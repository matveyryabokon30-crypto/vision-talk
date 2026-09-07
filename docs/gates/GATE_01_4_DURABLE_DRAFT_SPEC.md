# Vision Talk — Gate 01.4: durable local draft

Date: 2026-09-07.
Candidate: `gate-01.4.0-durable-draft`.
Status: IMPLEMENTED_ISOLATED_CANDIDATE; DEVICE_ACCEPTANCE_PENDING.
Production integration: BLOCKED.
Project: Vision Talk only.

## Proposition and isolation

After a confirmed local transaction on this origin in this browser, ordinary reload/reopen restores the exact unsent text, selected original file bytes, attachment order, selection and editor expansion state. Restore never submits a message. A failed transaction does not replace the last complete saved draft with a partial record or merely filenames.

This gate has one anonymous local draft slot. It has no accounts, Supabase, backend, upload, remote recipient, persistent conversation history, persistent agent tasks, cross-device synchronisation, service worker or offline-start guarantee. The 300 generated-message list is inherited as an isolated UI context, not production-scale qualification. Prior deployments and their scope-specific acceptance remain unchanged.

## Design and state

- IndexedDB v1 stores `drafts`, `assets`, `proofs`. Original user-selected File/Blob data is stored separately from draft metadata, not a temporary blob URL or Base64 filename surrogate.
- One readwrite transaction performs revision check, insertion of new original blobs, draft replacement and deletion of removed blobs. Saved is emitted after `transaction.complete`, not after `put.onsuccess`.
- File IDs are unique and immutable for a selection. Further typing updates the draft metadata/text without rewriting unchanged original blobs or regenerating previews.
- Change coalescing: 250 ms trailing debounce, bounded by a 1000 ms pending window. These are scheduling choices, not a guarantee of disk completion latency. While a transaction runs, the newest subsequent snapshot is retained and committed next.
- Visible states: opening; unsaved changes; saving; saved in this browser; restored; save error; restore error; conflict with another tab. Errors do not masquerade as Saved.
- Startup reads the saved snapshot before restoring an editable draft. Restore constructs usable File objects and local thumbnails, not sent messages. Ordinary message mode is restored; no demo task is restarted.
- Revision comparison rejects stale concurrent writers. A conflict keeps live text in memory and requires explicit user-confirmed loading of the saved snapshot, rather than silent overwriting.
- Removing a file removes its bytes in the same transaction as the updated draft. Clearing writes a new empty revision, preventing stale tabs from resurrecting an older snapshot.
- The UI provides Retry, explicit simulated failure, byte verification and Save-and-Reload. Failure injection is labelled demo and does not fill real device storage.
- The Save-and-Reload checkpoint records SHA-256 fingerprints locally, then actually reloads the page. A new page instance compares restored bytes against that checkpoint. Hashing is explicit test work, not repeated on every keystroke.
- Exported reports exclude draft text, filenames, original bytes and content hashes; only counts, status, booleans, timings and UI diagnostics are exported.
- Browser `persist()` is a separate explicit user action. Its return value is reported; a grant is neither an external backup nor a promise against user deletion.

## Blocking checks

1. Exact Unicode text, line breaks and trailing spaces round-trip after actual page reload.
2. Original image/video/document bytes and metadata/order round-trip; verify SHA-256, not only thumbnails.
3. Actual new-tab opening and a clean browser-process restart on the same profile/origin restore the saved snapshot.
4. Removed attachment does not reappear after reload; its unused asset row is removed.
5. Explicit clear stays empty after reload and retains a new revision.
6. A newly typed revision during an in-flight save is not lost; Saved is not displayed for an obsolete snapshot while a newer snapshot remains pending.
7. Injected quota, permission and transaction-abort failures leave the preceding committed snapshot complete and live draft intact. Retry commits the current draft.
8. Competing writes with one expected revision have one winner. The stale writer is rejected, not last-write-wins silently.
9. Missing/corrupt asset storage is reported as restore failure, not successful filename-only restoration.
10. Typing after file selection does not increase blob-write or metadata-read counts for unchanged files.
11. Restore causes no unsolicited local/remote send and does not resume demo tasks.
12. Persistence status changes do not resize the list. Menus, expansion, original textarea and selection remain usable.
13. Full editor remains usable during simulated width/height changes; physical keyboard/rotation separately require device acceptance.
14. Public storage autotest uses its own disposable database and does not clear the user's draft.
15. No application HTTP request transmits draft content. Static HTML/CSS/JS retrieval is not file upload. CSP connect-src is none.

A passing storage unit test is not a passed full messenger or accepted physical iPhone test. Keep failed evidence; do not rewrite raw user reports to manufacture acceptance.

## Device procedure, same unchanged URL for each browser

Use non-sensitive test data. Open in Safari; type unsent multiline text and select a photo, short video and document. Wait for Saved. Do not press Send. Use Save and Reload; verify text, selected originals and previews return. Delete one selected attachment; wait for Saved and reload again: it must stay deleted. Close the tab and reopen the same URL in the same browser. Clear explicitly and confirm empty restoration. Copy the report after running the non-destructive storage autotest.

Perform independently in Chrome. Safari and Chrome do not share this draft. An old gate's host does not share the new host's storage. Do not request passwords or clear browser data as part of this test. The page may require network to open again because offline application-shell caching is not in scope.

## Limits that must remain explicit

- Local storage is not cloud backup, end-to-end encrypted synchronisation or durable delivery.
- Never promise survival of sudden OS termination before commit, power loss, uninstall, user storage clearing or eviction under pressure. Wait for Saved before intentional closing.
- Browser storage quota and supported formats vary. No arbitrary-size/all-formats claim is qualified. The controlled byte test uses 16 MiB; media/UI fixtures are smaller. Explicit hashing currently reads the selected file bytes into memory and is not a large-file performance qualification.
- A restored unsupported-format file may have a labelled unavailable preview while the original bytes are intact; do not misreport that as decoded playable video.
- Local sent test messages/history and demo task state are not restored. Normal production sending/acknowledgement, account/conversation isolation and outbox exactly-once semantics belong to later gates.
- This prototype uses a maximum of 12 selected attachments. Long-term memory management of an indefinitely growing local sent history is not qualified.

## Primary sources

https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB — transaction lifecycle and shutdown; combine destructive and replacement operations atomically; do not rely on unload saves.
https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API — asynchronous transactional structured data and files.
https://webkit.org/blog/14403/updates-to-storage-policy/ — best-effort versus persistent storage, eviction, quotas and Storage API. None of these sources guarantee perpetual storage.

## Reproducibility

Executable storage module: `gates/gate-01-4-draft/vault.js`, introduced by bd0794f0cf6ad8a4e9598abce27eff9e13e2de59.
Native-engine workflow: `.github/workflows/gate014-storage-evidence.yml`.
Published-UI workflow: `.github/workflows/gate014-live-evidence.yml`; driver `gates/gate-01-4-draft/live_test.py` captures the hosted files used in its run.
Tests use synthetic fixtures only and contents:read, no production credentials. Workflow writes are confined to the research branch and do not deploy production. Evidence and exact release bytes are delivered with the conversation archive; publication alone is not test success.
