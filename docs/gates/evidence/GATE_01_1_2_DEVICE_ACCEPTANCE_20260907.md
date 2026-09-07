# Gate 01.1.2 — device acceptance record

Recorded date: 2026-09-07.
Build reported by the device: `gate-01.1.2-staged`.
Scope: synthetic 10,000-message list with predetermined row heights.
Production integration: **BLOCKED**.

## Evidence provenance

The user supplied the JSON report stored in `GATE_01_1_2_SAFARI_20260907_141809_USER_REPORT.json` (commit `946796b55d2fd54f40ca6990712bc85dce8d9f14`). Its timestamp is `2026-09-07T14:18:09.450Z`. The report identifies iPhone Safari. It is user-supplied on-device evidence, not a new measurement performed by the assistant and not a signed execution attestation. Its raw integration status is preserved unchanged.

Immediately afterwards the user confirmed: **«Все работает»**.

This confirmation is accepted as the user's manual acceptance for the Safari run just supplied. It does not assert a separate Chrome run. No new screen recording accompanied this confirmation, so no frame-by-frame smoothness measurement is claimed.

## Results accepted within scope

- 14 of 14 reported automatic checks: PASS.
- Initial bottom distance: 0.00 px; last message #10000.
- Prepend anchor displacement: 0.00 px.
- Append while reading history: 0.00 px displacement; visible anchor preserved.
- Maximum reported DOM rows during the stress test: 24, versus limit 120.
- Initial list render: 61 ms in this run. This is not network latency, app startup time, or a frame-rate measurement.
- Active list count: 1.
- Reported JavaScript errors: 0.

## Acceptance matrix

| Check | Status | Evidence |
|---|---|---|
| Safari synthetic-list automatic checks | PASS — user-supplied report | JSON above |
| Safari manual usability | ACCEPTED — user report | «Все работает» |
| Chrome on target iPhone, same build and scope | PENDING | No matching device report supplied yet |
| Natural-height real text, font/viewport/keyboard changes | NOT TESTED by this report | Requires separate gate extension |
| Networking, Realtime, media uploads and playback | OUT OF SCOPE | Not authorized by this result |
| Vision Talk production integration | BLOCKED | Chrome acceptance and subsequent scoped gates remain outstanding |

## Next action

Run the same unchanged `gate-01.1.2-staged` test in Chrome on the target iPhone and obtain its report plus manual confirmation. Do not ask the user to repeat the accepted Safari run unless a relevant implementation or environment change requires revalidation.

After both browser acceptances, advance only to an isolated next gate for natural text heights and viewport/keyboard changes. Do not treat a synthetic fixed-geometry list as proof that media, transport or the production messenger is ready.

## Changes in this recording step

Only the two evidence files were added on `messenger-architecture-1.0`. No test implementation, deployment, production entry, Supabase state, authentication, transport, or media configuration was changed.
