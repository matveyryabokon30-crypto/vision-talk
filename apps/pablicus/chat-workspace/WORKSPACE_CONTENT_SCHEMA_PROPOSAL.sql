-- Ordered rich content for the existing shared project and tasks.
-- Apply after TASK_LIFECYCLE_SCHEMA_PROPOSAL.sql. This file is not auto-applied.
-- Keep storage ACLs and existing task lifecycle/reminder semantics unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE pablicus_chat_private.conversation_canvases ADD COLUMN content jsonb;
ALTER TABLE pablicus_chat_private.canvas_tasks ADD COLUMN content jsonb;

-- NULL identifies a legacy plain-text row. No existing text is rewritten.
CREATE FUNCTION pablicus_chat_private.workspace_text_content(p_text text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
 SELECT jsonb_build_object('v',1,'blocks',CASE WHEN btrim(coalesce(p_text,''))='' THEN '[]'::jsonb
  ELSE jsonb_build_array(jsonb_build_object('id','legacy_text','type','text','text',p_text)) END);
$function$;
CREATE FUNCTION pablicus_chat_private.workspace_content_text(p_content jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
 SELECT coalesce(string_agg(b->>'text',E'\n' ORDER BY n),'')
 FROM jsonb_array_elements(p_content->'blocks') WITH ORDINALITY items(b,n) WHERE b->>'type'='text';
$function$;
CREATE FUNCTION pablicus_chat_private.workspace_content_summary(p_content jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
 SELECT coalesce(nullif(btrim(pablicus_chat_private.workspace_content_text(p_content)),''),
  (SELECT string_agg(coalesce(nullif(b->>'name',''),CASE b->>'type' WHEN 'image' THEN 'Фото'
    WHEN 'video' THEN 'Видео' WHEN 'audio' THEN 'Аудио' ELSE 'Документ' END),' · ' ORDER BY n)
   FROM jsonb_array_elements(p_content->'blocks') WITH ORDINALITY items(b,n) WHERE b->>'type'<>'text'),'');
$function$;


CREATE FUNCTION pablicus_chat_private.validate_workspace_content(
 p_conversation_id uuid,p_content jsonb,p_existing jsonb,p_allow_empty boolean
) RETURNS text LANGUAGE plpgsql SET search_path='' AS $function$
DECLARE
 v_sender uuid:=auth.uid();v_block jsonb;v_id text;v_type text;v_path text;v_name text;v_mime text;
 v_metadata jsonb;v_size bigint;v_actual_size bigint;v_actual_mime text;v_total_size bigint:=0;
 v_text text:='';v_preview text:='';v_seen text[]:=ARRAY[]::text[];v_key text;
BEGIN
 IF v_sender IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' OR p_content->'v' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(p_content->'blocks') IS DISTINCT FROM 'array'
     OR octet_length(p_content::text) > 200000 THEN
    RAISE EXCEPTION 'invalid rich content' USING ERRCODE='22023';
  END IF;
  IF (p_content - ARRAY['v','blocks']::text[]) <> '{}'::jsonb
     OR jsonb_array_length(p_content->'blocks') NOT BETWEEN (CASE WHEN p_allow_empty THEN 0 ELSE 1 END) AND 100 THEN
    RAISE EXCEPTION 'invalid rich content' USING ERRCODE='22023';
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
      IF char_length(v_text)>20000 OR octet_length(v_text)>80000 THEN RAISE EXCEPTION 'workspace text too long' USING ERRCODE='22023'; END IF;
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
         OR v_path !~ ('^' || p_conversation_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$') THEN
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
      -- A peer's private upload is never attachable merely by knowing its path.
      -- It must already be linked to this exact project/task in the locked row.
      IF split_part(v_path,'/',2)<>v_sender::text AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(p_existing->'blocks','[]'::jsonb)) old
        WHERE old->>'path'=v_path AND old->>'type'=v_type
         AND old->>'mime'=v_block->>'mime' AND old->'size'=v_block->'size'
      ) THEN RAISE EXCEPTION 'attachment not authorized for workspace item' USING ERRCODE='42501'; END IF;
      SELECT metadata INTO v_metadata FROM storage.objects
        WHERE bucket_id='message-media' AND name=v_path
         AND owner_id=split_part(v_path,'/',2) AND NOT coalesce(is_delete_marker,false) FOR SHARE;
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

 RETURN v_text;
END;
$function$;

CREATE OR REPLACE FUNCTION pablicus_chat_private.canvas_snapshot(p_conversation_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path='' AS $function$
 SELECT jsonb_build_object(
  'conversation_id',p_conversation_id,
  'revision',coalesce(c.revision,0),
  'canvas',jsonb_build_object('body',coalesce(c.body,''),'content',coalesce(c.content,pablicus_chat_private.workspace_text_content(c.body)),'revision',coalesce(c.plan_revision,0),
    'updated_at',c.updated_at,'updated_by',c.updated_by),
  'tasks',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'content',coalesce(t.content,pablicus_chat_private.workspace_text_content(t.title)),'assignee_id',t.assignee_id,'due_date',t.due_date,'completed',t.completed,
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

CREATE FUNCTION pablicus_chat_private.save_canvas_plan_v2(p_conversation_id uuid,p_expected_revision integer,p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id);v_canvas pablicus_chat_private.conversation_canvases;v_body text;
BEGIN
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_content IS NULL THEN
  RAISE EXCEPTION 'invalid canvas content' USING ERRCODE='22023'; END IF;
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_canvas FROM pablicus_chat_private.conversation_canvases WHERE conversation_id=p_conversation_id;
 IF coalesce(v_canvas.content,pablicus_chat_private.workspace_text_content(v_canvas.body))=p_content THEN
  RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id); END IF;
 IF v_canvas.plan_revision<>p_expected_revision THEN RAISE EXCEPTION 'canvas_revision_conflict' USING ERRCODE='40001'; END IF;
 v_body:=pablicus_chat_private.validate_workspace_content(p_conversation_id,p_content,v_canvas.content,true);
 UPDATE pablicus_chat_private.conversation_canvases SET content=p_content,body=v_body,plan_revision=plan_revision+1,revision=revision+1,
  updated_at=clock_timestamp(),updated_by=v_user WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;


CREATE OR REPLACE FUNCTION pablicus_chat_private.save_canvas_plan(p_conversation_id uuid,p_expected_revision integer,p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_canvas pablicus_chat_private.conversation_canvases;
BEGIN
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_body IS NULL OR char_length(p_body)>20000 OR octet_length(p_body)>80000 THEN
  RAISE EXCEPTION 'invalid canvas plan' USING ERRCODE='22023';
 END IF;
 PERFORM pablicus_chat_private.lock_canvas(p_conversation_id);
 SELECT * INTO v_canvas FROM pablicus_chat_private.conversation_canvases WHERE conversation_id=p_conversation_id;
 IF v_canvas.body=p_body THEN RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id); END IF;
 IF v_canvas.content IS NOT NULL THEN RAISE EXCEPTION 'workspace_content_requires_v2' USING ERRCODE='22023'; END IF;
 IF v_canvas.plan_revision<>p_expected_revision THEN RAISE EXCEPTION 'canvas_revision_conflict' USING ERRCODE='40001'; END IF;
 UPDATE pablicus_chat_private.conversation_canvases SET body=p_body,plan_revision=plan_revision+1,revision=revision+1,
  updated_at=clock_timestamp(),updated_by=v_user WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION pablicus_chat_private.create_canvas_task_v3(
 p_conversation_id uuid,p_task_id uuid,p_content jsonb,p_assignee_id uuid DEFAULT NULL,p_due_date date DEFAULT NULL,
 p_source_message_id uuid DEFAULT NULL,p_source_block_id text DEFAULT NULL,p_schedule jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id);
 v_task pablicus_chat_private.canvas_tasks; v_source public.messages; v_payload jsonb;v_schedule jsonb;v_date date;v_title text;
BEGIN
 IF p_task_id IS NULL THEN RAISE EXCEPTION 'task ID required' USING ERRCODE='22023'; END IF;
 v_schedule:=coalesce(pablicus_chat_private.normalize_task_schedule(p_schedule),'{}'::jsonb);
 v_date:=CASE WHEN v_schedule->>'due_at' IS NOT NULL THEN ((v_schedule->>'due_at')::timestamptz AT TIME ZONE (v_schedule->>'timezone'))::date ELSE p_due_date END;
 v_payload:=jsonb_build_object('api_version',3,'content',p_content,'assignee_id',p_assignee_id,'due_date',v_date,
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
 PERFORM pablicus_chat_private.validate_workspace_content(p_conversation_id,p_content,NULL,false);
 v_title:=left(pablicus_chat_private.workspace_content_summary(p_content),500);
 PERFORM pablicus_chat_private.validate_canvas_task(p_conversation_id,v_title,p_assignee_id,v_date);
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
 INSERT INTO pablicus_chat_private.canvas_tasks(id,conversation_id,title,content,assignee_id,due_date,source_message_id,source_block_id,created_by,updated_by,create_payload,due_at,due_timezone,reminder_minutes,followup_minutes)
 VALUES(p_task_id,p_conversation_id,v_title,p_content,p_assignee_id,v_date,p_source_message_id,p_source_block_id,v_user,v_user,v_payload,
  (v_schedule->>'due_at')::timestamptz,v_schedule->>'timezone',(v_schedule->>'reminder_minutes')::integer,(v_schedule->>'followup_minutes')::integer);
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION pablicus_chat_private.update_canvas_task_v3(
 p_conversation_id uuid,p_task_id uuid,p_expected_revision integer,p_content jsonb,p_assignee_id uuid,p_due_date date,p_completed boolean,p_schedule jsonb DEFAULT NULL,p_archived boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid:=pablicus_chat_private.assert_message_member(p_conversation_id); v_task pablicus_chat_private.canvas_tasks;v_schedule jsonb;v_date date;v_archive timestamptz;v_title text;
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
 IF coalesce(v_task.content,pablicus_chat_private.workspace_text_content(v_task.title))=p_content AND v_task.assignee_id IS NOT DISTINCT FROM p_assignee_id
  AND v_task.due_date IS NOT DISTINCT FROM v_date AND v_task.completed=p_completed
  AND v_task.due_at IS NOT DISTINCT FROM (v_schedule->>'due_at')::timestamptz
  AND v_task.due_timezone IS NOT DISTINCT FROM v_schedule->>'timezone'
  AND v_task.reminder_minutes IS NOT DISTINCT FROM (v_schedule->>'reminder_minutes')::integer
  AND v_task.followup_minutes IS NOT DISTINCT FROM (v_schedule->>'followup_minutes')::integer
  AND v_task.archived_at IS NOT DISTINCT FROM v_archive THEN
  RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
 END IF;
 IF v_task.revision<>p_expected_revision THEN RAISE EXCEPTION 'task_revision_conflict' USING ERRCODE='40001'; END IF;
 PERFORM pablicus_chat_private.validate_workspace_content(p_conversation_id,p_content,v_task.content,false);
 v_title:=left(pablicus_chat_private.workspace_content_summary(p_content),500);
 PERFORM pablicus_chat_private.validate_canvas_task(p_conversation_id,v_title,p_assignee_id,v_date);
 UPDATE pablicus_chat_private.canvas_tasks SET title=v_title,content=p_content,assignee_id=p_assignee_id,due_date=v_date,completed=p_completed,
  due_at=(v_schedule->>'due_at')::timestamptz,due_timezone=v_schedule->>'timezone',
  reminder_minutes=(v_schedule->>'reminder_minutes')::integer,followup_minutes=(v_schedule->>'followup_minutes')::integer,archived_at=v_archive,
  revision=revision+1,updated_at=clock_timestamp(),updated_by=v_user WHERE id=p_task_id;
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
 IF v_task.content IS NOT NULL AND v_task.title IS DISTINCT FROM btrim(p_title) THEN
  RAISE EXCEPTION 'workspace_content_requires_v3' USING ERRCODE='22023'; END IF;
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
 IF v_task.content IS NOT NULL AND v_task.title IS DISTINCT FROM btrim(p_title) THEN
  RAISE EXCEPTION 'workspace_content_requires_v3' USING ERRCODE='22023'; END IF;
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
 UPDATE pablicus_chat_private.canvas_tasks SET deleted_at=clock_timestamp(),content=NULL,title='Удалено',assignee_id=NULL,due_date=NULL,completed=false,
  due_at=NULL,due_timezone=NULL,reminder_minutes=NULL,followup_minutes=NULL,archived_at=NULL,
  source_message_id=NULL,source_block_id=NULL,
  create_payload=jsonb_build_object('sha256',encode(sha256(convert_to(create_payload::text,'UTF8')),'hex')),
  revision=revision+1,updated_at=clock_timestamp(),updated_by=v_user WHERE id=p_task_id;
 UPDATE pablicus_chat_private.conversation_canvases SET revision=revision+1 WHERE conversation_id=p_conversation_id;
 RETURN pablicus_chat_private.canvas_snapshot(p_conversation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION pablicus_chat_private.list_projects(p_query text DEFAULT '',p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 40)
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
  SELECT canvas.conversation_id,canvas.body,canvas.content,canvas.updated_at,canvas.plan_revision AS revision,
   coalesce(nullif(btrim(c.title),''),(SELECT coalesce(nullif(btrim(p.display_name),''),'@'||p.username)
    FROM public.conversation_members peer JOIN public.profiles p ON p.id=peer.user_id
    WHERE peer.conversation_id=canvas.conversation_id AND peer.user_id<>v_user AND p.is_approved
    ORDER BY peer.user_id LIMIT 1),'Диалог') AS conversation_title
  FROM pablicus_chat_private.conversation_canvases canvas
  JOIN memberships member ON member.conversation_id=canvas.conversation_id
  JOIN public.conversations c ON c.id=canvas.conversation_id
  WHERE btrim(canvas.body)<>'' OR jsonb_array_length(coalesce(canvas.content->'blocks','[]'::jsonb))>0
 ), matching AS MATERIALIZED (
  SELECT * FROM visible WHERE v_query='' OR strpos(lower(body),v_query)>0 OR strpos(lower(conversation_title),v_query)>0 OR strpos(lower(pablicus_chat_private.workspace_content_summary(content)),v_query)>0
 ), candidates AS MATERIALIZED (
  SELECT * FROM matching WHERE p_cursor IS NULL OR conversation_id>v_cursor ORDER BY conversation_id LIMIT p_limit+1
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY conversation_id LIMIT p_limit
 )
 SELECT jsonb_build_object('projects',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'conversation_id',conversation_id,'title',left(split_part(coalesce(nullif(btrim(body),''),pablicus_chat_private.workspace_content_summary(content)),E'\n',1),120),
  'conversation_title',conversation_title,'body_preview',left(body,240),
  'attachment_count',(SELECT count(*) FROM jsonb_array_elements(coalesce(content->'blocks','[]'::jsonb)) b WHERE b->>'type'<>'text'),'updated_at',updated_at,'revision',revision
 ) ORDER BY conversation_id) FROM page),'[]'::jsonb),
 'total_count',(SELECT count(*) FROM matching),
 'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit
  THEN (SELECT jsonb_build_object('conversation_id',conversation_id) FROM page ORDER BY conversation_id DESC LIMIT 1) ELSE NULL END)
 INTO v_result;
 RETURN v_result;
END;
$function$;

CREATE FUNCTION public.pablicus_save_canvas_plan_v2(p_conversation_id uuid,p_expected_revision integer,p_content jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.save_canvas_plan_v2(p_conversation_id,p_expected_revision,p_content);
$function$;

REVOKE ALL ON FUNCTION public.pablicus_save_canvas_plan_v2(uuid,integer,jsonb),pablicus_chat_private.save_canvas_plan_v2(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_save_canvas_plan_v2(uuid,integer,jsonb),pablicus_chat_private.save_canvas_plan_v2(uuid,integer,jsonb) TO authenticated;

CREATE FUNCTION public.pablicus_create_canvas_task_v3(
 p_conversation_id uuid,p_task_id uuid,p_content jsonb,p_assignee_id uuid DEFAULT NULL,p_due_date date DEFAULT NULL,
 p_source_message_id uuid DEFAULT NULL,p_source_block_id text DEFAULT NULL,p_schedule jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.create_canvas_task_v3(p_conversation_id,p_task_id,p_content,p_assignee_id,p_due_date,p_source_message_id,p_source_block_id,p_schedule);
$function$;

REVOKE ALL ON FUNCTION public.pablicus_create_canvas_task_v3(uuid,uuid,jsonb,uuid,date,uuid,text,jsonb),pablicus_chat_private.create_canvas_task_v3(uuid,uuid,jsonb,uuid,date,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_create_canvas_task_v3(uuid,uuid,jsonb,uuid,date,uuid,text,jsonb),pablicus_chat_private.create_canvas_task_v3(uuid,uuid,jsonb,uuid,date,uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.pablicus_update_canvas_task_v3(
 p_conversation_id uuid,p_task_id uuid,p_expected_revision integer,p_content jsonb,p_assignee_id uuid,p_due_date date,p_completed boolean,p_schedule jsonb DEFAULT NULL,p_archived boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_chat_private.update_canvas_task_v3(p_conversation_id,p_task_id,p_expected_revision,p_content,p_assignee_id,p_due_date,p_completed,p_schedule,p_archived);
$function$;

REVOKE ALL ON FUNCTION public.pablicus_update_canvas_task_v3(uuid,uuid,integer,jsonb,uuid,date,boolean,jsonb,boolean),pablicus_chat_private.update_canvas_task_v3(uuid,uuid,integer,jsonb,uuid,date,boolean,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_update_canvas_task_v3(uuid,uuid,integer,jsonb,uuid,date,boolean,jsonb,boolean),pablicus_chat_private.update_canvas_task_v3(uuid,uuid,integer,jsonb,uuid,date,boolean,jsonb,boolean) TO authenticated;

REVOKE ALL ON FUNCTION pablicus_chat_private.workspace_text_content(text),
 pablicus_chat_private.workspace_content_text(jsonb),pablicus_chat_private.workspace_content_summary(jsonb),
 pablicus_chat_private.validate_workspace_content(uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
