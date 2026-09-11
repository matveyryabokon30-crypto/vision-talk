# Known issues after Block 01 candidate

## Block 01 boundaries / residual review items

- Physical iPhone keyboard, safe-area and gesture behavior is not certified by Chromium CI.
- Authenticated production E2E is not run; tests use synthetic browser data and mock external API responses at the network boundary.
- The controller does not replace the internal message/outbox state machines; they intentionally remain application services.
- Browser history behavior beyond existing `?person=`/notification flows receives regression coverage only through preserved code paths, not a complete back/forward certification.

## Deferred blocks

- Block 2: canonical visual shell/design system and known header/composer geometry defects.
- Block 3: Canvas/editor/transport regressions beyond the specific project-click interception removed here.
- Block 4: server-backed groups, channels, Stories, avatar/data isolation and production release/security qualification.
- Block 5: AI agent and external adapters.

No production/device certification is claimed.
