# Public Bot Core — integration stage

Status: isolated GitHub staging integration. Production PWA is unchanged.

Base commit: `1bc2098df90f410ddfa1067ee67234b82d4a54e1` (`main`).
Branch: `bot-core-integration-stage`.

## Added

- `pablicus/bots/config.js` — disabled switch and Bot Core endpoint.
- `pablicus/bots/sdk.mjs` — authenticated browser API client.
- `pablicus/bots/stage.mjs` — staging controller with account-change-safe token lookup.
- `pablicus/bots-staging.html` — isolated test screen.

## Deliberately not changed

- `pablicus/index.html`
- `pablicus/app.js`
- `pablicus/sw.js`
- `pablicus/ASSET_MANIFEST.json`
- existing chat/database behavior

The staging page is not linked from the production shell and is not in the Service Worker allowlist. Therefore merging this branch alone would not expose Bot Core in the normal PWA navigation.

## Required next gate

The `/functions/v1/public-bot-core` backend must be deployed and verified against the tested Bot Core server contract before the switch can be enabled. Do not enable `PUBLIC_BOT_CORE_CONFIG.enabled` or change the production shell until server-side identity isolation, RLS/grants, idempotency and two-account tests pass.
