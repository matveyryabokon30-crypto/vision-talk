# Pablicus — 2B Shared Components

2B is the new bounded owner task PABLICUS-BLOCK02-2B-SHARED-COMPONENTS-20260912 R1, not a retrospectively invented canonical substep. Independent acceptance remains with the reviewer.

## Baseline and current implementation

WORK_START_HEAD: `6822a58a7a632fcfc182e4a8e2f02eea37d55afb`. Accepted 2A code: `9ee215300ac97b3c48bf5184f414f28333429a1c`; independent decision: `docs/pablicus/reviews/2026-09-12/2A_HANDOFF_REVIEW_R1.md`. The acceptance commit and all prior history are preserved.

Use COMPONENTS_2B_MANIFEST.json for final exact SHA/CI/status, COMPONENTS_2B_TEST_RESULTS.json for outcomes and binding, and COMPONENTS_2B_MAP.json for implementation, usage, owner, lifecycle, states and exceptions per affected component.

Native controls remain in their existing views. PablicusUI adds stateless prepareControl/tabKey/focusWithin helpers and an explicit control contract; it mounts no nodes and installs no global listener or observer. controls.css supplies common minimum size, disabled and keyboard-focus states using design-tokens.css. Existing visual styling and icon assets remain. Dynamic buttons default to type=button; their view continues to own busy/disabled/action state.

AppShell remains the geometry owner and exposes its existing measured viewport to overlays via CSS properties. The existing composer viewport event path is reused; no parallel shell viewport observer is introduced. The service worker allowlist/version includes the new static CSS; service-worker lifecycle is not qualified by tests that deliberately block service workers.

## Conflicts and minimal correction

The same browser probe against the accepted baseline and candidate demonstrates behavioral differences, separately from startup ERROR:

* Escape from a fullscreen composer toolbar control previously did not collapse. The handler now belongs to the whole existing composer; focus remains bounded and returns to expand after collapse.
* MediaViewer had no explicit accessible close control. A close button uses the existing close/epoch/resource-release path and connected-opener focus restoration.
* User close of a dirty Canvas task sheet discarded editing directly. User dismissal now goes through a dirty/pending/recording confirmation in that same owner. Denial preserves editing; successful save/internal teardown is not routed through an unrelated confirmation. Controller route leave guard is unchanged.
* Conversation filter buttons now expose pressed state and keyboard selection. Search modal input no longer suppresses visible focus.
* The workspace fullscreen surface is explicitly opaque. The legacy public-ui-foundation project-editor rules are restricted to the inline state so they no longer force fullscreen position:relative/height:auto. This removes a competing style responsibility instead of adding a global repair layer.
* Existing general modal follows the measured viewport and keeps its close control reachable under reduced viewport and long content. A bounded, keyboard-focusable title scrolls independently so the sticky heading cannot cover the end of the dialog content.

No product content model, identity state machine, storage or transport implementation was replaced. Exact changed paths and source hashes are in the component map.

## Qualification boundary

Real index, SDK login, routes and modules use the accepted explicit synthetic HTTP/WebSocket boundary, with no production forwarding. Browser evidence covers roots Chats/Tasks/Profile, nested Bots/Factory, conversation controls, native outbox/search/task dialogs, and the actual MediaViewer module with a synthetic Blob resolver. It does not prove production media storage behavior.

Phone 390×844, tablet 768×1024, desktop 1280×900 and small phone 320×568 are tested. Reduced visual viewport is 360px with 12px offset; safe-area values and long titles/32px composer text are synthetic. Screenshots and hit testing supplement state assertions. They do not replace a physical iPhone, real keyboard, Dynamic Type or rotation qualification.

Critical header/composer/close controls are measured. Existing compact Canvas calendar cells retain their local geometry; this is not an all-controls 44px target or WCAG compliance claim. Native search Escape may clear a nonempty query before dismissing; explicit close and Escape from close remain available. This substep does not create a universal form validation system.

The initial Ubuntu 24.04 2B CI failed before browser assertions because Chromium reported No usable sandbox. This is retained as an environment ERROR, never as a negative control. The dedicated 2B workflow uses the compatible standard Ubuntu 22.04 runner with Chromium sandbox still enabled; no AppArmor/managed policy is changed. Existing accepted regression runners retain their own recorded launch configuration.

## Deferred work

Later Block 2: remaining component/domain coverage and physical iPhone acceptance after Block 2 implementation. Existing accepted IA and interface contracts for SidePanel, FullScreenObjectView and agent-related components remain contracts, not delivered features.

Block 3: MessageDoc v2 and richer message/work-object behavior. Block 5: agent engine and capabilities. Calls/media sessions, marketplace, commerce and AI backend are not implemented here. Full CATEGORY_A commitments remain required in their subsequent release tasks. PLAN 1.0 and Amendments 01/02, five blocks and root navigation Чаты / Дела / Вы are unchanged. No next substep begins automatically.

Parallel commits f1e5d82, 39ee3c0 and 8ea1c7b were discovered during a non-fast-forward protection response and preserved in full. Amendment 03, its owner decision and DESIGN_REFERENCE_REGISTER were read before republishing. They establish a separate owner-led design authority; no reference design, new font, icon pack or mass redesign is implemented here. The current task remains the separately authorized engineering 2B. Existing assets are unchanged; this is not a retrospective license audit.

The workspace fullscreen implementation requires native Popover API support. When unavailable it retains inline editing and reports fullscreen unavailable, rather than claiming successful expansion. Physical iPhone and cross-browser coverage remain explicit later gates.
