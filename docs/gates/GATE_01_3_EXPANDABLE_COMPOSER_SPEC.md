# Gate 01.3 — Expandable multimodal composer

Date: 2026-09-07
Candidate: `gate-01.3.0-composer`
Status: IMPLEMENTED_ISOLATED_CANDIDATE_LOCAL_CHECKS_PASS_DEVICE_ACCEPTANCE_PENDING
Production integration: BLOCKED
Project: Vision Talk only. No other application's Worker or backend is used.

## Authority and isolation

This implements the proposal in `docs/gates/proposals/GATE_01_3_EXPANDABLE_COMPOSER_PROPOSAL_20260907.md` following the user's instruction «Делай gate 01.3».

The existing Gate 01.2.2 deployment and production `main` are not overwritten. The candidate uses the bounded, premeasured 300-message NaturalList mechanism; executable list operations are preserved. Its successful prior device checks are not treated as acceptance of the new composer. Gate 01.1.2 10K synthetic acceptance remains unchanged.

No Supabase, authentication, HTTP upload, media streaming, real assistant, task executor or production message is used. The application's CSP disallows connection requests. Camera/gallery/file inputs explicitly select local files. No uploaded user conversation photographs or documents are included in deployment fixtures. Automatic report exports contain counts and geometry, not draft contents or chosen filenames.

## Implemented behavior

- A single surrounding panel contains a persistent textarea, attachment strip, action buttons and a separate task-status strip.
- Empty state is compact. Text grows upward, then scrolls inside the textarea. Explicit expand/collapse retains the same input node, text and selection.
- Composer resizing preserves the pre-change history anchor or end-follow state. Ordinary scroll does not trigger repeated row measurement or application scroll correction.
- Photo/video/document selection creates draft attachment tiles immediately. At most one image/video metadata operation is active. Local image/video previews are small JPEGs; drafts do not autoplay videos. Unavailable previews have a bounded fallback, retaining the local File object.
- This UI candidate permits up to 12 selected attachments. It does not claim arbitrary file-size/codec support, durable file access, upload progress or delivery.
- Documents contains file selection and camera capture of a document. The latter is labelled as a photo, not OCR or a qualified scanner.
- The plus menu overlays the list. It supports outside dismissal, Escape and keyboard navigation. Selection and existing focus are retained/restored within the implemented interactions; full assistive-technology qualification remains outstanding.
- Modes are Message, Assistant demo and Task demo. Choosing a demo operation does not call an AI API or send a message. Task transitions are explicit user/test events; no timer fabricates task completion. The label DEMO remains visible.
- Local submission appends a text message and separate attachment messages to the test list. This is not recipient delivery. Sent video cards are posters only; playback is not part of this gate.
- Data is in page memory only. Reload/closing may discard the draft and local test messages. No durability is claimed.

## 32 automatic checks

The candidate's report records: end-position at first display; compact empty field; multiline growth; capped inner scrolling; expanded text/selection/identity preservation; accessible send control; collapse selection/focus; end-follow on growth; anchor preservation in history; menu overlay geometry; Documents-only top-level grouping; document submenu entries; Escape dismissal without text loss; local photo thumbnail; stable anchor on attachment addition; no repeat metadata reads on typing; object URL disposal on removal; document selection; invalid-video fallback preserving draft/file; sequential metadata operations; explicitly labelled assistant demo without message send; no hidden task timer; cancellation without input loss; separate local text/photo messages; compact reset after submission; return arrow above composer; arrow returns to latest; scroll isolation; one active list after repeated opening; bounded DOM and geometry; unused test URLs released; no recorded JavaScript errors.

Project thresholds: compact field <=78 CSS px, automatically sized textarea <=132 px, input minimum 40 px, minimum history space in expanded checks >=75 px, anchor tolerance <=1.5 px, end tolerance <=2 px, DOM cap 120. These are candidate-specific criteria, not Telegram/browser specifications or universal performance guarantees.

## Mandatory independent controls

Deliberately clearing text during expansion must fail the text/selection tests. Hiding Send must fail the control-visibility test. Reintroducing scroll correction must fail movement/isolation tests. Real JPEG, MP4 and TXT fixture selection must be tested separately from automatic synthetic/invalid-file cases.

## Device acceptance still required

Run the candidate independently in Safari and Chrome on the target iPhone. After an automatic run, manually type/paste/edit several lines, expand/collapse, select one photo and one short video, remove one attachment, open and dismiss menus, exercise explicit demo status transitions, and verify that writing remains possible. Check actual keyboard opening/closing, portrait/landscape and history-anchor stability. A visible failure blocks acceptance even with AUTO PASS.

Do not reinterpret desktop viewport changes as a real keyboard or device rotation. Neither an automated mount metric nor the count of JS errors proves smoothness. Do not approve a complete messenger, natural 10K startup, real upload, agent execution or media playback from this result.

## Primary browser references consulted

- https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/setSelectionRange
- https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications
- https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static
- https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

These establish platform capabilities and interaction patterns, not acceptance of this implementation.

## Delivery

Separate deployment: https://uncanny-wave-zvwt866.shipstatic.com/
Source/release files, deterministic development builder, fixtures, full JSON evidence and test drivers are delivered in conversation archive `Vision_Talk_Gate_01_3_Expandable_Composer.zip`. The release uses three first-party static files (index.html, style.css, app.js), not external libraries. This specification is not a claim that the source files have been committed to this repository.
