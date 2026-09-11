# Pablicus — 1C execution blueprint while source-write is blocked

Date: 2026-09-11.
Task: `PABLICUS-BLOCK01-1C-PREPARATION-WHILE-INCIDENT-20260911`, revision `R1`.
Status of this document: **DOCUMENTATION_ONLY / DESIGNED_NOT_PUBLISHED where source changes are described**.

Current 1C status remains **SUBSTEP_1C_BLOCKED_SUPPORT_CHANNEL**. This document does not clear the OpenAI source-write safety gate, does not publish the blocked payload, does not modify runtime Pablicus, tests or workflow, and does not advance to 1D. Accepted 1A/1B, the five-block plan, amendment 01, and the first physical iPhone review after Block 2 remain unchanged.

Fresh branch HEAD read before preparation: `ebb274af81eb2691d62fc8b2b09a860b05f368eb`. Historical 1C WORK_START_HEAD remains `dc4a6031e3a7b5248882f88dee11d83ccd88fd60`. Last executable CODE_SHA / TESTED_SHA remains `f00f253ca2adfe7afc07e64cc3a1dc8f53c5692d`; its browser matrix remains 0 PASS / 0 FAIL / 9 ERROR / 0 TIMEOUT / 0 NOT_RUN with zero behavioral assertions. Accepted 1B remains 31/31 PASS.

## 1. Safety boundary and purpose

The blocked operation remains the previously recorded `GitHub.create_tree` source write for integration-test instrumentation/diagnostics. The exact unpublished payload is not available in preserved evidence and is not reconstructed here. No equivalent source write is attempted in this preparation phase. Ordinary documentation is not treated as proof that source-write clearance changed.

The goal is to remove design ambiguity before normal service restoration. After a documented safety resolution, execution should require only the smallest approved harness implementation followed by already-specified diagnostics and acceptance runs.

---

# 2. Minimal future harness patch specification

Overall source-patch status: **DESIGNED_NOT_PUBLISHED**.

## 2.1 `tests/engineering/block-01/integration_1c/instrument.js`

### Current problematic construction

The committed instrument stores the following native browser functions as properties of `native`:

- `setTimeout`
- `clearTimeout`
- `setInterval`
- `clearInterval`
- `requestAnimationFrame`
- `cancelAnimationFrame`

and later calls them as methods of that object (`native.setTimeout(...)`, `native.clearTimeout(...)`, `native.raf(...)`, etc.). Independent review already proved that the receiver observed by recording substitutes changes from `window` before instrumentation to `native` after instrumentation for all six APIs.

### Proven harness defect

The instrumentation changes native receiver / `this` semantics. Browser startup causality is not yet proven; hypothesis H1 remains that the early `ChatCanvas.create → reset → clearTimeout` path could expose the receiver change before `legacyLogin` is unhidden.

### Minimal required future change

Preserve the native receiver semantics when forwarding all six browser primitives. The saved native callable may remain instrumented for accounting, but invocation must be equivalent to the original browser call with `window` as receiver. Do not replace these APIs with artificial implementations in the real browser run and do not disable observation.

### Expected behavior

For each API, calls made through the instrumented global must:

1. execute the original browser primitive;
2. observe the same receiver as a normal call through `window`;
3. preserve arguments, return identifiers and callback behavior;
4. continue to update instrumentation bookkeeping;
5. not add additional application-visible scheduling semantics.

### Proof that application runtime semantics were not changed

A dedicated instrument self-test must compare uninstrumented versus instrumented forwarding for all six APIs. It must record receiver identity, return-id type/validity and one actual callback/cancellation behavior per API family. The application files under `pablicus/` must be byte-identical between A/B diagnostics. This is a harness correction only.

### Instrument self-test requirements

`INSTRUMENT-NATIVE-RECEIVER-01`:

- baseline native call receiver: `window`;
- instrumented forwarding receiver: also `window`;
- `setTimeout` callback runs once;
- `clearTimeout` prevents a scheduled callback;
- `setInterval` runs and `clearInterval` stops it;
- rAF callback runs once and cancelled rAF does not run;
- resource counters return to expected baseline after cancellation/completion;
- any mismatch is FAIL, not warning.

## 2.2 `tests/engineering/block-01/integration_1c/case.py`

### Current problematic construction

The existing final capture executes in one sequential `try`:

`releaseWrite → App.state → instrument snapshot → screenshot → HTML`.

`App.state()` directly references `PablicusDebug`. If normal startup never creates that global, the exception prevents later evidence collection. The current case runner also lacks an independent outer `pageerror` collector even though the earlier probe had one.

### Proven harness defect

A secondary capture error can erase the evidence needed to identify the primary browser startup error. The last nine cases retained neither final screenshot nor final HTML.

### Minimal required future change

Install independent collectors **before `page.goto`**:

- `pageerror`;
- console events with type/text/location where available;
- `requestfailed`;
- HTTP/network failure observations from the explicit boundary.

Final evidence capture must be independent. Each of the following is attempted in its own bounded try/catch and one failure does not cancel the others:

- safe DOM/global state;
- optional application state;
- optional instrument snapshot;
- screenshot;
- HTML;
- network summary.

Base capture must not require the existence of `PablicusDebug`, `PablicusController` or `__integration`. Optional globals are checked with `typeof`/safe property access. No fake `PablicusDebug` may be created.

### Collector self-test

`COLLECTOR-EARLY-ERROR-01` uses an isolated test page that throws a deliberate early browser error before application globals exist.

PASS requires:

- process/test result remains nonzero (`FAIL` or `ERROR`, never PASS);
- first page error, message and stack/location are retained;
- console and request failures are retained when emitted;
- screenshot and HTML are retained whenever Chromium permits capture;
- absence of application globals is recorded as state, not as a capture crash;
- no behavioral product assertion is credited.

## 2.3 `tests/engineering/block-01/integration_1c/case.py` / `network.py` boundary precision

The existing LocalBoundary already models `get_message_actions`, `get_pinned_messages` and `factory_list_projects`. They must not be duplicated. The future correction is to make special routes obey the same explicit boundary contract as the base network model:

- exact host;
- exact HTTP method;
- exact path;
- synthetic authenticated user;
- expected request context;
- offline behavior;
- common `Boundary.calls` logging;
- explicit failure for unknown calls.

No universal `unknown RPC → []` fallback is permitted.

---

# 3. Controlled A/B browser diagnostic protocol

Status: **READY_TO_EXECUTE_AFTER_NORMAL_SAFETY_RESOLUTION**.

## 3.1 Fixed conditions

A and B use exactly the same:

- checked-out CODE_SHA;
- `pablicus/index.html`;
- bundled Supabase SDK;
- application/controller/chat/Canvas/bots/storage modules;
- Chromium version and launch flags;
- local origin;
- synthetic network state;
- synthetic USER_A and conversation;
- fixture files;
- viewport;
- service-worker policy;
- timeouts;
- production host blocking;
- collector implementation.

Only target variable: whether `instrument.js` is injected.

## 3.2 Variant A

Real Pablicus with **no instrument.js**.

## 3.3 Variant B

Real Pablicus with the corrected instrument enabled.

## 3.4 Mandatory evidence for both variants

- first `pageerror`;
- complete available stack and source/location;
- console messages;
- `requestfailed` entries;
- HTTP/network failures and boundary calls;
- `document.readyState`;
- URL/origin;
- `legacyLogin.hidden`;
- actual visibility of `#email`;
- presence/absence of `PablicusDebug`;
- presence/absence of `PablicusController`;
- presence/absence of `__integration`;
- minimal route/controller state when available;
- screenshot;
- HTML;
- exit classification (`PASS|FAIL|ERROR|TIMEOUT|BLOCKED`);
- source hashes for index, app, instrument and case runner.

## 3.5 Interpretation table

| A | B | Interpretation |
|---|---|---|
| PASS | receiver-related ERROR | H1 confirmed for this browser environment |
| same early ERROR | same early ERROR | H1 is not confirmed as root cause; investigate shared cause |
| ERROR X | ERROR Y | treat X and Y separately; no single invented root cause |
| PASS | PASS | receiver defect is fixed or no longer reproduces; proceed to preflight |
| environment ERROR/TIMEOUT | any | inconclusive; environment failure is not H1 evidence |

Runtime Pablicus must remain unchanged until a product failure is demonstrated independently of harness defects.

---

# 4. Explicit network contract registry

Primary API host: `ctcoqgsztdtsazdiwcmd.supabase.co`.
Storage host: corresponding `.storage.supabase.co` host.
Local origin static files are served only from the isolated test origin. External hosts are blocked.

Every modeled request must enter the common call journal with method, exact path, synthetic uid, relevant context/operation key and final status. Offline mode applies before special success behavior. Unknown calls remain explicit `501 / UNMODELED_BOUNDARY` (or a documented network block) and never become universal empty success.

The registry below is limited to observed or real-caller-backed paths needed by preflight/current nine scenarios.

## 4.1 Authentication and profile

| Endpoint | Real caller / need | Method/path | Required synthetic auth/context | Request | Response contract | Offline/error behavior |
|---|---|---|---|---|---|---|
| Password sign-in | `App.login`, bundled SDK `signInWithPassword` | POST `/auth/v1/token?grant_type=password` | none before login; fixture email selects A/B | email, password | Supabase-like session with user/access/refresh token | offline abort; invalid fixture credentials 400 |
| Refresh session | requirement 5, SDK `refreshSession` | POST `/auth/v1/token?grant_type=refresh_token` | refresh token bound to A or B | refresh_token | new session for same uid | offline abort; must not switch uid |
| Current user | SDK auth restore/session validation when requested | GET `/auth/v1/user` | bearer synthetic token | none | matching synthetic user | 401 if no synthetic session |
| Auth settings | SDK initialization if emitted | GET `/auth/v1/settings` | local test only | none | minimal settings object | exact logged route only |
| Profile | `authenticate()` real app call | GET `/rest/v1/profiles?...id=eq.<uid>` | same uid | PostgREST select/filter | approved profile for exact uid | late A response may be held; no cross-account overwrite |

## 4.2 Conversation/chat bootstrap

| Endpoint | Caller | Method/path | Arguments/context | Expected response |
|---|---|---|---|---|
| Dialog list | `loadDialogs()` | POST `/rest/v1/rpc/my_conversations_v3` | synthetic authenticated uid | A→C1,C2; B→CB; fallback v2 only if deliberately exercised |
| Dialog fallback | `loadDialogs()` | POST `/rest/v1/rpc/my_conversations_v2` | same | same schema; not silently used to hide v3 fixture error |
| Initial/read messages | `mountConversation`, `syncMessages`, requirement 5 held read | GET `/rest/v1/messages?...` | exact owned conversation and PostgREST filters | ordered synthetic messages only for owner |
| Conversation member read state | `syncMessages()` | GET `/rest/v1/conversation_members?...` | conversation + peer filter | minimal `last_read_seq` rows |
| Mark read | `syncMessages()` | POST `/rest/v1/rpc/mark_conversation_read` | `p_conversation_id`, `p_last_read_seq` | null success |
| Message action metadata | `chat-actions.js::sync()` | POST `/rest/v1/rpc/get_message_actions` | conversation + concrete message id array | `[]` is a valid empty fixture collection | exact host/POST/path/auth/context; logged; offline abort |
| Pinned messages | `chat-actions.js::syncPins()` | POST `/rest/v1/rpc/get_pinned_messages` | conversation | `[]` valid empty collection | same strict boundary |

## 4.3 Canvas, tasks and profile-side calls used by routes/lifecycle

| Endpoint | Caller | Method/path | Args | Response |
|---|---|---|---|---|
| Canvas load | `chatCanvas.load → canvasRpc` | POST `/rest/v1/rpc/pablicus_get_canvas` | `p_conversation_id` | state with `conversation_id`, `revision`, `canvas`, `tasks[]`, `participants[]` |
| Canvas save | real Canvas save path when scenario exercises persisted plan | POST `/rest/v1/rpc/pablicus_save_canvas_plan_v2` | conversation, expected revision, content | incremented canvas/revision or explicit 409 conflict |
| Task list | Tasks home/workspace quick during lifecycle | POST `/rest/v1/rpc/pablicus_list_tasks_v2` | view/query/today/cursor/limit/timezone | `{tasks:[], next_cursor:null}` for empty fixture |
| Project list | workspace quick if requested | POST `/rest/v1/rpc/pablicus_list_projects` | query/cursor/limit | `{projects:[], next_cursor:null}` |
| Storage usage | profile navigation | POST `/rest/v1/rpc/pablicus_storage_usage` | authenticated uid | numeric total/own/unknown counts |

The existing app also exposes create/update/delete Canvas task RPC callers. They are not preflight requirements unless a current 1C scenario invokes them; do not model them merely because they exist.

## 4.4 Message sending/outbox/storage

| Endpoint | Caller | Method/path | Context | Response/effect |
|---|---|---|---|---|
| Rich send | `pump()` | POST `/rest/v1/rpc/send_rich_message` | owned conversation; immutable `p_client_message_id`; rich content | idempotent synthetic server effect keyed by `(uid, client_message_id)`; repeated key returns same message |
| Object upload | `upload()` | POST/PUT `/storage/v1/object/<bucket>/<path>` for supported small files | authenticated owner/path | store exact byte count + SHA-256 in synthetic boundary |
| Signed object URL | `signedUrl`/verification | POST or SDK-defined exact sign request under `/storage/v1/object/sign/...` | authenticated owned path | signed fixture URL only for existing synthetic object |

If the working SDK emits additional resumable-upload endpoints for the chosen file sizes, they must be added only after a real caller/evidence trace proves they are reached. Current deterministic corpus stays below the simple-upload threshold where possible for 1C unless resumable behavior itself is the target.

## 4.5 Bots/scenario/factory used by requirement 1/lifecycle

| Endpoint | Real caller | Method/path | Context | Response |
|---|---|---|---|---|
| Bots list | `bots.js::load()` | GET `/functions/v1/public-bot-core/v1/bots` | bearer A/B | `{bots:[BOT]}` |
| Bot detail | `bots.js::openBot`, scenario bridge | GET `/functions/v1/public-bot-core/v1/bots/<BOT>` | same account | bot object |
| Bot chats | `bots.js::openBot` | GET `/functions/v1/public-bot-core/v1/bots/<BOT>/chats` | owner | `{chats:[]}` in route fixture |
| Factory projects | `bot-factory.js::renderHome` | POST `/rest/v1/rpc/factory_list_projects` | authenticated owner | `[]` for empty factory fixture; must obey offline and logging |

Current route scenario does not create or mutate a bot/factory project. Therefore POST bot creation, PATCH bot update, records, live bot chat and factory create/update/plan endpoints are **not required merely for presence in source**. Add them only if a future exact 1C scenario actually invokes them.

## 4.6 Realtime

The real SDK WebSocket must remain routed to the local synthetic boundary. Join/leave/heartbeat and declared Postgres-change subscriptions are journaled. No external socket connection is allowed. Active channel count is part of lifecycle evidence.

---

# 5. Deterministic synthetic test data

No real PII, tokens or production identifiers are used.

## 5.1 Identities and conversations

- `USER_A = 11111111-1111-4111-8111-111111111111`
- `USER_B = 22222222-2222-4222-8222-222222222222`
- `CONVERSATION_A1 = aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1`
- `CONVERSATION_A2 = aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2`
- `CONVERSATION_B1 = bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1`
- `BOT_1 = dddddddd-dddd-4ddd-8ddd-ddddddddddd1`

Synthetic login addresses remain `a@fixture.invalid` and `b@fixture.invalid`. Fixture passwords are test-only literals and are not production secrets.

## 5.2 Distinguishable texts

- `DRAFT_A = "1C-A-DRAFT::alpha::é::العربية::🙂"`
- `DRAFT_B = "1C-B-DRAFT::bravo::НЕ-СМЕШИВАТЬ-A-B"`
- `MESSAGE_A = "1C-A-MESSAGE::operation-key-A"`
- `MESSAGE_B = "1C-B-MESSAGE::operation-key-B"`
- Canvas unsaved marker: `"1C-CANVAS-UNSAVED::must-survive-deny"`
- Existing rich draft base retained for compatibility: `"1C: точный черновик\nСтрока №2 — é / العربية / 🙂"` plus tail `"Конец после трёх файлов — stable-order"`.

The values are deliberately non-overlapping so A/B mixing, stale overwrite and truncation are visible.

## 5.3 Existing deterministic file corpus

| Logical ID | Filename | MIME | Byte recipe | Size | SHA-256 | Default owner/use |
|---|---|---|---|---:|---|---|
| `FILE_A_TEXT` | `1-alpha.txt` | `text/plain` | UTF-8 `Original alpha\nСтрока один\n` | 37 | `9ce81549ae7afaa854078ba74b305266d12a7d0d816e4ac45a2d82f5465e54af` | A durability/outbox |
| `FILE_SEQUENCE` | `2-последовательность.bin` | `application/octet-stream` | byte `i % 251` for `i=0..4096` | 4097 | `a16560d668b843fb3be99ace41dbd18471f342bd3255a1d21204b35e43f74436` | A multi-file/order test or B isolation as explicitly declared per scenario |
| `FILE_TAIL` | `3-tail.dat` | `application/octet-stream` | byte `(255-i) % 256` for `i=0..256` | 257 | `e54984387fbd4ff16d36a4633e6e60072a29d7685d5ada5d39b5142ebc608be9` | explicit-retry/byte mutation control |

Ownership is asserted by the scenario/store namespace, not embedded in the file bytes. Every use records the expected synthetic owner. A future test-data refactor may split A/B filenames, but is unnecessary for the current acceptance if namespace assertions prove isolation.

The corpus catches:

- order swap: logical order + stable block/file IDs mismatch;
- replacement: filename/size/hash tuple mismatch;
- one-byte corruption: SHA-256 mismatch;
- A/B mixing: store owner/conversation plus text/hash mismatch;
- duplicate send: operation key and synthetic effect count mismatch.

---

# 6. Final requirements matrix

## Requirement 1 — real module/routes integration

**Real modules:** `index.html`, bundled SDK, `app-controller.js`, `app.js`, `chat.js`, `chat-canvas.js`, `bots.js`, `bots-nav.js`, scenario bridge/editor, actual stores.

**User action:** index → login A → conversation A1 → Canvas → conversation → Back → Bots → bot/scenario → return → factory view where currently routed → chats → conversation A1.

**Initial state:** clean isolated browser profile/origin; synthetic API state; no runtime modifications.

**Observables:** controller route; visible home/app; `conversationId`; `resourceId`; selected nav/tab; current chat scope; active message list; Canvas ready state; real module globals/source hashes; boundary calls.

**PASS:** each visible screen matches controller state; conversation/canvas use same exact A1 identity; Canvas has null unrelated `resourceId`; scenario has BOT resource id; active list exists only where required; no unexpected network route or unhandled page error.

**Negative control:** isolated route/resource corruption (for example scenario resource mismatch) must fail the same consistency assertion, not fail startup.

**Failure reason:** exact route/screen/resource mismatch or missing real module/resource.

**Evidence:** per-stage states, source hash manifest, screenshot checkpoints, network journal.

## Requirement 2 — lifecycle and at least 50 transitions

**Resource classes:**

- `APP_CONSTANT`: SDK client, controller singleton, persistent top-level application handlers intentionally retained for app lifetime.
- `SCREEN_SCOPED`: message list, Canvas editor resources, route handlers/subscriptions/observers/channels tied to an active screen.
- `TRANSIENT_OPERATION`: finite timeouts/rAF, in-flight RPC/fetch, one-shot mutation observers or temporary modal handlers.

**Sequence:** warm lazy modules once, return to chats home, capture baseline, then run a deterministic route cycle at least six times so controller generation delta is >=50, always returning to the same home state.

**Measure:** live event listeners by source/type; controller subscriptions/handlers; Mutation/Resize/Intersection observers; timeouts/intervals/rAF; active message lists; media/screen resources; SDK/realtime channels; navigation count.

**PASS:** after GC/settling and return to same state, SCREEN_SCOPED counts equal baseline, active list is zero at home, intervals/channels/subscriptions do not accumulate, one UI event yields one navigation, APP_CONSTANT values remain present rather than disappearing.

**Quiet-list test:** with unchanged synthetic data, observe `#screenContent` at home and `#canvas`/hidden home while conversation is idle for a bounded interval spanning normal poll timers. DOM mutation callbacks/records attributable to list rerender must remain zero unless a declared time display/state legitimately changes; any expected benign mutation must be named and excluded by exact source/selector, not by disabling observation.

**Negative control MUTATION_A:** isolated test copy intentionally leaves one screen-scoped listener/observer/interval/list active after each cycle. Same final resource assertion must FAIL specifically because the resource count grows.

## Requirement 3 — real durability of draft/files

**Real modules:** UI composer, rich composer, `PablicusRichStore`, working IndexedDB/vault, real chat open/leave, Canvas guard.

**Initial state:** A/A1 clean store.

**Operation:** enter `DRAFT_A` plus deterministic files through real UI; blur/persist; record stable block IDs/file IDs/order/hash; Canvas transition; deny exit with unsaved Canvas marker; verify unchanged route/editor/list/draft; accept exit; open A2 then return A1; close/reopen conversation; perform real same-origin page reload; reopen A1.

**PASS:** live and stored fingerprints are identical before/after transitions and reload: text, block order, stable IDs, filename, MIME, size, SHA-256 original Blob. Denied Canvas exit retains unsaved marker and active resources; accepted exit uses real leave; return uses real open and yields a working list.

**Negative control MUTATION_C:** isolated copy changes exactly one restored attachment byte **or** swaps exactly one attachment order after read. Same hash/order assertion must FAIL with `BYTE_HASH_MISMATCH` or `ATTACHMENT_ORDER_MISMATCH`; startup ERROR/TIMEOUT does not qualify.

## Requirement 4 — durable outbox

**Real modules:** composer → store queue/outbox/transport → upload/send pump.

**Sequence:**

1. set network unavailable;
2. enqueue `MESSAGE_A` + files;
3. record queue id, `client_message_id`, first sequence, message blocks, file IDs/order/hash;
4. actual page reload while API stays offline and declared local static shell loads unchanged source;
5. verify identical queue record and bytes;
6. restore network with `lose_ack=true` and hold `send_rich_message` after synthetic server effect;
7. verify effect count=1 and queue not deleted;
8. release with ACK transport loss, make network unavailable again and inspect durable queue;
9. retry after connectivity restoration;
10. same operation key is used; synthetic server effect remains count=1; ACK resolves queue.

**Explicit rejection path:** deny send → queue state `error`, original bytes retained, reason visible → clear denial → user retry → success.

**Counters:** `request_count(send_rich_message)`, unique operation keys, synthetic committed effect count, queue state transitions and stored file hashes.

**PASS:** loss of ACK never creates a second synthetic effect; unacknowledged data persists; explicit rejection never clears bytes; successful retry uses intended key semantics.

**Boundary statement:** synthetic effect/idempotency evidence is not production-server or RLS acceptance.

## Requirement 5 — A → B → A and late operations

**Initial state:** A/A1 has private draft/files and optionally outbox; B/B1 has distinct `DRAFT_B`/file fingerprint.

**Cases:**

- delayed A conversation read then login B and open B1; release A response;
- held native A draft write then switch B before release;
- held A send after synthetic commit then switch B before response completion;
- B same-user token refresh.

**Observables:** profile/uid; controller route; current conversation; `PablicusChat.scope`; draft fingerprint; attachments; outbox; selected resource; pending operations; boot/store identity.

**PASS:** late A work cannot mutate B screen/profile/draft/queue/resource; B remains exactly B; switching back to A restores A’s own expected durable state; same-user refresh does not destroy/reopen the screen or change draft without cause.

**Negative control MUTATION_B:** isolated copy removes one stale-account/currentness gate on the delayed read/save path. Same test must FAIL because an A marker appears in B state, B route/current changes, or B store fingerprint changes. Environment/startup failure is not the mutation result.

## Requirement 6 — storage failures and recovery

**Boundaries:** real store logic with controlled native IndexedDB transaction failure/abort only at the test boundary; no replacement read/write implementation.

**Write failure:** arm one store write failure → live unsaved text remains visible; vault reports error/pending; previous stored fingerprint stays intact; save error UI visible → clear cause → real retry → saved fingerprint equals live.

**Atomic enqueue failure:** fail actual outbox/draft-clear transaction → draft remains live+stored, queue absent, error visible; no false sent/saved state.

**Load failure:** after leaving conversation, arm one native readonly drafts transaction refusal → real open enters load-error/not-ready and visible error state; no false saved state → reload/open after cause removed restores expected bytes.

**PASS:** no silent clearing, no false saved/sent state, reason observable, retry works after one-shot cause removed.

This remains a bounded 1C failure set, not a full IndexedDB audit.

## Requirement 7 — positive/negative controls

Mandatory mutations:

- `MUTATION_A_RESOURCE_LEAK`: normal lifecycle PASS; isolated leak FAIL specifically on resource accumulation.
- `MUTATION_B_LATE_ACCOUNT`: normal isolation PASS; isolated stale-account guard break FAIL specifically because late A affects B.
- `MUTATION_C_BYTE_OR_ORDER`: normal durability PASS; one-byte or one-order mutation FAIL specifically on SHA-256/order assertion.

Mutation source is isolated and never committed over the working candidate. Exact same positive assertion is used where practical. Mutation run must reach the behavioral assertion. ERROR/TIMEOUT/startup failure does not qualify as expected negative control.

---

# 7. Preflight gate

Mass browser matrix is forbidden until preflight passes.

Required chain:

`HTTP 200 → real index → intended legacy login form visible on test origin → SDK login A → dialogs → conversation A1 → live message list → Canvas ready → return conversation with same live list contract`.

Preflight additionally verifies:

- first unhandled page error: none;
- `PablicusDebug`/normal production state exists only after normal app startup reaches it;
- `__integration` exists only in instrumented variant;
- IndexedDB is available and working store reaches ready/empty-or-specified state;
- no unexpected `UNMODELED_BOUNDARY`;
- all production/external hosts remain blocked except declared synthetic API interception;
- controller route and visible screen are consistent at each step;
- screenshot/HTML/error collectors work even if a later stage fails.

If preflight fails, assign one root result (`FAIL|ERROR|TIMEOUT|BLOCKED`) with fingerprint and mark dependent cases `NOT_RUN` or `BLOCKED` with `blocked_by=<preflight test/fingerprint>`. Do not launch nine copies of the same known startup failure.

---

# 8. Strict execution order after normal safety resolution

**GATE 0 — safety clearance:** record the actual support/status basis that permits source-write continuation. No inferred clearance.

**GATE 1 — minimal harness correction:** publish only the approved instrument receiver/capture/network-boundary correction; runtime Pablicus unchanged.

**GATE 2 — collector self-test:** early sentinel error is retained with nonzero result and surviving evidence.

**GATE 3 — A/B instrument diagnostic:** execute section 3 and determine H1/H2 from evidence.

**GATE 4 — preflight:** complete real index → login → conversation → Canvas → return chain.

**GATE 5 — requirements 1–7:** execute all required browser scenarios; no transfer of open items to 1D.

**GATE 6 — accepted 1B regressions:** 31/31 must remain PASS on final candidate.

**GATE 7 — negative controls:** all three required mutations must fail for the intended behavioral reason while positive source passes.

**GATE 8 — fresh CI:** any change to source/test/workflow invalidates prior CI for the new candidate. Run exact CODE_SHA in full checkout.

**GATE 9 — artifact integrity:** download original ZIP, verify GitHub digest/CRC, source hashes, result/log hashes, environment and finite process cleanup.

**GATE 10 — handoff docs:** update `INTEGRATION_1C_MANIFEST.json`, `INTEGRATION_1C_REPORT.md`, structured evidence and reproducible tests. Record actual HANDOFF_HEAD after creation.

**GATE 11 — status:** only if every original 1C requirement is satisfied: `SUBSTEP_1C_READY_FOR_INDEPENDENT_REVIEW`. Never self-assign ACCEPTED and never auto-start 1D.

---

# 9. Primary evidence schema

Each scenario result must contain at least:

```text
test_id
requirement_id
tested_sha
start_time_utc
end_time_utc
duration_ms
environment
browser
origin
synthetic_user
synthetic_conversation
initial_state
actions[]
checks[]
result
failure_class
first_error
console[]
page_errors[]
request_failures[]
network_calls[]
blocked_external_requests[]
resource_before
resource_after
storage_observations
file_hashes[]
screenshots[]
html_reference
process_log
log_hashes
dependencies[]
blocked_by
```

Allowed result statuses only:

- `PASS`
- `FAIL`
- `ERROR`
- `TIMEOUT`
- `NOT_RUN`
- `BLOCKED`

Rules:

- `PASS` requires all mandatory behavioral checks and mandatory evidence.
- `FAIL` means test reached the intended behavioral assertion and observed wrong product/harness behavior.
- `ERROR` means unexpected execution error prevented valid assertion.
- `TIMEOUT` is a bounded deadline result, never converted to expected mutation FAIL.
- `NOT_RUN` records a deliberately skipped dependent case with dependency/reason.
- `BLOCKED` records an unmet prerequisite outside the case’s valid execution boundary.
- missing evidence can never become PASS.

File-bearing cases additionally record logical id, block/file id, order index, filename, MIME, size, original SHA-256, restored SHA-256 and owner/store namespace.

---

# 10. Cost-of-failure / duplicate early-error rule

To prevent another 9× content-free startup failure:

1. Define an early-failure fingerprint from:
   - error class/type;
   - normalized message;
   - source URL/file;
   - first meaningful stack frame / line+column when available.
2. A failure counts toward deduplication only if it occurs **before the first behavioral assertion**.
3. If three independent cases in the same dependent group hit the same fingerprint before their first behavioral assertion, stop launching further dependent cases.
4. Mark the rest `NOT_RUN` with:
   - `blocked_by=<root test id>`;
   - fingerprint;
   - dependency explanation.
5. Independent scenarios that do not depend on the failed startup path may continue.
6. Different fingerprints are not collapsed together.
7. A product behavioral FAIL reached after assertions does not automatically stop unrelated cases.
8. TIMEOUT is fingerprinted separately and never treated as an intended negative mutation result.

The runner summary must distinguish `executed`, `deduplicated_not_run`, and `independent_continued` counts.

---

# 11. Prepared assertions by current scenario

The already-published scenario intent can be retained after harness repair rather than redesigned:

- `routes`: route/screen/resource consistency and real module graph.
- `quiet`: no idle rerender mutation in unchanged home/message lists.
- `lifecycle`: >=50 transitions, no screen-resource accumulation, one event→one navigation.
- `durability`: original file hash/order, stored/live equality, reopen and real reload equality.
- `canvas`: real unsaved deny; real leave waits for held native save; return has working list and identical file bytes.
- `outbox`: offline queue+reload, lost ACK with one server effect, retry, explicit rejection and recovery.
- `isolation`: A/B durable draft isolation, delayed A read, same-user refresh, held native A save then B, A restoration.
- `pending-send`: committed A send held across switch to B, B remains isolated, A queue restored and retry does not duplicate effect.
- `storage-errors`: write failure retention/retry, atomic enqueue abort, real native load failure/retry.

The redesign needed is harness correctness/evidence quality plus explicit required mutation controls; not replacement of these scenarios with unit mocks.

---

# 12. Items still blocked / not completed

As of this blueprint:

- OpenAI source-write safety status is still `NOT_RESOLVED` in preserved evidence.
- Support request was prepared but no ticket/case was created from the available execution environment.
- The minimal harness patch is **DESIGNED_NOT_PUBLISHED**.
- Collector self-test is not implemented/executed.
- Browser A/B is not executed.
- Preflight after harness repair is not executed.
- Requirements 1–7 remain OPEN.
- Required negative mutation controls remain NOT_RUN.
- There is no new CODE_SHA/TESTED_SHA or successful fresh 1C CI.
- No new runtime Pablicus defect has been established.
- Runtime Pablicus, main, production, Supabase, RLS/Auth, real user data, design, managed browser policy and URLBlocklist are unchanged.
- No merge/deploy, reset/force-push, 1D, Block 2–5, messaging or purchases are authorized or performed by this document.

This blueprint is intentionally the final design/preparation artifact while the source-write incident remains unresolved. It is not an executable candidate and is not 1C acceptance.
