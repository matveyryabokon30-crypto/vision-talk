# Block 01 implementation

Base production audit SHA: `f348aceacc3acdb315387a4066f6f495ce269b54`. Work continues on `refactor/pablicus-foundation-20260911`; production is not published from this branch.

## Implemented

- `pablicus/app-controller.js`: canonical route/state owner. Navigation is explicit (`section`, `screen`, `resourceId`, `conversationId`, `canvas`), each transition increments a generation, disposes the previous view scope, projects the active section/title, and rejects stale async completion through `isCurrent()`.
- `pablicus/chat-list-view.js`: stable favorite ordering and keyed DOM reconciliation. Reconciliation performs no DOM write when the order is already correct.
- `pablicus/app.js`: reuses the existing main authenticated Supabase client as an injected service, retains isolated recovery/passkey candidate clients, delegates primary navigation and conversation/canvas commands to the controller, uses stable favorite ordering, and exposes shared bot services without changing existing storage/auth keys.
- `pablicus/bots-nav.js`: no second persisted-session client, no artificial neutral-tab click, no text-label dispatch; Bots/Factory are controller routes.
- `pablicus/bot-scenario-bridge.js`: no second persisted-session client, no positional bot-card mapping or subtree observer; Scenario is opened with an explicit bot ID.
- `pablicus/bots.js`: bot cards and actions carry stable IDs/actions; Factory and Scenario are explicit callbacks.
- `pablicus/ux-refinement.js`: reduced to presentation compatibility only. It no longer owns navigation, project clicks, list ordering, or subtree synchronization.
- `pablicus/public-hotfix-v8.js`: historical compatibility file remains but its navigation/DOM-observer ownership is retired.
- `pablicus/index.html` and `pablicus/sw.js`: candidate entrypoint/cache graph includes the controller/list modules. Production worker is not deployed by this block.

The local-only group/channel/story prototype remains outside canonical navigation and is no longer dynamically activated by `bots-nav.js`; real server-backed versions remain Block 4 scope.

## Execution path

`index.html -> app-controller.js -> chat-list-view.js -> existing modules -> app.js -> bots-nav.js`. User actions invoke controller commands; controller changes state, projects route metadata, invokes the registered view handler, and disposes its view scope on the next transition. Existing message/outbox/token services remain application/session services and are not torn down with views.

## Tests

- `tests/engineering/block-01/test_block01.py`
- `tests/engineering/block-01/test_negative_cycle.py`
- CI: `.github/workflows/pablicus-foundation.yml`

Clean-copy command:

```sh
python -m pip install playwright==1.57.0 beautifulsoup4==4.14.3
python -m playwright install chromium
python tests/engineering/block-01/test_block01.py --source-root . --entrypoint-url http://127.0.0.1:8080/pablicus/ --output-dir block01-results
```

The static server must be started separately with `python -m http.server 8080 --bind 127.0.0.1`.

## Rollback

Revert only Block 01 commits on the work branch. No database migration, RLS/Auth change, storage-key migration, IndexedDB deletion, or user-data rewrite is part of this block, so rollback requires no data migration.
