# Pablicus: foundation remediation baseline — 2026-09-11

## Decision and scope
Replace the competing UI ownership/navigation/layout layer in the existing application. Preserve accounts, server identifiers, message order, durable draft/outbox data, media storage and the established public URL. Do not create another demo application or add a ninth visual hotfix.

This is Phase 0, not a production repair or acceptance certificate. Production assets and database were not modified by this audit. No user screenshots, messages, videos, credentials or database rows belong in this public report.

Baseline: `f348aceacc3acdb315387a4066f6f495ce269b54` (`Publish pre-Stage-3 hotfix v8`). GitHub Pages run `34547280893`, artifact `10179479816`; downloaded archive SHA-256 `092434415ad70ec58c00144e63fee7a27d7a0913340706da58a65947184a5e5f`.

Work branch: `refactor/pablicus-foundation-20260911`. No automatic merge or deployment.

## Reproduced defects

### F01 — self-triggering list observer (release blocker)
`pablicus/ux-refinement.js:28,41,57-58`: `reorderFavorites()` appends every existing chat row even if its order is unchanged. A subtree `MutationObserver` schedules `sync()`, which invokes the same reordering. Each frame therefore schedules the next frame. Checking the selected navigation tab does not stop work when the home screen is hidden by a conversation/canvas.

Offline Chromium reproduction with three synthetic chat rows, after warmup, one-second observation window:
- fixture without the enhancement scripts: 0 observer callbacks;
- `ux-refinement.js` alone: 60 callbacks;
- combined UX/hotfix/creation scripts: approximately 240-244 callbacks;
- combined scripts with the home screen hidden: approximately 240-244 callbacks;
- combined scripts with an empty chat list: 0 callbacks.

These are callback counts, not unique DOM changes, CPU utilization, rendered frames, or a measured iPhone freeze duration. The result establishes a repeatable unwanted idle loop, not exclusive attribution of every reported mobile freeze.

### F02 — opening a project is intercepted as editing
`pablicus/ux-refinement.js:21`: a capturing listener stops the project card click and programmatically clicks `.pccPlanEdit`. In a synthetic fixture the ordinary card action produces `{read:1, edit:0}` without this script, and `{read:0, edit:1}` with it. The behavior conflicts with an in-place, read-only disclosure of a saved project.

### F03 — header geometry combines incompatible CSS generations
`pablicus/chat-minimal.css:190-202` leaves `.chatHeading` in grid column 3. `pablicus/pablicus.css` leaves its flex direction as column. Later foundation/hotfix styles introduce a four-column header, absolute centering, fixed height and clipping without removing those inherited rules.

Using the deployed HTML and stylesheet order, without authentication or application JavaScript:

| Viewport width | Heading center error | Title height |
|---|---:|---:|
| 390 | 141 px | 0 px |
| 815 | 353.5 px | 0 px |
| 1440 (1000 px app) | 446 px | 0 px |

A local diagnostic CSSOM experiment removing the inherited `grid-column`, `grid-row`, and `flex-direction` declarations makes the center error 0 px and title height 15 px at all three widths. This was a causal isolation experiment, NOT a shipped CSS fix or complete visual acceptance test.

## Additional source findings
- `pablicus/bots-nav.js:5-12` dynamically loads the UI foundation, creation flows, UX refinement and hotfix v8. Absence from static HTML does not mean the hotfix is disconnected. The earlier contrary diagnosis is withdrawn.
- `pablicus/creation-flows.js:3-5,26-35` stores new groups/channels in unscoped localStorage and displays creation confirmations. Their list entries subsequently show a message that group transport is a separate future layer. These flows are local drafts/prototypes, not server-backed collaboration.
- `ux-refinement.js` contains a local story preview and locally stored avatar. A preview is not publication or cross-device persistence. Account scoping must be audited; cross-account disclosure has not been certified here.
- Main navigation in `app.js` and the injected bot navigation have separate owners; scenario bridge DOM injection also maps cards by position. Replace these with explicit route/action/resource identities.
- Separate persisted main-session Supabase clients should be consolidated. Do NOT blindly merge the deliberately isolated password-recovery and passkey-candidate clients.
- The old `browser-smoke.yml` targets root Vision Talk assets rather than `pablicus/**`. A successful Pages deployment is not an application regression test.
- A manually maintained `version.json` references a different commit. Generate release identity from the build/deploy pipeline.

## Replacement map

| Area | Treatment |
|---|---|
| `vault.js`, `outbox.js`, `transport-store.js`, stable message RPC contracts | Preserve behavior and IDs; establish regression coverage before changing implementation. |
| `chat-canvas.js`, `workspace-editor.js`, `rich-message.js` | Preserve storage/content contracts; separate read/edit/fullscreen states and resource lifetimes. |
| `ux-refinement.js`, `public-hotfix-v8.*` | Remove their ownership of navigation, rendering and layout after canonical replacements pass tests. Do not stack another patch. |
| `bots-nav.js`, `bot-scenario-bridge.js` | Replace dynamic UI injection, label-based click interception and positional identity mapping with explicit modules. |
| `style.css`, `pablicus.css`, `chat-minimal.css`, `public-ui-foundation.css` | Resolve layout ownership by component; remove contradictory legacy declarations rather than increasing specificity. |
| `creation-flows.js` local entities | Clearly retain as drafts or replace with real authenticated services; do not silently delete users' local content. |
| old laboratory/demo UI | Exclude from the production asset graph; retain history/recovery material. |
| Auth/database/storage/bot backend | No blanket rewrite or reset; contract/security tests and version-controlled migrations first. |

## Execution plan and gates

### Phase 0 — baseline and regression harness
Save the deployed artifact identity, reproducible local tests and evidence; work on a separate branch. Completed scope: source snapshot and diagnostic reproductions. This is not a backup of all user database/media data.

### Phase 1 — one application owner and automated checks
Implement explicit routes, view state, module mount/unmount, and disposable subscriptions/timers. Render card order from data only when the order changes. Stop hidden views from doing presentation work. Share the main authenticated service; preserve isolated auth flows. Add CI triggers for Pablicus and its actual dependency/test paths.

Gate: the populated hidden-list fixture becomes idle after settling; 50 route transitions do not accumulate active observers/listeners; late async responses cannot overwrite another route/account; existing messages and drafts are unaffected.

### Phase 2 — canonical UI shell and design system
One header, one primary navigation, shared tokens, explicit ownership of safe-area and viewport geometry. Separate conversation composer from project editor. Preserve the approved identity and icon.

Gate: correct section title; nonzero visible contact name; no overlapping action targets; no horizontal overflow at 390/815/1440 and keyboard-sized viewports. Mobile emulation is not physical iPhone acceptance.

### Phase 3 — canvas/editor and transport regression
A saved project opens read-only in place; editing is a separate explicit command. Preserve unsaved content, caret, attachment order and original bytes. Respect revisions and conflict handling; cancel stale work. Lazy media work must not block navigation.

Gate: 20 read/edit/close cycles without duplication or state loss; network retry creates no duplicate side effects; concurrent edits surface a conflict; existing source-message/task links remain valid.

### Phase 4 — real capabilities, release and data isolation
Replace local-only group/channel/avatar/story placeholders with server-backed features, or label them honestly as drafts/unavailable. Scope local storage to account and resource. Audit grants, function authorization and RLS with negative tests; missing RLS in an inaccessible private schema alone is not proof of exposure. Version control schema/function sources. Generate one atomic release manifest/asset graph and test service-worker upgrades with a draft and queued message.

Gate: allowed changes synchronize across two authorized test accounts/devices; unauthorized access is denied; no false success toast; production artifact matches reviewed SHA; rollback preserves data and authentication.

### Phase 5 — agent and channel adapters
Only after the manual product is stable: expose the same domain operations as permission-checked agent tools, with revisions, idempotency, approvals and audit records. Keep conversation projects distinct from bot-scenario graphs. Verify external API capabilities against official documentation at implementation time.

Gate: actual state changes, not generated advice or DOM click simulation; forbidden writes remain forbidden regardless of model output; failed tool calls do not produce a success claim.

## Reproduction
`tests/audit/pablicus_reproduce_legacy_ui.py` runs in an isolated local Chromium with all network requests blocked. It needs a source root containing `pablicus/`, Python Playwright and BeautifulSoup, and a Chromium binary.

```sh
python tests/audit/pablicus_reproduce_legacy_ui.py --source-root . --browser /path/to/chromium --output-dir audit-output
```

It is a diagnostic recorder: exit code zero means collection completed, not that the product passed. Inspect `idle_gate_pass`, `read_only_click_gate_pass`, `center_gate_pass`, and captured geometry. A future release gate must assert the repaired behavior. Re-run against the frozen baseline to compare; code changes that remove legacy files require adapting the harness to the canonical modules.

## Explicit limits
No complete authenticated production end-to-end suite, physical iPhone keyboard test, load test, full security certification, or complete other-chat transcript review is claimed. Existing retrieved requirements and screenshots informed the scope; public evidence uses only repository code and synthetic test data. No production repair has been released by Phase 0.
