import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import * as library from '@simplewebauthn/server';
import { createHandler, createEdgeAdapter, productionConfig as config } from './handler.mjs';
import { createWebAuthn } from './webauthn.mjs';

const hex = value => createHash('sha256').update(value).digest('hex');
const digest = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');
const CLIENT_SECRET = 'EXPLICIT_LOCAL_FIXTURE_CLIENT_SECRET_ONLY';
const VERIFIER = 'EXPLICIT_FIXTURE_PKCE_VERIFIER_12345678901234567890';
const NATIVE_UID = '4b27e210-ecf2-4ade-9960-6e7f304ad959';

// Test-only in-memory implementation of the atomic store contract. Production
// always uses store.mjs and the service-role-only PostgreSQL RPC.
function fixtureStore(clock) {
  const flows = new Map(); const keys = new Map(); const codes = new Map(); const tokens = new Map(); const buckets = new Map();
  const active = id => { const f = flows.get(id); return f && !f.completed && Date.parse(f.expiresAt) > clock() ? f : null; };
  const ready = id => { const f = active(id); return f?.claimed ? f : null; };
  let enabled = true;
  const saveCode = (flow, input, userinfo) => {
    flow.completed = true;
    codes.set(input.codeHash, { userinfo, codeChallenge: flow.codeChallenge, redirectUri: flow.redirectUri, expiresAt: input.codeExpiresAt });
    return true;
  };
  return {
    flows, keys, codes, tokens, setEnabled: value => { enabled = value; },
    async config() { return { clientId: config.clientId, secretHash: hex(CLIENT_SECRET), enabled }; },
    async createFlow(input) { assert.ok(!flows.has(input.id)); flows.set(input.id, { ...input, completed: false, claimed: false }); return true; },
    async readFlow({ id, secretHash }) { const f = active(id); return f?.secretHash === secretHash ? { ...f } : null; },
    async setChallenge(input) {
      const f = active(input.id); if (!f || f.secretHash !== input.secretHash || f.claimed) return false;
      const { expiresAt, ...rest } = input;
      Object.assign(f, rest, { challengeExpiresAt: expiresAt }); return true;
    },
    async claimChallenge({ id, secretHash, kind }) {
      const f = active(id);
      if (!f || f.secretHash !== secretHash || f.kind !== kind || f.claimed || Date.parse(f.challengeExpiresAt) <= clock()) return null;
      f.claimed = true; return { ...f };
    },
    async findCredential({ credentialId }) { return keys.get(credentialId) ?? null; },
    async completeRegistration(input) {
      const f = ready(input.flowId);
      if (!f || f.kind !== 'registration' || f.subjectId !== input.subjectId || f.name !== input.name || keys.has(input.credential.credentialId)) return false;
      keys.set(input.credential.credentialId, { ...input.credential, subjectId: input.subjectId, name: input.name });
      return saveCode(f, input, { sub: input.subjectId, name: input.name });
    },
    async completeAuthentication(input) {
      const f = ready(input.flowId); if (!f || f.kind !== 'authentication') return false;
      if (input.credentialId) {
        const key = keys.get(input.credentialId);
        if (!key || key.subjectId !== input.subjectId || key.counter !== input.oldCounter) return false;
        key.counter = input.newCounter;
      }
      return saveCode(f, input, input.userinfo);
    },
    async exchangeCode(input) {
      const code = codes.get(input.codeHash);
      if (!code || code.used || Date.parse(code.expiresAt) <= clock() || input.clientId !== config.clientId || code.codeChallenge !== input.codeChallenge || code.redirectUri !== input.redirectUri) return false;
      code.used = true; tokens.set(input.tokenHash, { userinfo: code.userinfo, expiresAt: input.tokenExpiresAt }); return true;
    },
    async userinfo({ tokenHash }) { const token = tokens.get(tokenHash); return token && Date.parse(token.expiresAt) > clock() ? token.userinfo : null; },
    async rateLimit({ key, limit, windowSeconds }) {
      const label = key + ':' + Math.floor(clock() / (windowSeconds * 1000));
      const count = (buckets.get(label) ?? 0) + 1; buckets.set(label, count); return count <= limit;
    },
  };
}

function fixture() {
  let time = Date.now(); const store = fixtureStore(() => time);
  const nativeCalls = []; let nativeProof = null;
  const native = {
    async startAuthentication() { return { challenge_id: crypto.randomUUID(), options: { rpId: config.rpId, challenge: b64(randomBytes(32)), userVerification: 'preferred' }, expires_at: new Date(time + 120000).toISOString() }; },
    async verifyAuthentication(input) { nativeCalls.push(input); if (!nativeProof) throw new Error('FIXTURE_UPSTREAM_PRIVATE_TOKEN'); return nativeProof; },
  };
  const webauthn = createWebAuthn({ library, rpId: config.rpId, origin: config.origin });
  const handle = createHandler({ store, webauthn, native, config, now: () => time });
  const request = (route, init = {}) => handle(new Request(config.apiBase + route, init));
  async function authorize(overrides = {}) {
    const params = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: config.callback, state: 'FIXTURE_STATE_123456789', code_challenge: b64(digest(VERIFIER)), code_challenge_method: 'S256', ...overrides });
    const result = await request('/authorize?' + params);
    if (result.status !== 303) return { result };
    const target = new URL(result.headers.get('location'));
    const fragment = new URLSearchParams(target.hash.slice(1));
    return { result, flowId: fragment.get('flow'), secret: fragment.get('secret'), target };
  }
  const post = (route, flow, body = {}, headers = {}) => request(route, { method: 'POST', headers: { Origin: config.origin, Authorization: 'Bearer ' + flow.secret, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ flowId: flow.flowId, ...body }) });
  const exchange = (code, overrides = {}, headers = {}) => request('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ client_id: config.clientId, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: config.callback, ...overrides }) });
  return { store, nativeCalls, handle, request, authorize, post, exchange, setNativeProof: proof => { nativeProof = proof; }, advance: ms => { time += ms; } };
}

// Minimal test-only CBOR encoder constructs an attestation from a real local
// ES256 key. Authentication signatures are checked by the pinned real library.
function cbor(value) {
  function head(major, count) {
    if (count < 24) return Buffer.from([(major << 5) | count]);
    if (count < 256) return Buffer.from([(major << 5) | 24, count]);
    const result = Buffer.alloc(3); result[0] = (major << 5) | 25; result.writeUInt16BE(count, 1); return result;
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([head(3, bytes.length), bytes]); }
  if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -value - 1);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...Array.from(value, ([key, val]) => Buffer.concat([cbor(key), cbor(val)]))]);
  throw new Error('unsupported_fixture_cbor');
}
function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const key = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const id = randomBytes(32); let subject;
  function data(type, options, overrides) { return Buffer.from(JSON.stringify({ type, challenge: options.challenge, origin: config.origin, crossOrigin: false, ...overrides })); }
  return {
    id: b64(id),
    registration(options, { rpId = config.rpId, flags = 0x45, client = {} } = {}) {
      subject = options.user.id;
      const length = Buffer.alloc(2); length.writeUInt16BE(id.length);
      const authData = Buffer.concat([digest(rpId), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), length, id, key]);
      return { id: b64(id), rawId: b64(id), type: 'public-key', response: { clientDataJSON: b64(data('webauthn.create', options, client)), attestationObject: b64(cbor(new Map([['fmt', 'none'], ['authData', authData], ['attStmt', new Map()]]))), transports: ['internal'] }, clientExtensionResults: { credProps: { rk: true } } };
    },
    authentication(options, { rpId = config.rpId, flags = 0x05, counter = 1, client = {}, wrongSignature = false, userHandle = subject } = {}) {
      const count = Buffer.alloc(4); count.writeUInt32BE(counter);
      const authenticatorData = Buffer.concat([digest(rpId), Buffer.from([flags]), count]);
      const clientData = data('webauthn.get', options, client);
      const signature = sign('sha256', Buffer.concat([authenticatorData, digest(clientData)]), privateKey);
      if (wrongSignature) signature[signature.length - 1] ^= 1;
      return { id: b64(id), rawId: b64(id), type: 'public-key', response: { clientDataJSON: b64(clientData), authenticatorData: b64(authenticatorData), signature: b64(signature), userHandle }, clientExtensionResults: {} };
    },
  };
}
async function enrolled(f, device = authenticator()) {
  const flow = await f.authorize();
  const optionsResponse = await f.post('/registration/options', flow, { name: 'Катя' });
  assert.equal(optionsResponse.status, 200); const { options } = await optionsResponse.json();
  const credential = device.registration(options);
  const verification = await f.post('/registration/verify', flow, { credential });
  assert.equal(verification.status, 200);
  const redirectTo = new URL((await verification.json()).redirectTo);
  return { device, flow, credential, code: redirectTo.searchParams.get('code'), subject: Buffer.from(options.user.id, 'base64url').toString(), redirectTo };
}

test('authorize uses exact redirect, S256 and one-use secret in fragment only', async () => {
  const f = fixture(); const flow = await f.authorize();
  assert.equal(flow.result.status, 303); assert.equal(flow.target.origin, config.origin);
  assert.equal(flow.target.pathname, new URL(config.page).pathname); assert.equal(flow.target.search, '');
  assert.equal(flow.result.headers.get('cache-control'), 'no-store');
  const stored = f.store.flows.get(flow.flowId);
  assert.equal(stored.secretHash, hex(flow.secret)); assert.ok(!JSON.stringify(stored).includes(flow.secret));
  for (const overrides of [{ redirect_uri: config.callback + '/evil' }, { code_challenge_method: 'plain' }, { client_id: 'evil' }, { response_type: 'token' }, { code_challenge: 'short' }, { state: '' }]) assert.equal((await f.authorize(overrides)).result.status, 400);
  const duplicate = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: config.callback, state: 's', code_challenge: b64(digest(VERIFIER)), code_challenge_method: 'S256' }); duplicate.append('client_id', config.clientId);
  assert.equal((await f.request('/authorize?' + duplicate)).status, 400);
});

test('authorize never redirects when persistence declines or becomes unavailable after setup lookup', async () => {
  for (const result of [false, null]) {
    const f = fixture();
    f.store.createFlow = async () => result;
    const flow = await f.authorize();
    assert.equal(flow.result.status, 503);
    assert.equal(flow.result.headers.get('location'), null);
    assert.deepEqual(await flow.result.json(), { error: 'unavailable', message: 'Вход временно недоступен. Попробуйте позже.' });
    assert.equal(f.store.flows.size, 0);
  }
});

test('real key enrollment, confidential token exchange and no-email userinfo', async () => {
  const f = fixture(); const enrollment = await enrolled(f);
  assert.equal(enrollment.redirectTo.origin + enrollment.redirectTo.pathname, config.callback);
  assert.equal(enrollment.redirectTo.searchParams.get('state'), 'FIXTURE_STATE_123456789');
  const exchanged = await f.exchange(enrollment.code); assert.equal(exchanged.status, 200);
  const token = await exchanged.json(); assert.equal(token.token_type, 'Bearer'); assert.equal(token.expires_in, 60);
  const info = await f.request('/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } });
  assert.deepEqual(await info.json(), { sub: enrollment.subject, name: 'Катя' });
  assert.equal(f.store.keys.size, 1); assert.equal(f.nativeCalls.length, 0);
  assert.ok(!JSON.stringify([...f.store.tokens]).includes(token.access_token));
  assert.equal((await f.post('/registration/verify', enrollment.flow, { credential: enrollment.credential })).status, 400);
  assert.equal((await f.exchange(enrollment.code)).status, 400);
});

test('real ES256 assertion returns the same subject and advances the counter', async () => {
  const f = fixture(); const enrollment = await enrolled(f); const flow = await f.authorize();
  const { options } = await (await f.post('/authentication/options', flow)).json();
  assert.equal(options.userVerification, 'required'); assert.deepEqual(options.allowCredentials, []);
  const credential = enrollment.device.authentication(options);
  const response = await f.post('/authentication/verify', flow, { credential }); assert.equal(response.status, 200);
  const code = new URL((await response.json()).redirectTo).searchParams.get('code');
  const token = await (await f.exchange(code)).json();
  assert.deepEqual(await (await f.request('/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } })).json(), { sub: enrollment.subject, name: 'Катя' });
  assert.equal(f.store.keys.get(enrollment.device.id).counter, 1); assert.equal(f.nativeCalls.length, 0);
  assert.equal((await f.post('/authentication/verify', flow, { credential })).status, 400);
});

test('wrong RP, origin, challenge, UV and cross-origin registration consume the operation', async () => {
  for (const mutation of [{ rpId: 'evil.example' }, { flags: 0x41 }, { client: { origin: 'https://evil.example' } }, { client: { challenge: b64(randomBytes(32)) } }, { client: { crossOrigin: true } }]) {
    const f = fixture(); const flow = await f.authorize(); const device = authenticator();
    const { options } = await (await f.post('/registration/options', flow, { name: 'Катя' })).json();
    const credential = device.registration(options, mutation);
    assert.equal((await f.post('/registration/verify', flow, { credential })).status, 400);
    f.advance(2100);
    assert.equal((await f.post('/registration/options', flow, { name: 'Катя' })).status, 400);
    assert.equal(f.store.keys.size, 0);
  }
});

test('wrong signature, RP, UV, origin, userHandle and replay counter cannot authenticate an own key', async () => {
  for (const mutation of [{ wrongSignature: true }, { rpId: 'evil.example' }, { flags: 1 }, { client: { origin: 'https://evil.example' } }, { userHandle: b64('another-subject') }]) {
    const f = fixture(); const enrollment = await enrolled(f); const flow = await f.authorize();
    const { options } = await (await f.post('/authentication/options', flow)).json();
    const response = await f.post('/authentication/verify', flow, { credential: enrollment.device.authentication(options, mutation) });
    assert.equal(response.status, 400); assert.equal((await response.json()).error, 'verification_failed');
    assert.equal(f.store.keys.get(enrollment.device.id).counter, 0); assert.equal(f.store.codes.size, 1);
  }
  const f = fixture(); const enrollment = await enrolled(f); f.store.keys.get(enrollment.device.id).counter = 3;
  const flow = await f.authorize(); const { options } = await (await f.post('/authentication/options', flow)).json();
  assert.equal((await f.post('/authentication/verify', flow, { credential: enrollment.device.authentication(options, { counter: 3 }) })).status, 400);
});

test('wrong Origin, missing bearer, body limits, methods and absent setup fail closed', async () => {
  const f = fixture(); const flow = await f.authorize();
  assert.equal((await f.post('/registration/options', flow, { name: 'Катя' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post('/registration/options', flow, { name: 'Катя' }, { Authorization: '' })).status, 401);
  assert.equal((await f.post('/registration/options', flow, { name: 'a'.repeat(70000) })).status, 413);
  assert.equal((await f.request('/registration/options', { headers: { Origin: config.origin } })).status, 405);
  assert.equal((await f.request('/userinfo?access_token=bad')).status, 400);
  f.store.setEnabled(false);
  assert.equal((await f.request('/health')).status, 503);
  assert.equal((await f.authorize()).result.status, 503);
});

test('PKCE mismatch and callback mismatch cannot consume a valid OAuth code; simultaneous exchanges have one winner', async () => {
  const f = fixture(); const enrollment = await enrolled(f);
  assert.equal((await f.exchange(enrollment.code, { code_verifier: 'WRONG_VERIFIER_12345678901234567890123456789012345678' })).status, 400);
  assert.equal((await f.exchange(enrollment.code, { redirect_uri: config.callback + '/wrong' })).status, 400);
  assert.equal((await f.exchange(enrollment.code, { client_secret: 'INVALID_CLIENT_SECRET_FIXTURE' })).status, 401);
  const responses = await Promise.all([f.exchange(enrollment.code), f.exchange(enrollment.code)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
});

test('HTTP Basic client authentication is supported; ambiguous credentials are rejected', async () => {
  const f = fixture(); const enrollment = await enrolled(f);
  const basic = 'Basic ' + Buffer.from(config.clientId + ':' + CLIENT_SECRET).toString('base64');
  assert.equal((await f.exchange(enrollment.code, {}, { Authorization: basic })).status, 401);
  const response = await f.request('/token', { method: 'POST', headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: enrollment.code, code_verifier: VERIFIER, redirect_uri: config.callback }) });
  assert.equal(response.status, 200);
});

test('flow, challenge, authorization code and bearer tokens expire independently', async () => {
  let f = fixture(); let flow = await f.authorize(); f.advance(301000);
  assert.equal((await f.post('/registration/options', flow, { name: 'Катя' })).status, 400);
  f = fixture(); flow = await f.authorize(); const device = authenticator();
  const { options } = await (await f.post('/registration/options', flow, { name: 'Катя' })).json(); f.advance(121000);
  assert.equal((await f.post('/registration/verify', flow, { credential: device.registration(options) })).status, 400);
  f = fixture(); let enrollment = await enrolled(f); f.advance(61000); assert.equal((await f.exchange(enrollment.code)).status, 400);
  f = fixture(); enrollment = await enrolled(f); const token = await (await f.exchange(enrollment.code)).json(); f.advance(61000);
  assert.equal((await f.request('/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } })).status, 401);
});

test('options requests within one fixed rate bucket are bounded; an accepted retry invalidates the previous challenge', async () => {
  const f = fixture(); const flow = await f.authorize(); const device = authenticator();
  const first = await f.post('/registration/options', flow, { name: 'Катя' }); const firstOptions = (await first.json()).options;
  assert.equal((await f.post('/registration/options', flow, { name: 'Катя' })).status, 429);
  f.advance(2100); const second = await f.post('/registration/options', flow, { name: 'Катя' }); assert.equal(second.status, 200);
  assert.notEqual((await second.json()).options.challenge, firstOptions.challenge);
  assert.equal((await f.post('/registration/verify', flow, { credential: device.registration(firstOptions) })).status, 400);
});

test('simultaneous registration verification has one winner and cannot replace another key', async () => {
  const f = fixture(); const flow = await f.authorize(); const device = authenticator();
  const { options } = await (await f.post('/registration/options', flow, { name: 'Катя' })).json(); const credential = device.registration(options);
  const results = await Promise.all([f.post('/registration/verify', flow, { credential }), f.post('/registration/verify', flow, { credential })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]); assert.equal(f.store.keys.size, 1);
});

test('native bridge output is proof-derived and excludes temporary sessions; failed own verification may delegate same assertion', async () => {
  const f = fixture(); const enrollment = await enrolled(f); const flow = await f.authorize();
  const proof = { sub: 'native:' + NATIVE_UID, name: 'Матвей', email: 'verified@example.test', email_verified: true, access_token: 'MUST_NOT_ESCAPE' };
  f.setNativeProof(proof);
  const { options } = await (await f.post('/authentication/options', flow)).json(); const credential = enrollment.device.authentication(options, { wrongSignature: true });
  const response = await f.post('/authentication/verify', flow, { credential, email: 'attacker@example.test', sub: 'attacker' });
  assert.equal(response.status, 200); assert.deepEqual(f.nativeCalls[0].credential, credential);
  const json = await response.json(); assert.ok(!JSON.stringify(json).includes('MUST_NOT_ESCAPE'));
  const token = await (await f.exchange(new URL(json.redirectTo).searchParams.get('code'))).json();
  const userinfo = await (await f.request('/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } })).json();
  assert.deepEqual(userinfo, { sub: proof.sub, name: proof.name, email: proof.email, email_verified: true });
});

test('native unverified identity and upstream private errors are not exposed', async () => {
  const f = fixture(); f.setNativeProof({ sub: 'native:' + NATIVE_UID, email: 'unverified@example.test', email_verified: false });
  const flow = await f.authorize(); const { options } = await (await f.post('/authentication/options', flow)).json();
  const response = await f.post('/authentication/verify', flow, { credential: authenticator().authentication(options) });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'verification_failed', message: 'Не удалось подтвердить ключ. Начните вход заново.' });
});

test('CORS preflight is exact and globally rate limited requests ignore forged IP headers', async () => {
  const f = fixture();
  const preflight = await f.request('/registration/options', { method: 'OPTIONS', headers: { Origin: config.origin } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), config.origin);
  assert.equal((await f.request('/registration/options', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 403);
  let last;
  for (let i = 0; i < 181; i++) last = await f.request('/userinfo', { headers: { Authorization: 'Bearer ' + b64(randomBytes(32)), 'X-Forwarded-For': '192.0.2.' + i } });
  assert.equal(last.status, 429);
});

test('Edge adapter handles documented function prefix without trusting incoming Host or forwarded headers', async () => {
  const f = fixture(); const edge = createEdgeAdapter(f.handle, config);
  const response = await edge(new Request('http://edge-runtime.internal/pablicus-passkey/health', { headers: { 'X-Forwarded-Host': 'evil.example' } }));
  assert.equal(response.status, 200);
  assert.equal((await edge(new Request('http://edge-runtime.internal/other-function/health'))).status, 404);
});
