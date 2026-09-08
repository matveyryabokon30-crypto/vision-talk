const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const safeMessages = Object.freeze({
  unavailable: 'Вход временно недоступен. Попробуйте позже.',
  invalid_request: 'Не удалось продолжить вход. Начните заново.',
  invalid_client: 'Не удалось подтвердить приложение.',
  invalid_grant: 'Эта попытка входа истекла или уже использована. Начните заново.',
  invalid_token: 'Подтверждение входа истекло.',
  forbidden_origin: 'Откройте вход на сайте Pablicus.',
  method_not_allowed: 'Этот способ запроса не поддерживается.',
  not_found: 'Страница входа не найдена.',
  rate_limited: 'Слишком много попыток. Подождите немного и повторите.',
  verification_failed: 'Не удалось подтвердить ключ. Начните вход заново.',
});
class BoundaryError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new BoundaryError(code, status); };
const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};
const uniqueParams = params => {
  const seen = new Set();
  for (const key of params.keys()) { if (seen.has(key)) fail('invalid_request'); seen.add(key); }
  return params;
};

export const productionConfig = Object.freeze({
  clientId: 'pablicus-web',
  callback: 'https://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback',
  apiBase: 'https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/pablicus-passkey',
  page: 'https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/passkey-start.html',
  origin: 'https://matveyryabokon30-crypto.github.io',
  rpId: 'matveyryabokon30-crypto.github.io',
});

// Supabase's gateway strips /functions/v1; the runtime route is prefixed by
// the function name. Rebuild only that known route on the pinned public API.
// Host/X-Forwarded-* headers never select a relying party or callback.
export function createEdgeAdapter(handler, config = productionConfig) {
  const base = new URL(config.apiBase);
  const shortPrefix = '/' + base.pathname.split('/').filter(Boolean).at(-1);
  return request => {
    const input = new URL(request.url);
    let suffix;
    if (input.pathname.startsWith(base.pathname + '/')) suffix = input.pathname.slice(base.pathname.length);
    else if (input.pathname.startsWith(shortPrefix + '/')) suffix = input.pathname.slice(shortPrefix.length);
    else return new Response(JSON.stringify({ error: 'not_found', message: safeMessages.not_found }), { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });
    const target = new URL(config.apiBase + suffix);
    target.search = input.search;
    return handler(new Request(target, request));
  };
}

export function createHandler({ store, webauthn, native, config = productionConfig, crypto = globalThis.crypto, now = () => Date.now() }) {
  const base = new URL(config.apiBase);
  const page = new URL(config.page);
  const origin = new URL(config.origin);
  if (base.protocol !== 'https:' || page.protocol !== 'https:' || new URL(config.callback).protocol !== 'https:' || page.origin !== config.origin || origin.hostname !== config.rpId || origin.origin !== config.origin || page.hash || page.search || base.search || base.hash || !config.clientId) throw new Error('invalid_provider_config');
  const browserRoutes = new Set(['/registration/options', '/registration/verify', '/authentication/options', '/authentication/verify']);
  const routes = new Map([['/health', 'GET'], ['/authorize', 'GET'], ['/token', 'POST'], ['/userinfo', 'GET'], ...Array.from(browserRoutes, route => [route, 'POST'])]);
  const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  const hash = async value => Array.from(await digest(value), byte => byte.toString(16).padStart(2, '0')).join('');
  const expiry = seconds => new Date(now() + seconds * 1000).toISOString();
  const bearer = request => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) fail('invalid_token', 401);
    return token;
  };
  const headers = request => {
    const result = new Headers({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin', 'Content-Type': 'application/json; charset=utf-8' });
    if (request.headers.get('origin') === config.origin) result.set('Access-Control-Allow-Origin', config.origin);
    return result;
  };
  const response = (request, body, status = 200, extra = {}) => {
    const resultHeaders = headers(request);
    for (const [key, value] of Object.entries(extra)) resultHeaders.set(key, String(value));
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: resultHeaders });
  };
  const readBody = async (request, type, maxBytes) => {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== type) fail('invalid_request');
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) fail('invalid_request', 413);
    const reader = request.body?.getReader();
    if (!reader) fail('invalid_request');
    let length = 0; const parts = [];
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > maxBytes) { await reader.cancel(); fail('invalid_request', 413); }
        parts.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('invalid_request'); }
  };
  const rate = async (key, limit, windowSeconds) => {
    if (!await store.rateLimit({ key, limit, windowSeconds })) fail('rate_limited', 429);
  };
  const flowContext = async request => {
    let body;
    try { body = JSON.parse(await readBody(request, 'application/json', 65536)); } catch (error) { if (error instanceof BoundaryError) throw error; fail('invalid_request'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !UUID.test(body.flowId ?? '')) fail('invalid_request');
    const secretHash = await hash(bearer(request));
    await rate(`flow:${body.flowId}`, 12, 60);
    const flow = await store.readFlow({ id: body.flowId, secretHash });
    if (!flow) fail('invalid_grant');
    return { body, flow, secretHash };
  };
  const credentialShape = credential => {
    if (!credential || typeof credential !== 'object' || credential.type !== 'public-key' || typeof credential.id !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(credential.id) || credential.rawId !== credential.id || !credential.response || typeof credential.response !== 'object') fail('verification_failed');
  };
  const redirect = (code, state) => {
    const target = new URL(config.callback);
    target.searchParams.set('code', code); target.searchParams.set('state', state);
    return target.href;
  };
  const issueCode = async (flow, complete, data) => {
    const code = random();
    const completed = await complete({ ...data, flowId: flow.id, codeHash: await hash(code), codeExpiresAt: expiry(60) });
    if (!completed) fail('invalid_grant');
    return { redirectTo: redirect(code, flow.state) };
  };

  return async function handle(request) {
    try {
      const url = new URL(request.url);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + '/')) fail('not_found', 404);
      const route = url.pathname.slice(base.pathname.length);
      if (!routes.has(route)) fail('not_found', 404);
      if (browserRoutes.has(route)) {
        if (request.headers.get('origin') !== config.origin) fail('forbidden_origin', 403);
        if (url.search) fail('invalid_request');
        if (request.method === 'OPTIONS') return response(request, null, 204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Max-Age': '300' });
      }
      if (request.method !== routes.get(route)) fail('method_not_allowed', 405);
      const setup = await store.config();
      if (!setup || setup.enabled !== true || setup.clientId !== config.clientId || !HASH.test(setup.secretHash ?? '')) fail('unavailable', 503);
      if (route === '/health') return response(request, { status: 'ok' });
      // No forwarded-header trust assumptions: global + authenticated-flow budgets
      // remain effective even when no trustworthy platform client address is available.
      await rate('global:requests', 180, 60);

      if (route === '/authorize') {
        if (url.search.length > 4096) fail('invalid_request');
        const q = uniqueParams(url.searchParams);
        if (q.get('client_id') !== config.clientId || q.get('response_type') !== 'code' || q.get('redirect_uri') !== config.callback || q.get('code_challenge_method') !== 'S256' || !SECRET.test(q.get('code_challenge') ?? '')) fail('invalid_request');
        const state = q.get('state');
        if (!state || state.length > 2048 || /[\u0000-\u001f\u007f]/.test(state)) fail('invalid_request');
        await rate('global:new-flow', 60, 60);
        const flowId = crypto.randomUUID(); const secret = random();
        const created = await store.createFlow({ id: flowId, secretHash: await hash(secret), state, codeChallenge: q.get('code_challenge'), redirectUri: config.callback, expiresAt: expiry(300) });
        if (created !== true) fail('unavailable', 503);
        const target = new URL(config.page);
        target.hash = new URLSearchParams({ flow: flowId, secret }).toString();
        return response(request, {}, 303, { Location: target.href });
      }

      if (browserRoutes.has(route)) {
        const { body, flow, secretHash } = await flowContext(request);
        const kind = route.startsWith('/registration/') ? 'registration' : 'authentication';
        if (route.endsWith('/options')) {
          // Limit options issuance within each fixed two-second server bucket.
          // Browser single-flight prevents ordinary double clicks; an accepted
          // retry replaces the previous challenge, including across a boundary.
          await rate(`options:${flow.id}`, 1, 2);
          let options; let subjectId = null; let name = null; let nativeChallengeId = null; let expiresAt = expiry(120);
          if (kind === 'registration') {
            if (typeof body.name !== 'string') fail('invalid_request');
            name = body.name.trim().normalize('NFC');
            if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) fail('invalid_request');
            subjectId = crypto.randomUUID();
            options = await webauthn.registrationOptions({ subjectId, name });
            if (options?.rp?.id !== config.rpId || options?.authenticatorSelection?.residentKey !== 'required' || options?.authenticatorSelection?.userVerification !== 'required') fail('unavailable', 503);
          } else {
            let result;
            try { result = await native.startAuthentication(); } catch { fail('unavailable', 503); }
            options = result?.options; nativeChallengeId = result?.challenge_id;
            if (options?.rpId !== config.rpId || typeof nativeChallengeId !== 'string' || nativeChallengeId.length < 1 || nativeChallengeId.length > 256) fail('unavailable', 503);
            const upstreamExpiry = Date.parse(result.expires_at);
            if (!Number.isFinite(upstreamExpiry) || upstreamExpiry <= now()) fail('unavailable', 503);
            expiresAt = new Date(Math.min(upstreamExpiry, now() + 120000)).toISOString();
            // Both the existing native credentials and our new discoverable keys
            // use this RP. Do not restrict the browser to one registry's IDs.
            options = { ...options, allowCredentials: [], userVerification: 'required' };
          }
          if (typeof options?.challenge !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(options.challenge)) fail('unavailable', 503);
          if (!await store.setChallenge({ id: flow.id, secretHash, kind, challenge: options.challenge, nativeChallengeId, subjectId, name, expiresAt })) fail('invalid_grant');
          return response(request, { options });
        }

        const claimed = await store.claimChallenge({ id: flow.id, secretHash, kind });
        if (!claimed) fail('invalid_grant');
        credentialShape(body.credential);
        if (kind === 'registration') {
          let verified;
          try { verified = await webauthn.verifyRegistration({ credential: body.credential, challenge: claimed.challenge }); } catch { fail('verification_failed'); }
          if (verified?.credentialId !== body.credential.id) fail('verification_failed');
          return response(request, await issueCode(claimed, data => store.completeRegistration(data), { subjectId: claimed.subjectId, name: claimed.name, credential: verified }));
        }

        const storedCredential = await store.findCredential({ credentialId: body.credential.id });
        let proof = null;
        if (storedCredential) {
          try { proof = await webauthn.verifyAuthentication({ credential: body.credential, challenge: claimed.challenge, storedCredential }); } catch { /* Native verifier can prove a real credential even if an own ID collides. */ }
        }
        if (proof && Number.isSafeInteger(proof.newCounter) && proof.newCounter >= 0) {
          return response(request, await issueCode(claimed, data => store.completeAuthentication(data), {
            subjectId: storedCredential.subjectId, name: storedCredential.name, credentialId: storedCredential.credentialId,
            oldCounter: storedCredential.counter, newCounter: proof.newCounter,
            userinfo: { sub: storedCredential.subjectId, name: storedCredential.name },
          }));
        }
        let userinfo;
        try { userinfo = await native.verifyAuthentication({ challengeId: claimed.nativeChallengeId, challenge: claimed.challenge, credential: body.credential }); } catch { fail('verification_failed'); }
        if (!userinfo || typeof userinfo.sub !== 'string' || !userinfo.sub.startsWith('native:') || !UUID.test(userinfo.sub.slice(7)) || userinfo.email_verified !== true || typeof userinfo.email !== 'string' || !userinfo.email.includes('@')) fail('verification_failed');
        const trusted = { sub: userinfo.sub, name: typeof userinfo.name === 'string' ? userinfo.name.slice(0, 80) : 'Pablicus', email: userinfo.email, email_verified: true };
        return response(request, await issueCode(claimed, data => store.completeAuthentication(data), { subjectId: trusted.sub, name: trusted.name, credentialId: null, oldCounter: null, newCounter: null, userinfo: trusted }));
      }

      if (route === '/token') {
        if (url.search) fail('invalid_request');
        const form = uniqueParams(new URLSearchParams(await readBody(request, 'application/x-www-form-urlencoded', 8192)));
        let clientId = form.get('client_id'); let secret = form.get('client_secret');
        const authorization = request.headers.get('authorization');
        if (authorization) {
          if (clientId || secret || !authorization.startsWith('Basic ')) fail('invalid_client', 401);
          let decoded;
          try { decoded = atob(authorization.slice(6)); } catch { fail('invalid_client', 401); }
          const separator = decoded.indexOf(':');
          if (separator < 0) fail('invalid_client', 401);
          try { clientId = decodeURIComponent(decoded.slice(0, separator)); secret = decodeURIComponent(decoded.slice(separator + 1)); } catch { fail('invalid_client', 401); }
        }
        if (clientId !== config.clientId || typeof secret !== 'string' || secret.length < 16 || secret.length > 512 || !same(await hash(secret), setup.secretHash)) fail('invalid_client', 401);
        const code = form.get('code'); const verifier = form.get('code_verifier');
        if (form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== config.callback || !SECRET.test(code ?? '') || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier ?? '')) fail('invalid_grant');
        const token = random();
        const exchanged = await store.exchangeCode({ codeHash: await hash(code), codeChallenge: base64url(await digest(verifier)), redirectUri: config.callback, clientId, tokenHash: await hash(token), tokenExpiresAt: expiry(60) });
        if (!exchanged) fail('invalid_grant');
        return response(request, { access_token: token, token_type: 'Bearer', expires_in: 60 });
      }

      if (route === '/userinfo') {
        if (url.search) fail('invalid_request');
        const info = await store.userinfo({ tokenHash: await hash(bearer(request)) });
        if (!info || typeof info.sub !== 'string') fail('invalid_token', 401);
        return response(request, info);
      }
      throw new BoundaryError('not_found', 404);
    } catch (error) {
      const code = error instanceof BoundaryError ? error.code : 'unavailable';
      const status = error instanceof BoundaryError ? error.status : 503;
      return response(request, { error: code, message: safeMessages[code] }, status, status === 429 ? { 'Retry-After': '2' } : {});
    }
  };
}
