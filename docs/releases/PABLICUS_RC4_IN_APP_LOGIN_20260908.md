# Pablicus RC4 — in-app email proof redemption, 2026-09-08

Status: PUBLISHED CANDIDATE. Physical iPhone email-proof login remains pending user verification.

Stable URL: https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/
Version: 0.1.0-rc4
Source branch: pablicus-rc2-release
Source commit: 360b5d66a8dc5df25d0e5379d4a8bd352af2ecbd
Asset revision: bfbbdbe9cb0d3121
Checked build/promotion/live verification run: 34214328807 — SUCCESS.
Job: 102022402566 — all build, Auth browser tests, inherited integration, promotion and exact live-byte checks passed.

## Immediate access route

Open the existing installed icon, apply the available update, verify RC4 and the button 'Получить письмо для входа'. Request a fresh email for the existing approved account. Copy the original login link from the email WITHOUT opening it, return to the installed app, paste in 'Код или ссылка из письма', then select 'Войти в приложении'. Do not reuse a link already consumed in Safari. The current server email template sends a link; do not claim it sends a numeric code. Numeric OTP entry is also supported when the server template provides one.

The app strictly parses only HTTPS /auth/v1/verify URLs on its exact Supabase project host and only email/magiclink types. It calls the standard client.auth.verifyOtp({token_hash,type:'email'}) in the requesting browser context. It never navigates to the supplied URL, transfers a Safari refresh token, creates users, changes passwords, or uses an administrator key. The one-use proof is cleared from the input and is not persisted/logged. Existing SDK session storage keys and persistSession/autoRefreshToken are preserved. The proof must not be sent to an assistant or added to repository evidence.

The previously unfinished pablicus-auth-handoff Edge Function was disabled before client integration: version 4, verify_jwt=true, body responds 410 and contains no privileged token-generation logic. No account or message was reset. This release does NOT use that relay.

## Tests actually performed

- Parser accepts the project email link and a numeric OTP, rejects untrusted hosts, HTTP, credential-bearing URLs, recovery/invite/signup links, duplicate tokens/types, malformed tokens and fragments.
- Real bundled Supabase SDK + explicitly MOCKED Auth HTTP, Chromium and WebKit, separate persistent browser stores: an authenticated first context does not authorize another; local verification authorizes only the requesting context; restored session needs no second OTP; reused token fails closed; pending email UI survives reload; no new tab or proof retention.
- Existing chat/outbox initialization regression passed with its explicitly mocked backend. This does not prove real reciprocal messaging.
- Promoted only the tested /pablicus/ directory; prior root files were checked unchanged.
- Every published distribution file matched the checked artifact via HTTPS.
- Both live browser engines displayed RC4 login and the correct new email request button without showing private workspace. No real email was sent or consumed by automation.

## Source and continuation

Actual client module: apps/pablicus/src/auth-local.js. Home markup: src/home.html. Source build.py, finalize.py and src/sw.js were migrated and committed BEFORE build; not only changed in a temporary dist archive. The one-time migration helper is migrate_rc4_login.py. Finalizer writes the built version and resource-based cache revision; it is mandatory during future releases. The RC3 automatic publisher was retired to prevent intermediate source commits from being deployed without browser checks.

Preserve approved scoped Gate results, existing database/user/chat identifiers and permanent URL. Do not present this as physical iPhone, full offline WebKit, live two-account delivery or complete Pablicus acceptance. No further JSON/whole-gate rerun is needed from the user just to verify this changed login step.
