-- Durable task reminders, additive to the existing capability-authenticated worker.
-- Apply AFTER TASK_LIFECYCLE_SCHEMA_PROPOSAL.sql. Reuses the existing minute cron.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE pablicus_push_private.task_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES pablicus_chat_private.canvas_tasks(id) ON DELETE CASCADE,
 schedule_version bigint NOT NULL,
 recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('task_reminder','task_followup')),
 run_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>run_at),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','cancelled','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,schedule_version,recipient_id,kind)
);
CREATE INDEX task_events_due ON pablicus_push_private.task_events(run_at) WHERE state='pending';
CREATE INDEX task_events_recipient ON pablicus_push_private.task_events(recipient_id);
CREATE TABLE pablicus_push_private.task_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES pablicus_push_private.task_events(id) ON DELETE CASCADE,
 subscription_id uuid NOT NULL REFERENCES pablicus_push_private.subscriptions(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 7),
 due_at timestamptz NOT NULL DEFAULT now(),
 lease uuid,
 last_status integer,
 UNIQUE(event_id,subscription_id)
);
CREATE INDEX task_deliveries_due ON pablicus_push_private.task_deliveries(due_at) WHERE state IN ('pending','sending');
CREATE INDEX task_deliveries_subscription ON pablicus_push_private.task_deliveries(subscription_id);
ALTER TABLE pablicus_push_private.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pablicus_push_private.task_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pablicus_push_private.task_events,pablicus_push_private.task_deliveries FROM PUBLIC,anon,authenticated;
-- Service-only functions below deliberately access the private canvas table;
-- browser roles receive neither table access nor EXECUTE privileges.

CREATE FUNCTION pablicus_push_private.task_event_valid(p_event pablicus_push_private.task_events) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT EXISTS(
  SELECT 1 FROM pablicus_chat_private.canvas_tasks t
  JOIN public.conversation_members cm ON cm.conversation_id=t.conversation_id AND cm.user_id=p_event.recipient_id
  JOIN public.profiles p ON p.id=cm.user_id AND p.is_approved
  WHERE t.id=p_event.task_id AND t.schedule_version=p_event.schedule_version
   AND NOT t.completed AND t.archived_at IS NULL AND t.deleted_at IS NULL AND t.due_at IS NOT NULL
   AND (t.assignee_id IS NULL OR t.assignee_id=p_event.recipient_id)
   AND CASE p_event.kind WHEN 'task_reminder' THEN t.reminder_minutes IS NOT NULL ELSE t.followup_minutes IS NOT NULL END
 );
$function$;
REVOKE ALL ON FUNCTION pablicus_push_private.task_event_valid(pablicus_push_private.task_events) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION pablicus_push_private.schedule_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND NEW.schedule_version=OLD.schedule_version THEN RETURN NEW; END IF;
 UPDATE pablicus_push_private.task_events SET state='cancelled'
  WHERE task_id=NEW.id AND schedule_version<>NEW.schedule_version AND state IN ('pending','ready');
 UPDATE pablicus_push_private.task_deliveries d SET state='dead',lease=NULL
  FROM pablicus_push_private.task_events e WHERE d.event_id=e.id AND e.task_id=NEW.id
   AND e.state='cancelled' AND d.state IN ('pending','sending');
 IF NEW.completed OR NEW.archived_at IS NOT NULL OR NEW.deleted_at IS NOT NULL OR NEW.due_at IS NULL THEN RETURN NEW; END IF;
 INSERT INTO pablicus_push_private.task_events(task_id,schedule_version,recipient_id,kind,run_at,expires_at)
 SELECT NEW.id,NEW.schedule_version,cm.user_id,k.kind,k.run_at,k.expires_at
 FROM public.conversation_members cm JOIN public.profiles p ON p.id=cm.user_id AND p.is_approved
 CROSS JOIN LATERAL (VALUES
  ('task_reminder',NEW.due_at-make_interval(mins=>NEW.reminder_minutes),
   CASE WHEN NEW.reminder_minutes=0 THEN NEW.due_at+interval '15 minutes' ELSE NEW.due_at END),
  ('task_followup',NEW.due_at+make_interval(mins=>NEW.followup_minutes),NEW.due_at+make_interval(mins=>NEW.followup_minutes)+interval '1 day')
 ) k(kind,run_at,expires_at)
 WHERE cm.conversation_id=NEW.conversation_id AND (NEW.assignee_id IS NULL OR cm.user_id=NEW.assignee_id)
  AND k.run_at IS NOT NULL AND k.expires_at>now()
 ON CONFLICT(task_id,schedule_version,recipient_id,kind) DO NOTHING;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_push_private.schedule_task() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pablicus_task_reminder_schedule AFTER INSERT OR UPDATE ON pablicus_chat_private.canvas_tasks
 FOR EACH ROW EXECUTE FUNCTION pablicus_push_private.schedule_task();

CREATE FUNCTION pablicus_push_private.prepare_task_deliveries() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_event pablicus_push_private.task_events; v_count integer;
BEGIN
 UPDATE pablicus_push_private.task_events e SET state=CASE WHEN expires_at<=now() THEN 'expired' ELSE 'cancelled' END
  WHERE state IN ('pending','ready') AND (expires_at<=now() OR NOT pablicus_push_private.task_event_valid(e));
 UPDATE pablicus_push_private.task_deliveries d SET state='dead',lease=NULL
 FROM pablicus_push_private.task_events e WHERE d.event_id=e.id AND d.state IN ('pending','sending') AND (
  e.state IN ('cancelled','expired') OR d.attempts>=7 OR NOT EXISTS(
   SELECT 1 FROM pablicus_push_private.subscriptions s WHERE s.id=d.subscription_id AND s.user_id=e.recipient_id));
 -- Lock each due event once. Devices present at dispatch each get one delivery;
 -- if no device is subscribed yet, retain the event until its expiry window.
 FOR v_event IN SELECT e.* FROM pablicus_push_private.task_events e
  WHERE e.state='pending' AND e.run_at<=now() AND e.expires_at>now()
   AND EXISTS(SELECT 1 FROM pablicus_push_private.subscriptions s WHERE s.user_id=e.recipient_id)
  ORDER BY e.run_at,e.id LIMIT 100 FOR UPDATE OF e SKIP LOCKED
 LOOP
  INSERT INTO pablicus_push_private.task_deliveries(event_id,subscription_id)
   SELECT v_event.id,s.id FROM pablicus_push_private.subscriptions s WHERE s.user_id=v_event.recipient_id
   ON CONFLICT(event_id,subscription_id) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count>0 THEN UPDATE pablicus_push_private.task_events SET state='ready' WHERE id=v_event.id; END IF;
 END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_push_private.prepare_task_deliveries() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION pablicus_push_private.claim_tasks(p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_result jsonb;
BEGIN
 PERFORM pablicus_push_private.prepare_task_deliveries();
 WITH candidates AS (
  SELECT d.id FROM pablicus_push_private.task_deliveries d
  JOIN pablicus_push_private.task_events e ON e.id=d.event_id
  WHERE d.state IN ('pending','sending') AND d.due_at<=now() AND e.run_at<=now() AND e.expires_at>now()
   AND pablicus_push_private.task_event_valid(e)
  ORDER BY d.due_at,d.id LIMIT greatest(0,least(25,p_limit)) FOR UPDATE OF d SKIP LOCKED
 ), claimed AS (
  UPDATE pablicus_push_private.task_deliveries d SET state='sending',attempts=attempts+1,lease=gen_random_uuid(),due_at=now()+interval '2 minutes'
  FROM candidates c WHERE c.id=d.id RETURNING d.*
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'lease',d.lease,
  'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key)),
  'payload',jsonb_build_object('kind',e.kind,'notification_id',e.id,'task_id',t.id,'conversation_id',t.conversation_id,
   'recipient_id',e.recipient_id,'due_at',t.due_at,'expires_at',e.expires_at,
   'title',CASE WHEN e.kind='task_followup' THEN 'Удалось завершить дело?' ELSE 'Скоро запланировано дело' END,
   'body',left(t.title,350)||CASE WHEN e.kind='task_followup' THEN E'\nОтметьте выполнение или перенесите срок.'
    ELSE E'\n'||to_char(t.due_at AT TIME ZONE coalesce(t.due_timezone,'UTC'),'DD.MM в HH24:MI') END)
 )),'[]'::jsonb) INTO v_result
 FROM claimed d JOIN pablicus_push_private.task_events e ON e.id=d.event_id
 JOIN pablicus_chat_private.canvas_tasks t ON t.id=e.task_id
 JOIN pablicus_push_private.subscriptions s ON s.id=d.subscription_id AND s.user_id=e.recipient_id;
 RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_push_private.claim_tasks(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pablicus_push_private.claim_tasks(integer) TO service_role;

CREATE FUNCTION pablicus_push_private.finish_task(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_status integer:=(p_input->>'status')::integer; v_sub uuid; v_id uuid:=(p_input->>'id')::uuid;
BEGIN
 IF v_status IS NULL OR v_status NOT BETWEEN 0 AND 599 THEN RAISE EXCEPTION 'invalid status' USING ERRCODE='22023'; END IF;
 SELECT subscription_id INTO v_sub FROM pablicus_push_private.task_deliveries WHERE id=v_id
  AND lease=(p_input->>'lease')::uuid AND state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true); END IF;
 IF v_status IN (404,410) THEN DELETE FROM pablicus_push_private.subscriptions WHERE id=v_sub;
 ELSE
  UPDATE pablicus_push_private.task_deliveries SET state=CASE WHEN v_status BETWEEN 200 AND 299 THEN 'sent'
   WHEN attempts>=7 OR (v_status BETWEEN 400 AND 499 AND v_status NOT IN (408,429)) THEN 'dead' ELSE 'pending' END,
   due_at=now()+make_interval(secs=>least(3600,60*power(2,attempts-1)::integer)),last_status=v_status,lease=NULL
  WHERE id=v_id AND lease=(p_input->>'lease')::uuid;
 END IF;
 RETURN jsonb_build_object('ok',true);
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_push_private.finish_task(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pablicus_push_private.finish_task(jsonb) TO service_role;

-- Same message checks as the established worker, with a bounded limit to reserve
-- task capacity during message bursts. Existing message API/payload is unchanged.
CREATE FUNCTION pablicus_push_private.claim_messages(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE v_result jsonb;
BEGIN
 UPDATE pablicus_push_private.outbox o SET state='dead' WHERE state IN ('pending','sending') AND (
  attempts>=7 OR o.created_at<now()-interval '1 day' OR NOT EXISTS (
   SELECT 1 FROM public.messages m
   JOIN public.conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=o.recipient_id
   JOIN public.conversation_members sm ON sm.conversation_id=m.conversation_id AND sm.user_id=m.sender_id
   JOIN public.profiles recipient ON recipient.id=o.recipient_id AND recipient.is_approved
   JOIN public.profiles sender ON sender.id=m.sender_id AND sender.is_approved
   JOIN pablicus_push_private.subscriptions s ON s.id=o.subscription_id AND s.user_id=o.recipient_id
   WHERE m.id=o.message_id AND m.deleted_at IS NULL AND m.sender_id<>o.recipient_id AND m.server_seq>coalesce(cm.last_read_seq,0)
  ));
 WITH candidates AS (
  SELECT id FROM pablicus_push_private.outbox WHERE state IN ('pending','sending') AND due_at<=now()
  ORDER BY due_at,id LIMIT greatest(0,least(25,p_limit)) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE pablicus_push_private.outbox o SET state='sending',attempts=attempts+1,lease=gen_random_uuid(),due_at=now()+interval '2 minutes'
  FROM candidates c WHERE c.id=o.id RETURNING o.*
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease',c.lease,
  'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key)),
  'payload',jsonb_build_object('title','Pablicus','body','Новое сообщение','conversation_id',m.conversation_id,'message_id',m.id,'recipient_id',c.recipient_id)
 )),'[]'::jsonb) INTO v_result FROM claimed c JOIN pablicus_push_private.subscriptions s ON s.id=c.subscription_id JOIN public.messages m ON m.id=c.message_id;
 RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_push_private.claim_messages(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pablicus_push_private.claim_messages(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.pablicus_push_rpc(p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE v_tasks jsonb; v_messages jsonb;
BEGIN
 IF p_action='worker_auth' THEN RETURN pablicus_push_private.consume_worker(p_input->>'token'); END IF;
 IF p_action='claim' THEN
  v_tasks:=pablicus_push_private.claim_tasks(5);
  v_messages:=pablicus_push_private.claim_messages(25-jsonb_array_length(v_tasks));
  IF jsonb_array_length(v_messages)+jsonb_array_length(v_tasks)<25 THEN
   v_tasks:=v_tasks||pablicus_push_private.claim_tasks(25-jsonb_array_length(v_messages)-jsonb_array_length(v_tasks));
  END IF;
  RETURN v_messages||v_tasks;
 END IF;
 IF p_action='finish' AND EXISTS(SELECT 1 FROM pablicus_push_private.task_deliveries WHERE id=(p_input->>'id')::uuid) THEN
  RETURN pablicus_push_private.finish_task(p_input);
 END IF;
 RETURN pablicus_push_private.rpc(p_action,p_input);
END;
$function$;
-- Only the worker can inspect a delivery ID for routing; no direct client access.
GRANT SELECT ON pablicus_push_private.task_deliveries TO service_role;
REVOKE ALL ON FUNCTION public.pablicus_push_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_push_rpc(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION pablicus_push_private.maintenance() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 DELETE FROM pablicus_push_private.worker_requests WHERE created_at<=now()-interval '2 minutes';
 DELETE FROM pablicus_push_private.outbox WHERE created_at<now()-interval '7 days';
 DELETE FROM pablicus_push_private.task_events WHERE expires_at<now()-interval '7 days';
 PERFORM pablicus_push_private.prepare_task_deliveries();
 IF EXISTS(SELECT 1 FROM pablicus_push_private.outbox WHERE state IN ('pending','sending') AND due_at<=now())
  OR EXISTS(SELECT 1 FROM pablicus_push_private.task_deliveries WHERE state IN ('pending','sending') AND due_at<=now()) THEN
  PERFORM pablicus_push_private.kick();
 END IF;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_push_private.maintenance() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
