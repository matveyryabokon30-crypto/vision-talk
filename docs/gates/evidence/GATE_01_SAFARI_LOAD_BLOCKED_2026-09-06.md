# Gate 01 — Safari launch blocked

Status: **NOT ACCEPTED / INTEGRATION BLOCKED**.

## Device report
The owner reports a blank page in standalone Safari. In the separately supplied recording the original test displays PASS. A pass in one browser context does not establish a pass in standalone Safari.

The cause of the Safari blank page has NOT been established. Do not attribute it to Instagram, login state, caching, a specific iOS bug, or hosting without controlled evidence.

## Independent source audit
Repository: matveyryabokon30-crypto/vision-talk
Branch read: messenger-architecture-1.0
File: gates/gate-01-chat-list/index.html
Git blob: 6748491a59b414f4a8b39d3119bc8202585b34d5
Size: 23775 bytes. The locally tested copy matches this Git blob exactly.

Test environment: Chromium 144.0.7559.96, Playwright, local HTML with page.set_content, 390x844 viewport, DPR 3, mobile and touch flags. This is NOT Safari, iOS, or a deployed-site network test.

The original in-page verdict was PASS, yet external inspection found:
- viewport clientWidth 564px (computed width 563.656px) against a 390px test viewport;
- 2 ResizeObserver instances on first automatic run;
- 4 ResizeObserver instances after three total runs;
- 40 physical message-row DOM elements after those runs;
- 2 rendered bubbles with vertical content clipping in the first inspected final viewport.

Source defects:
1. resetChat constructs a new VirtualChat without disconnecting the prior ResizeObserver or scroll handler. resetChat is called both before the automatic run and in runGate.
2. The gate checks chat.nodes.size, not the physical DOM count; stale instances are therefore not reliably counted.
3. Grid sizing can expand beyond the mobile width; there is no horizontal fit assertion.
4. The 80-position automatic stress loop is synchronous and does not measure responsiveness.
5. Initial and final offsets alone do not prove every rendered row's actual geometry, natural text sizing, or media behavior.

These findings do not prove the cause of the Safari blank page.

## Local candidate (not integrated or published as an accepted gate)
A local candidate gate-01.1.1-startup was prepared with explicit start, static startup screen, error display, destruction of prior list instances, width constraints, asynchronous stress steps, and additional DOM/layout assertions. It uses synthetic declared heights, not a general-purpose production layout algorithm.
Local tests at 375x812, 390x844 and 430x932 passed their automated assertions across three runs each: one active list; physical DOM count matches the model; no horizontal overflow or bubble clipping in inspected final views. Static startup text remained visible with JavaScript disabled.
No Safari result, no live network result, no performance guarantee, no integration authorization.

## Published startup-only probe
https://streamy-bolt-j86v2dg.shipstatic.com
Build: startup-probe-01
A small self-contained HTML page displays 'Страница получена' before JS, reports whether JS ran, and tests eight requestAnimationFrame callbacks only after a tap. No login, no Supabase, no video, no 10,000-row test, no external dependencies, no main-branch changes.
The page source was tested locally in Chromium with JS on and off; deployment service reported success. This does not establish Safari reachability.
This is a new probe deployment, not a replacement or update of the old strong-zone gate URL. An outcome on this hostname alone cannot identify the cause on the old hostname.

Next acceptance condition: establish whether the startup-only page renders in standalone Safari, then separately test the list code in that browser. Keep Gate 01 blocked throughout.
