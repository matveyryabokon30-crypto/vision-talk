-- Replace reusable worker credentials in pg_net with single-use capabilities.
-- pg_net is not an exposed API schema; its platform-owned queue may retain
-- broad SQL ACLs. Only a short-lived one-time token ever enters that queue.
BEGIN;
CREATE TABLE pablicus_push_private.worker_requests (
 token_hash bytea PRIMARY KEY CHECK(octet_length(token_hash)=32),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_worker_requests_created ON pablicus_push_private.worker_requests(created_at);
ALTER TABLE pablicus_push_private.worker_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pablicus_push_private.worker_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON pablicus_push_private.worker_requests TO service_role;

CREATE FUNCTION pablicus_push_private.consume_worker(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE v_consumed bytea;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'not authorized' USING ERRCODE='42501';
 END IF;
 -- DELETE atomically claims a capability; two concurrent replays cannot pass.
 DELETE FROM pablicus_push_private.worker_requests
 WHERE token_hash=extensions.digest(p_token,'sha256') AND created_at>now()-interval '2 minutes'
 RETURNING token_hash INTO v_consumed;
 IF v_consumed IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true);
END; $function$;
REVOKE ALL ON FUNCTION pablicus_push_private.consume_worker(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pablicus_push_private.consume_worker(text) TO service_role;

-- Intercept worker authentication at the sole public service-role entrypoint.
-- A legacy config dispatch token is no longer accepted by the HTTP worker.
CREATE OR REPLACE FUNCTION public.pablicus_push_rpc(p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
BEGIN
 IF p_action='worker_auth' THEN RETURN pablicus_push_private.consume_worker(p_input->>'token'); END IF;
 RETURN pablicus_push_private.rpc(p_action,p_input);
END; $function$;
REVOKE ALL ON FUNCTION public.pablicus_push_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_push_rpc(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION pablicus_push_private.kick() RETURNS bigint
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

CREATE OR REPLACE FUNCTION pablicus_push_private.maintenance() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 DELETE FROM pablicus_push_private.worker_requests WHERE created_at<=now()-interval '2 minutes';
 DELETE FROM pablicus_push_private.outbox WHERE created_at<now()-interval '7 days';
 IF EXISTS(SELECT 1 FROM pablicus_push_private.outbox WHERE state IN ('pending','sending') AND due_at<=now()) THEN
  PERFORM pablicus_push_private.kick();
 END IF;
END; $function$;
REVOKE ALL ON FUNCTION pablicus_push_private.maintenance() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
