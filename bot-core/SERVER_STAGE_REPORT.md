# Public Bot Core — server stage report

Date: 2026-09-10. Status: **DEPLOYED / CLOUD TWO-ACCOUNT ACCEPTANCE NOT COMPLETED**.

## What changed

The actual core source is committed in this branch, not merely a browser API shell. The immutable runtime-source commit is `4303c3e7f48a624149f2343936496ea8ac227593`.

Supabase project `ctcoqgsztdtsazdiwcmd` (Vision talk) was confirmed ACTIVE_HEALTHY. Migration `20260910100400_public_bot_core_cloud_pilot_v1` was successfully applied. It creates only `public_bot_private` tables (bots, sessions, events, records, keys, quota_buckets) and the service-only `public.public_bot_store_v1(jsonb)` RPC.

Edge Function `public-bot-core` was deployed as version 1, ACTIVE; bundle SHA-256 `f78ae396855db078618567b7401869dfdfaec5e82be35f0bd5db980e27eb261d`. It imports the immutable runtime-source commit. Server authentication is in the handler, not in the gateway: Supabase Auth /user plus the approved profile, or a hashed revocable chat key. No service credentials are in browser files or this report.

The staging UI was corrected: canonical template identifiers come from `/v1/templates`; replies and buttons come from `replies[]`; history is restored from the API; a lost-response retry reuses the same event identifier; stopped bots disable the composer; changing the browser session clears the screen. No new Auth client is created and no existing Auth storage is written. Pending retry state is memory-only, not a durable PWA outbox.

## Directly observed cloud checks

Responses were obtained through the project's `pg_net` HTTP queue and inspected in `net._http_response` for exact generated request IDs only. No unrelated requests or user message contents were read.

| Request | Observed |
|---|---|
| GET /public-bot-core/health | 200, version 0.1.1 |
| GET /public-bot-core/v1/me without token | 401 UNAUTHORIZED |
| GET /public-bot-core/v1/me with invalid token (QA run) | 401 UNAUTHORIZED |
| Unrelated Origin on health | 403 ORIGIN_FORBIDDEN |
| Existing GitHub Pages Origin on health | 200; exact Access-Control-Allow-Origin echoed |
| Anonymous direct storage RPC | 401; PostgreSQL 42501 permission denied for function |
| Retired QA endpoint without credentials | 401 at gateway |

A service-side quota write succeeded before the QA run. This confirms connectivity for that RPC operation; it is not evidence that all bot state transitions work in PostgreSQL.

Catalog inspection confirmed RLS on all six private tables; anon/authenticated have no SELECT, and service_role has SELECT. RPC execute permissions: anon=false, authenticated=false, service_role=true; SECURITY DEFINER=false.

## Local verification — do not confuse with cloud acceptance

Complete source kit: 75 Node tests passed, zero failed (67 existing tests plus 8 cloud-source checks). The eight new cloud-source tests are included in this repository and run with `cd bot-core && npm test`. The original SQLite runner and its other tests remain in the complete downloadable source kit.

Updated staging UI: 9 Chromium checks passed, zero failed. Harness: about:blank page, exposed Python transport to a real local SQLite HTTP server, controlled testStorage substitute for browser localStorage. No external navigation or browser security settings were changed. Verified canonical templates, actual replies/buttons, retry after lost confirmation, one saved result, stop control, history reopening, second bot flow, 390px overflow, session clearing and no JavaScript errors (grouped into 9 checks).

These tests do NOT verify Supabase password/passkey sign-in, PostgreSQL concurrency, mobile PWA lifecycle or live two-account isolation.

## Blocked acceptance step

The one-shot QA runner was intended to create two temporary synthetic Auth accounts, test the real public endpoint and remove those accounts. It passed 3 preliminary checks, then the first account-creation request returned HTTP 500 with code `unexpected_failure`. No fixture account IDs or bot IDs were returned. Therefore the authenticated test sequence never ran.

A read-write diagnostic INSERT into auth.users was denied by the connection's database permissions and made no change. Deployment of a revised QA handler was blocked by tool safety. No attempt to bypass that block or weaken Auth/RLS was made. The cause of the original Auth API 500 remains unestablished; this is not a finding that the messenger's user sign-in is broken.

The original temporary QA function was replaced with an inert version 2: gateway JWT verification enabled; body only returns 410 retired; no administrative operations remain. No existing user password, refresh token or session was requested or used.

## Preservation checks

Before and after deployment, the hashes of existing messenger function definitions, columns and RLS policies were identical:

- Existing functions: `aa094b640fee78ecd58ff96940df50eb`.
- Existing columns: `9c3aafb7251ce29820bc9993d4cfcba6`.
- Existing policies: `1cbf40a0f08de1754458372e724b23d6`.

Counts before/after: profiles 5, conversations 4, messages 94. Final QA-profile count: 0. These are snapshot checks, not a full user-data backup.

No edits to the production `pablicus/app.js`, `index.html`, `sw.js` or ASSET_MANIFEST.json. No main-branch merge, no production Bots button and no live staging-page publication. Changes remain in Draft PR #33. No new paid project, development branch, subscription or external server was created; existing Supabase usage limits still apply.

## Advisor findings

No new WARN attributable to Bot Core was returned. Six INFO notices were added for private tables with RLS and no policies; this is intentional denial of direct browser access, independently checked via grants. Pre-existing warnings remain: pg_net in public, four existing authenticated SECURITY DEFINER RPCs, and disabled leaked-password protection. They were not modified as part of this stage.

Official interpretation/remediation: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy ; https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public ; https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable ; https://supabase.com/docs/guides/auth/password-security . References explain platform behavior, not test results.

## Release gate

Do not call this a production-qualified bot platform. Complete authenticated testing through normal sign-in with two authorized test users; validate isolation, idempotency, concurrent revisions, persistence, stop/resume, visibility changes and key revocation on the actual PostgreSQL backend. Only then connect the Bots button to the current messenger and test browser/PWA sessions and devices. Keep the Draft PR unmerged until those checks are recorded.
