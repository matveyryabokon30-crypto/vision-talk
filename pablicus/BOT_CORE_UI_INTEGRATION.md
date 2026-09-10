# Public Bot Core UI integration candidate

Date: 2026-09-10

This branch adds an authenticated Bot Core UI module and a candidate page under `pablicus/` without changing the current main messenger shell, ordinary chats, Auth configuration, service worker, database schema or deployed Bot Core runtime.

Candidate capabilities:
- use the existing Public Supabase session;
- list the signed-in owner's bots;
- create private bots from `intake` and `help` templates;
- open a bot, start/stop it with optimistic revision protection;
- create/reuse a bot conversation;
- send text and button choices;
- reload persisted Bot Core history.

The candidate intentionally does not yet place a Bots button in `mainNav`. That navigation change is gated on browser acceptance of this candidate against the already-tested cloud runtime.

The candidate page is `pablicus/bots-candidate.html`. It is intended for staging publication/testing, not production navigation.

No claim is made here that the candidate has passed iPhone/PWA browser acceptance. The previous Bot Lab acceptance concerns the Bot Core API/security behaviours, not this new UI integration.