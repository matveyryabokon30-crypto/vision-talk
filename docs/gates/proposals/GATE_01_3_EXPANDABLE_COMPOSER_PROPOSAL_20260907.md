# Vision Talk — expandable multimodal composer proposal

Date: 2026-09-07.
Proposed gate identifier: Gate 01.3 — expandable composer.
Status: PROPOSAL_ONLY_NOT_IMPLEMENTED_NOT_TESTED.
Production integration: BLOCKED.
Project: matveyryabokon30-crypto/vision-talk only.

## User request

The user asks whether Vision Talk can have an expanding input area resembling the supplied ChatGPT/Claude-style references: draft text, photo/video thumbnails, controls within the same panel, pop-up functions, agent selection and task status.

This is a feasibility/design request. No implementation, deployment or completed gate is claimed by this document. References show desired interaction; they are not evidence of the internal architecture of ChatGPT or Claude.

## Keyboard screenshot evidence for existing Gate 01.2.2

The first two images supplied with the request show the same test site before and after the real keyboard is open. The address displayed is circular-node-a7vq6uj.shipstatic.com. The user supplied them in response to a request for a Chrome screenshot with the keyboard fully open.

Visible observations:
- The input and send controls remain visible in both images.
- With the keyboard open, the composer is above the keyboard/accessory-control area.
- The last displayed message, #300, remains visible above the composer.
- The open-keyboard screenshot does not show a large empty application region matching the previously reported 338 CSS-pixel gap.

Classification: CHROME_KEYBOARD_OPEN_STILL_VISUAL_PLACEMENT_SUPPORTED.
Limits: these still images do not measure animation smoothness, typing/caret stability, physical rotation, keyboard behaviour while reading older history, Safari behaviour, or an exact CSS-pixel distance. They do not explain the diagnostic coordinate discrepancy by themselves. The prior telemetry remains unchanged. Do not change working layout merely to force a diagnostic number to zero.

## Feasibility and implementation boundary

A browser textarea is a plain-text control. For the requested draft interface, place the text control, attachment tray, mode controls and task-status area in one surrounding composer container. They appear visually inside one panel but are separate DOM components. This does not require embedding arbitrary image/video nodes inside editable text.

Files explicitly selected by the user can have local previews before upload. Selection/preview is not delivery. A local blob preview must not be sent to another participant as if it were a durable remote attachment.

Literal text/image/text interleaving is a different structured-message feature. It requires an ordered block model, editing/selection semantics, serialization and matching recipient rendering. It is not the default attachment behaviour and not part of the first composer UI gate.

## Proposed behaviour

- Compact by default to preserve chat space. Text grows upward as lines are added. Maximum automatic height depends on the visible area above the real keyboard; at the cap, text scrolls internally.
- An explicit expand/collapse control provides a larger editor when requested. Opening a menu alone does not expand the entire composer.
- A compact attachment strip is inside the panel; thumbnails have removal controls, video duration when available and a clear pending state. Video drafts do not autoplay in parallel.
- A plus button opens a menu. Keep ordinary attachment semantics: gallery/camera, documents (including files and scan), and other approved tools. Do not reintroduce separate scan/file tabs contrary to earlier product decisions.
- Optional mode controls distinguish 'send a message', 'ask an assistant' and 'create a task'. Recipients and action scope are explicit; no hidden switch from private drafting to sending.
- Pop-ups overlay rather than reflow the chat. Focus/selection is retained or restored appropriately, including keyboard and assistive-technology interaction. Menus close through the intended close action and outside dismissal where appropriate.
- Task-status presentation is separate from draft text so new writing remains possible while a task runs.
- Agent suggestions never execute or send private conversation content automatically. A request must identify the selected input/context and require an explicit action.
- A real task status must come from the execution backend, not an animation timer. The initial isolated UI gate may use only explicitly labelled simulated events; it proves no working agent or backend task.
- Normal message submission uses the existing transport contract only after later integration gates. The isolated composer gate is local and sends nothing to production.

## Layout and state boundaries

Separate modules: draft state, attachment state, composer view, overlay/menu controller and task-status adapter. Draft state survives ordinary rerenders, menu open/close and expand/collapse without replacing the focused text element. Durable cross-reload draft/file retention, if added, needs a separate storage policy and verification; retaining a filename alone does not retain file access.

The composer is a sibling of the scrollable message list. Resizing it must preserve the reading anchor or the latest-message position according to the pre-change state. Ordinary scroll processing must not reintroduce repeated text measurement or programmatic correction. This is an acceptance requirement, not a claim that changing composer height requires no layout work.

## Proposed blocking checks, before integration

1. Compact -> multiline -> capped height -> explicit expanded -> compact preserves text, cursor and attachment selection.
2. Long text, paste, emoji/composition input, selection and deletion work without clipped content or focus loss.
3. Add/remove multiple local image/video/file drafts without layout jumps or repeated full-file reads on keystrokes.
4. No attachment selection transmits a file before an explicit authorised operation. Failed/delayed attachment operations leave draft text intact.
5. Menu appearance does not displace the list; closing does not accidentally submit, erase draft text or force keyboard dismissal.
6. End-position and history-anchor preservation during composer growth/shrink, actual keyboard transitions and physical rotation on both Safari and Chrome.
7. Return-to-latest control remains above the current composer and outside its text/attachment scroll region.
8. Simulated task status is visibly marked as simulated. Switching or cancelling a simulated task does not block ordinary draft typing.
9. Negative controls detect lost draft state, obscured send controls and unsolicited list movement. No acceptance based solely on green summary text.
10. New candidate requires its own on-device acceptance; prior 01.1.2/01.2.x acceptance is not silently transferred.

## Primary platform references consulted

- MDN textarea: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea — multiline plain text, not an embedded-media editor.
- MDN File API guide: https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications — user-selected files and local object-URL previews; object URL lifecycle.
- MDN Popover API: https://developer.mozilla.org/en-US/docs/Web/API/Popover_API — overlaid popovers, separate from normal layout.
- W3C WAI-ARIA menu button: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ — semantics and keyboard/focus interaction.
- W3C WAI-ARIA modal dialog: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ — focus management and dismissal in an expanded/modal editor.
- MDN ResizeObserver: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver — observing size changes; not a performance guarantee.
- MDN VisualViewport: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport — distinct layout/visual viewports and keyboard-related visible-area changes.

These references establish browser capabilities, not performance or acceptance of an unbuilt Vision Talk implementation.

## Changes made by this recording step

Only this proposal and visual-observation document is added on messenger-architecture-1.0. No production main, test runtime, previous deployment, URL, authentication, Supabase, media transport or agent configuration is modified. No new gate was run or passed in this step.
