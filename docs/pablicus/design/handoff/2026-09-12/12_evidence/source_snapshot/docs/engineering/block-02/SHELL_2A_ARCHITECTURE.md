# Pablicus — 2A Shell Architecture & Ownership Baseline

Executor package for task `PABLICUS-BLOCK02-2A-SHELL-ARCHITECTURE-20260912`, R1. Status and exact evidence binding are in `SHELL_2A_MANIFEST.json`. This is an architecture qualification with bounded foundation changes, not completion of Block 2.

Repository: `matveyryabokon30-crypto/vision-talk`. Branch: `refactor/pablicus-foundation-20260911`. WORK_START_HEAD: `abfc878896d8b10acc540d27ed370bbfaf2e8b70`. Resume HEAD after explicit owner approval of the blocked write: `a3651b9a9b03c676769bc642420e97c1f8f35a30`. Both baseline probe commits are retained. No parallel commits were discarded.

The owner directly confirmed independently accepted `BLOCK_1_ACCEPTED` in the 2A assignment. The historical 1D executor package at WORK_START still records READY; no separate 1D reviewer file was found there. That historical package is preserved. This document records the owner's later acceptance statement, not an invented reviewer report. Accepted 1C CODE_SHA / TESTED_SHA remains `4b886c1477c44752359ccc4b44f8ff5c072bb241`; its acceptance is not replaced by these regression runs.

## CURRENT STATE at WORK_START

The entrypoint had 30 script references, 17 stylesheet references and six explicit lazy resource edges: 53 distinct loaded paths including the bundled SDK. The ownership map inventories 64 top-level JS/CSS/index files, distinguishing application-loaded code, standalone authentication pages, the service worker and unloaded legacy code. It records DOM regions, navigation evidence, global listeners, observers, layout responsibilities, duplication and migration decisions. Current source hashes and the final entry graph are separately bound to the candidate.

Confirmed conflicts:

1. `index.html` declared Chats / Feed / Tasks / Profile; `bots-nav.js` inserted a fifth Bots root. This conflicted with the approved Chats / Tasks / You model.
2. `app-controller.js` and `app.js` both wrote the shared home heading. `app.js`, `bots-nav.js` and loaded `ux-refinement.js` independently altered shared home controls and presentation.
3. Shared headers, root navigation and conversation geometry were distributed across stylesheets. Two files declared global palette/default tokens, with no qualified registry of all required token groups.
4. Existing components and editor adapters had no common inspectable contract registry.

The retired `public-hotfix-v8.js` was already absent from the entry graph. `ux-repair-20260911.js` and `creation-flows.js` were also absent. They were not reactivated. A `MutationObserver` is not automatically a shell bug: `rich-message.js` disposes detached media and `inbox-monitor.js` positions its own notification. Canvas sheet history is a bounded local interaction; it does not own root routes.

## TARGET STATE qualified in 2A

| Responsibility | Single authority | Bounded adapters |
|---|---|---|
| Semantic route, identity and lifecycle state | `PablicusController`, app-controller.js | app.js root click bindings and domain route handlers request controller transitions |
| Shared shell/header/selected-root DOM | Stateless `PablicusShell`, app-shell.js | Domain views supply title/readiness/mode; no second route store |
| Primary outer geometry | shell.css and `PablicusShell.viewport` | chat.js measures visual viewport and schedules the existing layout; timeline anchoring and editor measurements remain local |
| Global tokens | design-tokens.css | Local component values remain explicitly bounded migration debt |
| Component registry | Frozen `PablicusUI`, component-registry.js | Existing components are referenced, not instantiated twice |
| Composer/editor contract | `PablicusUI.composer` | Existing RichComposer, Chat and WorkspaceEditor implementations retain their storage and lifecycle behavior |

The navigation owner is the controller, not the root click binding or the stateless projection. Existing domain handlers remain in app.js, bots-nav.js and the scenario bridge. They are clients of the accepted state machine. Shell projection has no global event listeners, mutation observers or independent route state. Source inspection is paired with actual click dispatch, header-write stacks, selected roots, visible screens and regression behavior.

## MIGRATION ACTIONS implemented

- Replace controller and app duplicate heading writes with the shell projection; centralize authentication/home/conversation visibility, readiness and conversation mode projection.
- Delegate the existing chat viewport output to AppShell; retain measurement, scheduling, timeline anchors, persistence and queue logic.
- Make exactly three root buttons explicit: **Чаты / Дела / Вы**. Bots/Factory remains an explicit nested tools entry under Дела, preserving logical bots/factory/scenario routes and resource IDs. The existing logical `feed` route maps to Chats for compatibility; no new Feed root is introduced.
- Remove bots-nav root injection and shared shell mutations. Stop loading ux-refinement; retain only bounded Factory/Scenario resource loading and controller handlers.
- Consolidate 123 extracted shell/token CSS rules plus 11 remaining header-control rules while retaining their original declarations and cascade order as the starting point. Then make deliberate root-count, control-size, safe-area and title geometry corrections. This is not a claim of byte-identical CSS or an unchanged computed appearance.
- Add the token and component contracts; retain the approved palette and glass icon assets. The service-worker asset list/version includes new shell files, but service-worker operation is not qualified by blocked-SW browser tests.
- Update 1B's DOM fixture to load the real shell/registry. Update 1C's Bots entry/selected-root adapter and the exact stale-account mutation insertion anchor. Identity, bytes/order, queue, route-resource, 54-transition and cleanup assertions remain explicit; none is replaced with a success stub.

The first candidate exposed a title defect on visual review despite its initial shell checks passing: inherited grid placement positioned the title over right-side actions and constrained its text to 32px. The strengthened probe checks title bounds, touch size and non-overlap, including long titles and enlarged text. The same probe runs on the pre-correction source and final candidate. The initial 1C negative-control runner also rejected an outdated exact insertion needle; that ERROR is retained as harness evidence, not counted as a qualified mutation or a product isolation failure.

## Information architecture

| Root | User access and scope |
|---|---|
| Чаты | Conversations; future group/channel/Space directory and Space switcher; Threads inside a conversation; scoped/global Search results; Saved personal conversation; private AI conversations and contextual Composer AI |
| Дела | Tasks; work objects linked from a task or conversation Canvas; nested Bots, Factory and Scenario entry points |
| Вы | Profile/settings, username/public identity, personal Saved shortcut |

Spaces, Threads, global Search, Saved/Personal Inbox, AI in Composer and Public Identity are Amendment 02 CATEGORY_A requirements for their approved release scope. A 2A contract is not implementation of those capabilities. Existing Saved conversation and public-profile helpers are narrower baselines. No automatic Feed, AI, Marketplace or Communities root tab is authorized. Existing Factory specification UI is not an agent executor.

## Composer contract

The shared contract declares text, attachments, rich blocks, commands, AI inline actions, mentions, agent invocation, task creation and work-object linking. Existing operations are `capture`, `restore`, `focus`, `blur`, `destroy`; the browser checks their presence on the live adapter. Extension requests carry kind, selection, payload and context: user, conversation, session generation, route generation, revision and cancellation signal. Results distinguish applied, cancelled, unsupported and error. Declaration never grants permission or implies execution.

Adapters must preserve original Blobs, stable block/file IDs, order, save-before-send, account isolation, visible failures and accepted Canvas leave. Existing v1 IndexedDB formats remain canonical. MessageDoc v2, new rich-document semantics and agent execution are not implemented in 2A.

## Responsive and mobile rules

Mobile is the primary interaction surface. All widths share route IDs and component contracts. Token thresholds are 768px (tablet) and 1024px (desktop); retained component-local 800px rules are compatibility debt, not competing root owners. CSS custom properties document breakpoint values; they are not assumed to substitute into native media-query syntax.

- AppShell owns the outer viewport. chat.js supplies measured visual viewport height/offset using its existing keyboard heuristic. The composer must remain inside the visible viewport, with no horizontal overflow.
- Safe-area tokens cover all four edges. Home/bottom navigation, conversation header and composer consume applicable insets. Keyboard-open padding avoids a second artificial dock gap.
- Root controls use semantic buttons and one click dispatcher. The composer attach/send controls and conversation title have a 44px minimum target. Long titles truncate within reserved header space, without covering Back, Search or Outbox actions.
- Existing modal/sheet owners keep their bounded lifecycle and leave guards. Future shared overlay migration must use max-block-size relative to the visual viewport, internal scrolling, safe-area insets, explicit initial focus, Escape/close guards and focus return.
- Future SidePanel and FullScreenObjectView present the same object ID/revision/permissions and semantic route. Desktop may use a panel; mobile uses a full-screen surface. They are interface-only in 2A. No duplicate object state/store is introduced.
- Large text must not conceal critical controls. The probe exercises 2x input/title text with reduced visual viewport and injected safe-area values. This is a bounded CSS stress case, not browser zoom, iOS Dynamic Type or physical-keyboard certification.

Evidence uses Chromium at 390×844, 768×1024 and 1280×900. A controlled visualViewport fixture activates the actual keyboard branch while preserving native method receivers. Injected 47px/34px safe-area tokens and long text test geometry. These observations do not prove Safari or a physical iPhone, native keyboard transitions, rotation, assistive technology or every device size.

## Accessibility qualification boundary

Root keyboard focus/visible outline, icon-control names and hit targets, selected-route semantics, critical touch sizes, light/dark opaque text-token contrast pairs and reduced-motion token resolution have explicit checks. This is not WCAG compliance. Translucent surfaces, every component state, actual screen-reader announcements, complete dialog focus trapping/return, all text scaling modes and user settings need later Block 2 validation. Token contrast is not substituted for all rendered contrast.

## Calls readiness

CATEGORY_B reserves audio/video header actions, an active-call surface, screen-share state and voice/live entry. Session IDs, conversation/Space context, participants, permissions and media state are separate from message-list/editor resources. A session overlay does not require a new root tab. Mobile full-screen and desktop panel surfaces share the session contract. No WebRTC, TURN, call signalling, device handoff, media-session engine or real call is introduced. Existing voice notes are not calls.

## DEFERRED TO LATER BLOCK 2

Remaining shared-component implementation and adoption, component-local token cleanup, removal of inert legacy CSS, comprehensive overlays/focus behavior, all mobile states and physical iPhone review; CATEGORY_A Spaces/Threads/Search/Saved/AI Composer/Public Identity implementation in their approved boundaries. Retired compatibility scripts remain absent and must be deleted or isolated after their final callers and standalone entrypoints are qualified. No new global hotfix/observer may repair another owner's DOM.

## DEFERRED TO BLOCK 3

MessageDoc v2, structured rich content, full Message/Thread/Topic/WorkObject links, object revision semantics and interactive-message execution. The contract leaves extension space; it does not implement these features.

## DEFERRED TO BLOCK 5

Universal AI/agent execution, agent-to-agent behavior, functioning service factory, marketplace and commerce. No such engine is part of the registry placeholders.

## Verification and handoff

`SHELL_2A_TEST_RESULTS.json` binds T01–T13 to source and browser evidence. `SHELL_2A_OWNERSHIP_MAP.json` retains before/current facts and migration actions. `SHELL_2A_COMPONENT_REGISTRY.md` distinguishes existing adapters and interface-only declarations. The manifest binds CODE_SHA, TESTED_SHA, runs/jobs/artifacts, ZIP digest/CRC, source/result hashes, limitations and external writes.

Reproduction uses pinned Playwright 1.57.0/Chromium through `.github/workflows/pablicus-shell-2a.yml`, the existing integration 1C workflow and the foundation workflow. `ownership_checks.py` alone proves only structural contracts; syntax alone proves no architecture. Browser and expected-negative results, actual-source 1B tests and real integration scenarios are independent gates. Fresh tests do not expand accepted Block 1 to production or the whole product.

Main, production, Supabase/RLS/Auth and real-user data are unchanged. No merge-to-main or deployment was performed. Plan 1.0 and Amendments 01/02 remain unchanged; five blocks remain in order. Independent review is required. 2B is not started automatically.
