# Gate 01.4 — Safari storage report review

Review date: 2026-09-08. Device report times remain 2026-09-07 UTC.
Build: `gate-01.4.0-durable-draft`.
Scoped status: **SAFARI_STORAGE_AUTOTEST_AND_RESTORED_DRAFT_AUDIT_PASS**.
Whole gate and production integration: **NOT CLOSED; REMAINING_DEVICE_SCOPES_PENDING**.

## Provenance

User-supplied JSON generated `2026-09-07T21:28:28.037Z`, exported `2026-09-07T21:28:40.345Z`. Its reported user agent identifies iPhone Safari. No new assistant device execution is claimed.

Raw report: `GATE_01_4_SAFARI_20260907T212828037Z_USER_REPORT.json`, commit `ff4b3ca403b4079eba03cdd3a44f19eada431727`. Whitespace normalised; values, historical pending-acceptance flags and null fields preserved. No actual draft text, media contents or file names are included.

The preceding screenshot review was read from `GATE_01_4_RESTORE_BYTECHECK_SCREENSHOT_REVIEW_20260908.md`. That review recorded four attachments. The immediate user instruction then requested removal of one attachment, waiting for Saved, closing/reopening the same URL in the same browser, byte verification and the non-destructive autotest. This response supplies structured results, not a written narration of every action.

## Accepted evidence, with separate datasets

1. **Isolated automatic storage checks: 18/18 PASS.** The temporary test database restored 3545 characters, binary fixtures of 7, 65537 and 33 bytes, selection and editor state, file metadata/order. Deletion, clear, revision conflicts, competing writes, rollback and injected quota/denial controls passed. Its `count:2` deletion result concerns test fixtures, not the user's three attachments. Tiny fixtures labelled image/video are binary-storage fixtures, not proof of decodable media.
2. **Actual restored draft audit: PASS.** `storage.state=restored`, revision 4, 112 characters, three retained/restored attachments. The audit at `21:28:16.702Z` reports exact text equality and matching current-draft/database file bytes, totalling 19,898,404 bytes (about 19.9 decimal MB). No pending save, active transaction or reported storage error remains.
3. **Non-destructive test and no local sends in this page instance.** The autotest reports the user draft unchanged; `composer_metrics.local_sends=0`, `errors=[]`.

Three restored attachments are consistent with the requested four-to-three removal scenario. Counts alone do not identify the removed file or prove the exact navigation sequence; no additional unchanged four-file screenshot is needed. `reload_check=null`: do not claim a recorded pre/post-navigation checkpoint or a browser-process restart from this report. Restoration and the fresh database audit are supported by their own fields.

## Scope not silently expanded

- No independent Chrome report for this gate is supplied here.
- Full user-draft clearing and explicit process-termination/reopen sequences are not documented by this report; automatic fixture clearing is a different test.
- `editor_regression=NOT_RUN`; manual keyboard/rotation/smoothness remain unmeasured in this export. Previous observations keep their original scope and are not erased.
- `persistent=false`, `background_save_guaranteed=false` and the storage estimate are preserved, not replaced with a durability guarantee. The estimated `usage` is not used as a measurement of restored payload size; the separate byte audit supplies that size.
- No playback, upload, delivery, account sync, offline shell, unlimited-size storage or indefinite retention qualification follows from this result.

## Next focused device action

Do not ask the user to repeat the accepted Safari autotest or unchanged three-file audit. Obtain the equivalent independent Chrome check on the same Gate 01.4 URL: use a separate test draft in Chrome, wait for Saved, reload/reopen, verify bytes, and remove one test attachment then reopen to check it remains removed. Export that browser's report. A later explicit clear check must be chosen by the user, not hidden in test cleanup. No new deployment is required for this check, and no transfer of the Safari draft to Chrome is expected.

## Changes in this recording step

Only the supplied report and this scoped review were added on `messenger-architecture-1.0`. No application assets, deployment, hostname, production main, Auth, Supabase, upload or previous acceptance record was changed. No new browser test was run.
