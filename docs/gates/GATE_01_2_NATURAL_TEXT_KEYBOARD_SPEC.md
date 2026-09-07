# Vision Talk — Gate 01.2: natural text, viewport and keyboard

Date: 2026-09-07
Candidate: `gate-01.2.0-natural`
Status: `ISOLATED_CANDIDATE; DEVICE_ACCEPTANCE_PENDING`
Production integration: `BLOCKED_PENDING_DEVICE_ACCEPTANCE_AND_SUBSEQUENT_GATES`

## Continuity and scope

The accepted Gate 01.1.2 synthetic known-height 10K implementation, its device reports and acceptance record are NOT changed by this work. This candidate is a separate implementation and requires its own acceptance. Its success cannot be claimed from the earlier gate's acceptance.

Gate 01.2 uses 300 locally generated messages with natural DOM text layout: paragraphs, long URLs, unbroken strings, emoji, mixed writing directions, and reserved-size image slots. Row heights are measured from actual DOM geometry, not supplied as final synthetic fixed heights. Offscreen rows have temporary estimates. These are synthetic test contents with real browser text wrapping, NOT production conversations.

This gate contains no Supabase SDK, authentication, production messages, Realtime, HTTP upload, media decoder, external library, service worker, or external font. Typing and sending create local ephemeral test messages only. The runtime makes no backend requests. A delayed local SVG image tests layout, not network transfer or production photos. No source files in `main`, authentication, database, media service, or previous deployment are changed.

## Proposed mechanism, not an industry guarantee

- An isolated measured-window list keyed by stable message IDs.
- Estimate offscreen heights; batch reads of mounted row heights; update offsets and restore an explicit `(message_id, pixel_offset)` anchor or end position.
- Preserve existing DOM nodes by ID when unchanged; replace only edited message content.
- Text wraps naturally; no fixed message height and no clipping to a precomputed synthetic height.
- ResizeObserver watches actual row and viewport changes. Changed dimensions trigger bounded layout work; disconnected instances release observer/listener/frame resources.
- The composer is a sibling of the scrolling history. VisualViewport dimensions and offsets drive the enclosing shell.
- Image content fills an already reserved aspect-ratio slot.

This is a testable candidate, not a claim that this algorithm or chosen thresholds reproduce Telegram. Width/height changes simulated by the harness cannot prove behavior of the real iOS keyboard or animation compositor.

## Primary references consulted

- MDN, VisualViewport: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport — layout vs visual viewport, keyboard-related shrinking, dimensions/offsets, resize/scroll events; the documentation also warns that emulated device-fixed positioning may flicker, so manual acceptance is mandatory.
- MDN, ResizeObserver: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver — dimension observation, disconnect/unobserve, observation errors.
- MDN, Document.fonts: https://developer.mozilla.org/en-US/docs/Web/API/Document/fonts — font loading state; this candidate uses system fonts and tests a font-size change, not every delayed webfont case.
- W3C, CSS Scroll Anchoring Level 1: https://www.w3.org/TR/css-scroll-anchoring/ — browser anchoring and exclusion; `overflow-anchor:none` alone is not an implementation of a stable chat list.

## Automatic acceptance — 18 checks

1. Open at message 300, bottom displacement <=2 CSS px.
2. Last bubble visible in the first instrumented frame after reveal. This does not replace a human check of initial visual traversal.
3. At least six distinct natural row heights; no inline fixed row height.
4. Inspect all 300 messages, including narrow-screen cases; no text clipping or horizontal overflow.
5. No adjacent row overlap/gap or DOM/model height mismatch >1.5 px.
6. Prepending 50 messages keeps the captured anchor within 1.5 px.
7. Increasing text in a message above the anchor keeps that anchor within 1.5 px.
8. Incoming local message while reading history keeps the anchor and displays the new-message control.
9. Delayed local image loads and its already reserved slot does not displace the anchor >1.5 px.
10. Simulated width change reflows text and keeps the anchor; explicitly NOT a physical rotation test.
11. Font-size increase reflows text and keeps the anchor.
12. Simulated height decrease while in history preserves the anchor; explicitly NOT a real keyboard test.
13. Simulated height decrease while at the end keeps bottom displacement <=2 px.
14. Local incoming message at the end remains visible.
15. Repeated list creation leaves exactly one active list and matching actual DOM/model node counts.
16. Maximum rendered rows <=120 during tested operations.
17. First measured mounting operation <1500 ms in this run; NOT a frame rate, network startup or universal performance SLA.
18. No recorded JavaScript errors.

Thresholds are project acceptance criteria, not requirements quoted from a browser standard. Values and sampling coverage are exported in JSON. Every auto-run resets the list and preserves separation between automatic PASS and manual acceptance.

## Independent negative controls

The browser test driver must confirm that:
- forcing all rows to the same visual position produces a nonzero overlap failure in the DOM audit;
- disabling anchor restoration produces a measurable anchor displacement above threshold.

These are defect-detection controls, not additional production capabilities.

## Manual device acceptance — mandatory for both Safari and Chrome on the target iPhone

After the automatic run, WITHOUT starting a new automatic run:

1. Scroll naturally through long texts, URLs and emoji. No visible blank bands, overlap, lost lines, jumps, or freezes.
2. At the end, focus the composer, type several lines, send locally, hide and reopen the real keyboard. The input remains usable above the keyboard and the latest message remains reachable/visible.
3. In history, remember a visible message; open/close the keyboard, use `Изменить выше`, `+50 старых` and `Картинка`. The reading position must not jump to the latest message.
4. With keyboard hidden, rotate portrait -> landscape -> portrait. Text reflows; the reading anchor remains usable; no horizontal overflow or detached composer. This does not demand that the same word has an identical pixel coordinate after text reflow.
5. Copy `Отчёт -> Копировать JSON` and provide a manual usability confirmation or a short recording of a defect.

Viewport changes during focus are recorded as observations/heuristics, never auto-promoted to verified hardware-keyboard acceptance. Rotation observations similarly are not equivalent to a human smoothness verdict. The JSON intentionally keeps `manual.status=PENDING_USER_CONFIRMATION` and integration blocked; later human acceptance is recorded separately without rewriting the raw evidence.

## Result meaning

A scoped PASS permits further isolated work only. It does not prove production-scale natural-text performance on 10K messages, accessibility/screen-reader coverage, search/copy across unmounted messages, network delivery, offline durability, video upload/playback, or a complete modern messenger.

Release policy: preserve both successful and failing evidence, keep a source digest, and do not silently transfer any previous gate's PASS to changed code. Production integration remains a later explicitly reviewed step.
