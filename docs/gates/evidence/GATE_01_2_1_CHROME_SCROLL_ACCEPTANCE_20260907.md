# Gate 01.2.1 — Chrome scroll acceptance, 2026-09-07

Build reported by the device: `gate-01.2.1-scroll-isolation`.
Scoped status: **CHROME_300_AUTO_PASS_AND_MANUAL_SCROLL_ACCEPTED**.
Whole Gate 01.2 status: **PARTIAL; KEYBOARD_ROTATION_AND_SAFARI_PENDING**.
Vision Talk production integration: **BLOCKED**.

## Evidence and provenance

The user supplied `GATE_01_2_1_CHROME_300_20260907T155458493Z_USER_REPORT.json`, preserved in commit `3ba22046ed40e156cbae979adf98e7996b03d7c4`.
Report generated: `2026-09-07T15:54:58.493Z`; exported: `2026-09-07T15:55:07.577Z`.
Reported browser: iPhone Chrome, UA contains `CriOS/153.0.8010.24`.
Reported visual viewport: 440 x 766 CSS px; list viewport: 440 x 583 CSS px.
The same user message states exactly: **«Работает четко»**.

The immediately preceding instruction asked the user to open this candidate in Chrome and scroll with a finger to message 1 and back, checking the previously reported inability to reach the top. The confirmation is accepted as manual scroll-usability acceptance for that requested scope. It is not interpreted as keyboard, rotation, Safari, network, or video acceptance.

This is user-supplied on-device evidence and a human confirmation, not an assistant-performed device run or a signed execution attestation. Raw JSON fields, including `manual.status` and `integration`, remain unchanged; this document records the later scoped acceptance separately.

## Reported results

- 20/20 automatic checks: PASS.
- Initial end position: 0 px bottom displacement; message m300 visible.
- All 300 generated messages inspected; 9 distinct natural row heights.
- Reported text clipping, width errors, overlap, gaps and model errors: 0.
- Prepend, editing text above the anchor and delayed reserved-slot image: 0 px displacement in the checks.
- Scroll-handler position writes: 0.
- Repeated text measurements on the tested scroll path: 0.
- Maximum DOM rows: 29, versus limit 120.
- Initial mounting: 91 ms in this run; not frame rate, end-to-end startup time or network latency.
- One active list after 13 creations / 12 destructions.
- Recorded JavaScript errors: 0.
- Cumulative scroll evidence includes 10 gestures and `reached_start: true`. The report mixes manual and automatic operations; these counters alone are not a frame-by-frame proof of the finger gesture sequence. Manual acceptance rests on the user's statement in context.

## Counter interpretation and limits

`programmatic_writes: 253` is a cumulative counter, while `writes_from_scroll: 0` describes the tested scroll path. Do not claim that the whole page made zero programmatic scroll writes. Similarly, `measured_rows: 8682` is cumulative work, not zero measurement work overall. The per-check result reports no repeated text measurement on the scroll path.

The candidate premeasures 300 natural-height rows in bounded DOM batches. This result does not qualify premeasurement of 10,000 natural-text messages or an unbounded chat history. It does not change the previously accepted synthetic known-height 10K gate.

`manual.keyboard` and `manual.rotation` both equal `NOT_OBSERVED`, with empty observation arrays. Simulated viewport changes in the automatic suite are not real keyboard or physical-rotation evidence. `local_sends: 1` alone is not proof of keyboard interaction.

## Acceptance matrix

| Requirement for this build | Status |
|---|---|
| Chrome, natural-height generated 300-message automatic suite | PASS REPORTED, 20/20 |
| Chrome, manual scrolling / reported inability to reach the top | ACCEPTED WITHIN REQUESTED SCOPE — user confirmation |
| Chrome, real keyboard at bottom and while reading history | PENDING |
| Chrome, physical portrait-landscape-portrait rotation | PENDING |
| Safari, same candidate automatic suite and manual scroll | PENDING |
| Safari, real keyboard and physical rotation | PENDING |
| Natural-text production 10K, persistence, network, uploads, playback | NOT QUALIFIED / OUT OF SCOPE |
| Production integration | BLOCKED |

## Remaining device check, unchanged candidate

Do not ask the user to repeat the successful unchanged Chrome automatic suite or the accepted Chrome finger-scroll exercise.

On the already open Chrome candidate, complete only real keyboard checks at the end and in history, then physical rotation with the keyboard hidden. The field must remain usable and the reading position must not jump to the end when history is being read. Export the report after these actions and obtain explicit confirmation or a defect description.

Then test the same candidate in Safari, including its automatic suite, manual scrolling, keyboard and rotation. Acceptance of Safari for the older synthetic gate does not transfer to changed code. The existing deployment address is not changed in this evidence-recording step.

## Isolation

This step adds only this acceptance document and the raw user report on `messenger-architecture-1.0`. It makes no changes to production `main`, test implementation, deployment, Supabase, authentication, text transport, Realtime, offline queues, photo/document/video transport or the already accepted Gate 01.1.2.
