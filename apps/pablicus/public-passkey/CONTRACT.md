# Public first-passkey candidate contract

Owner requested public passkey-only first signup after accepting the native Face ID login on 2026-09-08. This candidate is not enabled in production until normal database setup, provider configuration, and acceptance succeed. The current MCP database role remains read-only. No schema/admin actions may be routed through an Edge relay to bypass that restriction.

Provider: `custom:pablicus-passkey`, generic OAuth2, email_optional=true, PKCE S256 required. Client ID `pablicus-web`. Exactly one callback: `https://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback`. API base `https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/pablicus-passkey`. Page: `https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/passkey-start.html`. RP ID/origin remain the published GitHub domain.

## HTTP and browser contract

- `GET /authorize`: validate client_id, response_type=code, exact redirect_uri, bounded state, code_challenge S256. Create flow with random UUID and 32-byte bearer secret; only its SHA256 is stored. Redirect 303 to page fragment `#flow=<uuid>&secret=<base64url>`. No account or key is created by opening this URL.
- Page captures fragment immediately, removes it with replaceState, and stores flow/secret only in sessionStorage. All browser API calls use `Authorization: Bearer <flow-secret>`, JSON body including `flowId`, exact Origin allowlist; no credentials in query, logs, screenshots, or localStorage.
- `POST /registration/options` body `{flowId,name}` returns `{options}`. Name: trimmed 1..80 characters. No email/phone/password collected. Account subject is a new server UUID. Server generates WebAuthn challenge, stores it, and requires residentKey and userVerification.
- `POST /registration/verify` body `{flowId,credential}` atomically consumes the stored challenge, validates attestation with pinned SimpleWebAuthn, stores subject/key and one-use OAuth code; returns `{redirectTo}` with the fixed callback, code and preserved state.
- `POST /authentication/options` body `{flowId}` gets the challenge from official native Supabase passkey API, checks RP, stores challenge/native challenge_id, and returns `{options}` with UV required.
- `POST /authentication/verify` body `{flowId,credential}` consumes the stored challenge. Valid own credential signature yields its stable subject/name. Otherwise SAME assertion goes to official native Supabase verify API. Native success requires getUser, confirmed real email, approved profile; userinfo is `{sub:'native:'+uuid,name,email,email_verified:true}` based solely on that verified session. Revoke only the temporary native session with scope=local before issuing code. Never return temporary session to client. Native UV/challenge/origin are checked before delegating; native verifier checks signature. No direct auth credential reads/writes.
- `POST /token`: OAuth form, HTTP Basic or matching body client ID/secret; authorization_code only, exact callback, valid S256 verifier. Atomically consume code and create hashed 32-byte access token, TTL 60 seconds. Return standard access_token/token_type=Bearer/expires_in=60.
- `GET /userinfo`: bearer token, lookup hash with expiry, returns server-recorded userinfo. For new subjects NEVER include email/email_verified. No client-provided identity claims.
- `GET /health`: status only, returns 503 when setup is unavailable. No privileged details.
- Errors `{error:'bounded_code',message:'safe Russian text'}`; no upstream bodies/tokens. No-store responses, strict methods/body limits/CORS; server rate limits per trusted platform client IP hash and flow. Do not trust arbitrary forwarded headers without a documented platform source; global/per-flow limits must still work.

Each browser action is explicit. Cancellation allows fetching new options; replacing a challenge invalidates the previous one. A verification consumes the operation once even on failure. Page must offer return/restart after consumed/expired flow. Browser single-flight prevents ordinary double clicks while an operation is pending. The server limits options requests to one per fixed two-second bucket; accepted retries replace the previous challenge, and requests across a bucket boundary may both be accepted.

## Store adapter interface (all time values ISO strings)

`store.config()` -> `{clientId,secretHash,enabled}` or null.
`store.createFlow({id,secretHash,state,codeChallenge,redirectUri,expiresAt})`.
`store.readFlow({id,secretHash})` -> flow or null (valid/uncompleted/expiry).
`store.setChallenge({id,secretHash,kind,challenge,nativeChallengeId,subjectId,name,expiresAt})` -> bool. Valid flow only, replaces earlier challenge, resets claimed=false.
`store.claimChallenge({id,secretHash,kind})` -> flow+challenge info or null. Atomic, once, marks claimed. Does NOT permit another challenge after claimed.
`store.findCredential({credentialId})` -> `{credentialId,publicKey,counter,transports,subjectId,name}` or null. Public key is base64url COSE bytes.
`store.completeRegistration({flowId,subjectId,name,credential:{credentialId,publicKey,counter,transports},codeHash,codeExpiresAt})` -> bool. Atomic subject+credential+code; enforce consumed registration flow, preassigned subject, unique credential, one completion.
`store.completeAuthentication({flowId,subjectId,name,credentialId,oldCounter,newCounter,userinfo,codeHash,codeExpiresAt})` -> bool. Own branch atomically checks/stores counter; native branch credentialId=null and subjectId='native:'+uuid, permitted only by trusted handler. One completion. userinfo stored server-side in code; never accepted from browser.
`store.exchangeCode({codeHash,codeChallenge,redirectUri,clientId,tokenHash,tokenExpiresAt})` -> bool. Atomic conditional code consume + hashed token creation.
`store.userinfo({tokenHash})` -> object or null.
`store.rateLimit({key,limit,windowSeconds})` -> bool. Server-generated bucket labels; no raw secrets/IP persistence.

Postgres adapter uses a service-role-only RPC with explicit operations and private schema tables. SQL operations SECURITY INVOKER, no client grants or public table exposure. The existing Auth-trigger provisioning replacement handles usernames without email; approval derives only from trusted auth.identities provider for new eligible accounts, never user_metadata. Existing approval/bans/membership must be preserved. No auth identity rows inserted directly.

`createHandler({store,webauthn,native,config,crypto})` dependency injection; config pins URLs and client ID. Library wrapper exports registrationOptions,verifyRegistration,verifyAuthentication; native wrapper exports startAuthentication,verifyAuthentication (returns verified user info after local-only session cleanup). No network mocks in production wrappers. Handler tests inject boundaries explicitly.

## Integration and acceptance

Existing native key entry remains live until this provider is activated. New main entry uses normal Supabase OAuth PKCE and existing explicit callback exchange. For native:<uid> bridge identity, final Auth getUser UID must equal the proved UUID; never admit a duplicate/replacement account. Native no-email/phone-only bridge fails closed. New no-email accounts use custom key enrollment/management; native enrollment is not offered to those accounts.

Katya has an existing approved email account but no native key. Do not silently attach a new public subject to that account based on her typed name/email. A fresh public signup creates a distinct account; preserving her old account requires existing-account proof and explicit identity linking. Public invitation onboarding and that link are separate from silently claiming an address.

Required candidate tests: exact redirects and PKCE, one-use flow/challenge/code, wrong origin/RP/UV/signature, concurrent exchanges, real virtual authenticator with real verification library, native bridge UID and local-only logout, no temporary-token exposure, PostgreSQL grants and new-account-only approval, third-account chat isolation unchanged. Current iPhone native key/user acceptance is recorded; new public flow remains unaccepted until live configuration and device testing.
