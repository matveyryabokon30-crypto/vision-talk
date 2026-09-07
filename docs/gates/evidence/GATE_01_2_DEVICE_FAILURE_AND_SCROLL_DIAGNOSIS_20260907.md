# Gate 01.2.0 — device rejection and input-path diagnosis

Date: 2026-09-07.
Failed build: `gate-01.2.0-natural`.
Decision: **FAIL_MANUAL_SCROLL — NOT ACCEPTED; NO PRODUCTION INTEGRATION**.

## Device evidence supplied by owner

Owner: «Тормозит и дергается чат наверх дойти невозможно».
Report exported_at: `2026-09-07T15:28:14.917Z`.
User agent contains `CriOS/153.0.8010.24`, iPhone OS 26_6_1.
Dataset: 300. `overall=NOT_RUN`, `generated_at=null`, `results=[]`.
No automatic test was run; this does not negate the explicit manual rejection.
`errors=[]`, 1 active list, maximum DOM rows 11, and zero final geometry discrepancies do not measure smoothness or prove reachability of the start while swiping.
Keyboard observations report visual viewport height 428 and offsetTop 338; composer bottom 428 versus viewport bottom 766. The old `visible=true` condition did not test bottom attachment. This is an additional diagnostic gap, not proof that the keyboard was correctly positioned.

## Code inspected

Repository: `matveyryabokon30-crypto/vision-talk` ONLY.
Path: `gates/gate-01-2-natural/index.html`.
Commit: `22afe627daab727ce7da3d18714ebab495508f80`.
Original SHA-256: `67d092bdc8dfd7170ebab4682abfe387c77ea0984b3c11e07de8a8a2ca6bc67e`.

The scroll listener calls schedule -> sync -> restore. restore assigns scrollTop even for unchanged target values. sync measures rows, changes the estimated total height, and may restore again. This is verified code behavior, not an inference from the JSON.

## Independent local reproduction

Chromium 144.0.7559.96, headless, touch/mobile emulation, 440 x 766. Eight CDP touch gestures. An external wrapper on Element.prototype.scrollTop recorded **205 application writes**, including same-value writes from NaturalList.restore. A separate wrapper recorded **3,843 getBoundingClientRect calls** during that sequence. Model total height changed while scrolling.

This reproduces interference in the input path. It is NOT an instrumented trace from the owner's iPhone, nor proof that it explains every device symptom. Previous geometry-only automated runs did not exercise this condition.

## Isolated correction candidate

`gate-01.2.1-scroll-isolation` remains NOT ACCEPTED ON DEVICE.
Its scroll handler only samples the current offset and schedules rendering. Natural heights for this bounded 300-message page are measured in batches of at most 20 outside scrolling. This is explicitly NOT a qualification for measuring 10K natural messages at startup.
Only real mutations / explicit navigation / viewport-size changes can restore an anchor. Visual-viewport panning does not invoke list remeasurement. Delayed images use the current anchor, not one saved before a timeout. Composer diagnostics now include bottom gap.

Independent candidate tests: eight CDP gestures produced zero application scrollTop writes and zero DOM rect reads during the gesture interval. Native wheel input reached m1 from the end of all 300 messages with zero application writes and unchanged total height. Reintroducing scroll correction was detected by the independent probe. Actual iPhone scrolling, keyboard and rotation still require acceptance.

## Isolation

This record changes only the research branch. Accepted Gate 01.1.2 remains accepted in its original scope. No production main, auth, Supabase, Realtime, upload, playback, or working messenger entry is changed.

## Primary technical references

https://developer.chrome.com/docs/devtools/performance — forced layout when mixing style writes and geometry reads.
https://www.w3.org/TR/cssom-view-1/ — distinct scroll/resize events and visual viewport coordinates.
https://trac.webkit.org/wiki/Scrolling — asynchronous scrolling and iOS UIScrollView momentum.
