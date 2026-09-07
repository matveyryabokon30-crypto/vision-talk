# Gate 01.3.2 — device screenshot review of demo task UI

Recorded: 2026-09-07.
Project: Vision Talk only.
Build visible in screenshots: Gate 01.3.2.
Shown hostname: elastic-phase-6pp749d.shipstatic.com.
Scoped status: DEMO_TASK_STATES_AND_DRAFT_RETENTION_VISUALLY_SUPPORTED.
Whole Gate 01.3 / production integration: NOT CLOSED; BLOCKED_PENDING_REMAINING_SCOPED_CHECKS.

## Evidence provenance

The user supplied six screenshots in response to the request to exercise the demo task, continue typing, advance its status and try cancellation. There is no new JSON, execution trace or written usability confirmation in this message. The screenshots are actual user-provided visual evidence, not an assistant device run. Browser identity is not established by a new user-agent report; do not count the same images as independent Safari and Chrome runs.

Conversation attachment names, in supplied order:
1. CA2CD8E7-50A0-4DCD-B6A2-4A9DA17C752D.png
2. F899CB6D-6F33-4C4C-A67A-814129D1DFDD.png
3. D4DA38A8-A2C1-4307-8624-13C9951FC7C5.png
4. 97ADA565-17C4-47CA-BAB6-9B0207936983.png
5. D6C029AA-5DB7-4C0F-8263-71467A62D74D.png
6. A19C8189-1C5F-4CA2-B73B-C2A8DB1CDD5A.png

Images remain in the conversation. They are not copied into this repository or any public test deployment. Unrelated browser-tab titles and draft contents are not reproduced here.

## What is visible

- Image 1: a clearly labelled DEMO task is queued; Next and cross controls are visible. The keyboard is open. The draft contains text; the Send control remains visible.
- Image 2: the same task presentation reads running (demo). The same draft text remains visible, with a caret; Next, cross and Send remain visible. The visible conversation messages match image 1.
- Image 3: status reads ready, still prefixed DEMO. Next is no longer shown; the cross remains. The same draft, caret and Send remain visible with the keyboard open.
- Image 4: a queued demo is shown with the keyboard closed and the same draft text present. The UI explicitly states that no agent was launched.
- Image 5: a real landscape screenshot shows a ready demo and the same draft, expand, hide-keyboard, Send and return-to-latest controls. Text fits the displayed application region without obvious horizontal clipping. The visible history region is short but remains present.
- Image 6: portrait layout with the real keyboard open; no task strip is shown and the same draft text remains in the compact composer. Send and expand are visible.

## Scoped decision

Accept the pictured UI states as visual evidence that queued, running-demo and ready-demo statuses can coexist with an intact draft and accessible controls on this device. The set also supports portrait and landscape end-state layout. Re-requesting the same three task-state screenshots would add no evidence.

Do not overstate this evidence:
- Static images do not measure animation, frame rate, responsiveness, typing correctness or causal event order.
- The final absent strip supports a strip-free layout with retained draft. It does not by itself prove cancellation, task dismissal semantics, or a particular button path: no image shows the word Cancelled/Отменено.
- The target test phrase is already visible as a local conversation message in the first image. The sequence does not establish what action originally created it and neither proves nor disproves an unsolicited send at task start.
- The landscape image establishes an observed landscape state, not a smooth rotation transition, exact anchor preservation across reflow, or testing in both browsers.
- DEMO Ready remains a local presentation state, not evidence of real agent execution, networking, upload, useful work or durable task state.

Prior scoped menu/scroll/editor observations remain in their own records. This screenshot review does not manufacture a new automatic PASS, inherit prior test results for changed code, or authorize production integration.

## Next work boundary

No additional demo-task visuals or menu redesign are required by these screenshots. Keep the current candidate unchanged. Remaining device/cancellation/rotation-transition and cross-browser checks must be closed explicitly before any integration; they need not block specification of the next isolated capability.

Proposed next separate capability: Gate 01.4, durable draft and selected-file restoration. It is NOT implemented or tested by this recording. Its proof must cover:
- restoring the exact unsent text after reload/reopen on the same test origin;
- restoring selected attachment bytes and usable previews, not merely filenames;
- keeping explicit removal/clear actions removed after reopen;
- reporting saving, saved and failed states truthfully, including denied/quota-limited storage;
- avoiding unsolicited submission or a false delivery status on restore;
- preserving current composer/scroll behaviour, with device checks and failure controls.

This is local draft persistence, not background upload, indefinite retention under all OS/browser conditions, an offline delivery queue, real agent execution or media transport. Those require separate evidence.

## Changes made in this step

Only this evidence/review document is added on messenger-architecture-1.0. No runtime, source assets, previous deployment, hostname, authentication, Supabase, transport, production main or prior acceptance record is modified. No new browser run or deployment was performed.
