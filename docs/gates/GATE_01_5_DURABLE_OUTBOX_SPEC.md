# Gate 01.5 — durable local outgoing queue

Date: 2026-09-08. Project: Vision Talk only.
Status: CANDIDATE_IN_TEST; production integration BLOCKED.

## Scope
An isolated successor to Gate 01.4. An explicit Send action transfers a saved draft into a durable local outgoing group with text and attachment messages. It does NOT upload, call Supabase, authenticate, execute an agent, or deliver to another browser. No server ACK exists. Every active group is visibly `В очереди · не отправлено`. Retry is a local retry-intent operation on the same record, not a claimed network attempt.

The previous 01.4 user evidence supports its scoped storage checks in both mobile browsers. It does not grant acceptance to this new source. Old deployments, main, Supabase and accepted source files must remain unchanged.

## Blocking invariants
1. Validate and save the current draft before handoff. Queue insertion, sequence allocation and draft clearing use one IndexedDB readwrite transaction spanning the same database. Report success only on transaction completion.
2. On failure before commit, retain both the live draft and previous saved draft; no half-added group or consumed attachment.
3. Assign a stable intent ID to a saved draft content revision, preserved across selection/mode-only changes. The same enqueue intent is idempotent, including competing connections and recovery of its prior result. An intentionally submitted new draft may contain the same text and must not be globally deduplicated by content.
4. Each child text/attachment message has a stable ID and increasing local sequence. Local order is NOT a future server order guarantee.
5. Original file bytes remain in the shared asset store; queue references protect them from subsequent draft edits/deletion. Handoff does not rewrite blobs unnecessarily.
6. After actual page reload/new tab/browser-process restart in the same origin/profile, restore stable IDs, order, text, attachment bytes and queue state. A separate fresh-DB byte audit and an optional pre/post-navigation checkpoint report exactly what each measured.
7. Retry changes only local retry metadata, never creates a new outgoing record or invents a server ACK.
8. Cancellation is explicit and confirmed. Persist a tombstone; reject retry and do not resurrect a cancelled intent. Release blobs only when no active group or draft references them.
9. Missing file data blocks handoff/restoration with an explicit error. A filename is not proof of bytes.
10. The test harness operates in temporary DBs. It must not clear, enqueue or mutate the user's actual draft/queue. Private text, file names and fingerprints are not included in exported diagnostic JSON.
11. Preserve the existing composer and scroll algorithms. Queue errors and navigation controls remain accessible. An enqueue transaction can briefly prevent duplicate interactions; physical keyboard/focus behavior is a separate device check.
12. No test may label `sent`, `delivered`, or `read` without a real authenticated transport acknowledgment. Negative controls must catch fake ACK, duplicate retry and premature draft loss.

## Proof layers
- Native IndexedDB fixture tests: rollback after writes, quota/denial injection, original bytes, concurrent same-intent calls, stale revision rejection, identical text in a new intent, cancellation, missing bytes.
- Real browser integration with generated image, valid MP4, text document and 16 MiB binary fixture: UI handoff, reload, new tab, browser-process restart, loaded-page offline enqueue, actual failure UI, retry, cancelled record after navigation, and separate next draft.
- Fault after transaction completion but before UI clearing triggers page reload to prove recovery at that exact boundary. This is not a power-loss or OS-kill test.
- UI regression checks preserve editor expansion, visible Send, menu and list state. Simulated height/width is not physical iPhone keyboard/rotation.
- User Safari/Chrome checks on the published URL remain mandatory before scoped device acceptance.

## Limits
Single anonymous test conversation/profile; no cross-browser/account synchronization, no background network sending, no offline shell caching, no arbitrary-size or indefinite storage guarantee. Reopening the site may require connectivity; offline enqueue is tested only after the page is already loaded. Local storage can be removed by the user/browser. Hash checks read files for verification and are not an unlimited-file or memory benchmark. Storing original video bytes is not proof of its playback/encoding.

## Baseline provenance
Parent served files come from the successful Gate 01.4 artifact (run 34161167177, artifact 10032673500). Four source SHA-256 values are fixed in the builder. A blocked direct fetch of the old site must not be bypassed or described as a passing runtime test; use this authorized captured artifact. Builders work only in gates/gate-01-5-outbox/site.

A new candidate will be published only after actual executed tests, with failures retained and exact publication assets rechecked. Green fixture results alone do not authorize production integration.
