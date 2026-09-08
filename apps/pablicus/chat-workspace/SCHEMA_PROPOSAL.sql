-- Additive rich-message proposal. The file itself does not apply remote changes.
-- Existing message RPCs, ordering, storage policies and Auth remain unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA pablicus_chat_private;
REVOKE ALL ON SCHEMA pablicus_chat_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA pablicus_chat_private TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA pablicus_chat_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- An explicit owner mapping makes saved messages idempotent across devices.
CREATE TABLE pablicus_chat_private.saved_conversations (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL UNIQUE REFERENCES public.conversations(id) ON DELETE CASCADE
);
ALTER TABLE pablicus_chat_private.saved_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pablicus_chat_private.saved_conversations FROM PUBLIC, anon, authenticated;

CREATE FUNCTION pablicus_chat_private.start_saved_conversation() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_sender uuid := auth.uid();
  v_conversation uuid;
BEGIN
  IF v_sender IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  -- Serializes concurrent creation for the same owner without global locking.
  PERFORM 1 FROM public.profiles WHERE id=v_sender AND is_approved FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not approved' USING ERRCODE='42501'; END IF;
  SELECT conversation_id INTO v_conversation FROM pablicus_chat_private.saved_conversations WHERE user_id=v_sender;
  IF FOUND THEN
    IF NOT public.is_member(v_conversation,v_sender) OR
       (SELECT count(*) FROM public.conversation_members WHERE conversation_id=v_conversation)<>1 THEN
      RAISE EXCEPTION 'saved conversation membership changed' USING ERRCODE='42501';
    END IF;
    RETURN v_conversation;
  END IF;
  INSERT INTO public.conversations(type,title,created_by) VALUES('group','Избранное',v_sender) RETURNING id INTO v_conversation;
  INSERT INTO public.conversation_members(conversation_id,user_id,role) VALUES(v_conversation,v_sender,'owner');
  INSERT INTO pablicus_chat_private.saved_conversations(user_id,conversation_id) VALUES(v_sender,v_conversation);
  RETURN v_conversation;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_chat_private.start_saved_conversation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pablicus_chat_private.start_saved_conversation() TO authenticated;
CREATE FUNCTION public.start_saved_conversation() RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pablicus_chat_private.start_saved_conversation();
$function$;
REVOKE ALL ON FUNCTION public.start_saved_conversation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_saved_conversation() TO authenticated;

ALTER TABLE public.messages DROP CONSTRAINT messages_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text','file','image','video','document','rich'));

CREATE FUNCTION pablicus_chat_private.send_rich_message(
  p_conversation_id uuid, p_client_message_id uuid, p_content jsonb
) RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_sender uuid := auth.uid();
  v_existing public.messages;
  v_message public.messages;
  v_block jsonb;
  v_id text;
  v_type text;
  v_path text;
  v_name text;
  v_mime text;
  v_metadata jsonb;
  v_size bigint;
  v_actual_size bigint;
  v_actual_mime text;
  v_total_size bigint := 0;
  v_text text := '';
  v_preview text := '';
  v_seen text[] := ARRAY[]::text[];
  v_seq bigint;
  v_key text;
BEGIN
  IF v_sender IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_sender AND is_approved) THEN
    RAISE EXCEPTION 'account not approved' USING ERRCODE='42501';
  END IF;
  IF p_conversation_id IS NULL OR NOT public.is_member(p_conversation_id,v_sender) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE='42501';
  END IF;
  IF p_client_message_id IS NULL THEN RAISE EXCEPTION 'client message id required' USING ERRCODE='22023'; END IF;
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' OR p_content->'v' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(p_content->'blocks') IS DISTINCT FROM 'array'
     OR octet_length(p_content::text) > 200000 THEN
    RAISE EXCEPTION 'invalid rich content' USING ERRCODE='22023';
  END IF;
  IF (p_content - ARRAY['v','blocks']::text[]) <> '{}'::jsonb
     OR jsonb_array_length(p_content->'blocks') NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid rich content' USING ERRCODE='22023';
  END IF;

  -- An acknowledged retry still succeeds if an attachment was subsequently removed.
  -- A UUID reused for another conversation/content never acknowledges that other row.
  SELECT * INTO v_existing FROM public.messages
    WHERE sender_id=v_sender AND client_message_id=p_client_message_id;
  IF FOUND THEN
    IF v_existing.conversation_id=p_conversation_id AND v_existing.type='rich'
       AND v_existing.attachment_metadata=p_content THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'client_message_conflict' USING ERRCODE='23505';
  END IF;

  FOR v_block IN SELECT value FROM jsonb_array_elements(p_content->'blocks') LOOP
    IF jsonb_typeof(v_block) <> 'object'
       OR jsonb_typeof(v_block->'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_block->'type') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid block' USING ERRCODE='22023';
    END IF;
    v_id := v_block->>'id'; v_type := v_block->>'type';
    IF v_id !~ '^[A-Za-z0-9_-]{1,128}$' OR v_id=ANY(v_seen) THEN
      RAISE EXCEPTION 'invalid or duplicate block id' USING ERRCODE='22023';
    END IF;
    v_seen := array_append(v_seen,v_id);
    IF v_type='text' THEN
      IF (v_block - ARRAY['id','type','text']::text[]) <> '{}'::jsonb
         OR jsonb_typeof(v_block->'text') IS DISTINCT FROM 'string'
         OR btrim(v_block->>'text')='' THEN
        RAISE EXCEPTION 'invalid text block' USING ERRCODE='22023';
      END IF;
      v_text := v_text || CASE WHEN v_text='' THEN '' ELSE E'\n' END || (v_block->>'text');
      IF char_length(v_text)>5000 THEN RAISE EXCEPTION 'message too long' USING ERRCODE='22023'; END IF;
    ELSIF v_type IN ('image','video','audio','document') THEN
      IF (v_block - ARRAY['id','type','path','name','mime','size','width','height','duration']::text[]) <> '{}'::jsonb
         OR jsonb_typeof(v_block->'path') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_block->'name') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_block->'mime') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_block->'size') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid media block' USING ERRCODE='22023';
      END IF;
      v_path := v_block->>'path'; v_name := v_block->>'name';
      v_mime := lower(btrim(split_part(v_block->>'mime',';',1)));
      IF char_length(v_name) NOT BETWEEN 1 AND 255 OR btrim(v_name)=''
         OR char_length(v_path)>1024 OR char_length(v_mime) NOT BETWEEN 3 AND 127
         OR v_mime !~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'
         OR v_path !~ ('^' || p_conversation_id::text || '/' || v_sender::text || '/' || p_client_message_id::text || '/' || v_id || '/[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$') THEN
        RAISE EXCEPTION 'invalid attachment path or name' USING ERRCODE='22023';
      END IF;
      IF (v_block->>'size') !~ '^[1-9][0-9]{0,10}$' THEN
        RAISE EXCEPTION 'invalid attachment size' USING ERRCODE='22023';
      END IF;
      v_size := (v_block->>'size')::bigint;
      IF v_size>26214400 THEN RAISE EXCEPTION 'attachment exceeds 25 MiB' USING ERRCODE='22023'; END IF;
      v_total_size := v_total_size+v_size;
      IF v_total_size>104857600 THEN RAISE EXCEPTION 'message attachments exceed 100 MiB' USING ERRCODE='22023'; END IF;
      IF (v_type='image' AND v_mime NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif'))
         OR (v_type='video' AND v_mime NOT IN ('video/mp4','video/webm','video/quicktime','video/ogg'))
         OR (v_type='audio' AND v_mime NOT IN ('audio/mp4','audio/mpeg','audio/webm','audio/ogg','audio/wav','audio/x-wav','audio/aac','audio/flac','audio/x-m4a')) THEN
        RAISE EXCEPTION 'attachment MIME does not match block type' USING ERRCODE='22023';
      END IF;
      FOREACH v_key IN ARRAY ARRAY['width','height','duration'] LOOP
        IF v_block ? v_key THEN
          IF jsonb_typeof(v_block->v_key) <> 'number' OR (v_block->>v_key)::numeric <= 0
             OR (v_block->>v_key)::numeric > (CASE WHEN v_key='duration' THEN 7200 ELSE 16384 END) THEN
            RAISE EXCEPTION 'invalid media dimensions or duration' USING ERRCODE='22023';
          END IF;
        END IF;
      END LOOP;
      SELECT metadata INTO v_metadata FROM storage.objects
        WHERE bucket_id='message-media' AND name=v_path AND owner_id=v_sender::text FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'uploaded object not found' USING ERRCODE='22023'; END IF;
      IF coalesce(v_metadata->>'size','') !~ '^[1-9][0-9]{0,10}$' THEN
        RAISE EXCEPTION 'uploaded object size unavailable' USING ERRCODE='22023';
      END IF;
      v_actual_size := (v_metadata->>'size')::bigint;
      v_actual_mime := lower(btrim(split_part(coalesce(v_metadata->>'mimetype',''),';',1)));
      IF v_actual_size<>v_size THEN RAISE EXCEPTION 'attachment size mismatch' USING ERRCODE='22023'; END IF;
      IF v_actual_mime<>v_mime THEN RAISE EXCEPTION 'attachment MIME mismatch' USING ERRCODE='22023'; END IF;
      v_preview := v_preview || CASE WHEN v_preview='' THEN '' ELSE ' · ' END ||
        CASE v_type WHEN 'image' THEN 'Фото' WHEN 'video' THEN 'Видео' WHEN 'audio' THEN 'Аудио' ELSE v_name END;
    ELSE RAISE EXCEPTION 'unsupported block type' USING ERRCODE='22023';
    END IF;
  END LOOP;

  -- Same locking discipline as the existing message RPCs.
  PERFORM 1 FROM public.conversations WHERE id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_existing FROM public.messages
    WHERE sender_id=v_sender AND client_message_id=p_client_message_id;
  IF FOUND THEN
    IF v_existing.conversation_id=p_conversation_id AND v_existing.type='rich'
       AND v_existing.attachment_metadata=p_content THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'client_message_conflict' USING ERRCODE='23505';
  END IF;
  UPDATE public.conversations SET last_seq=last_seq+1 WHERE id=p_conversation_id RETURNING last_seq INTO v_seq;
  INSERT INTO public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_path,attachment_metadata)
    VALUES(p_client_message_id,p_conversation_id,v_seq,v_sender,'rich',
      CASE WHEN v_text<>'' THEN v_text ELSE left(v_preview,5000) END,NULL,p_content)
    RETURNING * INTO v_message;
  RETURN v_message;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_chat_private.send_rich_message(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pablicus_chat_private.send_rich_message(uuid,uuid,jsonb) TO authenticated;

-- Only this narrow invoker entry point is exposed to the Data API.
CREATE FUNCTION public.send_rich_message(p_conversation_id uuid,p_client_message_id uuid,p_content jsonb)
RETURNS public.messages LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $function$
  SELECT * FROM pablicus_chat_private.send_rich_message(p_conversation_id,p_client_message_id,p_content);
$function$;
REVOKE ALL ON FUNCTION public.send_rich_message(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_rich_message(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
