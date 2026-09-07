# Gate 01.4 — Chrome storage report review

Review date: 2026-09-08. Original device timestamps are preserved in UTC.
Build: `gate-01.4.0-durable-draft`.
Scoped status: **CHROME_STORAGE_AUTOTEST_PASS_AND_DRAFT_RESTORATION_REPORTED**.
Actual restored-draft byte audit in Chrome: **NOT_PRESENT_IN_EXPORT**.
Whole gate / production integration: **NOT CLOSED; REMAINING_SCOPES_PENDING**.

## Provenance

User-supplied JSON generated `2026-09-07T21:35:01.252Z`, exported `2026-09-07T21:35:05.900Z`. UA contains `CriOS/153.0.8010.24`, identifying reported iPhone Chrome. This is not an assistant-performed device run.

Raw report: `GATE_01_4_CHROME_20260907T213501252Z_USER_REPORT.json`, commit `86d357e5beaf09abcf911b432484d7ae11173588`. Formatting normalised; values, nulls, pending acceptance flags and scopes preserved. It contains no actual draft text, filenames or media content.

The preceding Safari evidence record `GATE_01_4_SAFARI_STORAGE_REVIEW_20260908.md` was read before this recording. Safari's positive audit is not transferred to Chrome.

## Supported results

- 18/18 isolated storage checks PASS, including exact text, binary fixture hashes, metadata/order, no unchanged blob rewrites on typing, revision conflicts, competing writes, rollback, removal, clear, missing-byte detection and non-destructive testing.
- The fixture sizes are 7, 65537 and 33 bytes. These are storage fixtures; labels image/video do not establish valid media decoding or verification of the user's selected files.
- The actual page reports `storage.state=restored`, revision 4, 112 draft characters, 3 restored files and 3 retained assets.
- No pending save, active transaction, storage error or JavaScript error is reported. Local sends in this page instance: 0.
- `storage.audit=null` and `storage.reload_check=null`. The report does NOT contain a successful fresh-database byte comparison for the user's three Chrome attachments or a pre/post-navigation checkpoint. Do not substitute automatic fixture hashes or Safari's 19,898,404-byte audit for this missing measurement.
- No written narration of the exact reopen/removal sequence is supplied. Counts alone do not prove the removed file's identity or a browser-process restart.

## Current comparison

| Scope | Safari report | Chrome report |
|---|---|---|
| Automatic storage fixtures | 18/18 PASS | 18/18 PASS |
| Actual restored draft | 112 characters, 3 files | 112 characters, 3 files |
| Actual current draft vs fresh database audit | PASS, 19,898,404 bytes | Not present (`audit=null`) |
| Pre/post-navigation checkpoint in supplied report | null | null |

## Focused next action

Do not request another Chrome autotest, another attachment selection, a repeated Safari test or a new deployment. In the currently open Chrome page, expose the existing diagnostic toolbar if needed, press `Сверить байты`, wait for its success or error result, then export `Отчёт -> Копировать JSON` without rerunning the autotest or reloading. A positive result records only the audit it actually performs; remaining manual/clear/retention and integration limits must not be silently closed.

## Isolation and limits

This step adds only the supplied report and this review to `messenger-architecture-1.0`. No runtime, deployment, URL, source assets, authentication, Supabase, main branch or prior acceptance record was changed. No new test run was performed.

`editor_regression=NOT_RUN`, keyboard/rotation/smoothness unmeasured, `persistent=false` and `background_save_guaranteed=false` remain unchanged. No new playback, upload, delivery, offline-shell, account sync, unlimited-size or indefinite-retention qualification follows.
