# Gate 01.4 — durable draft candidate, actual live evidence

Recorded: 2026-09-07.
Candidate: `gate-01.4.0-durable-draft`.
Status: REMOTE_NATIVE_AND_LIVE_CHECKS_PASS; PHYSICAL_IPHONE_ACCEPTANCE_PENDING.
Production integration: BLOCKED.
URL: https://fleeting-mesh-8c9pdyg.shipstatic.com/
Claim: https://my.shipstatic.com/claim/9bba8c503c6b3d5597f4e03a920d1e05
Provider created epoch 1788813525; expires unless claimed 1789072725. No password or account.

## Implemented scope

The isolated composer now autosaves exact draft text, selection, full-editor state, attachment order and original File/Blob bytes in IndexedDB on this origin/browser. Saving uses one revision-checked transaction for metadata, added blobs and removals. Saved is shown only after transaction completion. Subsequent typing does not rewrite unchanged file blobs or regenerate their metadata. Pending newer edits are serialised behind an in-flight save. Errors and conflicting tabs are visible; retry is explicit. Removing/clearing after a successful commit is persistent.

Restoration does not send anything. Local sent test history, demo task state and mode are deliberately not restored. The prototype has one anonymous draft slot, not account/conversation sync. The new footer shows storage state; Save and Reload performs an actual navigation and compares a locally stored SHA-256 checkpoint on the next page instance. Verify Bytes compares the current draft with a fresh database read. Reports do not contain actual draft text, file names or file hashes. The restored editor continues to use the original textarea and compact menu.

No production main, old test deployment, Supabase, authentication, Realtime, upload or agent backend was changed. New executable storage module, two test workflows/drivers and specification were committed only on messenger-architecture-1.0. Complete UI release bytes are in the delivered archive, not claimed as committed by this evidence file.

## Native storage proof

Run: https://github.com/matveyryabokon30-crypto/vision-talk/actions/runs/34159599715
Commit: 1e4cc363e41162b64abc07bdfb24c1e0547f92f1.
Job 101858452378: SUCCESS.
Artifact 10032155577: native-storage.json (downloaded into the conversation package).

GitHub Actions Linux, Playwright 1.55.0, fresh persistent test profiles in Chromium and WebKit. Not physical iOS. In both engines:

- 17/17 native IndexedDB checks passed: exact Unicode text, original binary bytes, metadata/order, deletion, clear, revision conflict, competing transactions and complete rollback.
- A 16 MiB synthetic original file retained the same SHA-256 after actual page reload, new tab and closing/restarting the browser process on the same profile.
- A delayed earlier save plus newer edit preserved the newer edit. Injected quota failure kept both the live draft and preceding saved record intact; retry succeeded. Saving state was not prematurely reported as Saved.
- Faults are deliberate simulated quota/denial/abort, not a claim that a physical device's storage was filled.

## Published UI proof

Successful final run: https://github.com/matveyryabokon30-crypto/vision-talk/actions/runs/34161167177
Driver commit: 6673f5c6dd1af7f069fd7f89c19edd6056d7cde4.
Job 101863141659: SUCCESS, completed 2026-09-07T20:56:40Z.
Artifact 10032673500: gate014-live-ui-and-hosted-source.
Artifact digest: sha256:3cc1373e6d98c6e5d1efc49833c5c828da932829afaba7b8cb9a97d5aa3618fc.

The browser opened the actual published HTTPS URL, not only set_content. Engines: Chromium 140.0.7339.16 and WebKit 26.0, Linux headless with touch enabled. 14 integration scenarios passed in each engine. The public non-destructive storage autotest reported 18/18 in each engine.

Passed scenarios include actual selected JPEG, MP4 and TXT file bytes, exact text/selection/full-mode restoration after reload, the Save-and-Reload button and its new-page checkpoint, new tab, real browser process restart, removal staying removed after reload, visible injected save failure and working Retry, recovered-draft menu interaction, stable reading anchor during saving, full editor with simulated height/width changes, empty restoration after clear, and no recorded application fetch/upload or JavaScript errors. Width/height simulation is NOT physical keyboard/rotation proof.

WebKit generated and restored the JPEG preview and a two-second MP4 thumbnail. The automated Chromium build reported the MP4 preview unavailable; its original MP4 bytes were nevertheless restored and verified. This is an explicit unsupported-preview fallback, not claimed successful MP4 playback. Video playback/transcoding is outside this gate and awaits its own work.

## Exact retrieved publication snapshot

The live test independently retrieved and retained these four served files:

| File | Bytes | SHA-256 |
|---|---:|---|
| index.html | 6960 | d62b1f119e847fa3d18fe47b8cf9d77b21699b3de42a99ec12c9b40d0435e9b4 |
| style.css | 13937 | 060871a0fdb14a79c3687869eb3d41da3429170ee581c5e39be63584e93a490a |
| vault.js | 17562 | 696bb399a47aa831ec80c23c7afb86ddd10746d850ae3f4e80f2e7355176167a |
| app.js | 47468 | a2eece2ed630f5fc48a91063a4a7c3500153c32b16fd4bf594e7cd943a17c331 |

Retrieved vault.js matches the committed and native-tested storage module byte-for-byte. Publication HTML contains the provider's _ship asset query strings. Original local source and retrieved served copies differ in comments, some local-message/JSON-fallback CSS and provider HTML rewriting; the final live tests ran the served candidate, and the archive includes both copies and diffs. No assertion that the pre-publication canonical files were byte-identical to the live files is made.

## Failed driver runs retained

The candidate URL and site files were not changed between live attempts.
1. Run 34160451763: Playwright eval-based wait_for_function was rejected by the site's restrictive CSP. Polling was changed to Python-side debugger evaluation; CSP was not weakened.
2. Run 34160716803: readiness was checked before the diagnostic captureDraft hook had been exported after asynchronous checkpoint verification. Waiting now also requires that hook. Stored data and UI were already restored.
3. Run 34160933736: Locator.click waited for the underlying plus button to receive a click, while the intended transparent dismissal layer intercepted it. The test now sends an actual touchscreen tap at the plus coordinates and asserts the menu closes. No force-click or removal of overlay behavior was used.
4. Run 34161167177: all preserved storage/UI assertions passed. These corrections changed the harness, not acceptance thresholds or application code.

Earlier source-supplied local layout checks at 440x766, 440x428, 320x640 and 844x390 exercised full-editor controls and the explicit storage-unavailable state. Local navigation was blocked by managed browser policy; that policy was not bypassed. Those checks are not represented as native persistence tests; the above connector-authorised CI runs provide separate execution evidence.

## Remaining gate limits and user test

Physical Safari/Chrome iPhone acceptance is still pending. Do not transfer old gate acceptance. The user should type unsent test text, select small test media/document, wait for Saved, reload/reopen the SAME URL in the SAME browser, and check restoration. Delete one attachment, wait for Saved and repeat. Clear explicitly and verify empty restoration. Public Autotest does not delete the user's draft. Safari and Chrome keep different local drafts.

No guarantee of survival before commit, arbitrary file sizes, user storage deletion, browser eviction or OS failure. Local storage is not cloud backup. Reopening the static application may require network; offline shell caching is not implemented. Hash verification currently reads complete selected files into memory; it is not a large-file benchmark. No background upload, delivery, real agent, durable sent history, E2EE or production-ready messenger is asserted.

Source, exact served assets, reproducible CI drivers/workflows, synthetic fixtures, full JSON reports, failed runs and screenshots are delivered in `Vision_Talk_Gate_01_4_Durable_Draft.zip`. No private user media is included.
