-- Additive, read-only search/materials/usage API. Apply after message actions.
-- The file itself does not apply remote changes. Existing payloads stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF to_regprocedure('pablicus_chat_private.assert_message_member(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='messages' AND column_name='edited_content') THEN
    RAISE EXCEPTION 'message actions schema must be installed first';
  END IF;
END;
$guard$;

-- Read APIs use a fresh statement snapshot and do not take write locks.
CREATE FUNCTION pablicus_chat_private.assert_search_member(p_conversation_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.is_approved) THEN
    RAISE EXCEPTION 'account not approved' USING ERRCODE='42501';
  END IF;
  IF p_conversation_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id=p_conversation_id AND cm.user_id=v_user) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE='42501';
  END IF;
  RETURN v_user;
END;
$function$;

-- Accepts only an already authorized row from the outer RPC. The rich preview
-- body can contain filenames, so reconstruct real text from effective blocks.
CREATE FUNCTION pablicus_chat_private.effective_search_text(p_message public.messages)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
  SELECT CASE WHEN p_message.type='rich' THEN coalesce((
    SELECT string_agg(b.value->>'text',E'\n' ORDER BY b.ordinality)
    FROM jsonb_array_elements(CASE
      WHEN jsonb_typeof(coalesce(p_message.edited_content,p_message.attachment_metadata)->'blocks')='array'
      THEN coalesce(p_message.edited_content,p_message.attachment_metadata)->'blocks' ELSE '[]'::jsonb END)
      WITH ORDINALITY b(value,ordinality)
    WHERE b.value->>'type'='text'
  ),'') ELSE coalesce(p_message.edited_body,p_message.body,'') END;
$function$;

CREATE FUNCTION pablicus_chat_private.search_messages(
  p_conversation_id uuid,p_query text,p_before_seq bigint DEFAULT NULL,p_limit integer DEFAULT 30
) RETURNS TABLE(message_id uuid,server_seq bigint,sender_id uuid,created_at timestamptz,snippet text,message_revision integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_user uuid:=pablicus_chat_private.assert_search_member(p_conversation_id);
  v_query text:=lower(btrim(p_query));
BEGIN
  IF p_query IS NULL OR char_length(btrim(p_query)) NOT BETWEEN 1 AND 200
     OR octet_length(p_query)>1600 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_before_seq IS NOT NULL AND p_before_seq<1) THEN
    RAISE EXCEPTION 'invalid search parameters' USING ERRCODE='22023';
  END IF;
  -- strpos treats %, _ and backslash literally: no SQL wildcard language.
  -- Existing UNIQUE(conversation_id,server_seq) supports the keyset range/order.
  RETURN QUERY
    SELECT m.id,m.server_seq,m.sender_id,m.created_at,
      substring(t.body FROM greatest(1,strpos(lower(t.body),v_query)-80) FOR 280),m.message_revision
    FROM public.messages m
    CROSS JOIN LATERAL (SELECT pablicus_chat_private.effective_search_text(m) AS body) t
    WHERE m.conversation_id=p_conversation_id AND m.deleted_at IS NULL
      AND (p_before_seq IS NULL OR m.server_seq<p_before_seq)
      AND strpos(lower(t.body),v_query)>0
    ORDER BY m.server_seq DESC LIMIT p_limit;
END;
$function$;

-- Flatten all kinds before filtering, so every row has a deterministic cursor
-- inside its message. Multiple URLs in one text block get distinct ordinals.
CREATE FUNCTION pablicus_chat_private.message_material_rows(p_message public.messages)
RETURNS TABLE(block_id text,block_index integer,kind text,type text,path text,name text,mime text,size bigint,body text,url text,duration numeric)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
  WITH rich_blocks AS (
    SELECT b.value,b.ordinality::integer AS source_index
    FROM jsonb_array_elements(CASE WHEN p_message.type='rich'
      AND jsonb_typeof(coalesce(p_message.edited_content,p_message.attachment_metadata)->'blocks')='array'
      THEN coalesce(p_message.edited_content,p_message.attachment_metadata)->'blocks' ELSE '[]'::jsonb END)
      WITH ORDINALITY b(value,ordinality)
  ), attachments AS (
    SELECT b.value->>'id' AS block_id,b.source_index,0::bigint AS sub_index,
      CASE b.value->>'type' WHEN 'audio' THEN 'audio' WHEN 'document' THEN 'documents' ELSE 'media' END AS kind,
      b.value->>'type' AS type,b.value->>'path' AS path,b.value->>'name' AS name,b.value->>'mime' AS mime,
      CASE WHEN b.value->>'size' ~ '^[0-9]{1,18}$' THEN (b.value->>'size')::bigint END AS size,
      left(pablicus_chat_private.effective_search_text(p_message),280) AS body,NULL::text AS url,
      CASE WHEN b.value->>'duration' ~ '^[0-9]{1,6}([.][0-9]{1,6})?$' THEN (b.value->>'duration')::numeric END AS duration
    FROM rich_blocks b WHERE b.value->>'type' IN ('image','video','audio','document') AND coalesce(b.value->>'path','')<>''
    UNION ALL
    SELECT NULL::text,0,0::bigint,
      CASE WHEN lower(coalesce(p_message.attachment_metadata->>'mime_type',p_message.attachment_metadata->>'mime','')) LIKE 'audio/%' THEN 'audio'
        WHEN p_message.type IN ('image','video') THEN 'media' ELSE 'documents' END,
      CASE WHEN lower(coalesce(p_message.attachment_metadata->>'mime_type',p_message.attachment_metadata->>'mime','')) LIKE 'audio/%' THEN 'audio'
        WHEN p_message.type='file' THEN 'document' ELSE p_message.type END,
      p_message.attachment_path,coalesce(p_message.attachment_metadata->>'name','Файл'),
      coalesce(p_message.attachment_metadata->>'mime_type',p_message.attachment_metadata->>'mime','application/octet-stream'),
      CASE WHEN coalesce(p_message.attachment_metadata->>'size_bytes',p_message.attachment_metadata->>'size') ~ '^[0-9]{1,18}$'
        THEN coalesce(p_message.attachment_metadata->>'size_bytes',p_message.attachment_metadata->>'size')::bigint END,
      left(pablicus_chat_private.effective_search_text(p_message),280),NULL::text,NULL::numeric
    WHERE p_message.type IN ('file','image','video','document') AND coalesce(p_message.attachment_path,'')<>''
  ), text_blocks AS (
    SELECT b.value->>'id' AS block_id,b.source_index,b.value->>'text' AS body FROM rich_blocks b WHERE b.value->>'type'='text'
    UNION ALL
    SELECT NULL::text,1,pablicus_chat_private.effective_search_text(p_message) WHERE p_message.type<>'rich'
  ), links AS (
    SELECT b.block_id,b.source_index,u.ordinality AS sub_index,'links'::text AS kind,'link'::text AS type,
      NULL::text AS path,rtrim(u.parts[1], '.,;:!?)]}') AS name,NULL::text AS mime,NULL::bigint AS size,
      left(b.body,280) AS body,rtrim(u.parts[1], '.,;:!?)]}') AS url,NULL::numeric AS duration
    FROM text_blocks b CROSS JOIN LATERAL regexp_matches(coalesce(b.body,''),$url$https?://[^[:space:]<>"']+$url$,'gi')
      WITH ORDINALITY u(parts,ordinality)
  ), all_items AS (
    SELECT * FROM attachments UNION ALL SELECT * FROM links
  )
  SELECT i.block_id,(row_number() OVER (ORDER BY i.source_index,i.sub_index)-1)::integer,i.kind,i.type,i.path,i.name,i.mime,i.size,i.body,i.url,i.duration
  FROM all_items i;
$function$;

CREATE FUNCTION pablicus_chat_private.chat_materials(
  p_conversation_id uuid,p_kind text,p_query text DEFAULT '',p_before_seq bigint DEFAULT NULL,
  p_before_index integer DEFAULT NULL,p_limit integer DEFAULT 40
) RETURNS TABLE(message_id uuid,server_seq bigint,sender_id uuid,block_id text,block_index integer,kind text,type text,path text,name text,mime text,size bigint,body text,url text,created_at timestamptz,duration numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_user uuid:=pablicus_chat_private.assert_search_member(p_conversation_id);
  v_query text:=lower(btrim(coalesce(p_query,'')));
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('media','documents','audio','links')
     OR char_length(btrim(coalesce(p_query,'')))>200 OR octet_length(coalesce(p_query,''))>1600
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_before_seq IS NULL)<>(p_before_index IS NULL)
     OR (p_before_seq IS NOT NULL AND p_before_seq<1)
     OR (p_before_index IS NOT NULL AND p_before_index NOT BETWEEN 0 AND 100000) THEN
    RAISE EXCEPTION 'invalid material parameters' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT m.id,m.server_seq,m.sender_id,i.block_id,i.block_index,i.kind,i.type,i.path,i.name,i.mime,i.size,i.body,i.url,m.created_at,i.duration
    FROM public.messages m CROSS JOIN LATERAL pablicus_chat_private.message_material_rows(m) i
    WHERE m.conversation_id=p_conversation_id AND m.deleted_at IS NULL
      AND (p_before_seq IS NULL OR m.server_seq<=p_before_seq)
      AND (p_before_seq IS NULL OR m.server_seq<p_before_seq OR i.block_index>p_before_index)
      AND i.kind=p_kind
      AND (v_query='' OR strpos(lower(coalesce(i.name,'')||E'\n'||pablicus_chat_private.effective_search_text(m)||E'\n'||coalesce(i.url,'')),v_query)>0)
    ORDER BY m.server_seq DESC,i.block_index ASC LIMIT p_limit;
END;
$function$;

CREATE FUNCTION pablicus_chat_private.storage_usage()
RETURNS TABLE(total_bytes numeric,own_bytes numeric,object_count bigint,own_object_count bigint,unknown_size_count bigint,measured_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.is_approved) THEN
    RAISE EXCEPTION 'account not approved' USING ERRCODE='42501';
  END IF;
  -- Stored originals and stored archived versions count; deletion markers do not.
  -- No object paths, owner IDs, or individual private-chat measurements escape.
  RETURN QUERY
    SELECT coalesce(sum(s.bytes),0),coalesce(sum(s.bytes) FILTER(WHERE s.mine),0),count(*),
      count(*) FILTER(WHERE s.mine),count(*) FILTER(WHERE s.bytes IS NULL),statement_timestamp()
    FROM (
      SELECT CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::numeric END AS bytes,
        coalesce(nullif(o.owner_id,''),o.owner::text)=v_user::text AS mine
      FROM storage.objects o WHERE o.bucket_id='message-media' AND NOT o.is_delete_marker
    ) s;
END;
$function$;

CREATE FUNCTION public.pablicus_search_messages(
  p_conversation_id uuid,p_query text,p_before_seq bigint DEFAULT NULL,p_limit integer DEFAULT 30
) RETURNS TABLE(message_id uuid,server_seq bigint,sender_id uuid,created_at timestamptz,snippet text,message_revision integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM pablicus_chat_private.search_messages(p_conversation_id,p_query,p_before_seq,p_limit);
$function$;

CREATE FUNCTION public.pablicus_chat_materials(
  p_conversation_id uuid,p_kind text,p_query text DEFAULT '',p_before_seq bigint DEFAULT NULL,
  p_before_index integer DEFAULT NULL,p_limit integer DEFAULT 40
) RETURNS TABLE(message_id uuid,server_seq bigint,sender_id uuid,block_id text,block_index integer,kind text,type text,path text,name text,mime text,size bigint,body text,url text,created_at timestamptz,duration numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM pablicus_chat_private.chat_materials(p_conversation_id,p_kind,p_query,p_before_seq,p_before_index,p_limit);
$function$;

CREATE FUNCTION public.pablicus_storage_usage()
RETURNS TABLE(total_bytes numeric,own_bytes numeric,object_count bigint,own_object_count bigint,unknown_size_count bigint,measured_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM pablicus_chat_private.storage_usage();
$function$;

REVOKE ALL ON FUNCTION pablicus_chat_private.assert_search_member(uuid),
  pablicus_chat_private.effective_search_text(public.messages),pablicus_chat_private.message_material_rows(public.messages),
  pablicus_chat_private.search_messages(uuid,text,bigint,integer),public.pablicus_search_messages(uuid,text,bigint,integer),
  pablicus_chat_private.chat_materials(uuid,text,text,bigint,integer,integer),public.pablicus_chat_materials(uuid,text,text,bigint,integer,integer),
  pablicus_chat_private.storage_usage(),public.pablicus_storage_usage()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pablicus_chat_private.search_messages(uuid,text,bigint,integer),public.pablicus_search_messages(uuid,text,bigint,integer),
  pablicus_chat_private.chat_materials(uuid,text,text,bigint,integer,integer),public.pablicus_chat_materials(uuid,text,text,bigint,integer,integer),
  pablicus_chat_private.storage_usage(),public.pablicus_storage_usage() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
