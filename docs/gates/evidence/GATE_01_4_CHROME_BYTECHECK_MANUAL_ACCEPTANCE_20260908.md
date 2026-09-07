# Gate 01.4 — Chrome restored-draft bytecheck accepted within scope

Review date: 2026-09-08. This is not an inferred screenshot capture date.
Project: Vision Talk only.
Candidate: `gate-01.4.0-durable-draft`.
Scoped status: **CHROME_CURRENT_RESTORED_DRAFT_BYTECHECK_CONFIRMED_BY_SCREENSHOT_AND_USER**.
Combined device evidence: **SAFARI_AND_CHROME_STORAGE_AUTOTESTS_PASS; RESTORATION_AND_CURRENT_DRAFT_BYTE_COMPARISONS_SUPPORTED_IN_BOTH**.
Whole-gate release / production integration: **NOT AUTHORIZED_BY_THIS_SCOPED_ACCEPTANCE**.

## Evidence and continuity

Read before recording: `GATE_01_4_CHROME_STORAGE_REVIEW_20260908.md`, blob `42af999a56000b4d648855459e751fe36bb86ef5`.
The earlier Chrome JSON, generated 2026-09-07T21:35:01.252Z, identified CriOS, reported 18/18 isolated storage checks, restoration of 112 characters and three attachments, but contained `storage.audit=null`.
The immediately preceding instruction asked for Verify Bytes in that already open Chrome page, without another autotest or reload.

The user now supplies a screenshot and the exact statement: **«Все совпало»**.
Screenshot attachment: `CC8CEB1E-2DF3-4145-861D-7C12DA819AD9.png` (conversation file `file_0000000079f081f49c08c2b86156d447`).
The screenshot shows Gate 01.4 at `fleeting-mesh-8c9pdyg.shipstatic.com`, the status **«Сверка: текст и байты всех файлов совпали»**, three attachment cards, a retained draft and the footer **«Восстановлено · файлов: 3»**.
Associate this with the requested Chrome continuation; do not treat the image as a new UA measurement or independent second device run.

This is user-supplied screenshot evidence plus explicit confirmation, not an assistant-performed browser test. The image and its private draft/attachment contents are not copied into the repository or deployment. No new JSON, hashes, byte total or navigation checkpoint is invented. The older raw JSON retains its historical null audit; this later evidence supplements it rather than rewriting it.

## Decision

Close the previously outstanding Chrome current-restored-draft bytecheck item for the shown three attachments. No repeat of this byte comparison, identical screenshots or unchanged storage autotests is required merely to reconfirm the same success. No replacement JSON is needed to establish this screenshot-level/manual result.

| Scoped evidence | Safari | Chrome |
|---|---|---|
| Isolated automatic storage checks | 18/18 PASS, prior device JSON | 18/18 PASS, prior device JSON |
| Restored draft reported | 112 characters, three files | 112 characters, three files |
| Current draft versus fresh database comparison | Positive structured audit in prior JSON | Positive on-screen result plus user confirmation in this step |

The fixture hashes in automatic tests are distinct from the actual-draft comparison. Safari's 19,898,404-byte total is not assigned to Chrome. Verify Bytes compares the present draft with a fresh database read; it does not by itself prove a pre/post-process-restart hash checkpoint.

## Limits retained

This closes the requested comparison, not every device or release criterion. Full user-draft clearing after reopen, exact process-termination sequences, current-build editor regressions and any remaining manual device scenarios keep their existing evidence statuses. No measured FPS, indefinite retention, arbitrary file-size support, offline shell, account synchronization, real task execution, upload, playback or recipient delivery is inferred. Earlier pending flags are not silently erased.

The next proposed isolated capability is Gate 01.5: a durable outgoing-message queue. Its intended acceptance boundary is explicit submission into a persisted outbox, recovery of unsent entries after reopen, preserved attachment references, visible waiting/error states and no loss or duplicate enqueue. Actual server acknowledgement, idempotent delivery and recipient receipts require their own real transport tests; simulated acknowledgements must not be labelled real delivery. This is a proposed next scope, not implemented or tested in this recording.

## Changes actually made

Only this evidence/acceptance document is added to `messenger-architecture-1.0`. No application code, deployment, origin, authentication, Supabase, transport, production main, previous report or accepted gate is changed. No new browser execution or deployment occurred.