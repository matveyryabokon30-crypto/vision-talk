/* Public rollout flags only. Provider secrets belong in the Auth dashboard.
 * Enable a provider only after its server setup, new-account provisioning,
 * and a real sign-in on the published URL have passed acceptance.
 */
globalThis.PablicusAuthConfig = Object.freeze({
  passkeys: Object.freeze({
    enabled: false,
    rpId: 'matveyryabokon30-crypto.github.io',
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
