# Gate 01.2.2 — Chrome return-to-latest acceptance

Recorded date: 2026-09-07.
Build: `gate-01.2.2-return-latest`.
Scoped status: **CHROME_300_AUTO_PASS_AND_RETURN_CONTROL_MANUAL_ACCEPTED**.
Whole natural-text/keyboard gate: **PARTIAL; SAFARI, KEYBOARD_VALIDATION_AND_ROTATION_OUTSTANDING**.
Vision Talk production integration: **BLOCKED**.

## Evidence provenance

User-provided report: `GATE_01_2_2_CHROME_300_20260907T163502107Z_USER_REPORT.json`.
Report commit: `139cb00e0547262434448b4f591b74325750f5f3`.
Generated: `2026-09-07T16:35:02.107Z`; exported: `2026-09-07T16:35:17.445Z`.
UA includes `CriOS/153.0.8010.24`; reported iPhone Chrome.
Dataset: 300 generated natural-height messages premeasured in bounded DOM batches.

The same user message states exactly: **«Все работает»**.
The preceding instruction asked specifically to open the chat, scroll upwards, observe the circular down arrow without receiving a new message, and use one tap to return to the latest message without involuntarily opening the keyboard. This confirmation is accepted for that requested Chrome return-control/scroll-usability scope. It is not silently expanded into a separate Safari run, physical rotation, measured FPS, networking, media delivery or production acceptance.

This is a user-supplied device report plus human confirmation, not a new assistant-performed device measurement or signed execution attestation. The JSON is stored with normalized whitespace and unchanged values. Its historical `manual` and `integration` fields are not rewritten to manufacture acceptance.

## Reported results accepted within scope

- 24/24 automatic checks: PASS.
- Initial latest-message position: 0 px bottom displacement, m300.
- No text clipping, horizontal overflow, adjacent overlaps or DOM/model height mismatch in the inspected set.
- Prepend and text edits above the reading anchor: 0 px reported displacement.
- Arrow hidden at the latest message; visible in history even with pending count 0; one activation returns to m300 with 0 px bottom displacement and hides the arrow.
- Arrow update and scroll-handler checks: 0 repeated row measurements and 0 writes from the scroll handler.
- Total programmatic writes: 91 across explicit navigation/tests. This is NOT zero total writes. Total measured rows across operations: 3314; not a claim that all layout measurement is absent.
- Maximum recorded DOM rows: 29 against limit 120.
- Initial mount: 87 ms in this reported run, not network latency or FPS.
- JavaScript errors: none recorded.
- Start reached; 7 recorded gestures. Gesture counts alone do not prove smoothness; the user's confirmation supplies scoped manual usability acceptance.

## Keyboard telemetry discrepancy — do not hide under overall PASS

Two focus/shrink observations report:

- visual-viewport height 428 px, offsetTop 338 px;
- composer rectangle top 371 px, bottom 428 px;
- diagnostic viewport top 338 px, bottom 766 px;
- `visible: true`;
- `bottom_gap_px: 338`;
- `attached_to_viewport_bottom: false`.

After focus ends: composer bottom 766 px, diagnostic viewport bottom 766 px, gap 0, attached true.

These fields do not establish correct attachment to the visible keyboard edge. They also do not by themselves prove a user-visible 338 px gap: coordinate interpretation, sampling relative to viewport animation and actual screen placement must be checked. The report's `overall: PASS` covers the 24 automatic checks, not this hardware keyboard observation. User success must not be contradicted by an unverified telemetry interpretation, nor should the anomalous fields be erased.

A source-only audit was performed in this recording step on `site/index.html` in the already mounted conversation archive `Vision_Talk_Gate_01_2_2_Return_Latest.zip`. SHA-256 `bfc91ac733b58384b267400f8a7791a1a08e494da43a1698ae35d52e62789cbe`, 43574 bytes, matches the candidate record. Function `composerVisible()` at line 230 computes its lower comparison edge as `visualViewport.offsetTop + visualViewport.height` and subtracts `getBoundingClientRect().bottom`. This confirms where the numeric gap is calculated; it does NOT validate cross-browser coordinate semantics or identify a confirmed keyboard defect. No runtime or device test was performed in this source audit.

Classification: **KEYBOARD_TELEMETRY_DISCREPANCY_REQUIRES_VALIDATION**, not PASS and not a confirmed visual FAIL. Resolve using coordinate-aware instrumentation and a real-device visual check before changing working layout or granting keyboard acceptance.

## Acceptance matrix

| Area | Status |
|---|---|
| Chrome 300-message automatic checks, current build | PASS — supplied report |
| Chrome return-to-latest and ordinary scroll usability | ACCEPTED — user confirmation |
| Actual keyboard appearance/disappearance | SHRINK OBSERVED; attachment measurement requires validation |
| Physical rotation | NOT OBSERVED |
| Safari, this natural-text/return-control build | PENDING |
| Gate 01.1.2 known-height 10K, both browsers | Prior accepted evidence remains unchanged |
| 10K natural-height scale | NOT QUALIFIED by the 300-message test |
| Auth, networking, Realtime, uploads, playback | OUT OF SCOPE |
| Production integration | BLOCKED pending remaining scoped gates |

## Next action and isolation

Do not request another unchanged Chrome arrow test or full automatic run: the requested Chrome return-control scope is accepted. Keep this exact candidate unchanged while validating remaining keyboard telemetry and obtaining the outstanding Safari/physical-rotation evidence. A still image with the real keyboard open can help distinguish a visible placement issue from a measurement discrepancy without rerunning the whole list test.

This step adds only the raw report and this acceptance record on `messenger-architecture-1.0`. No source code, deployment, domain, login/session settings, production main, Supabase state, transport, or prior accepted gate was changed.
