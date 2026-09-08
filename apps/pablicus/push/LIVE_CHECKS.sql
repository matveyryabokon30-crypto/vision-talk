-- Safe administrative checks: no VAPID private key, worker token, endpoint or
-- subscription encryption secret is selected by these queries.
SELECT name,default_version,installed_version FROM pg_available_extensions WHERE name IN ('pg_net','pg_cron','pgcrypto');
SELECT to_regclass('net.http_request_queue') IS NOT NULL AS request_queue_exists,
 to_regclass('net._http_response') IS NOT NULL AS response_table_exists;
SELECT n.nspname,p.proname,p.prosecdef,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='pablicus_push_private' OR p.proname='pablicus_push_rpc';
SELECT n.nspname,c.relname,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT') AS anon_read,
 has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='pablicus_push_private' AND c.relkind='r';
SELECT public_key IS NOT NULL AS vapid_configured,length(public_key) AS public_key_characters,
 length(dispatch_token)=64 AS worker_secret_correct_length FROM pablicus_push_private.config;
SELECT jobname,schedule,active FROM cron.job WHERE jobname='pablicus-push-retry';
SELECT state,count(*) FROM pablicus_push_private.outbox GROUP BY state;
SELECT count(*) AS registered_devices FROM pablicus_push_private.subscriptions;
SELECT count(*) AS unexpired_worker_capabilities FROM pablicus_push_private.worker_requests WHERE created_at>now()-interval '2 minutes';
SELECT has_schema_privilege('anon','net','USAGE') AS anon_net_usage,
 has_schema_privilege('authenticated','net','USAGE') AS authenticated_net_usage;
SELECT n.nspname,p.proname,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='net';

-- Run this separately after deploying the Edge function; note its returned
-- request ID. On an empty outbox it initializes VAPID with no device delivery.
-- SELECT pablicus_push_private.kick() AS request_id;
-- Then inspect only that ID (replace 123 with the actual returned request ID):
-- SELECT id,status_code,timed_out,error_msg,content::jsonb
-- FROM net._http_response WHERE id=123;
-- Expected: HTTP 200 and {"ok":true,"claimed":0,"sent":0}.
