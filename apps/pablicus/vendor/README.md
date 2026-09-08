# Pablicus browser SDK

`supabase.js` is the **unaltered** `package/dist/umd/supabase.js` from the official
npm package `@supabase/supabase-js@2.105.0` (MIT). This is the stable minimum version
documented for native Supabase passkeys, pinned to avoid drifting experimental
APIs. The release was published on 2026-04-27 and adds passkey registration,
authentication and management. No credentials are required to reproduce it.

## Verification and reproduction

From the repository root, verify the committed bytes without network access:

```sh
python apps/pablicus/vendor/verify-supabase.py
```

Recreate them from the official npm registry:

```sh
python apps/pablicus/vendor/verify-supabase.py --download
```

The download command checks registry package/version metadata against the lock,
verifies the tarball using npm `dist.integrity` (SHA-512) and a pinned SHA-256,
then checks the extracted bundle SHA-256 before replacing the file. It reads
only the specified tar member and performs no npm install or lifecycle scripts.
The complete provenance, dependency versions and hashes are in
`supabase.lock.json`. Initial acquisition and verification occurred 2026-09-08.

Bundle SHA-256:
`24e8c00dc25da420ee741068b60bcdb5f62cb3598d8834058acf37ec6ee1a724`

Tarball SHA-256:
`ab0c52d34b139b1018d0269676baec157bff52e83a86af065bf930a4dee3d720`

## Compatibility review

The replaced Pablicus bundle was 2.45.3. Review of the current
[Supabase changelog](https://supabase.com/changelog.md), the pinned package, and
its [release notes](https://github.com/supabase/supabase-js/releases/tag/v2.105.0)
identified these relevant upgrade considerations:

- Although its upstream path still contains `umd`, 2.105.0's browser artifact is
  an IIFE defining the browser global `supabase`. Unlike 2.45.3, it does not expose
  CommonJS `module.exports`. Node tests should evaluate the original browser
  script with `vm` and read `context.supabase`; do not rewrite the official file.
- The pinned package declares Node >=20. Its Realtime implementation expects
  native WebSocket or an explicit transport. Since 2.55.0, Node <22 needs `ws`
  passed as `realtime.transport`; browsers and Node >=22 already provide the
  required API. Use Node >=22 for local/CI verification.
  [Upstream breaking-change notice](https://supabase.com/changelog/37869-change-in-realtime-js-affecting-node-js-22).
- Passkeys require `auth: { experimental: { passkey: true } }` and separately
  enabled server support. Missing client opt-in throws before network calls.
  The API is experimental even though this SDK release is stable.
- The June 2026 `API_EXTERNAL_URL` prefix change concerns self-hosted server
  deployments; it does not alter a hosted project's browser base URL.
  [Auth configuration notice](https://supabase.com/changelog/47093-self-hosted-supabase-api-external-url-to-include-auth-v1).
- The management OAuth token endpoint changed successful status from 201 to
  200. It is a different endpoint from this app's `/auth/v1` sign-in endpoints.
  [OAuth status notice](https://supabase.com/changelog/45468-breaking-change-oauth-token-endpoint-will-return-http-200-instead-of-201).

The legacy `.github/workflows/vendor-supabase.yml` downloads 2.45.3 into the root
`vendor/` directory for older entry points. It is not the reproduction command
for the Pablicus source bundle in this directory.

## Pinned passkey contract

The following was checked against `@supabase/auth-js@2.105.0` source and the
[official passkey guide](https://supabase.com/docs/guides/auth/passkeys).
All SDK responses use `{ data, error }` unless an unexpected programming error
throws. Treat both rejected calls and returned errors as failures.

| Client call | HTTP under `/auth/v1` | Successful data |
| --- | --- | --- |
| `auth.passkey.startRegistration()` | `POST /passkeys/registration/options`, user JWT, `{}` | `{challenge_id, options, expires_at}` |
| `auth.passkey.verifyRegistration({challengeId, credential})` | `POST /passkeys/registration/verify`, user JWT, `{challenge_id, credential}` | `{id, friendly_name?, created_at}` |
| `auth.passkey.startAuthentication()` | `POST /passkeys/authentication/options`, `{gotrue_meta_security:{}}` | `{challenge_id, options, expires_at}` |
| `auth.passkey.verifyAuthentication({challengeId, credential})` | `POST /passkeys/authentication/verify`, `{challenge_id, credential}` | `{session, user}` from the standard session response |
| `auth.passkey.list()` | `GET /passkeys`, user JWT | Array of `{id, friendly_name?, created_at, last_used_at?}` |
| `auth.passkey.update({passkeyId, friendlyName})` | `PATCH /passkeys/{id}`, user JWT, `{friendly_name}` | Updated metadata |
| `auth.passkey.delete({passkeyId})` | `DELETE /passkeys/{id}`, user JWT | `null` |

High-level `auth.registerPasskey({options:{signal}})` and
`auth.signInWithPasskey({options:{signal,captchaToken?}})` perform the browser
ceremony as well. The signal controls the browser prompt, **not** server HTTP
requests. Registration reads the current session separately for options and
verification, so an application that requires account-race protection should
use the split API and check account identity before verification. Authentication
saves the returned session and awaits `SIGNED_IN` subscribers before resolving.
Do not synchronously await additional auth calls from those subscribers.

The options' binary fields are base64url JSON strings. Prefer native
`PublicKeyCredential.parseCreationOptionsFromJSON` /
`parseRequestOptionsFromJSON` and credential `toJSON()` where available.
The SDK fallback decodes creation `challenge`, `user.id`, and
`excludeCredentials[].id`; request `challenge` and `allowCredentials[].id`.
Fallback response serialization encodes attestation or assertion buffers,
includes credential ID, type, extension results and optional attachment; no
private key enters the page or server payload.

Relevant browser failures include `AbortError` (`ERROR_CEREMONY_ABORTED`),
`NotAllowedError` (keeps name/cause, `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY`),
`InvalidStateError` (`ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`), and RP/domain
errors. Server codes include `passkey_disabled`, `too_many_passkeys`,
`webauthn_credential_exists`, `webauthn_credential_not_found`,
`webauthn_challenge_not_found`, `webauthn_challenge_expired`, and
`webauthn_verification_failed`.

Local smoke verification evaluated the exact browser bundle in a Node 24 VM,
checked its client constructor and all seven passkey namespace methods plus the
existing OTP/OAuth/session methods, and confirmed listing without a session
returns `AuthSessionMissingError` without a network request. Browser/HTTP
integration evidence belongs to the application tests, not this artifact check.
