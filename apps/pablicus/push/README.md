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

## Task reminders and followup

Apply `TASK_REMINDERS_SCHEMA_PROPOSAL.sql` after
`../chat-workspace/TASK_LIFECYCLE_SCHEMA_PROPOSAL.sql`. The existing Edge worker,
VAPID keys, subscriptions, and `pablicus-push-retry` minute cron are reused;
there is no second recurring job or new credential. The cron invokes the replaced
`maintenance()` function, which queues due task deliveries before kicking the
same single-use worker capability. The worker still claims at most 25 deliveries,
reserving up to five places for tasks so message bursts cannot starve reminders.

The task mutation trigger schedules one event per task schedule version,
recipient, and kind, independently of whether the app is open. The approved
assigned member is the recipient; an unassigned shared task addresses all current
approved participants. Each subscribed device present when the due event is
materialized gets one delivery. If the recipient has no subscribed device yet,
the event waits until its expiry. New participants do not retrospectively inherit
notifications from a schedule created before they joined.

* `task_reminder`: runs at `due_at - reminder_minutes`. A late reminder expires
  at the task time; an explicit at-time reminder has a 15-minute delivery window.
* `task_followup`: runs at `due_at + 180 minutes`, asking whether the task was
  completed. The followup has a 24-hour delivery window and sends once. It never
  marks a task complete, deletes it, or repeatedly prompts without a new schedule.
* UTC instants determine dispatch; `due_timezone` only formats the task's due
  time in its notification. Cron resolution is one minute, plus provider/network
  delivery latency; it is not an exact-time alarm.

Task payloads use the existing encrypted Web Push transport:

```json
{
  "kind": "task_reminder or task_followup",
  "notification_id": "stable event UUID",
  "task_id": "task UUID",
  "conversation_id": "conversation UUID",
  "recipient_id": "recipient UUID",
  "due_at": "ISO timestamp",
  "expires_at": "ISO timestamp",
  "title": "Скоро запланировано дело / Удалось завершить дело?",
  "body": "Task title and due time / completion prompt"
}
```

The task title is included only inside the encrypted payload, limited to 350
characters. Ordinary message notifications retain their generic body. The service
worker must check recipient binding and expiry, deduplicate `notification_id`,
and route a click to the task's conversation. The app's authenticated task UI
handles completion, archive, postponement, and permanent removal.

Changing due time, reminders, assignee, completion, archive, or deletion advances
`schedule_version` and cancels pending/leased old jobs. Claim rechecks the current
task state, schedule, recipient approval, membership, and subscription ownership.
Late acknowledgements cannot resurrect cancelled deliveries. Leased jobs retry
with the same event ID and a fresh lease; expired endpoints are removed. A push
already accepted by the platform cannot be recalled by a subsequent task edit.
Events expire and are pruned seven days after expiry together with deliveries.
Private task tables have RLS and no browser grants; task scheduler functions are
owner-only or worker-only. No client timer is used for background notification.

Additional local verification:

```sh
node --test apps/pablicus/push/task-reminders.test.mjs
```

These tests execute both schema proposals and the actual private SQL in the
pinned PGlite runtime with synthetic tasks, accounts, devices, and a fake pg_net
transport. They cover due windows, stable retry IDs, cancellation and stale leases,
completion/archive/delete, approval/membership loss, device rebind, expiry, cron
capabilities, multiple devices, and bounded fair task/message batches.

To stop only task notifications while preserving chat push and task content:

```sql
BEGIN;
DROP TRIGGER IF EXISTS pablicus_task_reminder_schedule ON pablicus_chat_private.canvas_tasks;
UPDATE pablicus_push_private.task_events SET state='cancelled' WHERE state IN ('pending','ready');
UPDATE pablicus_push_private.task_deliveries SET state='dead',lease=NULL WHERE state IN ('pending','sending');
COMMIT;
```

Primary references rechecked 2026-09-09:
[Supabase Cron](https://supabase.com/docs/guides/cron) and
[Supabase changelog](https://supabase.com/changelog). No relevant breaking change
to the existing hosted pg_cron/pg_net worker integration was identified.
