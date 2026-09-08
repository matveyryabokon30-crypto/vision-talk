// The production entrypoint supplies the exact npm:...@13.3.0 library.
// Tests supply that same installed package, never a signature-verifier substitute.
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bytes = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 22000) throw new Error('invalid_encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
};

export function createWebAuthn({ library, rpId, origin, rpName = 'Pablicus' }) {
  if (!library?.generateRegistrationOptions || !library?.verifyRegistrationResponse || !library?.verifyAuthenticationResponse) throw new Error('webauthn_dependency_unavailable');
  const exact = new URL(origin);
  if (exact.protocol !== 'https:' || exact.origin !== origin || exact.hostname !== rpId) throw new Error('invalid_webauthn_config');
  function clientData(credential, challenge, type) {
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(credential.response.clientDataJSON)));
    if (data.type !== type || data.challenge !== challenge || data.origin !== origin || data.crossOrigin === true || (data.topOrigin && data.topOrigin !== origin)) throw new Error('invalid_client_data');
  }
  return Object.freeze({
    async registrationOptions({ subjectId, name }) {
      return library.generateRegistrationOptions({
        rpID: rpId, rpName, userID: encoder.encode(subjectId), userName: name,
        userDisplayName: name, timeout: 120000, attestationType: 'none',
        supportedAlgorithmIDs: [-7, -257],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      });
    },
    async verifyRegistration({ credential, challenge }) {
      clientData(credential, challenge, 'webauthn.create');
      const result = await library.verifyRegistrationResponse({
        response: credential, expectedChallenge: challenge, expectedOrigin: origin,
        expectedRPID: rpId, requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
      if (!result.verified || !result.registrationInfo?.userVerified) throw new Error('registration_rejected');
      const record = result.registrationInfo.credential;
      return { credentialId: record.id, publicKey: b64(record.publicKey), counter: record.counter, transports: record.transports ?? [] };
    },
    async verifyAuthentication({ credential, challenge, storedCredential }) {
      clientData(credential, challenge, 'webauthn.get');
      const userHandle = credential.response.userHandle;
      if (userHandle && new TextDecoder('utf-8', { fatal: true }).decode(bytes(userHandle)) !== storedCredential.subjectId) throw new Error('wrong_user_handle');
      const result = await library.verifyAuthenticationResponse({
        response: credential, expectedChallenge: challenge, expectedOrigin: origin,
        expectedRPID: rpId, requireUserVerification: true,
        credential: { id: storedCredential.credentialId, publicKey: bytes(storedCredential.publicKey), counter: storedCredential.counter, transports: storedCredential.transports },
      });
      if (!result.verified || !result.authenticationInfo?.userVerified) throw new Error('authentication_rejected');
      return { newCounter: result.authenticationInfo.newCounter };
    },
  });
}
