# Public Bot Core — first account cloud verification

Date: 2026-09-10.
Status: ACCOUNT_A_RUN_PASSED / SECOND_ACCOUNT_NOT_TESTED.

## Evidence provenance

The owner supplied the JSON copied from the published Bot Lab page in the conversation. It identifies project `ctcoqgsztdtsazdiwcmd`, starts at `2026-09-10T12:39:06.122Z`, and finishes at `2026-09-10T12:39:27.250Z`.

The supplied report contains 34 checks, all `pass: true`, `complete: true`, and `peer: null`. This is a user-run browser report, not a claim that the assistant performed a new authenticated browser run. The assistant corroborated persisted metadata with a read-only Supabase SELECT limited to synthetic test bots created in that exact time window. No passwords, token values, key hashes, personal messages or record contents were requested.

## Results in the supplied browser report

- Server health: HTTP 200; unauthenticated request: HTTP 401.
- Ordinary account accepted; owner identity checked.
- Two bots created; ownership checked.
- Intake conversation completed and exactly one record saved.
- Concurrent identical final requests returned one logical confirmation.
- Reusing the event ID with a different payload returned HTTP 409.
- History fetched from the server; five completed steps observed at that point.
- Help bot replied.
- Concurrent different changes at the same revision: one accepted, one revision conflict.
- Stop and resume accepted; stopped bot rejected new messages.
- Temporary chat-scoped key worked, could not manage bots or open a different bot.
- Key revoked and subsequently rejected with HTTP 401.
- Help bot returned to private visibility.

## Independently corroborated database metadata

Both test bots from that run exist. Each is active, private, and at bot revision 3. Both belong to the same owner; the actual owner identifier is omitted from this public report.

Two bot conversations exist for that owner:

| Conversation | Current revision | Persisted events | Persisted records |
|---|---:|---:|---:|
| Intake | 6 | 6 | 1 |
| Help | 2 | 2 | 0 |

The sixth intake event is consistent with the final `/start` after stop/resume in the test source. It does not contradict the five-step history check earlier in the run. Event bodies were not read in this corroboration.

The temporary key for the help bot exists with scope `chat` and a non-null revocation timestamp. Its secret value and hash were not read.

Inspected published test source: `bot-lab/lab.mjs`, Git blob `1ec4474e4295080a50b9d47bf0d7e8d2e97ae44c`.

## Remaining gate

`peer: null` means no cross-account result was included. A second allowed account must run its own account checks and use the first account's copied object code to exercise the four implemented peer-denial checks. Repeat in the opposite direction before assigning a two-account acceptance status.

The four current peer checks cover reading a private bot, reading its history, reading records, and creating a conversation with the private bot. They are not a complete authorization audit, load test, or installed-PWA lifecycle test. Key restrictions within account A do not establish isolation between two ordinary accounts.

No production messenger source, Auth setting, database schema, existing data, or deployment was modified in recording this evidence. This file is added only to the integration branch; PR #33 remains draft and unmerged.
