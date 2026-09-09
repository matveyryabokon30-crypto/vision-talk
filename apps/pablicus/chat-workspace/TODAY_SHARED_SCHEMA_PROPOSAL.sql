-- Shared Today regression fix; reviewed schema proposal, not CLI migration history.
-- Apply after TASK_LIFECYCLE_SCHEMA_PROPOSAL.sql. Compatible before/after the
-- additive WORKSPACE_CONTENT_SCHEMA_PROPOSAL.sql: legacy content returns null.
-- Changes only read filtering and additive content output. No task data writes.
-- Today: active shared tasks scheduled for the viewer's local today, plus
-- undated tasks created on that local day. Assignment restricts only 'mine'.
BEGIN;

CREATE OR REPLACE FUNCTION pablicus_chat_private.list_tasks_v2(
 p_view text DEFAULT 'open',p_query text DEFAULT '',p_today date DEFAULT CURRENT_DATE,
 p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 40,p_timezone text DEFAULT 'UTC'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_user uuid:=auth.uid(); v_query text; v_cursor_time timestamptz; v_cursor_id uuid; v_result jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
 -- Keep approval valid throughout this read, matching assert_message_member.
 PERFORM 1 FROM public.profiles p WHERE p.id=v_user AND p.is_approved FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account not approved' USING ERRCODE='42501'; END IF;
 IF p_view IS NULL OR p_view NOT IN ('open','mine','overdue','completed','archived','today') THEN
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
 IF NOT pablicus_chat_private.valid_task_timezone(p_timezone) THEN RAISE EXCEPTION 'invalid task timezone' USING ERRCODE='22023'; END IF;
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

 WITH memberships AS MATERIALIZED (
  SELECT cm.conversation_id FROM public.conversation_members cm WHERE cm.user_id=v_user FOR SHARE OF cm
 ), matching AS MATERIALIZED (
  SELECT t.*,c.title AS explicit_conversation_title
  FROM pablicus_chat_private.canvas_tasks t
  JOIN public.conversations c ON c.id=t.conversation_id
  JOIN memberships cm ON cm.conversation_id=t.conversation_id
  WHERE t.deleted_at IS NULL
   AND CASE WHEN p_view='archived' THEN t.archived_at IS NOT NULL ELSE t.archived_at IS NULL AND t.completed=(p_view='completed') END
   AND (p_view<>'mine' OR t.assignee_id=v_user)
   AND (p_view<>'overdue' OR CASE WHEN t.due_at IS NOT NULL THEN t.due_at<CURRENT_TIMESTAMP ELSE t.due_date<p_today END)
   -- Today is shared across accessible conversations, not restricted by assignee.
   -- An undated item saved today is visible today without changing its due date.
   -- An explicit schedule always wins over its creation date.
   AND (p_view<>'today' OR CASE
    WHEN t.due_at IS NOT NULL THEN (t.due_at AT TIME ZONE p_timezone)::date=p_today
    WHEN t.due_date IS NOT NULL THEN t.due_date=p_today
    ELSE (t.created_at AT TIME ZONE p_timezone)::date=p_today END)
   AND (v_query='' OR strpos(lower(t.title),v_query)>0)
 ), candidates AS MATERIALIZED (
  SELECT * FROM matching t WHERE (p_cursor IS NULL OR (t.created_at,t.id)<(v_cursor_time,v_cursor_id))
  ORDER BY t.created_at DESC,t.id DESC
  LIMIT p_limit+1
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT p_limit
 ), items AS (
  SELECT t.created_at,t.id,jsonb_build_object(
   'content',to_jsonb(t)->'content',
   'id',t.id,'title',t.title,'assignee_id',t.assignee_id,'due_date',t.due_date,'completed',t.completed,
   'due_at',t.due_at,'due_timezone',t.due_timezone,'reminder_minutes',t.reminder_minutes,
   'followup_minutes',t.followup_minutes,'archived_at',t.archived_at,'schedule_version',t.schedule_version,
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
  'total_count',(SELECT count(*) FROM matching),
  'tasks',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM items),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN
   (SELECT jsonb_build_object('created_at',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1)
   ELSE NULL END
 ) INTO v_result;
 RETURN v_result;
END;
$function$;

-- Preserve private implementation/public invoker access boundaries explicitly.
REVOKE ALL ON FUNCTION pablicus_chat_private.list_tasks_v2(text,text,date,jsonb,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pablicus_chat_private.list_tasks_v2(text,text,date,jsonb,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
