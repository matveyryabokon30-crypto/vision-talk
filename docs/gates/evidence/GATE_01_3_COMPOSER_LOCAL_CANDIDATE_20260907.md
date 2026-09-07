# Gate 01.3 — local composer candidate evidence

Date: 2026-09-07
Build: gate-01.3.0-composer
Status: LOCAL_CHECKS_PASS_DEVICE_ACCEPTANCE_PENDING
Production integration: BLOCKED
Specification commit: ba21d79a606eba1147d307ae294cf71c8048c204

## What was executed

Local Playwright Chromium 144.0.7559.96, headless with mobile viewport emulation. These are NOT physical iOS runs.

32/32 automatic checks passed at each of 440x844, 320x640 and 844x390. The release copies of CSS and JavaScript were also retested as inlined assets in set_content at the same three viewports: 32/32 each, no recorded JS errors.

Independent browser-input checks selected an actual generated JPEG (1800x1200), a generated H.264 MP4 (320x240, 2 seconds) and a TXT fixture. Image and video previews became ready; video duration was 2 seconds. Continuing typing did not increase metadata-read count. Touch expand/collapse preserved text selection. Local submission produced separate text and attachment messages.

External window-width change preserved the history anchor within 0.453125 CSS px. A viewport height-change simulation kept Send inside the shell and retained at least 75 px for history. Neither result is a real keyboard or physical rotation test.

Independent scrollTop-setter and getBoundingClientRect wrappers recorded 0 application scroll assignments and 0 rectangle reads during a native wheel-input traversal from the end to m1 (20 steps, monotonic upwards). This is not an instrumented on-device finger/inertia trace.

No application HTTP requests were observed during the local inlined-file interaction checks. The release CSP has connect-src 'none'. Initial HTML/CSS/JS retrieval from hosting is separate from sending draft contents or files.

## Negative controls

- Deliberately clearing draft text during expand produced FAIL in text/selection preservation and collapse selection/focus.
- Hiding Send produced FAIL in the expanded-control visibility check. The visibility audit requires nonzero control dimensions, not only a point inside the viewport.
- Reintroducing scroll correction produced FAIL in end position, history anchor, overlay stability, attachment growth and scroll-isolation checks.

## Source and publication

Submitted first-party release consists of 3 files (63609 bytes):

| File | Bytes | SHA-256 of local release copy |
|---|---:|---|
| index.html | 5517 | 22a3f119d0e91274034885a97978d85d2abcd5c0e46ffb755713798527b2808d |
| style.css | 9639 | ac91d53366019e7bbd69f98c31c15553ecc2e4d751539e375990e8434f102598 |
| app.js | 48453 | 931c42b018cdc82d2f3dea1666a28032f6cfd5d2f7639cf8c1e8b16211da053e |

The self-contained development form is separately available (65233 bytes, SHA-256 61801f01eda976ac7bfe8347cae3fd754f24e809a1f6b7e93f7be0ff820f145f). Packaging removes unused old harness helpers and redundant style definitions. Release behavior was retested separately; old gate acceptances are not inherited.

Deployment: https://uncanny-wave-zvwt866.shipstatic.com/
Provider reported success, 4 files and 63704 bytes including its generated configuration, no password.
Created epoch: 1788804296. Expires unless claimed: 1789063496.
Claim URL: https://my.shipstatic.com/claim/21a244b1659bba66d9e5e60ed4058c24

Independent live retrieval/runtime verification: NOT VERIFIED. External DNS was unavailable in the container and Opera navigation returned 'Tabs are unchanged'. Browser loopback navigation also returned ERR_BLOCKED_BY_ADMINISTRATOR; this was not bypassed. Local tests used supplied source via set_content instead. Provider publication and local execution are separate evidence, not a claimed live Safari run. Matching total byte count is not a cryptographic verification of live hosted files.

Source/release copies, builder, generated fixtures, full per-run JSON, independent test drivers and screenshots are in conversation archive Vision_Talk_Gate_01_3_Expandable_Composer.zip. Only specification/evidence documents are committed by this step; no claim that the release source files were committed here.

## Acceptance still required

Physical Safari and Chrome: normal typing/paste/selection, expanding/collapsing, choosing local photo/video, removing attachments, menu dismissal, keyboard and rotation, smooth reading position while composer grows. Real camera and native chooser behavior must be tested on the device.

This candidate does not implement uploads, backend tasks, actual AI, durable draft storage, rich text/image/text interleaving or video playback. It is a bounded 300-message test, not natural-height 10K qualification or complete messenger acceptance.

No production main, Supabase, authentication, media transport, previously accepted source or previous deployment was modified.
