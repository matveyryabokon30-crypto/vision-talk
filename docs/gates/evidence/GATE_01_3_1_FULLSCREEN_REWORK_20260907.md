# Gate 01.3.1 — automatic growth and full-area editor

Date: 2026-09-07.
Project: Vision Talk only.
Candidate: `gate-01.3.1-fullscreen`.
Status: **LOCAL_CANDIDATE_TESTED; NEW_DEVICE_ACCEPTANCE_PENDING**.
Production integration: **BLOCKED**.
Predecessor: `gate-01.3.0-composer` — **MANUAL_EXPANSION_FAIL despite 32/32 reported automatic checks**.

## User review and acceptance boundary

The user supplied an iPhone Chrome report generated 2026-09-07T18:33:03.613Z, exported 18:33:10.607Z. The reported automatic result was 32/32 PASS. They confirmed that photo and document selection worked, but explicitly rejected the expansion behavior: after typing, expansion hardly enlarged the field; opening the keyboard made the supposedly expanded editor small; automatic growth was insufficient. The requested design work is deferred.

This is a summary of the user review, not an exact copy of the long JSON and not a new device measurement. The supplied screenshots are interaction evidence/reference only and were not published in the test site.

Two distinct requested states:
1. Normal composing: grow automatically as text wraps, until the available area requires internal text scrolling. No requirement to press expand before typing.
2. Explicit full editor: cover the application's entire available area above the keyboard, hiding the chat and diagnostic panels. Stay expanded through typing, paste, focus and viewport changes until explicit return or send. Preserve the same textarea, draft, selection and attachments.

## Confirmed source defect

The predecessor `syncComposer()` reset the focused textarea height to 40 px, then calculated a common maximum budget that always reserved 80 px for history. It capped the ordinary input at 132 px and expanded input at 440 px, but both were subject to the smaller shared budget. With keyboard and task chrome present, both states can therefore receive the same effective height. The user's telemetry included input_height 105 px during keyboard shrink.

Independent local reproduction at a 440x428 viewport with long text and a cancelled demo task:
- Predecessor input: 130 px before expand, 130 px after expand, 130 px after further typing. Boolean expanded remained true. This demonstrates a layout-budget failure, not evidence that every input event cleared the boolean.
- Candidate input: 216 px in ordinary auto-grown mode, 317 px in full mode. Full composer covered 428 px of the 428 px application area and stayed there after further typing. These values are local Chromium measurements, not the user's iPhone measurements.

The previous check that required visible history even in expanded mode did not implement the newly clarified full-editor requirement. The former 132 px automatic limit and retained-history assertion are explicitly superseded for this candidate. Other list/selection/attachment acceptance requirements are retained.

## Implementation boundary

- A noninteractive, aria-hidden textarea mirror measures natural draft height. Ordinary input does not repeatedly collapse the focused textarea to 40 px to measure it.
- Normal mode grows to an available-area budget, keeping at least 64 px for history when feasible. The 78% shell budget is a project decision, not a Telegram/OpenAI specification.
- Diagnostic tools/status collapse while typing to leave more space; they return after input loses focus.
- Explicit expanded mode uses a full-area composer within the same application shell. The original textarea stays in place; no second editing node or draft transfer is used.
- The full editor hides attachment thumbnails, task bar and chat without deleting them. Attachment count remains in its title. Collapse restores the normal draft view with its assets.
- Background chat and controls are inert while the full editor is active. Send and return remain accessible.
- The history model, text measurement and scrolling algorithm are retained. Ordinary scroll does not measure rows or assign scrollTop.
- No Auth, Supabase, upload, real agent execution, durable draft retention or production deployment changes.

## Local tests actually executed

Environment: Chromium 144.0.7559.96, headless, mobile viewport emulation. Local candidate HTML/CSS/JS supplied through Playwright set_content. NOT physical iOS.

- 40/40 automatic checks passed at 440x766, 320x640 and 844x390 on the final local source.
- Added checks cover text-before-expand, continued typing in full mode, full-area geometry, attachments/task preservation, 428 px height simulation, continued input after the simulated height change, progressive ordinary growth beyond 132 px, and accessible expand control after long input.
- Independent browser-input sequence typed 18 successive lines without pressing expand. Input heights grew from 84 to 521 px and then capped; the mode stayed ordinary.
- Actual generated JPEG, two-second H.264 MP4 and TXT fixtures were selected. Preview state was ready; video duration was 2 seconds. Typing did not increase metadata reads.
- Touch activation preserved selection and the same textarea. Full mode survived continuing text and external viewport height/width changes. Physical keyboard/rotation remain unverified.
- Returning restored text, attachments and history anchor. Local full-editor submission produced separate text and attachment messages.
- External scrollTop-setter/getBoundingClientRect probes during native wheel traversal to m1: 0 application writes and 0 rectangle reads, 19 monotonic steps.
- No application HTTP requests or JavaScript errors in that local interaction sequence.

Four deliberate negative controls produced FAIL without test-execution exceptions:
1. Full editor capped at 240 px.
2. Typing silently changes expanded to false.
3. Expansion clears draft text.
4. Send is hidden.

The initial full-layer implementation was caught by local tests because an absolute grid item inherited grid-row 5 rather than covering the shell. It was corrected to auto grid placement before publication and the local matrix passed. No failed local candidate was presented as accepted.

## Publication and reproducibility

New isolated candidate: https://slippery-link-u9ds45u.shipstatic.com/
Claim: https://my.shipstatic.com/claim/4c727a8e97189e02cc60e61c83694432
Provider reported success, 4 files / 72404 bytes including generated configuration, no password. Expires unless claimed: epoch 1789066458.

Local tested canonical files:
- app.js: 55372 bytes; SHA-256 26bf31159cae62e845ec042ca8ee7733452078c3a595af44286546d46ed368fc
- style.css: 12159 bytes; SHA-256 04d47cac594f7dc751b10039ce8c141b5d6ebc92619c81e89047e1d708986da8
- index.html: 5750 bytes; SHA-256 6902c904228e6e8055eef718855293216ddfd3602e1e78f9276d8e1763ae5e82

Submitted release was manually compacted and has updated visible version labels; bytes differ from the canonical local files. No cryptographic equivalence of live files or independent live execution is claimed. Container HTTP retrieval failed DNS resolution, Opera navigation returned Tabs are unchanged, and web retrieval refused the new URL. These limitations were not bypassed. Provider publication and canonical local tests are separate evidence.

Conversation artifact `Vision_Talk_Gate_01_3_1_Fullscreen_Composer.zip` contains canonical source, exact predecessor files, deterministic change builder, source diff, tests, synthetic fixtures and complete local result JSON/screenshots. It is not an assertion that the entire release source was committed by this documentation step.

## Focused next device check

Do not ask the user to re-prove every old attachment/menu test. The current blocker is: type a long message FIRST with the real keyboard open, confirm ordinary growth, tap expand AFTER typing, continue typing, and return. Text and selected assets must remain; full mode must not shrink back to a partial editor. Actual Safari/Chrome keyboard, rotation and smoothness acceptance remain necessary; an automatic PASS is not a substitute.

## Primary references consulted

- MDN Element.scrollHeight: https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight
- MDN VisualViewport: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- MDN HTMLTextAreaElement.setSelectionRange: https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/setSelectionRange
- MDN HTMLElement.inert: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/inert

These establish browser APIs, not performance guarantees or knowledge of ChatGPT/Claude internals. The user screenshots specify the desired interaction, not those products' implementation.

This step adds only this evidence document on messenger-architecture-1.0. Production main, accepted old gate files, existing deployment addresses, user sessions, Supabase and media transport were not modified.
