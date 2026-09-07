# Gate 01.4 — device restoration and byte-check screenshot review

Recorded: 2026-09-08. This is the review date, not an inferred image capture date.
Project: Vision Talk only.
Candidate associated with the shown deployment: `gate-01.4.0-durable-draft`.
Scoped status: **DRAFT_RESTORATION_AND_POSITIVE_BYTECHECK_VISUALLY_SUPPORTED**.
Whole Gate 01.4 / production integration: **NOT CLOSED; BLOCKED_PENDING_REMAINING_SCOPED_CHECKS**.

## Evidence provenance

The user supplied three screenshots without a new JSON report or written confirmation of the exact navigation sequence. They follow the instruction to reveal the diagnostic toolbar, save/reload the same page, and verify bytes.

Conversation attachments, in order:
1. E3B6D8E7-B31F-4D4E-8D91-B41F60B71D3A.png
2. 482D8169-71A1-4DDF-8977-FC6A5D03438C.png
3. F47BCD5D-3F9A-4859-8059-EA23951DE37E.png

Images remain in the conversation; no images, private draft content, attachment names or contents are published in this repository. No new independent browser/device execution was performed in this review. No new UA report identifies an independent second-browser run.

The existing candidate record `GATE_01_4_DURABLE_DRAFT_LIVE_CANDIDATE_20260907.md` was read before recording these observations.

## Visible observations

- First screenshot: Gate 01.4, draft text and four attachment cards (two images, a video and a document); the footer reports saved in this browser. Only the Report header control is visible.
- Second screenshot: diagnostic toolbar is visible, including Save and Reload and Verify Bytes. Status states that the draft was restored locally and nothing was sent. The footer reports four restored files. The same visible draft and four cards are present. Video preview preparation is still shown.
- Third screenshot: status explicitly reports `Сверка: текст и байты всех файлов совпали`. Four restored files remain shown. The video card displays duration 0:43, but does not show actual video playback.

This resolves the screenshot-level question of whether the toolbar can be accessed and supplies visual evidence of restoration plus the application's positive byte-comparison result in the shown browser.

## Scope and limits

The candidate documentation distinguishes the Save-and-Reload cross-navigation checkpoint from Verify Bytes, which compares the current draft against a fresh database read. These screenshots show the positive Verify Bytes status, not the underlying digest values or complete cross-navigation checkpoint report. They do not independently establish the exact user action that caused restoration, a browser-process restart, or a pre/post-reload cryptographic attestation.

Do not promote this into full automatic PASS or acceptance in both Safari and Chrome. No new JSON was supplied. Persistent deletion, explicit clear, new-tab/process reopen on this device, failure handling and independent second-browser coverage remain unconfirmed by these pictures. Prior CI evidence remains separate.

Restored original video data and a duration label are not proof of a usable poster, playback, upload or delivery. Nothing here qualifies arbitrary-size files, indefinite storage retention, account sync, media transport or production integration.

## Focused next check

No need to repeat the unchanged four-file restoration just to obtain the same screenshots. On the same page and in the same browser: remove one test attachment, wait for the saved indication, close that tab, reopen the identical Gate 01.4 URL and run Verify Bytes. Expect three remaining attachments, the same draft text and no resurrection of the removed item. Request the resulting Report JSON and browser name to associate structured evidence with this device. Any later full clear must be an explicit user action, not automatic test cleanup of the user's draft.

## Isolation

Only this evidence document is added on `messenger-architecture-1.0`. No source, deployment, origin, authentication, Supabase, transport, production main or existing gate record is modified.
