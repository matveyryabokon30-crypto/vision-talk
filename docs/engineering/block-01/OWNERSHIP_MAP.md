# Block 01 — ownership map

Base inspected: `748243d0cb850c74faf4ca284ca136811fbf312c`; production comparison: `f348aceacc3acdb315387a4066f6f495ce269b54`.

This initial map records the implementation direction before behavior changes. It is not acceptance evidence. No production release is authorized.

| State / action | Current owners | Canonical owner after Block 01 | Old path to remove |
|---|---|---|---|
| Main section and active conversation | app.js page/current; bots-nav mounted; DOM-selected tab in UX/hotfix | application navigation controller, called by app.js commands | neutral feed click, delegated text matching, DOM-derived routes |
| Conversation / Canvas | app.js canvasVisible; UX/hotfix DOM inference and composer writes | application navigation controller; canvas local editor state is emitted explicitly | canvas capture-to-edit, observer-based visibility repair |
| Bots / Factory / Scenario | bots-nav, scenario bridge and independent DOM interceptors | explicit route with bot/project IDs; screen adapters receive shared services | card index mapping, button-label dispatch, artificial navigation clicks |
| Header and active tab | app.js, bots-nav, ux-refinement, public-hotfix-v8 | one navigation projection | independent delayed title rewrites |
| Main authenticated session | app.js plus bots-nav plus scenario-bridge clients | existing app.js authenticated client | duplicate persisted-session clients and their auth subscriptions |
| Recovery / candidate verification | deliberately isolated clients in app.js | retain isolated clients and existing contracts | none; do not consolidate with main session |
| Chat list and favorites | renderHome; reorderFavorites; hotfix cleanChats; creation observer | keyed list view supplied with data and explicit favorite commands | all observer-triggered reinsertion and positional identity |
| Project read/edit | chat-canvas native disclosure plus UX capture listener | chat-canvas local state with explicit read/edit events | capture listener calling Edit on card click |
| UI resources | anonymous observers, timers, listeners | per-view resource scopes; idempotent dispose | unmanaged enhancement initialization and subtree repair loops |
| Draft, outbox, inbox, token refresh | existing storage/transport/session services | remain application/session services, not screen resources | no teardown on hiding chats or opening Canvas |

## Lifetime boundary

Application/session services survive screen transitions. View scopes own listeners, observers, requests and presentation timers and are disposed or suspended on navigation. Durable drafts and pending outbox items retain their existing storage keys and formats. Cancellation is paired with session generation and route/resource checks; cancellation alone is not authorization or stale-result protection.

## Reproduction before implementation

An isolated Chromium run against the baseline files observed five seconds after warmup: 1,200 observer callbacks with 3 visible cards, 1,200 with 100 cards, and 1,200 with 3 hidden cards. The combined scripts generated 12,600 / 303,600 / 12,600 mutation records respectively. These are callback/record counts, not CPU measurements. A saved project card produced read=0, edit=1. Historical audit files are unchanged; new run evidence will accompany ACCEPTANCE.md.
