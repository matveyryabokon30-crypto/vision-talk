-- Additive push infrastructure. No message content is copied into notifications.
-- Apply after review. Requires pg_net + pg_cron enabled by EXTENSIONS.sql.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE SCHEMA pablicus_push_private;
REVOKE ALL ON SCHEMA pablicus_push_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA pablicus_push_private TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pablicus_push_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE pablicus_push_private.config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 public_key text,
 private_jwk jsonb,
 dispatch_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32),'hex'),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pablicus_push_private.config(singleton) VALUES(true);
CREATE TABLE pablicus_push_private.subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 endpoint text UNIQUE NOT NULL CHECK(length(endpoint) BETWEEN 10 AND 2048),
 p256dh text NOT NULL CHECK(length(p256dh)=87),
 auth_key text NOT NULL CHECK(length(auth_key)=22),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user ON pablicus_push_private.subscriptions(user_id);
CREATE TABLE pablicus_push_private.outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES pablicus_push_private.subscriptions(id) ON DELETE CASCADE,
 message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 7),
 due_at timestamptz NOT NULL DEFAULT now(),
 lease uuid,
 last_status integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(subscription_id,message_id)
);
CREATE INDEX push_outbox_due ON pablicus_push_private.outbox(due_at) WHERE state IN ('pending','sending');
CREATE INDEX push_outbox_message ON pablicus_push_private.outbox(message_id);
CREATE INDEX push_outbox_recipient ON pablicus_push_private.outbox(recipient_id);
ALTER TABLE pablicus_push_private.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE pablicus_push_private.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pablicus_push_private.outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA pablicus_push_private FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pablicus_push_private TO service_role;

-- All exposed RPC access is service-role-only. The Edge handler verifies real
-- Auth user tokens before calling user operations with their verified UUID.
CREATE FUNCTION pablicus_push_private.rpc(p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE v_config pablicus_push_private.config; v_uid uuid; v_endpoint text;
 v_id uuid; v_result jsonb; v_status integer; v_sub uuid;
BEGIN
 IF p_action='config' THEN
  SELECT * INTO v_config FROM pablicus_push_private.config WHERE singleton;
  RETURN jsonb_build_object('publicKey',v_config.public_key,'privateJwk',v_config.private_jwk);
 ELSIF p_action='worker_auth' THEN
  -- WORKER_CAPABILITIES.sql must be applied before deploying the Edge worker.
  RETURN pablicus_push_private.consume_worker(p_input->>'token');
 ELSIF p_action='init' THEN
  IF coalesce(p_input->>'publicKey','') !~ '^[A-Za-z0-9_-]{87}$' OR p_input->'privateJwk'->>'kty' IS DISTINCT FROM 'EC'
   OR p_input->'privateJwk'->>'crv' IS DISTINCT FROM 'P-256' OR coalesce(p_input->'privateJwk'->>'d','') !~ '^[A-Za-z0-9_-]{43}$'
  THEN RAISE EXCEPTION 'invalid key' USING ERRCODE='22023'; END IF;
  UPDATE pablicus_push_private.config SET public_key=p_input->>'publicKey',private_jwk=p_input->'privateJwk' WHERE singleton AND public_key IS NULL;
  RETURN pablicus_push_private.rpc('config');
 ELSIF p_action IN ('subscribe','unsubscribe','user_check') THEN
  v_uid:=(p_input->>'user_id')::uuid;
  IF v_uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_uid AND is_approved) THEN
   RAISE EXCEPTION 'account unavailable' USING ERRCODE='42501';
  END IF;
  IF p_action='user_check' THEN RETURN jsonb_build_object('ok',true); END IF;
  v_endpoint:=p_input->>'endpoint';
  IF p_action='unsubscribe' THEN
   DELETE FROM pablicus_push_private.subscriptions WHERE endpoint=v_endpoint AND user_id=v_uid;
   RETURN jsonb_build_object('ok',true);
  END IF;
  IF v_endpoint IS NULL OR v_endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)/[^#[:space:]]+$'
   OR length(v_endpoint)>2048 OR coalesce(p_input->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}$'
   OR coalesce(p_input->>'auth','') !~ '^[A-Za-z0-9_-]{22}$' THEN
   RAISE EXCEPTION 'invalid subscription' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,13));
  IF (SELECT count(*) FROM pablicus_push_private.subscriptions WHERE user_id=v_uid)>=10
   AND NOT EXISTS(SELECT 1 FROM pablicus_push_private.subscriptions WHERE user_id=v_uid AND endpoint=v_endpoint)
  THEN RAISE EXCEPTION 'device limit reached' USING ERRCODE='22023'; END IF;
  -- A subscription belongs to the currently signed-in account on this browser.
  -- Rebinding deletes old queued deliveries before changing the owner.
  DELETE FROM pablicus_push_private.outbox WHERE subscription_id IN (
   SELECT id FROM pablicus_push_private.subscriptions WHERE endpoint=v_endpoint AND user_id<>v_uid);
  INSERT INTO pablicus_push_private.subscriptions(user_id,endpoint,p256dh,auth_key)
   VALUES(v_uid,v_endpoint,p_input->>'p256dh',p_input->>'auth')
   ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth_key=excluded.auth_key,updated_at=now();
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='claim' THEN
  -- Recheck authorization and unread state at dispatch, not just at insertion.
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
   ORDER BY due_at,id LIMIT 25 FOR UPDATE SKIP LOCKED
  ), claimed AS (
   UPDATE pablicus_push_private.outbox o SET state='sending',attempts=attempts+1,lease=gen_random_uuid(),due_at=now()+interval '2 minutes'
   FROM candidates c WHERE c.id=o.id RETURNING o.*
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease',c.lease,
   'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key)),
   'payload',jsonb_build_object('title','Pablicus','body','Новое сообщение','conversation_id',m.conversation_id,'message_id',m.id,'recipient_id',c.recipient_id)
  )),'[]'::jsonb) INTO v_result FROM claimed c JOIN pablicus_push_private.subscriptions s ON s.id=c.subscription_id JOIN public.messages m ON m.id=c.message_id;
  RETURN v_result;
 ELSIF p_action='finish' THEN
  v_status:=(p_input->>'status')::integer;
  IF v_status IS NULL OR v_status NOT BETWEEN 0 AND 599 THEN RAISE EXCEPTION 'invalid status' USING ERRCODE='22023'; END IF;
  SELECT subscription_id INTO v_sub FROM pablicus_push_private.outbox WHERE id=(p_input->>'id')::uuid
   AND lease=(p_input->>'lease')::uuid AND state='sending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true); END IF;
  IF v_status IN (404,410) THEN
   DELETE FROM pablicus_push_private.subscriptions WHERE id=v_sub;
  ELSE
   UPDATE pablicus_push_private.outbox SET state=CASE WHEN v_status BETWEEN 200 AND 299 THEN 'sent'
    WHEN attempts>=7 OR (v_status BETWEEN 400 AND 499 AND v_status NOT IN (408,429)) THEN 'dead' ELSE 'pending' END,
    due_at=now()+make_interval(secs=>least(3600,60*power(2,attempts-1)::integer)),last_status=v_status,lease=NULL
   WHERE id=(p_input->>'id')::uuid AND lease=(p_input->>'lease')::uuid;
  END IF;
  RETURN jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'invalid action' USING ERRCODE='22023'; END IF;
END; $function$;
REVOKE ALL ON FUNCTION pablicus_push_private.rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pablicus_push_private.rpc(text,jsonb) TO service_role;
CREATE FUNCTION public.pablicus_push_rpc(p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT pablicus_push_private.rpc(p_action,p_input);
$function$;
REVOKE ALL ON FUNCTION public.pablicus_push_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_push_rpc(text,jsonb) TO service_role;

CREATE FUNCTION pablicus_push_private.kick() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_token text; v_request bigint;
BEGIN
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO pablicus_push_private.worker_requests(token_hash) VALUES(extensions.digest(v_token,'sha256'));
 SELECT net.http_post(
  url:='https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/pablicus-push/dispatch',
  body:='{}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','X-Pablicus-Worker',v_token),timeout_milliseconds:=60000
 ) INTO v_request;
 RETURN v_request;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Pablicus push dispatch deferred'; RETURN NULL;
END; $function$;
REVOKE ALL ON FUNCTION pablicus_push_private.kick() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION pablicus_push_private.enqueue_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_count integer;
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 INSERT INTO pablicus_push_private.outbox(subscription_id,message_id,recipient_id)
 SELECT s.id,NEW.id,cm.user_id FROM public.conversation_members cm
 JOIN pablicus_push_private.subscriptions s ON s.user_id=cm.user_id
 JOIN public.profiles p ON p.id=cm.user_id AND p.is_approved
 WHERE cm.conversation_id=NEW.conversation_id AND cm.user_id<>NEW.sender_id
 AND EXISTS(SELECT 1 FROM public.profiles sender JOIN public.conversation_members sm ON sm.user_id=sender.id
  WHERE sender.id=NEW.sender_id AND sender.is_approved AND sm.conversation_id=NEW.conversation_id)
 ON CONFLICT(subscription_id,message_id) DO NOTHING;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count>0 THEN PERFORM pablicus_push_private.kick(); END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- Push infrastructure can never turn an otherwise valid send into a failure.
 RAISE WARNING 'Pablicus notification could not be queued'; RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION pablicus_push_private.enqueue_message() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pablicus_push_message_insert AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION pablicus_push_private.enqueue_message();

CREATE FUNCTION pablicus_push_private.maintenance() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 DELETE FROM pablicus_push_private.outbox WHERE created_at<now()-interval '7 days';
 IF EXISTS(SELECT 1 FROM pablicus_push_private.outbox WHERE state IN ('pending','sending') AND due_at<=now()) THEN
  PERFORM pablicus_push_private.kick();
 END IF;
END; $function$;
REVOKE ALL ON FUNCTION pablicus_push_private.maintenance() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
