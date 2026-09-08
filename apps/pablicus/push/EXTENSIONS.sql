-- Platform prerequisites, executed separately before SCHEMA_PROPOSAL.sql.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Request desired ACLs, then read back: hosted supabase_admin-owned objects
-- may retain PUBLIC grants that postgres cannot revoke. WORKER_CAPABILITIES.sql
-- is mandatory; keep net excluded from exposed schemas/publications.
REVOKE ALL ON net.http_request_queue,net._http_response FROM PUBLIC,anon,authenticated;
-- Also deny the extension's default PUBLIC function/schema access.
REVOKE ALL ON SCHEMA net FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA net FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA net TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO service_role;
