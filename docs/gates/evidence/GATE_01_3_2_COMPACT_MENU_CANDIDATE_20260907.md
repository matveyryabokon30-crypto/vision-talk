# Vision Talk — Gate 01.3.2 compact menu

Date: 2026-09-07.
Build: `gate-01.3.2-glass-menu`.
Status: LOCAL_CANDIDATE_TESTED; NEW_DEVICE_ACCEPTANCE_PENDING.
Production integration: BLOCKED.

## User decision and boundary

The user stated that the prior full-editor candidate works, then requested changes only to the plus menu: content-sized width, placement as low as possible instead of above the entire expanded draft, translucent background, an icon and a short label per action. No subtitles or oversized empty width. This statement is not expanded into acceptance of every browser, keyboard, transport or media gate.

Changes are confined to menu markup/styles, placement relative to the plus button, outside-dismissal focus preservation, version labels and menu tests. The predecessor NaturalList, full-editor and automatic-growth algorithms are retained. Files and document-camera actions remain under Documents. Assistant/task choices remain explicitly demo in their submenu/status; no real agent is claimed.

Menu placement compares the plus and app shell rectangles in the same coordinate frame. Its lower edge is six CSS pixels above the plus button, not above the composer top, so a tall draft is behind the menu. Width is intrinsic with a viewport cap. The background is partially transparent with a backdrop blur, with a more opaque fallback when filtering is unavailable or reduced transparency is requested. No overall opacity is applied to labels/icons. The outer dismissal surface is transparent. Menu height is capped to the available area and internally scrollable at very short heights. These dimensions are project choices, not claimed ChatGPT/Telegram specifications.

## Local tests actually run

Environment: Chromium 144.0.7559.96, headless, mobile viewport emulation via Playwright. Local first-party HTML/CSS/JS supplied through set_content, not physical iOS.

- Extended local regression harness: 48/48 at 440x766, 320x640, 844x390.
- Publication-source focused menu/regression harness: 17/17 at the same three sizes. The public Autotest has these 17 scoped checks, not the full archive's 48-check harness.
- Independent touch-event checks at 440x766, 440x428, 320x320 and 844x390: content width 193.156 CSS px; menu/plus gap 6 px; inside app bounds; long draft overlapped instead of moving the menu above the entire composer. Menu open/close did not change history height or scroll position. Documents/modes submenus, outside tap, second plus tap and Escape worked; text/selection and the original textarea were preserved. Full-editor mode and continued typing remained functional. No application HTTP requests or JS errors in those local interaction sequences.
- Negative controls: forcing 330 px menu width, restoring the old placement above the entire composer, and removing icons were each detected as FAIL without test-execution exceptions.
- A test-driver assumption was corrected: End moves to a line end, whereas the preservation test needed Control+End before appending text. This did not change application code or acceptance thresholds.

Real iPhone keyboard placement, visual translucency and performance of the new menu are not accepted by these local tests. Static or simulated viewport changes are not physical keyboard/rotation tests.

## Source and publication

Base archive: `Vision_Talk_Gate_01_3_1_Fullscreen_Composer.zip`, release files. Base code came from that mounted conversation artifact, not the unrelated video application.

Local publication-source hashes:
- index.html: 5742 bytes, SHA-256 89c04dd19012ac0cc4bdf90ac58631598ca1e02d9478fb06b768ab88abcce36c
- style.css: 13348 bytes, SHA-256 a130fb56e7d93daf29c77a63d549529b49653b0b3a318f05d36853beedd253b8
- app.js: 47259 bytes, SHA-256 722d8f5581a2b8613c97540c4892bbca80bb8e632ac4ca1dce3acf3f5bb2ce62

Deployment: https://elastic-phase-6pp749d.shipstatic.com/
Claim: https://my.shipstatic.com/claim/f11e5172c78dd34ac12c0f52402dc15c
Provider confirmed success, four files and 65906 bytes including generated configuration, no password. Expires unless claimed at epoch 1789069268.

Submitted text was whitespace-compacted with HTML-label adjustments from the locally tested publication copies. No byte-identical verification of hosted assets or independent live execution is claimed. Container retrieval failed DNS, web open declined the new URL, Opera returned Browser not connected. Provider publication and local test execution remain separate evidence.

Conversation artifact `Vision_Talk_Gate_01_3_2_Compact_Menu.zip` contains the tested source variants, preserved base release, menu component/styles, builders, diff, independent tests, per-run JSON and screenshots. This commit adds this evidence record only; it does not assert that all source files were committed here.

No production main, Supabase, Auth, transport, old deployments or previously accepted gate files were changed.

## Focused device check

Write a long draft with keyboard open, press plus, observe compact low placement over the draft, translucency and icons/short labels. Close via outside tap or plus, ensuring the draft remains. No request to repeat the full old attachment battery solely for this menu change. Safari and Chrome device acceptance remain necessary before integration.

## Primary platform references

https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/max-content
https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport/offsetTop

These establish browser capabilities, not proof of performance or another product's internal implementation.
