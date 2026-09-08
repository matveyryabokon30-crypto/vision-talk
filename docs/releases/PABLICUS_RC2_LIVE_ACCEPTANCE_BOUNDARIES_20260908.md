# Pablicus RC2 — live checks and continuation, 2026-09-08

## Already published; do not redeploy a random test origin

Application URL: https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/
Product version: 0.1.0-rc2.
Application source commit: 4fcf34507ecb56bca3590f864ae56d46354b831d on pablicus-rc2-release.
Application sources and build: apps/pablicus/ in that source commit.
Asset revision: 3e4c0d268cf92179.
Main publication commit: 491ec319e1f5ebfb3cf0e577c9dba175dcbf64ec.
Publication run 34206093276 succeeded. Evidence artifact 10047827907 verified all 19 hosted files match the tested distribution bytes. Existing root files were preserved. This URL has no ShipStatic three-day expiry and is the intended stable URL for subsequent updates.

Status: PUBLISHED CANDIDATE, NOT FULLY ACCEPTED RELEASE. Never equate a mock-backend PASS with authenticated two-user acceptance.

## Actual checks of the deployed URL

Read-only live run 34207537458 at test-harness commit 0791a066d910221c62faa40f8fc614c62b7edf0a. Artifact 10048411111, SHA-256 7f609f91bb524bfcbd646093a1c40f6f3208be5ad284efa0ab8e91217080c33b.

- Published version.json matches source commit 4fcf345.
- Manifest name Pablicus, display standalone, relative stable id/start_url/scope.
- Hosted PNGs decoded with exact dimensions 180x180, 192x192, 512x512.
- Real anonymous HTTPS queries to messages, conversations and conversation_members returned zero rows.
- Chromium: login screen, in-app installation guidance, active correctly scoped service worker, 17 public static cache entries, desktop width, actual new-document offline reload and no JavaScript errors all passed.
- WebKit: online document initialized, email/password login rendered without exposing the workspace, installation guidance worked, and page-initiated online reload initialized a new document. Then the assertion requiring a nonempty app cache failed. No JavaScript errors were reported. The harness labels the broader online phase FAIL because that phase includes the cache assertion; do not label all WebKit checks PASS.
- Earlier WebKit run 34206613517 reached the offline Page.reload step, where the automation returned an internal WebKit error. The subsequent normal-profile/page-initiated test did not prove a fix; it exposed the cache assertion instead. Both failures remain evidence. Do not keep rerunning the same test without collecting new cache/worker diagnostics.
- WebKit offline cold start remains UNQUALIFIED. Physical iPhone/Safari/Home Screen launch is NOT TESTED by these Linux browser runs.

Screenshots in the artifact show actual published Chromium login at phone and desktop sizes, not a rendered design mockup.

## Backend read-only audit and access boundary

Supabase project ctcoqgsztdtsazdiwcmd: 2 approved existing profiles, 74 existing messages and conversation last_seq=74 remained unchanged after these checks. messages RLS is enabled; the sender_id/client_message_id unique index exists; message-media remains private. Metadata privilege checks show anonymous cannot execute send_message/send_attachment_message and authenticated cannot update profiles.is_approved. These are metadata facts, not substitutes for hostile authenticated API tests.

An attempted rollback-only role-scoped SQL test was rejected at SET LOCAL ROLE authenticated with permission denied, before the send RPC. No role grants or account password resets were made. Do not evade this restriction. The managed SQL connection is not a browser login and must not be represented as proof of user-level RPC/RLS behavior.

Remaining automatic live-exchange blocker: no authorized browser sessions or securely provided credentials for two approved QA accounts are available to the runner. Do not ask for production passwords in chat, invent credentials, reset accounts, expose a service-role key, or mark two-user messaging verified. Secure QA credentials through a runner secret mechanism or an actual two-account device test are valid next routes.

## Implemented candidate boundaries

Code implements existing-account login, direct chats, server messages, Realtime plus retained polling, per-account/chat durable draft and outbox, stable send identifiers, server ACK, private photo/document upload/opening, Focus, profile/theme, inherited growing/fullscreen composer and PWA shell. Its UI/backend-adapter tests passed with an explicitly mocked backend in run 34203868313. Live two-account exchange and session restoration are not yet accepted.

Current explicit limits: text <=5000 characters; attachments <=25 MiB. Outgoing video processing is disabled. Feed/social posts/stories, shared tasks/plans, real AI, voice recording, calls and push are not implemented; their absence must remain visible rather than simulated.

## Next action, not a new Gate reset

Keep this URL, application identity, accepted isolated gate evidence and existing data. On the published candidate, validate two existing approved accounts, reciprocal messages without closing the chat, one queued message after offline/reconnect without duplicates, photo/document bytes and draft retention. Separately validate iPhone Home Screen launch and WebKit offline cold start. No repeat of accepted menus/text-list gates is required unless a related change or new risk exists.

Future changes must edit the release source, run affected checks, promote the checked artifact to main:/pablicus/ and preserve IndexedDB identifiers. Never replace the old root application to make the new candidate appear published.
