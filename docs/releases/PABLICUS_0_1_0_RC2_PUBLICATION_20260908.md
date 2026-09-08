# Pablicus 0.1.0-rc2 — stable publication, 2026-09-08

Status: PUBLISHED RELEASE CANDIDATE. Not a fully accepted production release.

## Exact accessible application

https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/

This is the existing repository's HTTPS GitHub Pages site with a new /pablicus/ subdirectory. It is not an expiring ShipStatic deployment. Existing root files were SHA-256 checked before/after staging and left unchanged. No Supabase schema, account or message was changed during this publication.

- Application source commit: 4fcf34507ecb56bca3590f864ae56d46354b831d
- Source branch: pablicus-rc2-release
- Complete buildable client source: apps/pablicus/ in that branch/commit, including inherited accepted code, build.py, finalize.py, transport-store, product client, static assets and tests.
- Publication commit on main: 491ec319e1f5ebfb3cf0e577c9dba175dcbf64ec
- Published static client: pablicus/ on main.
- Asset revision: 3e4c0d268cf92179
- Build/browser check run: 34203868313, success; actual scope is Chromium/WebKit + IndexedDB + explicitly mocked Supabase backend.
- Checked build artifact: 10046952008; archive digest 874d70162c3567b0db27160336c6943e754bc6c37c73fd88bd616392185554ed.
- Publication run: 34206093276, success.
- Publication evidence artifact: 10047827907. All 19 published files fetched through HTTPS match the tested artifact byte-for-byte.

## Corrected deployment diagnosis

Read-only audit run 34205847721 confirmed that Pages already exists: build_type=legacy, source branch=main, source path=/, status=built, https_enforced=true. Existing site HTTP 200. Supabase Auth settings endpoint HTTP 200. Earlier statements that Pages was not configured were incorrect. A connector endpoint failure was not proof of absent hosting.

The model's local container has no outbound DNS access in this execution. Build/download/publication/network checks therefore run through the existing GitHub Actions runner, with artifacts returned through the GitHub connector. Do not retry direct container networking repeatedly.

## Scope of this candidate

Existing Supabase project and contracts; closed approved-account login; direct conversations; Realtime plus retained polling; account/chat-scoped IndexedDB drafts and outgoing queue; server client-message identifier deduplication; text, photos and documents; expandable/fullscreen composer; Focus; profile theme settings; public-shell PWA with stable relative id/start_url/scope and 180/192/512 PNG assets.

This is implementation scope, not proof that every live authenticated scenario has passed. Fresh two-account exchange with the real hosted backend is NOT YET VERIFIED. Physical iPhone/Home Screen acceptance is NOT YET VERIFIED. The read-only published-browser smoke run is separate from mocked-backend integration and from authenticated acceptance.

Current explicit limits: one text message up to 5000 characters; selected files up to 25 MiB; outgoing video processing not enabled. Feed, shared tasks/plans, social publishing, AI execution, voice recording, calls and push are not implemented in this candidate. Those sections must not show fabricated working data.

## Continuation and rollback

Keep the application URL and PWA identity stable. Do not replace root index.html, reset messenger-architecture-1.0, replace user accounts, discard existing accepted Gate evidence, or use failed media-v30–v35 as a baseline.

For the next candidate, edit the existing app sources; run only affected regressions, verify exact artifact provenance, and promote the checked dist to the same main:/pablicus/ directory. The publication workflow lives at .github/workflows/pablicus-publish-candidate.yml on the release branch. It intentionally pins the tested run/commit and refuses unexpected Pages configuration.

Rollback restores only main:/pablicus/ from the previous publication commit/artifact and requests a Pages rebuild. Database changes are not coupled to static rollback. Preserve IndexedDB database names/schema and inspect pending drafts/outbox before any future incompatible storage change.

Next acceptance on actual hosted candidate: existing approved account login/session retention, reciprocal messages while both chats stay open, one offline queued message after reconnection without duplication, photo/document opening, draft/queue survival and Home Screen launch. Do not require repeating previously accepted isolated UI tests without a changed code path or new risk.
