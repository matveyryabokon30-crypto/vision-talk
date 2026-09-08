// Official Supabase Auth REST bridge. No admin key, auth-table access, or SDK
// session persistence. A native session is proof for this request only.
const MESSAGES = Object.freeze({
  native_configuration: 'Вход временно недоступен.',
  native_unavailable: 'Не удалось связаться с сервером входа. Попробуйте ещё раз.',
  native_options: 'Сервер не подготовил ключ доступа. Начните вход заново.',
  native_assertion: 'Не удалось подтвердить ключ доступа. Начните вход заново.',
  native_identity: 'Не удалось подтвердить существующий аккаунт.',
  native_approval: 'Для этого аккаунта вход пока недоступен.',
  native_cleanup: 'Не удалось завершить проверку входа. Попробуйте ещё раз.',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const utf8 = new TextEncoder();

export class NativeError extends Error {
  constructor(code = 'native_unavailable') {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'native_unavailable';
    super(MESSAGES[safeCode]);
    this.name = 'NativeError';
    this.code = safeCode;
    this.status = safeCode === 'native_configuration' || safeCode === 'native_unavailable' ||
      safeCode === 'native_cleanup' ? 503 : 400;
  }
}

function requireValue(ok, code) {
  if (!ok) throw new NativeError(code);
}

function decode(value, maxBytes = 16384) {
  requireValue(typeof value === 'string' && value.length > 0 &&
    value.length <= Math.ceil(maxBytes * 4 / 3) && /^[A-Za-z0-9_-]+$/.test(value) &&
    value.length % 4 !== 1, 'native_assertion');
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    requireValue(bytes.length <= maxBytes &&
      btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value, 'native_assertion');
    return bytes;
  } catch {
    throw new NativeError('native_assertion');
  }
}

function publicApiKey(value) {
  if (typeof value !== 'string' || value.length > 8192) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(decode(parts[1], 4096))).role === 'anon';
  } catch {
    return false;
  }
}

async function guardAssertion({credential, challenge, rpId, origin}) {
  requireValue(credential && credential.type === 'public-key' && credential.id === credential.rawId &&
    credential.response && typeof challenge === 'string', 'native_assertion');
  decode(credential.id, 1024);
  requireValue(decode(challenge, 128).length >= 16, 'native_assertion');
  let client;
  try {
    client = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(decode(credential.response.clientDataJSON)));
  } catch {
    throw new NativeError('native_assertion');
  }
  requireValue(client && client.type === 'webauthn.get' && client.challenge === challenge &&
    client.origin === origin && (client.crossOrigin === undefined || client.crossOrigin === false) &&
    (client.topOrigin === undefined || client.topOrigin === origin), 'native_assertion');
  const authenticator = decode(credential.response.authenticatorData);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(rpId)));
  requireValue(authenticator.length >= 37 && digest.every((byte, index) => byte === authenticator[index]) &&
    (authenticator[32] & 0x05) === 0x05, 'native_assertion');
  decode(credential.response.signature, 8192);
  if (credential.response.userHandle !== undefined && credential.response.userHandle !== null) {
    decode(credential.response.userHandle, 128);
  }
}

function confirmedIdentity(user, expectedId) {
  requireValue(user && UUID.test(user.id) && user.id === expectedId && user.is_anonymous === false &&
    typeof user.email === 'string' && user.email.length <= 320 &&
    /^[^\s@]+@[^\s@]+$/.test(user.email) && typeof user.email_confirmed_at === 'string' &&
    Number.isFinite(Date.parse(user.email_confirmed_at)), 'native_identity');
  const metadata = user.user_metadata;
  const rawName = metadata?.full_name || metadata?.name || metadata?.display_name;
  const name = typeof rawName === 'string' ? rawName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';
  return {sub: 'native:' + user.id, name: name || 'Участник Pablicus', email: user.email, email_verified: true};
}

export function createNative({supabaseUrl, apiKey, rpId, origin, fetchImpl = fetch}) {
  let base;
  let app;
  try {
    base = new URL(supabaseUrl);
    app = new URL(origin);
  } catch {
    throw new NativeError('native_configuration');
  }
  requireValue(base.protocol === 'https:' && base.pathname === '/' && !base.search && !base.hash &&
    !base.username && !base.password && app.protocol === 'https:' && app.origin === origin &&
    app.hostname === rpId && publicApiKey(apiKey) && typeof fetchImpl === 'function', 'native_configuration');
  const baseUrl = base.origin;

  async function request(path, {method = 'GET', body, token, empty = false, errorCode = 'native_unavailable'} = {}) {
    try {
      const headers = {apikey: apiKey, Accept: 'application/json'};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = 'Bearer ' + token;
      const response = await fetchImpl(baseUrl + path, {
        method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000),
      });
      requireValue(response.ok, errorCode);
      if (empty) return null;
      // Never read or propagate an upstream error body, which may contain tokens.
      return await response.json();
    } catch {
      throw new NativeError(errorCode);
    }
  }

  async function startAuthentication() {
    const result = await request('/auth/v1/passkeys/authentication/options', {
      method: 'POST', body: {gotrue_meta_security: {}}, errorCode: 'native_options',
    });
    let expiresAt;
    try {
      // auth-js 2.105.0 declares expires_at as a number (Unix seconds).
      // Normalize it for the store's ISO contract, with our own short lifetime.
      const now = Date.now();
      const upstreamExpiry = result?.expires_at === undefined ? now + 120000 :
        typeof result.expires_at === 'number' ? result.expires_at * 1000 :
          typeof result.expires_at === 'string' ? Date.parse(result.expires_at) : NaN;
      requireValue(result && typeof result.challenge_id === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(result.challenge_id) && result.options?.rpId === rpId &&
        decode(result.options.challenge, 128).length >= 16 &&
        Number.isFinite(upstreamExpiry) && upstreamExpiry > now, 'native_options');
      expiresAt = new Date(Math.min(upstreamExpiry, now + 120000)).toISOString();
    } catch {
      throw new NativeError('native_options');
    }
    return {
      challenge_id: result.challenge_id,
      options: {...result.options, userVerification: 'required'},
      expires_at: expiresAt,
    };
  }

  async function verifyAuthentication({challengeId, credential, challenge}) {
    requireValue(typeof challengeId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(challengeId), 'native_assertion');
    await guardAssertion({credential, challenge, rpId, origin});
    const candidate = await request('/auth/v1/passkeys/authentication/verify', {
      method: 'POST', body: {challenge_id: challengeId, credential}, errorCode: 'native_assertion',
    });
    // Raw REST verification returns a session at the top level (the SDK wraps it).
    const token = candidate?.access_token;
    requireValue(typeof token === 'string' && /^[A-Za-z0-9._-]{1,16384}$/.test(token), 'native_identity');
    try {
      requireValue(candidate?.user && UUID.test(candidate.user.id), 'native_identity');
      const user = await request('/auth/v1/user', {token, errorCode: 'native_identity'});
      const userinfo = confirmedIdentity(user, candidate.user.id);
      const profiles = await request('/rest/v1/profiles?select=id,is_approved&id=eq.' + encodeURIComponent(user.id), {
        token, errorCode: 'native_approval',
      });
      requireValue(Array.isArray(profiles) && profiles.length === 1 && profiles[0]?.id === user.id &&
        profiles[0]?.is_approved === true, 'native_approval');
      return userinfo;
    } finally {
      // scope=local revokes only this temporary session, never another device.
      // Cleanup failure overrides success so a bridge OAuth code is not issued.
      await request('/auth/v1/logout?scope=local', {
        method: 'POST', token, empty: true, errorCode: 'native_cleanup',
      });
    }
  }

  return Object.freeze({startAuthentication, verifyAuthentication});
}
