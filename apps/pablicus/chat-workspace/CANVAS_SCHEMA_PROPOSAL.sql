-- Shared conversation canvas. Apply after rich/reply/actions schemas.
-- No changes to message payloads, sending, Auth or Storage permissions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
 IF to_regprocedure('pablicus_chat_private.assert_message_member(uuid)') IS NULL THEN
  RAISE EXCEPTION 'message actions schema must be installed first';
 END IF;
END;
$guard$;

CREATE TABLE pablicus_chat_private.conversation_canvases (
 conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
 body text NOT NULL DEFAULT '' CHECK(char_length(body)<=20000 AND octet_length(body)<=80000),
 plan_revision integer NOT NULL DEFAULT 0 CHECK(plan_revision>=0),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_at timestamptz,
 updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX conversation_canvases_updated_by_idx ON pablicus_chat_private.conversation_canvases(updated_by);

CREATE TABLE pablicus_chat_private.canvas_tasks (
 id uuid PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 500 AND octet_length(title)<=2000),
 assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 due_date date CHECK(due_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'),
 completed boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
 source_block_id text CHECK(source_block_id IS NULL OR source_block_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 deleted_at timestamptz,
 -- Immutable create request retained after edits/deletion for safe replay.
 create_payload jsonb NOT NULL
);
CREATE INDEX canvas_tasks_conversation_idx ON pablicus_chat_private.canvas_tasks(conversation_id);
CREATE INDEX canvas_tasks_live_order_idx ON pablicus_chat_private.canvas_tasks(conversation_id,created_at,id) WHERE deleted_at IS NULL;
CREATE INDEX canvas_tasks_assignee_idx ON pablicus_chat_private.canvas_tasks(assignee_id);
CREATE INDEX canvas_tasks_source_idx ON pablicus_chat_private.canvas_tasks(source_message_id);
CREATE INDEX canvas_tasks_created_by_idx ON pablicus_chat_private.canvas_tasks(created_by);
CREATE INDEX canvas_tasks_updated_by_idx ON pablicus_chat_private.canvas_tasks(updated_by);

ALTER TABLE pablicus_chat_private.conversation_canvases ENABLE ROW LEVEL SECURITY;
ALTER TABLE pablicus_chat_private.canvas_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pablicus_chat_private.conversation_canvases,pablicus_chat_private.canvas_tasks FROM PUBLIC,anon,authenticated;
-- Explicit deny policies document that only guarded functions may access these tables.
CREATE POLICY conversation_canvases_no_direct_access ON pablicus_chat_private.conversation_canvases
 FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY canvas_tasks_no_direct_access ON pablicus_chat_private.canvas_tasks
 FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);

CREATE FUNCTION pablicus_chat_private.canvas_snapshot(p_conversation_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path='' AS $function$
 SELECT jsonb_build_object(
  'conversation_id',p_conversation_id,
  'revision',coalesce(c.revision,0),
  'canvas',jsonb_build_object('body',coalesce(c.body,''),'revision',coalesce(c.plan_revision,0),
    'updated_at',c.updated_at,'updated_by',c.updated_by),
  'tasks',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'assignee_id',t.assignee_id,'due_date',t.due_date,'completed',t.completed,
    'revision',t.revision,'source_message_id',t.source_message_id,'source_block_id',t.source_block_id,
    'created_at',t.created_at,'created_by',t.created_by,'updated_at',t.updated_at,'updated_by',t.updated_by
  ) ORDER BY t.created_at,t.id) FROM pablicus_chat_private.canvas_tasks t
   WHERE t.conversation_id=p_conversation_id AND t.deleted_at IS NULL),'[]'::jsonb),
  'participants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'username',p.username)
    ORDER BY coalesce(nullif(btrim(p.display_name),''),p.username),p.id)
   FROM public.conversation_members cm JOIN public.profiles p ON p.id=cm.user_id
   WHERE cm.conversation_id=p_conversation_id AND p.is_approved),'[]'::jsonb)
 ) FROM (SELECT 1) singleton LEFT JOIN pablicus_chat_private.conversation_canvases c ON c.conversation_id=p_conversation_id;
$function$;

CREATE FUNCTION pablicus_chat_private.lock_canvas(p_conversation_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
 INSERT INTO pablicus_chat_private.conversation_canvases(conversation_id) VALUES(p_conversation_id) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM pablicus_chat_private.conversation_canvases WHERE conversation_id=p_conversation_id FOR UPDATE;
END;
$function$;

CREATE FUNCTION pablicus_chat_private.validate_canvas_task(
 p_conversation_id uuid,p_title text,p_assignee_id uuid,p_due_date date
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
 IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 500 OR octet_length(p_title)>2000 THEN
  RAISE EXCEPTION 'invalid task title' USING ERRCODE='22023';
 END IF;
 IF p_due_date IS NOT NULL AND (NOT isfinite(p_due_date) OR p_due_date NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31') THEN
  RAISE EXCEPTION 'invalid task date' USING ERRCODE='22023';
 END IF;
 IF p_assignee_id IS NOT NULL THEN
  PERFORM 1 FROM public.profiles p WHERE p.id=p_assignee_id AND p.is_approved FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignee unavailable' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.conversation_members cm WHERE cm.conversation_id=p_conversation_id AND cm.user_id=p_assignee_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignee not in conversation' USING ERRCODE='22023'; END IF;
 END IF;
END;
$function$;

CREATE FUNCTION pablicus_chat_private.get_canvas(p_conversation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id);
BEGIN
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE FUNCTION pablicus_chat_private.save_canvas_plan(p_conversation_id uuid,p_expected_revision integer,p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_canvas pablicus_chat_private.conversation_canvases;
BEGIN
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_body IS NULL OR char_length(p_body)>20000 OR octet_length(p_body)>80000 THEN
  RAISE EXCEPTION 'invalid canvas plan' USING ERRCODE='22023';
 END IF;
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_canvas FROM pablicus_chat_private.conversation_canvases WHERE conversation_id=p_conversation_id;
 IF v_canvas.body=p_body THEN RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id); END IF;
 IF v_canvas.plan_revision<>p_expected_revision THEN RAISE EXCEPTION 'canvas_revision_conflict' USING ERRCODE='40001'; END IF;
 UPDATE pablicus_chat_private.conversation_canvases SET body=p_body,plan_revision=plan_revision+1,revision=revision+1,
  updated_at=clock_timestamp(),updated_by=v_user WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE FUNCTION pablicus_chat_private.create_canvas_task(
 p_conversation_id uuid,p_task_id uuid,p_title text,p_assignee_id uuid DEFAULT NULL,p_due_date date DEFAULT NULL,
 p_source_message_id uuid DEFAULT NULL,p_source_block_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id);
 v_task pablicus_chat_private.canvas_tasks; v_source public.messages; v_payload jsonb;
BEGIN
 IF p_task_id IS NULL THEN RAISE EXCEPTION 'task ID required' USING ERRCODE='22023'; END IF;
 v_payload:=jsonb_build_object('title',p_title,'assignee_id',p_assignee_id,'due_date',p_due_date,
   'source_message_id',p_source_message_id,'source_block_id',p_source_block_id);
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_task FROM pablicus_chat_private.canvas_tasks WHERE id=p_task_id;
 IF FOUND THEN
  IF v_task.conversation_id<>p_conversation_id OR v_task.created_by IS DISTINCT FROM v_user OR v_task.create_payload<>v_payload THEN
   RAISE EXCEPTION 'task_id_conflict' USING ERRCODE='23505';
  END IF;
  -- The actor was re-authorized before reaching this replay path. Return current
  -- state even if the task was edited/deleted, or its source/assignee was removed.
  RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
 END IF;
 PERFORM pablicus_chat_private.validate_canvas_task(p_conversation_id,p_title,p_assignee_id,p_due_date);
 IF p_source_block_id IS NOT NULL AND (p_source_message_id IS NULL OR p_source_block_id !~ '^[A-Za-z0-9_-]{1,128}$') THEN
  RAISE EXCEPTION 'invalid source block' USING ERRCODE='22023';
 END IF;
 IF p_source_message_id IS NOT NULL THEN
  SELECT * INTO v_source FROM public.messages WHERE id=p_source_message_id AND conversation_id=p_conversation_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'source not in conversation' USING ERRCODE='42501'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'source deleted' USING ERRCODE='22023'; END IF;
  IF p_source_block_id IS NOT NULL AND (v_source.type<>'rich' OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(coalesce(v_source.edited_content,v_source.attachment_metadata)->'blocks') b
   WHERE b->>'id'=p_source_block_id
  )) THEN RAISE EXCEPTION 'source block not found' USING ERRCODE='22023'; END IF;
 END IF;
 IF (SELECT count(*) FROM pablicus_chat_private.canvas_tasks WHERE conversation_id=p_conversation_id AND deleted_at IS NULL)>=200 THEN
  RAISE EXCEPTION 'canvas_task_limit' USING ERRCODE='22023';
 END IF;
 INSERT INTO pablicus_chat_private.canvas_tasks(id,conversation_id,title,assignee_id,due_date,source_message_id,source_block_id,created_by,updated_by,create_payload)
 VALUES(p_task_id,p_conversation_id,btrim(p_title),p_assignee_id,p_due_date,p_source_message_id,p_source_block_id,v_user,v_user,v_payload);
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE FUNCTION pablicus_chat_private.update_canvas_task(
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
 -- Same-value retries are safe even when their original assignee later leaves.
 IF v_task.title=btrim(p_title) AND v_task.assignee_id IS NOT DISTINCT FROM p_assignee_id
  AND v_task.due_date IS NOT DISTINCT FROM p_due_date AND v_task.completed=p_completed THEN
  RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
 END IF;
 IF v_task.revision<>p_expected_revision THEN RAISE EXCEPTION 'task_revision_conflict' USING ERRCODE='40001'; END IF;
 PERFORM pablicus_chat_private.validate_canvas_task(p_conversation_id,p_title,p_assignee_id,p_due_date);
 UPDATE pablicus_chat_private.canvas_tasks SET title=btrim(p_title),assignee_id=p_assignee_id,due_date=p_due_date,completed=p_completed,
  revision=revision+1,updated_at=clock_timestamp(),updated_by=v_user WHERE id=p_task_id;
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE FUNCTION pablicus_chat_private.delete_canvas_task(p_conversation_id uuid,p_task_id uuid,p_expected_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_task pablicus_chat_private.canvas_tasks;
BEGIN
 IF p_expected_revision IS NULL OR p_expected_revision<0 THEN RAISE EXCEPTION 'invalid task revision' USING ERRCODE='22023'; END IF;
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_task FROM pablicus_chat_private.canvas_tasks WHERE id=p_task_id AND conversation_id=p_conversation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'task not in conversation' USING ERRCODE='42501'; END IF;
 IF v_task.deleted_at IS NOT NULL THEN RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id); END IF;
 IF v_task.revision<>p_expected_revision THEN RAISE EXCEPTION 'task_revision_conflict' USING ERRCODE='40001'; END IF;
 UPDATE pablicus_chat_private.canvas_tasks SET deleted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp(),updated_by=v_user WHERE id=p_task_id;
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE FUNCTION public.pablicus_get_canvas(p_conversation_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.get_canvas(p_conversation_id);
$function$;
CREATE FUNCTION public.pablicus_save_canvas_plan(p_conversation_id uuid,p_expected_revision integer,p_body text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.save_canvas_plan(p_conversation_id,p_expected_revision,p_body);
$function$;
CREATE FUNCTION public.pablicus_create_canvas_task(
 p_conversation_id uuid,p_task_id uuid,p_title text,p_assignee_id uuid DEFAULT NULL,p_due_date date DEFAULT NULL,
 p_source_message_id uuid DEFAULT NULL,p_source_block_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.create_canvas_task(p_conversation_id,p_task_id,p_title,p_assignee_id,p_due_date,p_source_message_id,p_source_block_id);
$function$;
CREATE FUNCTION public.pablicus_update_canvas_task(
 p_conversation_id uuid,p_task_id uuid,p_expected_revision integer,p_title text,p_assignee_id uuid,p_due_date date,p_completed boolean
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.update_canvas_task(p_conversation_id,p_task_id,p_expected_revision,p_title,p_assignee_id,p_due_date,p_completed);
$function$;
CREATE FUNCTION public.pablicus_delete_canvas_task(p_conversation_id uuid,p_task_id uuid,p_expected_revision integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.delete_canvas_task(p_conversation_id,p_task_id,p_expected_revision);
$function$;

REVOKE ALL ON FUNCTION pablicus_chat_private.canvas_snapshot(uuid),pablicus_chat_private.lock_canvas(uuid),
 pablicus_chat_private.validate_canvas_task(uuid,text,uuid,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pablicus_get_canvas(uuid),pablicus_chat_private.get_canvas(uuid),
 public.pablicus_save_canvas_plan(uuid,integer,text),pablicus_chat_private.save_canvas_plan(uuid,integer,text),
 public.pablicus_create_canvas_task(uuid,uuid,text,uuid,date,uuid,text),pablicus_chat_private.create_canvas_task(uuid,uuid,text,uuid,date,uuid,text),
 public.pablicus_update_canvas_task(uuid,uuid,integer,text,uuid,date,boolean),pablicus_chat_private.update_canvas_task(uuid,uuid,integer,text,uuid,date,boolean),
 public.pablicus_delete_canvas_task(uuid,uuid,integer),pablicus_chat_private.delete_canvas_task(uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_get_canvas(uuid),pablicus_chat_private.get_canvas(uuid),
 public.pablicus_save_canvas_plan(uuid,integer,text),pablicus_chat_private.save_canvas_plan(uuid,integer,text),
 public.pablicus_create_canvas_task(uuid,uuid,text,uuid,date,uuid,text),pablicus_chat_private.create_canvas_task(uuid,uuid,text,uuid,date,uuid,text),
 public.pablicus_update_canvas_task(uuid,uuid,integer,text,uuid,date,boolean),pablicus_chat_private.update_canvas_task(uuid,uuid,integer,text,uuid,date,boolean),
 public.pablicus_delete_canvas_task(uuid,uuid,integer),pablicus_chat_private.delete_canvas_task(uuid,uuid,integer)
 TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
