# Public Bot Core — Stage 2 status, 2026-09-10

**BLOCKED / INCOMPLETE IMPORT. Do not merge or deploy this branch as a working bot integration.**

## Exact baseline

- Source branch: `pablicus-rc2-release` at `7f17be3cb1e347f9f7777703aebca02ce5f14a10`.
- Isolated branch: `feat/public-bot-core-20260910`.
- Snapshot preparation commit: `89d52dd7c91795e69fc8f82f67aa550f670dc59a`.
- Source export workflow run: `34460143971`, success. This exported source; it did NOT run bot functional tests.
- No changes were made to the publication branch, production Supabase, approved icons, or live user data.

## Completed locally, not committed to this branch

The previous `Public_Bot_Core_v0.1.0.zip` was adapted to the current source tree, not copied over the old published application. The local candidate contains the independent engine, storage/API adapters, a build wrapper for the current messenger, and an opt-in bot panel. Each panel is pinned to its authenticated account and cancels pending requests on close or account change.

The final local run passed **75 Node tests, 0 failed, 0 skipped**. Candidate build comparison passed: six new bot assets, five expected generated build file edits; all other existing generated files are unchanged. Icons, PWA identity, ordinary chat/media and Auth modules remain byte-identical to the plain current build. The feature remains disabled by default.

## Blocker

The connector's platform safety check blocked the attempted source-tree write twice with an inability-to-determine-safety message. Upload was stopped. Partial Git objects were created, but no incomplete source tree was attached to this branch. This branch currently contains only source-preparation metadata and this status record, not the complete bot module.

The complete local candidate and raw local test evidence are delivered separately in the conversation as `Public_Bot_Core_Stage2_Candidate.zip`. The draft PR is a progress/blocker record, NOT a tested implementation PR.

## Not verified

Real PostgreSQL 17 transaction/role tests, Deno entry smoke tests, and current-client Chromium/WebKit integration tests have been authored but NOT executed. Their CI workflow is in the local candidate, not active in this branch. No cloud staging migration, Edge Function deployment, real-account Auth/PostgREST tests, or physical-device acceptance was performed.

Bots still use their own section and history. Integration as contacts in the ordinary messenger conversation stream, background queues, paid AI, real calendar booking and payments are not implemented.

Do not infer production readiness from local tests or from the successful source-export workflow. Restore a normal approved source-import path and run the remaining checks before considering any deployment. Do not bypass platform safety checks or overwrite the working source with the old ZIP.
