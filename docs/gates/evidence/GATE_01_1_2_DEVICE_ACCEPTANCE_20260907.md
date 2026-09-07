# Gate 01.1.2 — device acceptance record

Recorded date: 2026-09-07.
Build reported by the devices: `gate-01.1.2-staged`.
Scope: synthetic 10,000-message list with predetermined row heights.
Scoped gate status: **ACCEPTED_WITHIN_SYNTHETIC_10K_SCOPE**.
Automated checks: **PASS REPORTED ON SAFARI AND CHROME, 10K EACH**.
Manual acceptance: **SAFARI AND CHROME ACCEPTED — USER CONFIRMATIONS**.
Production integration: **BLOCKED_PENDING_SUBSEQUENT_SCOPED_GATES**.

## Evidence provenance

All device JSON files below were supplied by the user in the Vision Talk conversation. They are on-device reports, not new measurements performed by the assistant and not signed execution attestations. Raw integration statuses are preserved unchanged. An automatic PASS does not establish frame-by-frame visual smoothness or approve production integration.

### Safari, 10,000 messages

Report: `GATE_01_1_2_SAFARI_20260907_141809_USER_REPORT.json`.
Commit: `946796b55d2fd54f40ca6990712bc85dce8d9f14`.
Timestamp: `2026-09-07T14:18:09.450Z`.
Viewport: 440 x 332 CSS pixels; DPR 3.

Immediately afterwards the user confirmed: **«Все работает»**.

This confirmation is accepted as manual acceptance for the Safari run just supplied. It does not assert a separate Chrome run. No new screen recording accompanied this confirmation, so no frame-by-frame smoothness measurement is claimed.

### Chrome, 100 messages — earlier limited run

Report: `GATE_01_1_2_IPHONE_CHROME_100_20260907T143335715Z.json`.
Commit: `cd1a27027b809d1cfab0eccf50a0ef202e49f5ee`.
Timestamp: `2026-09-07T14:33:35.715Z`.
Reported user agent includes `CriOS/153.0.8010.24`.

14/14 automatic checks passed, but the dataset was 100 and acceptance was `SMALL_DATASET_ONLY`. Retain this as small-dataset evidence; do not reclassify it as a 10K run.

### Chrome, 10,000 messages — latest automatic run

Report: `GATE_01_1_2_IPHONE_CHROME_10000_20260907T143752279Z.json`.
Commit: `9f85c503e8a59fa4a19e34cd4cd2960eff2c4e9c`.
Timestamp: `2026-09-07T14:37:52.279Z`.
Reported user agent includes `CriOS/153.0.8010.24`.
Viewport: 440 x 366 CSS pixels; DPR 3.

The fields `dataset`, `manualOpen.count`, and `syntheticDatasetSize` all equal 10000; `scopeAcceptance` is `SYNTHETIC_10K_ONLY`.
14/14 automatic checks passed. This closes the previously missing Chrome 10K automatic run. The `manualOpen` object records an opening operation, not a human evaluation of scrolling.

### Chrome manual acceptance — subsequent user confirmation

After the Chrome 10K report, the assistant asked specifically whether the Chrome list was smooth under the user's finger, without jumps or freezes, and stated that no new run or JSON was needed.

The user replied: **«Все работает хорошо плавно быстро и четко»**.

This reply closes the pending Chrome manual-usability acceptance for the same reported build and synthetic 10K scope. It is user-reported visual and interaction acceptance, not an instrumented frame-rate, latency, or memory measurement. No additional browser run was performed by the assistant in this recording step.

## Results accepted within automatic-test scope

| Measurement | Safari 10K | Chrome 10K |
|---|---:|---:|
| Reported automatic checks | 14/14 PASS | 14/14 PASS |
| Initial bottom distance; final message | 0.00 px; #10000 | 0.00 px; #10000 |
| Prepend anchor displacement | 0.00 px | 0.00 px |
| Append while reading history | 0.00 px; anchor preserved | 0.00 px; anchor preserved |
| Maximum reported DOM rows in stress test | 24 / limit 120 | 24 / limit 120 |
| Initial list render in this run | 61 ms | 60 ms |
| Active list count | 1 | 1 |
| Reported JavaScript errors | 0 | 0 |

Render times above are single-run list measurements. They are not network latency, app startup time, media startup time, or a frame-rate measurement. Fixed synthetic geometry does not test natural text wrapping, keyboard interactions, delayed image loading, or media decoding.

## Acceptance matrix

| Check | Status | Evidence |
|---|---|---|
| Safari synthetic 10K automatic checks | PASS — user-supplied report | Safari JSON above |
| Safari manual usability | ACCEPTED — user report | «Все работает» following Safari run |
| Chrome synthetic 10K automatic checks | PASS — user-supplied report | Chrome 10K JSON above |
| Chrome manual usability | ACCEPTED — user report | «Все работает хорошо плавно быстро и четко» after the Chrome-specific question |
| Gate 01.1.2 synthetic known-height 10K list | ACCEPTED WITHIN SCOPE | Both device reports plus both manual confirmations |
| Natural-height real text, font/viewport/keyboard changes | NOT TESTED by these reports | Requires separate gate extension |
| Networking, Realtime, uploads, playback | OUT OF SCOPE | Not authorized by these results |
| Vision Talk production integration | BLOCKED | Subsequent scoped gates remain outstanding; this gate's device acceptance is complete |

## Next action

Do not request another unchanged Safari or Chrome automatic run or another manual confirmation. The agreed synthetic 10K acceptance is complete for `gate-01.1.2-staged`. Relevant future implementation or environment changes may require a separately explained regression test; do not silently extend this acceptance to changed code.

Advance to an isolated next gate for natural text heights, wrapping, and viewport/keyboard changes. It must not be described as already built or tested on the basis of this evidence record. Do not treat a synthetic known-height list as proof that media, transport, or the production messenger is ready.

Keep the raw JSON files unchanged, including their historical `integration` fields. This record adds the later human decision for the scoped gate; it does not manufacture a new device measurement or authorize production integration.

## Change history and isolation

- Initial acceptance recording: Safari report and user confirmation saved; Chrome pending.
- Earlier Chrome report: 100 messages only, retained without scope expansion.
- Chrome automatic acceptance: 10K raw report added; manual confirmation remained pending.
- Latest recording: explicit Chrome manual confirmation added; Gate 01.1.2 accepted for the synthetic known-height 10K scope in both target browsers.
- This recording step updates only this acceptance document on `messenger-architecture-1.0`. No test implementation, deployment, production entry, Supabase state, authentication, transport, or media configuration is changed. Production `main` is not updated.
