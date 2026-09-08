-- Intended OWNER-MANAGED ACL correction after installing pg_net. No extension drop, object
-- relocation, catalog mutation or loss of pending notification data.
-- pg_net's extension metadata can name public while all functions live in net.
-- Hosted readback 2026-09-08: owner supabase_admin issued PUBLIC grants;
-- postgres cannot revoke them. A successful migration with warnings does NOT
-- mean these ACLs changed. Read back effective privileges in LIVE_CHECKS.sql.
-- Current protection is exclusion from the Data API/Reatime and single-use
-- worker capabilities, not a claimed SQL ACL denial on platform-owned objects.
BEGIN;
REVOKE ALL ON SCHEMA net FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA net FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA net TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO service_role;
-- The message-trigger/cron worker runs as its postgres owner, unaffected by
-- browser-role revocations. Only the Edge RPC API is reachable by service_role.
COMMIT;
