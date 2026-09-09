-- Task times, lifecycle, and cross-conversation project index.
-- Apply after CANVAS_SCHEMA_PROPOSAL.sql and TASKS_SCHEMA_PROPOSAL.sql.
-- Private tables stay inaccessible; all client operations use guarded RPCs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE pablicus_chat_private.canvas_tasks
 ADD COLUMN due_at timestamptz,
 ADD COLUMN due_timezone text,
 ADD COLUMN reminder_minutes integer,
 ADD COLUMN followup_minutes integer,
 ADD COLUMN archived_at timestamptz,
 ADD COLUMN schedule_version bigint NOT NULL DEFAULT 1,
 ADD CONSTRAINT canvas_tasks_schedule_valid CHECK (
  (due_at IS NULL AND due_timezone IS NULL AND reminder_minutes IS NULL AND followup_minutes IS NULL)
  OR (due_at IS NOT NULL AND isfinite(due_at) AND due_at >= TIMESTAMPTZ '1900-01-01 00:00:00+00'
   AND due_at < TIMESTAMPTZ '10000-01-01 00:00:00+00' AND due_timezone IS NOT NULL
   AND char_length(due_timezone) BETWEEN 1 AND 100 AND due_date IS NOT NULL)),
 ADD CONSTRAINT canvas_tasks_reminder_valid CHECK(reminder_minutes IN (0,15,30,60,1440)),
 ADD CONSTRAINT canvas_tasks_followup_valid CHECK(followup_minutes=180),
 ADD CONSTRAINT canvas_tasks_schedule_version_valid CHECK(schedule_version>0);
CREATE INDEX canvas_tasks_active_due_idx ON pablicus_chat_private.canvas_tasks(due_at,id)
 WHERE deleted_at IS NULL AND NOT completed AND archived_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX canvas_tasks_lifecycle_order_idx ON pablicus_chat_private.canvas_tasks((archived_at IS NOT NULL),completed,created_at DESC,id DESC)
 WHERE deleted_at IS NULL;

CREATE FUNCTION pablicus_chat_private.bump_task_schedule() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
 IF ROW(NEW.due_at,NEW.due_timezone,NEW.reminder_minutes,NEW.followup_minutes,NEW.assignee_id,NEW.completed,NEW.archived_at,NEW.deleted_at)
   IS DISTINCT FROM ROW(OLD.due_at,OLD.due_timezone,OLD.reminder_minutes,OLD.followup_minutes,OLD.assignee_id,OLD.completed,OLD.archived_at,OLD.deleted_at) THEN
  NEW.schedule_version:=OLD.schedule_version+1;
 ELSE NEW.schedule_version:=OLD.schedule_version;
 END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER canvas_tasks_bump_schedule BEFORE UPDATE ON pablicus_chat_private.canvas_tasks
 FOR EACH ROW EXECUTE FUNCTION pablicus_chat_private.bump_task_schedule();

CREATE FUNCTION pablicus_chat_private.valid_task_timezone(p_timezone text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $function$
 SELECT p_timezone IS NOT NULL AND char_length(p_timezone) BETWEEN 1 AND 100
  AND p_timezone !~ '^(posix|right)/' AND (p_timezone='UTC' OR strpos(p_timezone,'/')>0)
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone);
$function$;
CREATE FUNCTION pablicus_chat_private.normalize_task_schedule(p_schedule jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $function$
DECLARE v_due timestamptz;v_zone text;v_reminder integer;v_followup integer;
BEGIN
 IF p_schedule IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_schedule)<>'object' OR (p_schedule-'due_at'-'timezone'-'reminder_minutes'-'followup_minutes')<>'{}'::jsonb THEN
  RAISE EXCEPTION 'invalid task schedule' USING ERRCODE='22023';
 END IF;
 IF p_schedule->>'due_at' IS NULL THEN
  IF p_schedule->>'timezone' IS NOT NULL OR p_schedule->>'reminder_minutes' IS NOT NULL OR p_schedule->>'followup_minutes' IS NOT NULL THEN
   RAISE EXCEPTION 'task time required for reminders' USING ERRCODE='22023';
  END IF;
  RETURN '{}'::jsonb;
 END IF;
 IF jsonb_typeof(p_schedule->'due_at')<>'string'
  OR p_schedule->>'due_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  OR jsonb_typeof(p_schedule->'timezone') IS DISTINCT FROM 'string'
  OR NOT pablicus_chat_private.valid_task_timezone(p_schedule->>'timezone') THEN
  RAISE EXCEPTION 'invalid task time or timezone' USING ERRCODE='22023';
 END IF;
 BEGIN v_due:=(p_schedule->>'due_at')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'invalid task time' USING ERRCODE='22023';
 END;
 IF NOT isfinite(v_due) OR v_due<TIMESTAMPTZ '1900-01-01 00:00:00+00' OR v_due>=TIMESTAMPTZ '10000-01-01 00:00:00+00' THEN
  RAISE EXCEPTION 'invalid task time' USING ERRCODE='22023';
 END IF;
 v_zone:=p_schedule->>'timezone';
 IF p_schedule->>'reminder_minutes' IS NOT NULL THEN
  IF jsonb_typeof(p_schedule->'reminder_minutes')<>'number' OR p_schedule->>'reminder_minutes' NOT IN ('0','15','30','60','1440') THEN
   RAISE EXCEPTION 'invalid reminder interval' USING ERRCODE='22023';
  END IF;
  v_reminder:=(p_schedule->>'reminder_minutes')::integer;
 END IF;
 IF NOT p_schedule?'followup_minutes' THEN v_followup:=180;
 ELSIF p_schedule->>'followup_minutes' IS NOT NULL THEN
  IF jsonb_typeof(p_schedule->'followup_minutes')<>'number' OR p_schedule->>'followup_minutes'<>'180' THEN
   RAISE EXCEPTION 'invalid followup interval' USING ERRCODE='22023';
  END IF;
  v_followup:=180;
 END IF;
 RETURN jsonb_build_object('due_at',v_due,'timezone',v_zone,'reminder_minutes',v_reminder,'followup_minutes',v_followup);
END;
$function$;
CREATE FUNCTION pablicus_chat_private.task_payload_matches(p_saved jsonb,p_request jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
 SELECT p_saved=p_request OR p_saved=jsonb_build_object('sha256',encode(sha256(convert_to(p_request::text,'UTF8')),'hex'));
$function$;

CREATE OR REPLACE FUNCTION pablicus_chat_private.canvas_snapshot(p_conversation_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path='' AS $function$
 SELECT jsonb_build_object(
  'conversation_id',p_conversation_id,
  'revision',coalesce(c.revision,0),
  'canvas',jsonb_build_object('body',coalesce(c.body,''),'revision',coalesce(c.plan_revision,0),
    'updated_at',c.updated_at,'updated_by',c.updated_by),
  'tasks',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'assignee_id',t.assignee_id,'due_date',t.due_date,'completed',t.completed,
    'due_at',t.due_at,'due_timezone',t.due_timezone,'reminder_minutes',t.reminder_minutes,
    'followup_minutes',t.followup_minutes,'archived_at',t.archived_at,'schedule_version',t.schedule_version,
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

CREATE OR REPLACE FUNCTION pablicus_chat_private.create_canvas_task(
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
  IF v_task.conversation_id<>p_conversation_id OR v_task.created_by IS DISTINCT FROM v_user OR NOT pablicus_chat_private.task_payload_matches(v_task.create_payload,v_payload) THEN
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
 IF (SELECT count(*) FROM pablicus_chat_private.canvas_tasks WHERE conversation_id=p_conversation_id AND deleted_at IS NULL AND NOT completed AND archived_at IS NULL)>=200 THEN
  RAISE EXCEPTION 'canvas_task_limit' USING ERRCODE='22023';
 END IF;
 INSERT INTO pablicus_chat_private.canvas_tasks(id,conversation_id,title,assignee_id,due_date,source_message_id,source_block_id,created_by,updated_by,create_payload)
 VALUES(p_task_id,p_conversation_id,btrim(p_title),p_assignee_id,p_due_date,p_source_message_id,p_source_block_id,v_user,v_user,v_payload);
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION pablicus_chat_private.create_canvas_task_v2(
 p_conversation_id uuid,p_task_id uuid,p_title text,p_assignee_id uuid DEFAULT NULL,p_due_date date DEFAULT NULL,
 p_source_message_id uuid DEFAULT NULL,p_source_block_id text DEFAULT NULL,p_schedule jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id);
 v_task pablicus_chat_private.canvas_tasks; v_source public.messages; v_payload jsonb;v_schedule jsonb;v_date date;
BEGIN
 IF p_task_id IS NULL THEN RAISE EXCEPTION 'task ID required' USING ERRCODE='22023'; END IF;
 v_schedule:=coalesce(pablicus_chat_private.normalize_task_schedule(p_schedule),'{}'::jsonb);
 v_date:=CASE WHEN v_schedule->>'due_at' IS NOT NULL THEN ((v_schedule->>'due_at')::timestamptz AT TIME ZONE (v_schedule->>'timezone'))::date ELSE p_due_date END;
 v_payload:=jsonb_build_object('title',p_title,'assignee_id',p_assignee_id,'due_date',v_date,
   'source_message_id',p_source_message_id,'source_block_id',p_source_block_id,'schedule',v_schedule);
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_task FROM pablicus_chat_private.canvas_tasks WHERE id=p_task_id;
 IF FOUND THEN
  IF v_task.conversation_id<>p_conversation_id OR v_task.created_by IS DISTINCT FROM v_user OR NOT pablicus_chat_private.task_payload_matches(v_task.create_payload,v_payload) THEN
   RAISE EXCEPTION 'task_id_conflict' USING ERRCODE='23505';
  END IF;
  -- The actor was re-authorized before reaching this replay path. Return current
  -- state even if the task was edited/deleted, or its source/assignee was removed.
  RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
 END IF;
 PERFORM pablicus_chat_private.validate_canvas_task(p_conversation_id,p_title,p_assignee_id,v_date);
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
 IF (SELECT count(*) FROM pablicus_chat_private.canvas_tasks WHERE conversation_id=p_conversation_id AND deleted_at IS NULL AND NOT completed AND archived_at IS NULL)>=200 THEN
  RAISE EXCEPTION 'canvas_task_limit' USING ERRCODE='22023';
 END IF;
 INSERT INTO pablicus_chat_private.canvas_tasks(id,conversation_id,title,assignee_id,due_date,source_message_id,source_block_id,created_by,updated_by,create_payload,due_at,due_timezone,reminder_minutes,followup_minutes)
 VALUES(p_task_id,p_conversation_id,btrim(p_title),p_assignee_id,v_date,p_source_message_id,p_source_block_id,v_user,v_user,v_payload,
  (v_schedule->>'due_at')::timestamptz,v_schedule->>'timezone',(v_schedule->>'reminder_minutes')::integer,(v_schedule->>'followup_minutes')::integer);
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

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
 PERFORM pablicus_chat_private.validate_canvas_task(p_conversation_id,p_title,p_assignee_id,v_date);
 UPDATE pablicus_chat_private.canvas_tasks SET title=btrim(p_title),assignee_id=p_assignee_id,due_date=v_date,completed=p_completed,
  due_at=(v_schedule->>'due_at')::timestamptz,due_timezone=v_schedule->>'timezone',
  reminder_minutes=(v_schedule->>'reminder_minutes')::integer,followup_minutes=(v_schedule->>'followup_minutes')::integer,archived_at=v_archive,
  revision=revision+1,updated_at=clock_timestamp(),updated_by=v_user WHERE id=p_task_id;
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION pablicus_chat_private.delete_canvas_task(p_conversation_id uuid,p_task_id uuid,p_expected_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_task pablicus_chat_private.canvas_tasks;
BEGIN
 IF p_expected_revision IS NULL OR p_expected_revision<0 THEN RAISE EXCEPTION 'invalid task revision' USING ERRCODE='22023'; END IF;
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_task FROM pablicus_chat_private.canvas_tasks WHERE id=p_task_id AND conversation_id=p_conversation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'task not in conversation' USING ERRCODE='42501'; END IF;
 IF v_task.deleted_at IS NOT NULL THEN RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id); END IF;
 IF v_task.revision<>p_expected_revision THEN RAISE EXCEPTION 'task_revision_conflict' USING ERRCODE='40001'; END IF;
 UPDATE pablicus_chat_private.canvas_tasks SET deleted_at=clock_timestamp(),title='Удалено',assignee_id=NULL,due_date=NULL,completed=false,
  due_at=NULL,due_timezone=NULL,reminder_minutes=NULL,followup_minutes=NULL,archived_at=NULL,
  source_message_id=NULL,source_block_id=NULL,
  create_payload=jsonb_build_object('sha256',encode(sha256(convert_to(create_payload::text,'UTF8')),'hex')),
  revision=revision+1,updated_at=clock_timestamp(),updated_by=v_user WHERE id=p_task_id;
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE FUNCTION pablicus_chat_private.list_tasks_v2(
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
   AND (p_view<>'today' OR ((t.assignee_id IS NULL OR t.assignee_id=v_user)
    AND CASE WHEN t.due_at IS NOT NULL THEN (t.due_at AT TIME ZONE p_timezone)::date=p_today ELSE t.due_date=p_today END))
   AND (v_query='' OR strpos(lower(t.title),v_query)>0)
 ), candidates AS MATERIALIZED (
  SELECT * FROM matching t WHERE (p_cursor IS NULL OR (t.created_at,t.id)<(v_cursor_time,v_cursor_id))
  ORDER BY t.created_at DESC,t.id DESC
  LIMIT p_limit+1
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT p_limit
 ), items AS (
  SELECT t.created_at,t.id,jsonb_build_object(
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

CREATE FUNCTION pablicus_chat_private.list_projects(p_query text DEFAULT '',p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 40)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=auth.uid();v_query text;v_cursor uuid;v_result jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=v_user AND is_approved FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account not approved' USING ERRCODE='42501'; END IF;
 IF p_query IS NULL OR char_length(p_query)>200 OR octet_length(p_query)>800 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 60 THEN
  RAISE EXCEPTION 'invalid project query or limit' USING ERRCODE='22023';
 END IF;
 v_query:=lower(btrim(p_query));
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor)<>'object' OR (p_cursor-'conversation_id')<>'{}'::jsonb
   OR jsonb_typeof(p_cursor->'conversation_id') IS DISTINCT FROM 'string'
   OR (p_cursor->>'conversation_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
   RAISE EXCEPTION 'invalid project cursor' USING ERRCODE='22023';
  END IF;
  v_cursor:=(p_cursor->>'conversation_id')::uuid;
 END IF;
 WITH memberships AS MATERIALIZED (
  SELECT cm.conversation_id FROM public.conversation_members cm WHERE cm.user_id=v_user FOR SHARE OF cm
 ), visible AS MATERIALIZED (
  SELECT canvas.conversation_id,canvas.body,canvas.updated_at,canvas.plan_revision AS revision,
   coalesce(nullif(btrim(c.title),''),(SELECT coalesce(nullif(btrim(p.display_name),''),'@'||p.username)
    FROM public.conversation_members peer JOIN public.profiles p ON p.id=peer.user_id
    WHERE peer.conversation_id=canvas.conversation_id AND peer.user_id<>v_user AND p.is_approved
    ORDER BY peer.user_id LIMIT 1),'Диалог') AS conversation_title
  FROM pablicus_chat_private.conversation_canvases canvas
  JOIN memberships member ON member.conversation_id=canvas.conversation_id
  JOIN public.conversations c ON c.id=canvas.conversation_id
  WHERE btrim(canvas.body)<>''
 ), matching AS MATERIALIZED (
  SELECT * FROM visible WHERE v_query='' OR strpos(lower(body),v_query)>0 OR strpos(lower(conversation_title),v_query)>0
 ), candidates AS MATERIALIZED (
  SELECT * FROM matching WHERE p_cursor IS NULL OR conversation_id>v_cursor ORDER BY conversation_id LIMIT p_limit+1
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY conversation_id LIMIT p_limit
 )
 SELECT jsonb_build_object('projects',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'conversation_id',conversation_id,'title',left(split_part(btrim(body),E'\n',1),120),
  'conversation_title',conversation_title,'body_preview',left(body,240),'updated_at',updated_at,'revision',revision
 ) ORDER BY conversation_id) FROM page),'[]'::jsonb),
 'total_count',(SELECT count(*) FROM matching),
 'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit
  THEN (SELECT jsonb_build_object('conversation_id',conversation_id) FROM page ORDER BY conversation_id DESC LIMIT 1) ELSE NULL END)
 INTO v_result;
 RETURN v_result;
END;
$function$;

CREATE FUNCTION public.pablicus_create_canvas_task_v2(
 p_conversation_id uuid,p_task_id uuid,p_title text,p_assignee_id uuid DEFAULT NULL,p_due_date date DEFAULT NULL,
 p_source_message_id uuid DEFAULT NULL,p_source_block_id text DEFAULT NULL,p_schedule jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.create_canvas_task_v2(p_conversation_id,p_task_id,p_title,p_assignee_id,p_due_date,p_source_message_id,p_source_block_id,p_schedule);
$function$;
CREATE FUNCTION public.pablicus_update_canvas_task_v2(
 p_conversation_id uuid,p_task_id uuid,p_expected_revision integer,p_title text,p_assignee_id uuid,p_due_date date,p_completed boolean,
 p_schedule jsonb DEFAULT NULL,p_archived boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.update_canvas_task_v2(p_conversation_id,p_task_id,p_expected_revision,p_title,p_assignee_id,p_due_date,p_completed,p_schedule,p_archived);
$function$;
CREATE FUNCTION public.pablicus_list_tasks_v2(
 p_view text DEFAULT 'open',p_query text DEFAULT '',p_today date DEFAULT CURRENT_DATE,
 p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 40,p_timezone text DEFAULT 'UTC'
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.list_tasks_v2(p_view,p_query,p_today,p_cursor,p_limit,p_timezone);
$function$;
CREATE FUNCTION public.pablicus_list_projects(p_query text DEFAULT '',p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 40)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.list_projects(p_query,p_cursor,p_limit);
$function$;
REVOKE ALL ON FUNCTION pablicus_chat_private.bump_task_schedule(),pablicus_chat_private.valid_task_timezone(text),
 pablicus_chat_private.normalize_task_schedule(jsonb),pablicus_chat_private.task_payload_matches(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pablicus_create_canvas_task_v2(uuid,uuid,text,uuid,date,uuid,text,jsonb),pablicus_chat_private.create_canvas_task_v2(uuid,uuid,text,uuid,date,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_create_canvas_task_v2(uuid,uuid,text,uuid,date,uuid,text,jsonb),pablicus_chat_private.create_canvas_task_v2(uuid,uuid,text,uuid,date,uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.pablicus_update_canvas_task_v2(uuid,uuid,integer,text,uuid,date,boolean,jsonb,boolean),pablicus_chat_private.update_canvas_task_v2(uuid,uuid,integer,text,uuid,date,boolean,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_update_canvas_task_v2(uuid,uuid,integer,text,uuid,date,boolean,jsonb,boolean),pablicus_chat_private.update_canvas_task_v2(uuid,uuid,integer,text,uuid,date,boolean,jsonb,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.pablicus_list_tasks_v2(text,text,date,jsonb,integer,text),pablicus_chat_private.list_tasks_v2(text,text,date,jsonb,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_list_tasks_v2(text,text,date,jsonb,integer,text),pablicus_chat_private.list_tasks_v2(text,text,date,jsonb,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.pablicus_list_projects(text,jsonb,integer),pablicus_chat_private.list_projects(text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_list_projects(text,jsonb,integer),pablicus_chat_private.list_projects(text,jsonb,integer) TO authenticated;
-- Cached older clients must not bring archived tasks back into their active list.
CREATE OR REPLACE FUNCTION pablicus_chat_private.list_tasks(
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
  WHERE t.deleted_at IS NULL AND t.archived_at IS NULL AND t.completed=(p_view='completed')
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
NOTIFY pgrst,'reload schema';
COMMIT;
