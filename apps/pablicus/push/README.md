# Pablicus Web Push

Real encrypted browser push for installed Pablicus. No native app, SMS service,
Apple developer account or new user password is involved. On iOS the web app
must be on the Home Screen and notification permission must be requested by
an explicit user gesture. The user controls banners/lock-screen appearance
in iOS notification settings. No icon badge is requested by this implementation.

## HTTP contract

Deploy `index.ts`, `webpush.mjs`, `deno.json` as **pablicus-push**.
`verify_jwt=false` is intentional: every browser request verifies its Bearer
token against Auth `/user` and rechecks the approved profile in the database.
The dispatch route uses a separate single-use 256-bit capability, checked
through a service-role-only RPC. A publishable key or ordinary user JWT cannot
dispatch. Capabilities expire after two minutes and are atomically consumed.

* Authenticated `GET /functions/v1/pablicus-push` returns `{publicKey}`.
* Authenticated POST `{action:"subscribe",subscription:PushSubscriptionJSON}`
  saves the endpoint for the verified user; result `{ok:true}`.
* Authenticated POST `{action:"unsubscribe",endpoint}` removes only the verified
  user's registration; result `{ok:true}`. Other accounts cannot remove it.
* Internal POST `/functions/v1/pablicus-push/dispatch` requires
  `X-Pablicus-Worker`. A fresh random token is generated for every kick; only
  its SHA-256 hash is stored privately. A replay, expired token or previous
  reusable credential is rejected. Tokens are never returned to a browser or
  committed to git.

Encrypted payload: `{title:"Pablicus",body:"Новое сообщение",conversation_id,
message_id,recipient_id}`. No message text, filenames or profile/contact data
go through push. The service worker must reject a recipient ID that differs
from the locally bound account and use the message ID to deduplicate alerts.

## Installation and validation

1. Apply `EXTENSIONS.sql` (pg_net/pg_cron). SQL ACL revocations are requests,
   not a guarantee: this hosted installation's objects belong to
   `supabase_admin`, and postgres cannot revoke their owner-issued PUBLIC ACLs.
   Keep `net` outside all exposed API schemas and out of Realtime publications.
2. Apply reviewed `SCHEMA_PROPOSAL.sql`. Tables are private, have RLS enabled,
   and grant access only to service_role. No exposed definer functions.
   Then apply `WORKER_CAPABILITIES.sql` before activating the Edge worker.
3. Deploy the Edge function with the three files above. Built-in Supabase
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are used only on the server.
4. Apply `SCHEDULE.sql` through the administrative migration path, which runs
   as postgres. It schedules retries and calls `pablicus_push_private.kick()`
   once on the initially empty outbox. The read-only SQL tool runs under
   `supabase_read_only_user` and cannot invoke this administrative function.
5. Check that kickoff's `net._http_response` for HTTP 200 with
   `{ok:true,claimed:0,sent:0}`. This initializes a stable VAPID key pair inside
   the Edge runtime. Run security advisors. Never print the config table or
   request headers. Cron retries only when pending work is due and prunes
   outbox records older than seven days.
6. Both users enable notifications on their own installed app. Verify an alert
   with the recipient's phone locked by sending a normal new message.

The message trigger queues only recipients with registered devices. pg_net
starts its request after commit. Notification/network failures never reject a
message send. Workers claim at most 25 jobs with a two-minute lease, send in
groups of five, and retry transient errors up to seven attempts. Sender and
recipient approval, membership, read position, ownership and deletion are
rechecked at dispatch. HTTP 404/410 removes expired endpoints. Unknown network
outcomes can be retried: browser-side message-ID deduplication is required.
Endpoint redirects are refused and only Apple/FCM/Mozilla HTTPS push services
are accepted. A maximum of ten registered devices per user is enforced.

Run local verification after `npm ci` in `../chat-workspace`:

```sh
node --test apps/pablicus/push/webpush.test.mjs apps/pablicus/push/schema.test.mjs apps/pablicus/push/index.test.mjs
```

Crypto is built from WebCrypto primitives without third-party runtime packages.
The encryption output matches the published RFC 8291 example byte for byte;
VAPID is checked using Node's independent OpenSSL-backed verifier. PostgreSQL
tests use the project's already pinned PGlite dependency and synthetic data.
Edge request tests cover Auth verification, secret isolation and dispatch auth.
Physical iPhone delivery requires permission on the user's device; it cannot
be truthfully verified by these isolated tests.

## Rollback

To stop new pushes without altering chat messages or removing user accounts,
run as database administrator:

```sql
BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='pablicus-push-retry';
DROP TRIGGER IF EXISTS pablicus_push_message_insert ON public.messages;
UPDATE pablicus_push_private.outbox SET state='dead',lease=NULL
 WHERE state IN ('pending','sending');
COMMIT;
```

Already in-flight encrypted deliveries may still arrive. This preserves VAPID
keys and subscriptions so the reviewed trigger/schedule can be reinstated;
never regenerate VAPID as a routine rollback because browsers bind subscriptions
to that public key. Roll back the frontend notification controls independently
if needed. `LIVE_CHECKS.sql` supplies safe administrative health/ACL queries.

The existing pg_net 0.20.4 installation records `public` as its extension
namespace, although every extension function is in `net` and no public HTTP
wrapper exists. It is not relocatable. Its platform-owned SQL objects retain
PUBLIC access because postgres cannot revoke grants issued by supabase_admin.
`NET_HARDENING.sql` documents the desired owner-managed ACLs; its success must
never be inferred from a migration response alone. Read back effective ACLs.
No role escalation, system catalog modifications or extension reinstall is used.

Live checks confirmed that REST requests selecting `net` or
`pablicus_push_private` return HTTP 406: only `public` and `graphql_public` are
exposed. Neither private schema is in a Realtime publication. The push API
returns HTTP 401 without a verified user. Private config, subscriptions and
outbox are owned by postgres and their browser-role read/write permissions
are false. The worker queue contains only single-use two-minute capabilities;
it never contains the private VAPID key or a reusable worker credential.

Primary references checked 2026-09-08:

* [Supabase changelog](https://supabase.com/changelog.md): extension pinning
  change and explicit grants for newly created API objects reviewed.
* [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
* [pg_net transaction semantics](https://supabase.com/docs/guides/database/extensions/pg_net)
* [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
* [RFC 8291 encryption](https://www.rfc-editor.org/rfc/rfc8291)
* [RFC 8292 VAPID](https://www.rfc-editor.org/rfc/rfc8292)
* [WebKit: Web Push on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
