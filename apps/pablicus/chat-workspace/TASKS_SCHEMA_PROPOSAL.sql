-- Shared tasks across the caller's current conversations. Additive, read only.
-- Apply after CANVAS_SCHEMA_PROPOSAL.sql; no direct task table access is granted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
 IF to_regclass('pablicus_chat_private.canvas_tasks') IS NULL THEN
  RAISE EXCEPTION 'conversation canvas schema must be installed first';
 END IF;
END;
$guard$;

-- One bounded ordered page, including completed tasks, without sorting all tasks.
CREATE INDEX canvas_tasks_global_live_order_idx
 ON pablicus_chat_private.canvas_tasks(completed,created_at DESC,id DESC)
 WHERE deleted_at IS NULL;

CREATE FUNCTION pablicus_chat_private.list_tasks(
 p_view text DEFAULT 'open',p_query text DEFAULT '',p_today date DEFAULT CURRENT_DATE,
 p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 40
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_user uuid:=auth.uid(); v_query text; v_cursor_time timestamptz; v_cursor_id uuid; v_result jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
 -- Keep approval valid throughout this read, matching assert_message_member.
 PERFORM 1 FROM public.profiles p WHERE p.id=v_user AND p.is_approved FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account not approved' USING ERRCODE='42501'; END IF;
 IF p_view IS NULL OR p_view NOT IN ('open','mine','overdue','completed') THEN
  RAISE EXCEPTION 'invalid task view' USING ERRCODE='22023';
 END IF;
 IF p_query IS NULL OR char_length(p_query)>200 OR octet_length(p_query)>800 THEN
  RAISE EXCEPTION 'invalid task query' USING ERRCODE='22023';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 60 THEN
  RAISE EXCEPTION 'invalid task limit' USING ERRCODE='22023';
 END IF;
 IF p_today IS NULL OR NOT isfinite(p_today) OR p_today NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION 'invalid current date' USING ERRCODE='22023';
 END IF;
 v_query:=lower(btrim(p_query));
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor)<>'object' OR jsonb_typeof(p_cursor->'created_at') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_cursor->'id') IS DISTINCT FROM 'string' OR (p_cursor-'created_at'-'id')<>'{}'::jsonb
   OR (p_cursor->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   OR (p_cursor->>'created_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
   RAISE EXCEPTION 'invalid task cursor' USING ERRCODE='22023';
  END IF;
  BEGIN
   v_cursor_time:=(p_cursor->>'created_at')::timestamptz;
   v_cursor_id:=(p_cursor->>'id')::uuid;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
   RAISE EXCEPTION 'invalid task cursor' USING ERRCODE='22023';
  END;
  IF NOT isfinite(v_cursor_time) THEN RAISE EXCEPTION 'invalid task cursor' USING ERRCODE='22023'; END IF;
 END IF;

 WITH candidates AS MATERIALIZED (
  SELECT t.*,c.title AS explicit_conversation_title
  FROM pablicus_chat_private.canvas_tasks t
  JOIN public.conversations c ON c.id=t.conversation_id
  JOIN public.conversation_members cm ON cm.conversation_id=t.conversation_id AND cm.user_id=v_user
  WHERE t.deleted_at IS NULL AND t.completed=(p_view='completed')
   AND (p_view<>'mine' OR t.assignee_id=v_user)
   AND (p_view<>'overdue' OR t.due_date<p_today)
   AND (v_query='' OR strpos(lower(t.title),v_query)>0)
   AND (p_cursor IS NULL OR (t.created_at,t.id)<(v_cursor_time,v_cursor_id))
  ORDER BY t.created_at DESC,t.id DESC
  LIMIT p_limit+1
  -- Only membership rows contributing to the bounded page are locked. A
  -- concurrent membership deletion must complete before or after this read.
  FOR SHARE OF cm
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT p_limit
 ), items AS (
  SELECT t.created_at,t.id,jsonb_build_object(
   'id',t.id,'title',t.title,'assignee_id',t.assignee_id,'due_date',t.due_date,'completed',t.completed,
   'revision',t.revision,'source_message_id',t.source_message_id,'source_block_id',t.source_block_id,
   'created_at',t.created_at,'created_by',t.created_by,'updated_at',t.updated_at,'updated_by',t.updated_by,
   'conversation_id',t.conversation_id,
   'conversation_title',coalesce(t.explicit_conversation_title,
    (SELECT coalesce(nullif(btrim(p.display_name),''),'@'||p.username)
     FROM public.conversation_members peer JOIN public.profiles p ON p.id=peer.user_id
     WHERE peer.conversation_id=t.conversation_id AND peer.user_id<>v_user AND p.is_approved
     ORDER BY peer.user_id LIMIT 1),'Диалог'),
   'assignee_name',(SELECT coalesce(nullif(btrim(p.display_name),''),'@'||p.username)
     FROM public.profiles p JOIN public.conversation_members member ON member.user_id=p.id
      AND member.conversation_id=t.conversation_id
     WHERE p.id=t.assignee_id AND p.is_approved)
  ) AS item FROM page t
 )
 SELECT jsonb_build_object(
  'tasks',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM items),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN
   (SELECT jsonb_build_object('created_at',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1)
   ELSE NULL END
 ) INTO v_result;
 RETURN v_result;
END;
$function$;

CREATE FUNCTION public.pablicus_list_tasks(
 p_view text DEFAULT 'open',p_query text DEFAULT '',p_today date DEFAULT CURRENT_DATE,
 p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 40
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.list_tasks(p_view,p_query,p_today,p_cursor,p_limit);
$function$;
REVOKE ALL ON FUNCTION public.pablicus_list_tasks(text,text,date,jsonb,integer),
 pablicus_chat_private.list_tasks(text,text,date,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_list_tasks(text,text,date,jsonb,integer),
 pablicus_chat_private.list_tasks(text,text,date,jsonb,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
