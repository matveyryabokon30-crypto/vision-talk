/* Public rollout flags only. Provider secrets belong in the Auth dashboard.
 * Social providers require their server setup and new-account provisioning.
 * Passkeys use the existing account; native challenge readiness was verified
 * on the configured production RP before enabling this release.
 */
globalThis.PablicusAuthConfig = Object.freeze({
  passkeys: Object.freeze({
    enabled: true,
    rpId: 'matveyryabokon30-crypto.github.io',
    origin: 'https://matveyryabokon30-crypto.github.io',
  }),
  publicPasskey: Object.freeze({
    enabled: true,
    origin: 'https://matveyryabokon30-crypto.github.io',
  }),
  publicSignupReady: false,
  providers: Object.freeze({
    google: false,
    'custom:yandex': false,
    'custom:mailru': false,
    azure: false,
  }),
});
