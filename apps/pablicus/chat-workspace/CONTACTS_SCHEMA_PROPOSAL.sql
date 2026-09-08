-- Pablicus discovery: public profile fields only; no contact-book upload.
-- Apply after review. Existing messages, memberships and profile permissions stay intact.
BEGIN;

CREATE OR REPLACE FUNCTION public.pablicus_search_people(p_query text)
RETURNS TABLE(id uuid,username text,display_name text,avatar_url text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $function$
DECLARE
 v_me uuid := auth.uid();
 v_query text := lower(ltrim(btrim(coalesce(p_query,'')),'@'));
BEGIN
 IF v_me IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_me AND p.is_approved) THEN
  RAISE EXCEPTION 'not authenticated or account unavailable' USING ERRCODE='42501';
 END IF;
 IF char_length(v_query)<2 OR char_length(v_query)>80 THEN RETURN; END IF;
 RETURN QUERY
 SELECT p.id,p.username,p.display_name,p.avatar_url
 FROM public.profiles p
 WHERE p.is_approved AND p.id<>v_me
   AND (strpos(lower(p.username),v_query)>0 OR strpos(lower(coalesce(p.display_name,'')),v_query)>0)
 ORDER BY (lower(p.username)=v_query) DESC,
   (lower(coalesce(p.display_name,''))=v_query) DESC,
   lower(coalesce(nullif(p.display_name,''),p.username)),p.username,p.id
 LIMIT 20;
END;
$function$;
REVOKE ALL ON FUNCTION public.pablicus_search_people(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pablicus_search_people(text) TO authenticated;

-- Serialise both directions of a direct conversation. Simultaneous taps use
-- the same transaction lock, then the second call reuses the first conversation.
CREATE SCHEMA IF NOT EXISTS pablicus_chat_private;
REVOKE ALL ON SCHEMA pablicus_chat_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA pablicus_chat_private TO authenticated;
CREATE OR REPLACE FUNCTION pablicus_chat_private.start_direct_conversation(target_username text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_me uuid:=auth.uid(); v_target uuid; v_existing uuid; v_created uuid;
 v_username text:=lower(ltrim(btrim(coalesce(target_username,'')),'@'));
BEGIN
 IF v_me IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_me AND p.is_approved) THEN
  RAISE EXCEPTION 'not authenticated or account unavailable' USING ERRCODE='42501';
 END IF;
 IF char_length(v_username)<2 OR char_length(v_username)>80 THEN
  RAISE EXCEPTION 'user not found' USING ERRCODE='22023';
 END IF;
 SELECT p.id INTO v_target FROM public.profiles p WHERE p.username=v_username AND p.is_approved;
 IF v_target IS NULL THEN RAISE EXCEPTION 'user not found' USING ERRCODE='22023'; END IF;
 IF v_target=v_me THEN RAISE EXCEPTION 'cannot chat with yourself' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   least(v_me::text,v_target::text)||':'||greatest(v_me::text,v_target::text),0));
 SELECT c.id INTO v_existing
 FROM public.conversations c
 JOIN public.conversation_members a ON a.conversation_id=c.id AND a.user_id=v_me
 JOIN public.conversation_members b ON b.conversation_id=c.id AND b.user_id=v_target
 WHERE c.type='direct' AND (SELECT count(*) FROM public.conversation_members x WHERE x.conversation_id=c.id)=2
 ORDER BY c.created_at,c.id LIMIT 1;
 IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
 INSERT INTO public.conversations(type,created_by) VALUES('direct',v_me) RETURNING id INTO v_created;
 INSERT INTO public.conversation_members(conversation_id,user_id,role)
 VALUES(v_created,v_me,'owner'),(v_created,v_target,'member');
 RETURN v_created;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_chat_private.start_direct_conversation(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION pablicus_chat_private.start_direct_conversation(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.start_direct_conversation(target_username text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT pablicus_chat_private.start_direct_conversation(target_username); $function$;
REVOKE ALL ON FUNCTION public.start_direct_conversation(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_direct_conversation(text) TO authenticated;

-- Keep the established list contract. Display the peer's chosen name, falling
-- back to their handle, while retaining the existing membership and unread rules.
CREATE OR REPLACE FUNCTION public.my_conversations_v3()
RETURNS TABLE(id uuid,title text,last_message text,last_seq bigint,last_read_seq bigint,unread_count bigint,last_message_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$
 SELECT c.id,coalesce(c.title,
  (SELECT coalesce(nullif(btrim(p.display_name),''),'@'||p.username)
   FROM public.conversation_members cm2 JOIN public.profiles p ON p.id=cm2.user_id
   WHERE cm2.conversation_id=c.id AND cm2.user_id<>auth.uid() AND p.is_approved
   ORDER BY cm2.user_id LIMIT 1),'Диалог'),
  lm.body,c.last_seq,cm.last_read_seq,
  (SELECT count(*)::bigint FROM public.messages um WHERE um.conversation_id=c.id
   AND um.server_seq>cm.last_read_seq AND um.sender_id<>auth.uid()
   AND to_jsonb(um)->>'deleted_at' IS NULL),
  coalesce(lm.created_at,c.created_at)
 FROM public.conversations c
 JOIN public.conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=auth.uid()
 JOIN public.profiles me ON me.id=auth.uid() AND me.is_approved
 LEFT JOIN LATERAL (
  SELECT CASE m.type
   WHEN 'image' THEN coalesce(nullif(coalesce(to_jsonb(m)->>'edited_body',m.body),''),'Фото')
   WHEN 'video' THEN coalesce(nullif(coalesce(to_jsonb(m)->>'edited_body',m.body),''),'Видео')
   WHEN 'document' THEN coalesce(m.attachment_metadata->>'name','Документ')
   WHEN 'file' THEN coalesce(m.attachment_metadata->>'name',to_jsonb(m)->>'edited_body',m.body,'Файл')
   ELSE coalesce(to_jsonb(m)->>'edited_body',m.body) END AS body,m.created_at
  FROM public.messages m WHERE m.conversation_id=c.id AND to_jsonb(m)->>'deleted_at' IS NULL
  ORDER BY m.server_seq DESC LIMIT 1
 ) lm ON true
 ORDER BY coalesce(lm.created_at,c.created_at) DESC,c.id;
$function$;
REVOKE ALL ON FUNCTION public.my_conversations_v3() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_conversations_v3() TO authenticated;

-- Existing clients can still call the earlier list RPCs. Keep their exact
-- return shapes and creation-time ordering, using the same safe preview source.
CREATE OR REPLACE FUNCTION public.my_conversations()
RETURNS TABLE(id uuid,title text,last_message text,last_seq bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$
 SELECT v.id,v.title,v.last_message,v.last_seq
 FROM public.my_conversations_v3() v JOIN public.conversations c ON c.id=v.id
 ORDER BY c.created_at DESC,c.id;
$function$;
CREATE OR REPLACE FUNCTION public.my_conversations_v2()
RETURNS TABLE(id uuid,title text,last_message text,last_seq bigint,last_read_seq bigint,unread_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$
 SELECT v.id,v.title,v.last_message,v.last_seq,coalesce(v.last_read_seq,0),v.unread_count
 FROM public.my_conversations_v3() v JOIN public.conversations c ON c.id=v.id
 ORDER BY c.created_at DESC,c.id;
$function$;
REVOKE ALL ON FUNCTION public.my_conversations(),public.my_conversations_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_conversations(),public.my_conversations_v2() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
