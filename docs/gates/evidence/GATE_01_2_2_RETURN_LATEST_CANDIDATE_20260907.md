# Gate 01.2.2 — return-to-latest control and image-test clarification

Date: 2026-09-07.
Candidate: `gate-01.2.2-return-latest`.
Status: **LOCAL_REGRESSION_PASS; DEVICE_ACCEPTANCE_PENDING**.
Production integration: **BLOCKED**.

## Latest user evidence applies to the predecessor, not this changed candidate

The user supplied a second Chrome report for `gate-01.2.1-scroll-isolation`, generated `2026-09-07T16:06:50.485Z`, exported `2026-09-07T16:06:58.288Z`. UA contains `CriOS/153.0.8010.24`. Dataset: 300 generated messages with natural DOM text heights. Reported 20/20 automatic checks PASS; first mounting 73 ms; maximum DOM rows 29; initial bottom error 0; 0 writes from scroll; 0 JavaScript errors. The total 189 programmatic writes include explicit tests/navigation and must not be misreported as zero total writes. Keyboard and rotation observations are empty and their raw statuses are NOT_OBSERVED.

The user stated: «Да, смотрю, всё работает чётко. И большие сообщения, и маленькие, любые.» This extends the existing predecessor Chrome text/scroll usability acceptance, not its Safari, real-keyboard, physical-rotation, production-scale, networking or media qualification. This document is a summary of that user-provided report, not an exact raw JSON copy or a new device measurement.

## Requested product behavior

1. A circular downward-chevron control sits at the lower right of the history, above and outside the composer.
2. It appears when the user leaves the latest messages even when no new message arrives. One activation returns to the latest message and hides the control. It must not make the list follow incoming messages while reading history.
3. Ordinary photos are intended to be distinct image messages with optional captions. The existing `Картинка` test changes a reserved slot inside an existing generated message to test layout stability; it is not a media-upload implementation. Relabel it `Картинка (тест)` to clarify this.
4. A future optional structured message containing text/image/text is a product idea, not accepted as the default attachment behavior and not implemented or qualified here.

Screenshots supplied in the conversation are UI references only. No unrelated project, linked Worker, message content, personal photograph or contact information was copied into the test deployment.

## Change boundary

Base HTML SHA-256: `2475d8d580a5582d993dacbe75b9df41015f3fa19e148b9b797566bfb7626b6c` (40043 bytes), `site/index.html` in conversation archive `Vision_Talk_Gate_01_2_1_Scroll_Isolation.zip`.

Candidate HTML SHA-256: `bfc91ac733b58384b267400f8a7791a1a08e494da43a1698ae35d52e62789cbe` (43574 bytes).

Only return-control presentation, visibility state, pending-local-message marker, input-focus preservation, explanatory labels and four additional checks changed. The geometry-measurement, offset model, scroll handler, viewport calculations and anchor-restore algorithms remain the predecessor implementations. Return visibility is evaluated in the existing render cycle from the maintained height model and scrollTop; it does not create another scroll listener, measure text or write scroll position. The old candidate and production main were not overwritten.

The return threshold of 48 CSS pixels, 48x48 control size and <=2 px final bottom tolerance are project decisions, not values asserted to come from Telegram or WhatsApp.

## Local tests actually executed

Environment: Chromium 144.0.7559.96, headless, mobile viewport emulation; NOT real iOS. Standalone HTML loaded by Playwright set_content.

- Final candidate: 24/24 automatic checks passed at 440x844, 320x640 and 844x390.
- External pointer/touch interaction checks: arrow visible in history without incoming messages; one tap returns to bottom; hidden at bottom; control remains above composer; existing textarea focus retained; local incoming marker appears and clears.
- Negative control: forcing the arrow permanently hidden caused overall FAIL and failed the arrow-without-new-messages check.
- External scroll regression probe of the same functional candidate before the final instruction-only text change: native wheel input traversed m300 to m1 in 56 steps, monotonic upwards, 0 application scrollTop assignments, 0 DOM rectangle reads, 0 repeated row measurements and 0 total-height change. Reintroducing a scroll correction was detected. Final instruction-only text change was followed by the complete three-viewport 24-check matrix.

Existing passing device evidence is not inherited as hardware acceptance for this new build. Tests involving simulated height/width remain simulations, not a real iPhone keyboard or rotation. This is still a bounded premeasured 300-message gate, not a natural-height 10K qualification.

## Publication and verification limits

Live candidate: https://circular-node-a7vq6uj.shipstatic.com/
Provider reported successful deployment, 43574 source bytes plus 95 generated configuration bytes, no password. Expires at epoch 1789057253 unless claimed.

Independent container HTTP fetch failed with DNS error `[Errno -3] Temporary failure in name resolution`. Do not describe that as a successful independent live browser or Safari test. Local results above and provider publication are separate pieces of evidence.

Source, deterministic builder, source diff, tests and full local result JSON are delivered in conversation artifact `Vision_Talk_Gate_01_2_2_Return_Latest.zip`.

## Next device check

Open the isolated page. Scroll a few messages upwards without adding incoming messages. Confirm the circular arrow appears. Tap it once: the latest message should become visible, the arrow should disappear and ordinary scrolling should remain smooth. No requirement to repeat the already accepted predecessor Chrome 300-message traversal solely to record the same old evidence. Safari, actual keyboard and rotation remain outstanding for the natural-text gate.

## Primary platform references consulted

- https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTop — subpixel positions, overscroll and distinction between reading and assigning scrollTop.
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus — focus and unintended scrolling; keeping a focused element from losing focus on pointer activation.

This step creates only this evidence/design record on the research branch. It does not modify production main, Supabase, Auth, Realtime, Storage, media processing, or existing deployments.
