# Public first-key registration candidate

This branch prepares **name → create passkey → account** without an email password, SMS, or a fabricated verified address. It is not enabled in the published app. `src/auth-config.js` keeps `publicPasskey.enabled=false` until the server and real-device acceptance below succeed.

The owner has confirmed native Apple Passwords/Face ID enrollment and sign-in on the existing release. Preserve that working account and key. An existing account with no key cannot be claimed by typing its email/name; it needs its existing authentication proof before linking, or the person can explicitly create a separate new account.

## Components

- `handler.mjs`, `webauthn.mjs`, `native.mjs`: own generic OAuth2 provider, actual pinned SimpleWebAuthn verification, and official native Auth verification for old keys.
- `index.ts`, `store.mjs`: Edge entrypoint and narrow service-role-only runtime persistence. No DDL, configuration relay, arbitrary SQL, or Auth-user administration endpoint.
- `SCHEMA_PROPOSAL.sql`: explicit owner-reviewed first installation, private tables, atomic operations and trusted-identity provisioning. It preserves existing approval decisions and conversation membership policies. Reapplication aborts instead of rotating the secret.
- `src/passkey-start.*`: same-origin first-key page. The main app uses normal Supabase PKCE OAuth and persists its normal Auth session.

The provider's new subject UUID is distinct from the Supabase account UUID. A verified old native key uses `native:<existing Auth UUID>` and the verified account email for standard Auth identity linking. The frontend rejects a native-subject/account-UUID mismatch before displaying account data.

## Activation on the existing project

Project: `ctcoqgsztdtsazdiwcmd` (Vision talk). Do not create a replacement project.

1. Require a green **Pablicus public first-key candidate** run for this exact source revision. This checks actual signatures, PostgreSQL roles and concurrent operations, Chromium virtual credentials and existing Auth/chat regressions.
2. Apply `SCHEMA_PROPOSAL.sql` once through an authorized migration connection or the owner's SQL Editor. Its final result contains `oauth_client_id` and a randomly generated `oauth_client_secret`. Put that secret only in the server provider configuration in step 4; never commit it, put it in frontend code, or print it in CI logs. Installation is transactional and deliberately refuses conflicting provisioning/schema or an existing installation.
3. Deploy the `pablicus-passkey` Edge Function with `index.ts`, `handler.mjs`, `webauthn.mjs`, `native.mjs`, `store.mjs` and the committed Deno dependency configuration/lock, if present. `verify_jwt=false` is intentional: this is the pre-login provider. Its browser routes authenticate a short-lived flow bearer and exact Origin, token exchange authenticates the confidential OAuth client and PKCE, and UserInfo authenticates a short-lived opaque bearer. Public `/authorize` is rate-limited. Runtime uses the normal project `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`; no new admin key is embedded in the function.
4. In [Auth Providers](https://supabase.com/dashboard/project/ctcoqgsztdtsazdiwcmd/auth/providers), create a **Manual configuration / OAuth2** provider with these exact values:

| Field | Value |
| --- | --- |
| Identifier | `custom:pablicus-passkey` |
| Name | `Pablicus` |
| Client ID | `pablicus-web` |
| Client Secret | One-time result from step 2 |
| Authorization URL | `https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/pablicus-passkey/authorize` |
| Token URL | `https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/pablicus-passkey/token` |
| UserInfo URL | `https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/pablicus-passkey/userinfo` |
| Scopes | `profile` |
| Email optional | `true` |
| PKCE | `true` |
| Enabled | `true` |

The fixed server callback is `https://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback`. Keep existing native passkey RP ID `matveyryabokon30-crypto.github.io` and Origin `https://matveyryabokon30-crypto.github.io`. Confirm new Auth signups are allowed and the existing app callback `https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/` remains allowed. Do not disable email confirmation globally or enable unrelated providers.

5. Check `/health` returns 200. Run a real authorize redirect through Supabase and confirm upstream S256/state, fixed callback and the correct first-key page. Do not accept a mocked redirect as production verification.
6. Publish the candidate static assets with the public flag still off, then use the real candidate flow to accept: new independent account creation; sign-out/reentry opens the same account; an old native key opens its original Auth UUID and messages; a third account cannot read the other two's conversations. Test real iPhone Safari/installed PWA. Automated Chromium credentials do not prove Face ID on a device.
7. Only after acceptance, set `publicPasskey.enabled=true`, rebuild/finalize, run release checks and publish via the existing release workflow. Verify the live bytes and repeat both old-key and new-key sign-in. Then share the normal Pablicus app URL.

The current connector's SQL session is read-only. Verify whether a separate authorized write tool is available before applying anything; do not change its role, use an Edge admin relay, or retrieve another privileged credential to circumvent that boundary.

## Recovery and limits

The device/password manager stores the private passkey; the server stores its public key. A synchronized passkey can be used on another compatible device. New accounts in this candidate have no verified email or phone recovery. If all copies of their key are lost, this candidate cannot recover the account. Additional-key management and a verified recovery method are separate unfinished work; the UI must not promise either.

First-key creation creates real account and key records. Global/per-flow rate limits bound requests but are not a complete anti-abuse system for large public traffic. Expired flow/token/bucket records are cleaned opportunistically. Abandoned enrolled subjects are retained so a saved key is not silently invalidated by cleanup.

## Safe rollback

Set the frontend public flag back to false to restore the existing native/email entry UI while diagnosing a rollout. This pauses new-provider entry, including new accounts that only have its keys; do not call that full account availability. Keep provider/schema/credentials intact, preserve active sessions, and never delete user records or passkeys as a rollback. A temporary server shutdown can use the private configuration `enabled=false` through the authorized owner connection.

## References

- [Supabase custom OAuth providers](https://supabase.com/docs/guides/auth/custom-oauth-providers)
- [Supabase native passkeys](https://supabase.com/docs/guides/auth/passkeys)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server)

This first-signup provider and compatibility bridge are our composition of these APIs, not Supabase's native registration feature.
