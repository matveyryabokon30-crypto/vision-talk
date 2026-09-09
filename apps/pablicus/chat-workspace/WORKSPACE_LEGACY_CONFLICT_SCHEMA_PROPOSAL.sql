-- Preserve stale-revision conflict handling for legacy metadata-only clients.
-- Apply after WORKSPACE_CONTENT_SCHEMA_PROPOSAL.sql. Existing data/ACLs unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION pablicus_chat_private.update_canvas_task(
 p_conversation_id uuid,p_task_id uuid,p_expected_revision integer,p_title text,p_assignee_id uuid,p_due_date date,p_completed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_task pablicus_chat_private.canvas_tasks;
BEGIN
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_completed IS NULL THEN
  RAISE EXCEPTION 'invalid task update' USING ERRCODE='22023';
 END IF;
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_task FROM pablicus_chat_private.canvas_tasks WHERE id=p_task_id AND conversation_id=p_conversation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'task not in conversation' USING ERRCODE='42501'; END IF;
 IF v_task.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'task deleted' USING ERRCODE='22023'; END IF;
 IF v_task.due_at IS NOT NULL AND p_due_date IS DISTINCT FROM v_task.due_date THEN RAISE EXCEPTION 'task_schedule_requires_v2' USING ERRCODE='22023'; END IF;
 -- Same-value retries are safe even when their original assignee later leaves.
 IF v_task.title=btrim(p_title) AND v_task.assignee_id IS NOT DISTINCT FROM p_assignee_id
  AND v_task.due_date IS NOT DISTINCT FROM p_due_date AND v_task.completed=p_completed THEN
  RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
 END IF;
 IF v_task.revision<>p_expected_revision THEN RAISE EXCEPTION 'task_revision_conflict' USING ERRCODE='40001'; END IF;
 IF v_task.content IS NOT NULL AND v_task.title IS DISTINCT FROM btrim(p_title) THEN
  RAISE EXCEPTION 'workspace_content_requires_v3' USING ERRCODE='22023'; END IF;
 PERFORM pablicus_chat_private.validate_canvas_task(p_conversation_id,p_title,p_assignee_id,p_due_date);
 UPDATE pablicus_chat_private.canvas_tasks SET title=btrim(p_title),assignee_id=p_assignee_id,due_date=p_due_date,completed=p_completed,
  revision=revision+1,updated_at=clock_timestamp(),updated_by=v_user WHERE id=p_task_id;
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION pablicus_chat_private.update_canvas_task_v2(
 p_conversation_id uuid,p_task_id uuid,p_expected_revision integer,p_title text,p_assignee_id uuid,p_due_date date,p_completed boolean,p_schedule jsonb DEFAULT NULL,p_archived boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_task pablicus_chat_private.canvas_tasks;v_schedule jsonb;v_date date;v_archive timestamptz;
BEGIN
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_completed IS NULL THEN
  RAISE EXCEPTION 'invalid task update' USING ERRCODE='22023';
 END IF;
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_task FROM pablicus_chat_private.canvas_tasks WHERE id=p_task_id AND conversation_id=p_conversation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'task not in conversation' USING ERRCODE='42501'; END IF;
 IF v_task.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'task deleted' USING ERRCODE='22023'; END IF;
 v_schedule:=CASE WHEN p_schedule IS NULL THEN
  CASE WHEN v_task.due_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('due_at',v_task.due_at,'timezone',v_task.due_timezone,'reminder_minutes',v_task.reminder_minutes,'followup_minutes',v_task.followup_minutes) END
  ELSE pablicus_chat_private.normalize_task_schedule(p_schedule) END;
 v_date:=CASE WHEN v_schedule->>'due_at' IS NOT NULL THEN ((v_schedule->>'due_at')::timestamptz AT TIME ZONE (v_schedule->>'timezone'))::date ELSE p_due_date END;
 v_archive:=CASE WHEN p_archived IS NULL THEN v_task.archived_at WHEN p_archived THEN coalesce(v_task.archived_at,clock_timestamp()) ELSE NULL END;
 -- Same-value retries are safe even when their original assignee later leaves.
 IF v_task.title=btrim(p_title) AND v_task.assignee_id IS NOT DISTINCT FROM p_assignee_id
  AND v_task.due_date IS NOT DISTINCT FROM v_date AND v_task.completed=p_completed
  AND v_task.due_at IS NOT DISTINCT FROM (v_schedule->>'due_at')::timestamptz
  AND v_task.due_timezone IS NOT DISTINCT FROM v_schedule->>'timezone'
  AND v_task.reminder_minutes IS NOT DISTINCT FROM (v_schedule->>'reminder_minutes')::integer
  AND v_task.followup_minutes IS NOT DISTINCT FROM (v_schedule->>'followup_minutes')::integer
  AND v_task.archived_at IS NOT DISTINCT FROM v_archive THEN
  RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
 END IF;
 IF v_task.revision<>p_expected_revision THEN RAISE EXCEPTION 'task_revision_conflict' USING ERRCODE='40001'; END IF;
 IF v_task.content IS NOT NULL AND v_task.title IS DISTINCT FROM btrim(p_title) THEN
  RAISE EXCEPTION 'workspace_content_requires_v3' USING ERRCODE='22023'; END IF;
 PERFORM pablicus_chat_private.validate_canvas_task(p_conversation_id,p_title,p_assignee_id,v_date);
 UPDATE pablicus_chat_private.canvas_tasks SET title=btrim(p_title),assignee_id=p_assignee_id,due_date=v_date,completed=p_completed,
  due_at=(v_schedule->>'due_at')::timestamptz,due_timezone=v_schedule->>'timezone',
  reminder_minutes=(v_schedule->>'reminder_minutes')::integer,followup_minutes=(v_schedule->>'followup_minutes')::integer,archived_at=v_archive,
  revision=revision+1,updated_at=clock_timestamp(),updated_by=v_user WHERE id=p_task_id;
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

NOTIFY pgrst,'reload schema';
COMMIT;
