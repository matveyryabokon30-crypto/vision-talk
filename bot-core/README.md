# Public Bot Core — cloud pilot 0.1.1

Status: DEPLOYED / TWO-ACCOUNT CLOUD ACCEPTANCE BLOCKED. Not production-qualified.

This directory now contains the actual deterministic engine, HTTP handler, authentication adapter, and PostgreSQL RPC adapter. The earlier branch contained only an unconnected staging UI.

## Deployed
- Existing Supabase project: ctcoqgsztdtsazdiwcmd.
- Edge function: public-bot-core, version 1.
- Runtime source is pinned to commit 4303c3e7f48a624149f2343936496ea8ac227593.
- Applied migration: 20260910100400_public_bot_core_cloud_pilot_v1 (SQL retained under cloud/applied).
- Separate private schema public_bot_private. Existing chats and profiles are not migrated or replaced.
- No new paid project, branch, plan or server was created. Existing provider usage quotas still apply.

## Run the included cloud-source checks
Node.js >=22.16:
```
cd bot-core
npm test
```
These are 8 source-level tests, not a live cloud acceptance test. The separate complete source delivery contains the pre-existing SQLite runner and 67 additional tests (75 total passed locally).

## Security boundary
The gateway flag verify_jwt=false is intentional: the handler validates Supabase bearer tokens with Auth /user and requires an approved profile; pbc_ keys are hashed, revocable and scoped. Browser roles cannot call public_bot_store_v1 or access private tables. The RPC is SECURITY INVOKER, not DEFINER. Service credentials exist only in server environment variables. Owner approval is checked during cloud key lookup.

All 6 private tables have RLS and no user policies; direct user access is intentionally denied. Service-role access is trusted and therefore requires careful handler authorization. This is not proof that all authorization paths passed live tests.

## Do not publish yet
Read SERVER_STAGE_REPORT.md. The helper's attempt to create the first synthetic Auth user returned HTTP 500 unexpected_failure. No test accounts were successfully created. A revised QA helper deployment was blocked by tool safety, and the original helper was retired: public-bot-core-qa version 2 has JWT verification enabled and only returns HTTP 410. No bypass or alternative privileged fixture setup was used after that block.

No main merge, production UI button, authenticated two-account cloud test, production load test or native-device acceptance occurred. Existing user credentials were not requested or used.

## Continuing safely
Use two authorized test accounts through the normal application sign-in and verify identity, ownership isolation, chat history, idempotent writes, concurrent revisions, stop/resume and key revocation on PostgreSQL. Diagnose the failed test setup before calling the cloud pilot accepted; its cause is not established. Do not disable RLS or weaken the messenger's login to get tests to pass. Do not request passwords or tokens in chat.

The staging UI stays in PR #33 and is not linked from the live messenger. It reads the existing browser session without changing Auth storage or refreshing it. Its pending retry ID is memory-only: reloading during a pending request is not an offline-outbox guarantee.

## Rollback / pause
Do not drop the schema as a routine rollback. First keep the UI disabled and deploy an inert public-bot-core handler returning 503, with JWT verification on. Preserve or export bot data before any separately authorized destructive rollback. Existing messenger handlers need not be changed.
