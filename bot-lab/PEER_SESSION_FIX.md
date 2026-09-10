# Peer-only check after an unconfirmed browser session

Date: 2026-09-10. Release: `20260910-peer-2`.

## Observed problem

The owner supplied a report started at 13:53:29.884Z: health=200, intentionally anonymous request=401, ordinary-account verification=401; complete=false. The accompanying earlier peer screen displays only a generic unexpected-response message. Its actual HTTP status was not supplied; do not infer unauthorized disclosure, or a specific expiry timestamp, from that screen.

The existing `lab.mjs` reads an access token from browser storage without refreshing it. A run resets its in-browser report and manifest before checking `/v1/me`. Thus a new failed run can replace the locally saved successful report. The earlier reports already sent to the assistant and recorded as evidence are not invalidated. This is a test-harness limitation, not proof that the bots stopped working.

## Contained remedy

Three additive files provide `/bot-lab/peer.html`: `peer.html`, `peer-page.mjs`, `peer-core.mjs`. No existing messenger file, Auth settings, backend, schema, service worker, password or existing Lab-state key is modified. The legacy full-run page is not patched in this change. The new page never writes localStorage, including legacy report storage, and never calls refresh-token or administrative endpoints. Its only sessionStorage write retains a user-supplied non-secret test-target code and an optional expected checking-account ID across ordinary login navigation.

The page performs only four peer-isolation probes, independently of the in-browser 34-check report. It produces a distinct `kind: peer_isolation_only` report; it must not be represented as a new full scenario run.

A server-verified `/v1/me` check is required before the probes, including expected-user and different-target-owner checks. The same account is checked again at completion. Token changes stop the run; identities are not silently switched. HTTP 401 is an inconclusive session interruption, never a successful isolation result or proof of leaked data. Unexpected 2xx stops with failure and the response body is never read, rendered or included in the report. Only 404 plus NOT_FOUND passes a probe. No redirects, cookies or arbitrary endpoints are permitted.

The fourth probe attempts to create a conversation with the private foreign bot and expects rejection. If that request is unexpectedly permitted, a test conversation may be created; it is not deleted automatically. No new bots, records or ordinary messages are sent by the page.

Prefilling accepts a validated code in the URL fragment (not a query sent to the server) and strips that fragment before API requests. No user/test IDs or secrets are hardcoded into the public source.

## Verification

- `node --check` passed for both JavaScript modules.
- `node --test bot-lab/tests/peer-core.test.mjs`: **24 passed, 0 failed**. Mocked HTTP tests cover absent/expired/changed session, wrong actor/scope, exact four-probe sequence, 401 mid-run, incomplete final auth, unexpected successful response privacy, failure classification, code validation, no auth/legacy storage writes and absence of refresh operations.
- A real Chromium navigation attempt to the isolated localhost HTTP test server returned `ERR_BLOCKED_BY_ADMINISTRATOR`. It was not worked around. No browser, mobile, CSP or actual-account acceptance is claimed for this new page.
- Read-only corroboration of the two known intake bot/session pairs: each remains private and active, at session revision 6, with 6 events and exactly 1 record. No event body or key/refresh token was retrieved. This confirms target existence for the supplied reverse check, not its access-control outcome.

## Next acceptance

First participant opens Public normally in the same browser to refresh/restore their session. They then reopen the prefilled peer-only link, verify sign-in, run four checks and send the resulting report. No full scenario rerun or changes on the second participant's phone are required. The inverse cloud-isolation result remains pending until that report is obtained.

References for the session model, not application-specific evidence:
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/reference/javascript/auth-getuser
