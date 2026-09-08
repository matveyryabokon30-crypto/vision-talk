-- Additive message actions. Apply after the rich-message/reply proposals.
-- Original message payloads remain immutable: edit overlays and deletion markers
-- preserve acknowledged send retries, stable sequences and existing reply IDs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF to_regprocedure('pablicus_chat_private.send_rich_message(uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'rich-message schema must be installed first';
  END IF;
END;
$guard$;

ALTER TABLE public.messages
  ADD COLUMN message_revision integer NOT NULL DEFAULT 0 CHECK (message_revision>=0),
  ADD COLUMN edited_body text,
  ADD COLUMN edited_content jsonb,
  ADD COLUMN edited_at timestamptz,
  ADD COLUMN deleted_at timestamptz;

-- Existing permissive membership policies still decide who may read a chat.
-- This additional condition prevents REST from exposing deleted originals.
CREATE POLICY messages_hide_deleted ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

CREATE TABLE pablicus_chat_private.message_pins (
  message_id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  pinned_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_pins_conversation_created_idx ON pablicus_chat_private.message_pins(conversation_id,created_at DESC);
CREATE TABLE pablicus_chat_private.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍','❤️','🔥','😂','😮','😢','🙏')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,user_id)
);
CREATE INDEX message_reactions_conversation_idx ON pablicus_chat_private.message_reactions(conversation_id);
CREATE INDEX message_reactions_user_idx ON pablicus_chat_private.message_reactions(user_id);
CREATE INDEX message_pins_user_idx ON pablicus_chat_private.message_pins(pinned_by);
ALTER TABLE pablicus_chat_private.message_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE pablicus_chat_private.message_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pablicus_chat_private.message_pins,pablicus_chat_private.message_reactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON pablicus_chat_private.message_pins,pablicus_chat_private.message_reactions TO authenticated;
CREATE POLICY message_pins_member_read ON pablicus_chat_private.message_pins FOR SELECT TO authenticated
  USING (public.is_member(conversation_id,(SELECT auth.uid())) AND EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND is_approved));
CREATE POLICY message_reactions_member_read ON pablicus_chat_private.message_reactions FOR SELECT TO authenticated
  USING (public.is_member(conversation_id,(SELECT auth.uid())) AND EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND is_approved));

CREATE FUNCTION pablicus_chat_private.assert_message_member(p_conversation_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=v_user AND is_approved FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not approved' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.conversation_members WHERE conversation_id=p_conversation_id AND user_id=v_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not a member' USING ERRCODE='42501'; END IF;
  RETURN v_user;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_chat_private.assert_message_member(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION pablicus_chat_private.edit_message_text(
  p_conversation_id uuid,p_message_id uuid,p_expected_revision integer,p_text text,p_block_id text DEFAULT NULL
) RETURNS public.messages LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id);
  v_message public.messages;
  v_content jsonb;
  v_block jsonb;
  v_index integer;
  v_body text;
BEGIN
  IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_text IS NULL OR btrim(p_text)='' OR char_length(p_text)>5000 THEN
    RAISE EXCEPTION 'invalid message edit' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_message FROM public.messages WHERE id=p_message_id AND conversation_id=p_conversation_id FOR UPDATE;
  IF NOT FOUND OR v_message.sender_id<>v_user THEN RAISE EXCEPTION 'message not owned' USING ERRCODE='42501'; END IF;
  IF v_message.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'message deleted' USING ERRCODE='22023'; END IF;
  IF v_message.type='text' THEN
    IF p_block_id IS NOT NULL THEN RAISE EXCEPTION 'text message has no block' USING ERRCODE='22023'; END IF;
    IF coalesce(v_message.edited_body,v_message.body)=p_text THEN RETURN v_message; END IF;
    v_body:=p_text;
  ELSIF v_message.type='rich' THEN
    IF p_block_id IS NULL OR p_block_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'text block required' USING ERRCODE='22023'; END IF;
    v_content:=coalesce(v_message.edited_content,v_message.attachment_metadata);
    SELECT value,(ordinality-1)::integer INTO v_block,v_index
      FROM jsonb_array_elements(v_content->'blocks') WITH ORDINALITY WHERE value->>'id'=p_block_id;
    IF NOT FOUND OR v_block->>'type'<>'text' THEN RAISE EXCEPTION 'text block not found' USING ERRCODE='22023'; END IF;
    IF v_block->>'text'=p_text THEN RETURN v_message; END IF;
    v_content:=jsonb_set(v_content,ARRAY['blocks',v_index::text,'text'],to_jsonb(p_text),false);
    SELECT string_agg(value->>'text',E'\n' ORDER BY ordinality) INTO v_body
      FROM jsonb_array_elements(v_content->'blocks') WITH ORDINALITY WHERE value->>'type'='text';
    IF char_length(v_body)>5000 OR octet_length(v_content::text)>200000 THEN RAISE EXCEPTION 'message too long' USING ERRCODE='22023'; END IF;
  ELSE RAISE EXCEPTION 'message text cannot be edited' USING ERRCODE='22023';
  END IF;
  -- Same-value retries above return the current row; stale differing edits fail.
  IF v_message.message_revision<>p_expected_revision THEN RAISE EXCEPTION 'message_revision_conflict' USING ERRCODE='40001'; END IF;
  UPDATE public.messages SET edited_body=v_body,edited_content=v_content,edited_at=clock_timestamp(),message_revision=message_revision+1
    WHERE id=p_message_id RETURNING * INTO v_message;
  RETURN v_message;
END;
$function$;

CREATE FUNCTION pablicus_chat_private.delete_message(
  p_conversation_id uuid,p_message_id uuid,p_expected_revision integer
) RETURNS public.messages LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_message public.messages;
BEGIN
  IF p_expected_revision IS NULL OR p_expected_revision<0 THEN RAISE EXCEPTION 'invalid message revision' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_message FROM public.messages WHERE id=p_message_id AND conversation_id=p_conversation_id FOR UPDATE;
  IF NOT FOUND OR v_message.sender_id<>v_user THEN RAISE EXCEPTION 'message not owned' USING ERRCODE='42501'; END IF;
  IF v_message.deleted_at IS NOT NULL THEN RETURN v_message; END IF;
  IF v_message.message_revision<>p_expected_revision THEN RAISE EXCEPTION 'message_revision_conflict' USING ERRCODE='40001'; END IF;
  UPDATE public.messages SET deleted_at=clock_timestamp(),message_revision=message_revision+1 WHERE id=p_message_id RETURNING * INTO v_message;
  DELETE FROM pablicus_chat_private.message_pins WHERE message_id=p_message_id;
  DELETE FROM pablicus_chat_private.message_reactions WHERE message_id=p_message_id;
  RETURN v_message;
END;
$function$;

CREATE FUNCTION pablicus_chat_private.set_message_pin(p_conversation_id uuid,p_message_id uuid,p_pinned boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_message public.messages;
BEGIN
  IF p_pinned IS NULL THEN RAISE EXCEPTION 'pin state required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_message FROM public.messages WHERE id=p_message_id AND conversation_id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'message not in conversation' USING ERRCODE='42501'; END IF;
  IF v_message.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'message deleted' USING ERRCODE='22023'; END IF;
  IF p_pinned THEN
    INSERT INTO pablicus_chat_private.message_pins(message_id,conversation_id,pinned_by)
      VALUES(p_message_id,p_conversation_id,v_user) ON CONFLICT(message_id) DO NOTHING;
  ELSE DELETE FROM pablicus_chat_private.message_pins WHERE message_id=p_message_id;
  END IF;
  RETURN p_pinned;
END;
$function$;

CREATE FUNCTION pablicus_chat_private.set_message_reaction(p_conversation_id uuid,p_message_id uuid,p_emoji text,p_active boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_message public.messages;
BEGIN
  IF p_active IS NULL OR p_emoji IS NULL OR p_emoji NOT IN ('👍','❤️','🔥','😂','😮','😢','🙏') THEN
    RAISE EXCEPTION 'invalid reaction' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_message FROM public.messages WHERE id=p_message_id AND conversation_id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'message not in conversation' USING ERRCODE='42501'; END IF;
  IF v_message.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'message deleted' USING ERRCODE='22023'; END IF;
  IF p_active THEN
    INSERT INTO pablicus_chat_private.message_reactions(message_id,conversation_id,user_id,emoji)
      VALUES(p_message_id,p_conversation_id,v_user,p_emoji)
      ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=excluded.emoji;
  ELSE DELETE FROM pablicus_chat_private.message_reactions WHERE message_id=p_message_id AND user_id=v_user AND emoji=p_emoji;
  END IF;
  RETURN p_active;
END;
$function$;

CREATE FUNCTION pablicus_chat_private.get_message_actions(p_conversation_id uuid,p_message_ids uuid[])
RETURNS TABLE(message_id uuid,pinned boolean,reactions jsonb,message_revision integer,edited_body text,edited_content jsonb,edited_at timestamptz,deleted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id);
BEGIN
  IF p_message_ids IS NULL OR cardinality(p_message_ids)>200 OR array_position(p_message_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid message IDs' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_message_ids) q(id) LEFT JOIN public.messages m ON m.id=q.id AND m.conversation_id=p_conversation_id WHERE m.id IS NULL) THEN
    RAISE EXCEPTION 'message not in conversation' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT m.id,
    m.deleted_at IS NULL AND EXISTS(SELECT 1 FROM pablicus_chat_private.message_pins p WHERE p.message_id=m.id),
    CASE WHEN m.deleted_at IS NOT NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object('emoji',r.emoji,'count',r.total,'mine',r.mine) ORDER BY r.emoji)
      FROM (SELECT x.emoji,count(*)::integer AS total,bool_or(x.user_id=v_user) AS mine
        FROM pablicus_chat_private.message_reactions x WHERE x.message_id=m.id GROUP BY x.emoji) r
    ),'[]'::jsonb) END,
    m.message_revision,CASE WHEN m.deleted_at IS NULL THEN m.edited_body END,
    CASE WHEN m.deleted_at IS NULL THEN m.edited_content END,m.edited_at,m.deleted_at
  FROM public.messages m WHERE m.conversation_id=p_conversation_id AND m.id=ANY(p_message_ids) ORDER BY m.server_seq;
END;
$function$;

CREATE FUNCTION pablicus_chat_private.get_pinned_messages(p_conversation_id uuid)
RETURNS SETOF public.messages LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id);
BEGIN
  RETURN QUERY SELECT m.* FROM pablicus_chat_private.message_pins p JOIN public.messages m ON m.id=p.message_id
    WHERE p.conversation_id=p_conversation_id AND m.conversation_id=p_conversation_id AND m.deleted_at IS NULL
    ORDER BY p.created_at DESC,m.server_seq DESC LIMIT 50;
END;
$function$;

-- The exposed entry points are invokers. All authorization and mutation remain
-- inside the private implementations with fixed empty search paths.
CREATE FUNCTION public.edit_message_text(p_conversation_id uuid,p_message_id uuid,p_expected_revision integer,p_text text,p_block_id text DEFAULT NULL)
RETURNS public.messages LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM pablicus_chat_private.edit_message_text(p_conversation_id,p_message_id,p_expected_revision,p_text,p_block_id);
$function$;
CREATE FUNCTION public.delete_message(p_conversation_id uuid,p_message_id uuid,p_expected_revision integer)
RETURNS public.messages LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM pablicus_chat_private.delete_message(p_conversation_id,p_message_id,p_expected_revision);
$function$;
CREATE FUNCTION public.set_message_pin(p_conversation_id uuid,p_message_id uuid,p_pinned boolean)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
  SELECT pablicus_chat_private.set_message_pin(p_conversation_id,p_message_id,p_pinned);
$function$;
CREATE FUNCTION public.set_message_reaction(p_conversation_id uuid,p_message_id uuid,p_emoji text,p_active boolean)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
  SELECT pablicus_chat_private.set_message_reaction(p_conversation_id,p_message_id,p_emoji,p_active);
$function$;
CREATE FUNCTION public.get_message_actions(p_conversation_id uuid,p_message_ids uuid[])
RETURNS TABLE(message_id uuid,pinned boolean,reactions jsonb,message_revision integer,edited_body text,edited_content jsonb,edited_at timestamptz,deleted_at timestamptz)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM pablicus_chat_private.get_message_actions(p_conversation_id,p_message_ids);
$function$;
CREATE FUNCTION public.get_pinned_messages(p_conversation_id uuid)
RETURNS SETOF public.messages LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM pablicus_chat_private.get_pinned_messages(p_conversation_id);
$function$;

REVOKE ALL ON FUNCTION pablicus_chat_private.edit_message_text(uuid,uuid,integer,text,text),public.edit_message_text(uuid,uuid,integer,text,text),
  pablicus_chat_private.delete_message(uuid,uuid,integer),public.delete_message(uuid,uuid,integer),
  pablicus_chat_private.set_message_pin(uuid,uuid,boolean),public.set_message_pin(uuid,uuid,boolean),
  pablicus_chat_private.set_message_reaction(uuid,uuid,text,boolean),public.set_message_reaction(uuid,uuid,text,boolean),
  pablicus_chat_private.get_message_actions(uuid,uuid[]),public.get_message_actions(uuid,uuid[]),
  pablicus_chat_private.get_pinned_messages(uuid),public.get_pinned_messages(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pablicus_chat_private.edit_message_text(uuid,uuid,integer,text,text),public.edit_message_text(uuid,uuid,integer,text,text),
  pablicus_chat_private.delete_message(uuid,uuid,integer),public.delete_message(uuid,uuid,integer),
  pablicus_chat_private.set_message_pin(uuid,uuid,boolean),public.set_message_pin(uuid,uuid,boolean),
  pablicus_chat_private.set_message_reaction(uuid,uuid,text,boolean),public.set_message_reaction(uuid,uuid,text,boolean),
  pablicus_chat_private.get_message_actions(uuid,uuid[]),public.get_message_actions(uuid,uuid[]),
  pablicus_chat_private.get_pinned_messages(uuid),public.get_pinned_messages(uuid)
  TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
