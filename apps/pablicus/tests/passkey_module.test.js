'use strict';
// Execute the exact vendored SDK; only Auth HTTP and the platform authenticator
// are fixtures. These tests never contact a project or manufacture a real user.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const {webcrypto} = require('node:crypto');
const passkeys = require('../src/passkey-login.js');
const PROJECT = 'https://passkey-fixture.invalid', ORIGIN = 'https://pablicus-fixture.invalid';
const KEY = 'passkey-test';
const USER = {id: '11111111-1111-4111-8111-111111111111', email: 'test@example.invalid',
  email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false};
const OTHER = {...USER, id: '22222222-2222-4222-8222-222222222222'};
const SAVED = {id: '33333333-3333-4333-8333-333333333333', friendly_name: 'iCloud Keychain', created_at: '2026-09-08T00:00:00Z'};
const b64 = text => Buffer.from(text).toString('base64url');
const buffer = text => Uint8Array.from(Buffer.from(text)).buffer;
function session(user = USER) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {access_token: b64(JSON.stringify({alg: 'HS256', typ: 'JWT'})) + '.' +
    b64(JSON.stringify({sub: user.id, exp, aud: 'authenticated', role: 'authenticated'})) + '.fixture',
    refresh_token: 'PRIVATE_FIXTURE_REFRESH_' + user.id, expires_at: exp, expires_in: 3600, token_type: 'bearer', user};
}
function defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; }

async function fixture(settings = {}) {
  const calls = [], browserCalls = [], states = [], admitted = [], events = [], values = new Map();
  let loginUser = settings.loginUser || USER, serverUser = settings.user || USER, approved = settings.approved !== false;
  let flow;
  const storage = {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  if (settings.signedIn) values.set(KEY, JSON.stringify(session(serverUser)));
  class Credential {
    constructor(kind) {
      this.id = b64('credential-id'); this.rawId = buffer('credential-id'); this.type = 'public-key'; this.authenticatorAttachment = 'platform';
      this.response = kind === 'create' ? {clientDataJSON: buffer('client-data'), attestationObject: buffer('attestation'), getTransports: () => ['internal']} :
        {clientDataJSON: buffer('client-data'), authenticatorData: buffer('authenticator'), signature: buffer('signature'), userHandle: buffer(USER.id)};
    }
    getClientExtensionResults() { return {}; }
  }
  const registration = {challenge_id: 'registration-challenge', options: {rp: {id: 'pablicus-fixture.invalid', name: 'Pablicus'},
    challenge: b64('fresh-registration-challenge'), user: {id: b64(USER.id), name: 'test@example.invalid', displayName: 'Test'},
    pubKeyCredParams: [{type: 'public-key', alg: -7}], excludeCredentials: [{type: 'public-key', id: b64('existing-credential')}],
    authenticatorSelection: {residentKey: 'required', userVerification: 'required'}, attestation: 'none', timeout: 60000}};
  const authentication = {challenge_id: 'authentication-challenge', options: {challenge: b64('fresh-authentication-challenge'),
    rpId: 'pablicus-fixture.invalid', userVerification: 'required', timeout: 60000}};
  const runtime = {
    module: {exports: {}}, exports: {}, URL, URLSearchParams, Headers, Request, Response, AbortController, AbortSignal,
    TextEncoder, TextDecoder, ArrayBuffer, Uint8Array, crypto: webcrypto, btoa, atob, console, DOMException,
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: new URL(ORIGIN + '/pablicus/'), isSecureContext: true, PublicKeyCredential: Credential,
    document: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    addEventListener() {}, removeEventListener() {},
    navigator: {credentials: {
      async create(options) { browserCalls.push({method: 'create', options}); return settings.create ? settings.create(options, api) : new Credential('create'); },
      async get(options) { browserCalls.push({method: 'get', options}); return settings.get ? settings.get(options, api) : new Credential('get'); }
    }},
    async fetch(url, options = {}) {
      const route = new URL(String(url)).pathname.replace('/auth/v1', '');
      const call = {route, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null,
        authorization: new Headers(options.headers).get('authorization')};
      calls.push(call);
      const custom = settings.http ? await settings.http(call, api) : undefined;
      if (custom) return custom;
      let result;
      if (route === '/user') result = settings.identity ? await settings.identity(call, api) : serverUser;
      else if (route === '/passkeys/registration/options') result = registration;
      else if (route === '/passkeys/registration/verify') result = {...SAVED, private_fixture: 'MUST_NOT_REACH_UI'};
      else if (route === '/passkeys/authentication/options') result = authentication;
      else if (route === '/passkeys/authentication/verify') { serverUser = loginUser; result = session(loginUser); }
      else if (route === '/passkeys') result = settings.keys || [SAVED];
      else if (route === '/logout') return new Response(null, {status: 204});
      else throw new Error('Unexpected fixture HTTP ' + route);
      return new Response(JSON.stringify(result), {status: 200, headers: {'content-type': 'application/json'}});
    }
  };
  runtime.window = runtime; runtime.self = runtime; runtime.exports = runtime.module.exports;
  const api = {calls, browserCalls, states, admitted, events, values, runtime, Credential,
    setApproval(value) { approved = value; }, setServerUser(user) { serverUser = user; },
    async changeAccount(user) { serverUser = user; return client.auth.setSession(session(user)); }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../vendor/supabase.js'), 'utf8'), runtime,
    {filename: 'supabase-browser-bundle', timeout: 3000});
  const client = runtime.supabase.createClient(PROJECT, 'PUBLIC_FIXTURE_KEY', {auth: {
    storageKey: KEY, storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    flowType: 'pkce', experimental: {passkey: true}}, global: {fetch: runtime.fetch}});
  await client.auth.initialize();
  const isolatedValues = new Map();
  const signInClient = settings.isolatedSignIn ? runtime.supabase.createClient(PROJECT, 'PUBLIC_FIXTURE_KEY', {auth: {
    storageKey: KEY + '-pending', storage: {getItem: key => isolatedValues.get(key) || null,
      setItem: (key, value) => isolatedValues.set(key, value), removeItem: key => isolatedValues.delete(key)},
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce', experimental: {passkey: true}},
    global: {fetch: runtime.fetch}}) : undefined;
  if (signInClient) await signInClient.auth.initialize();
  flow = passkeys.create({client, signInClient, enabled: settings.enabled !== undefined ? settings.enabled : true, environment: runtime,
    getAccount: async ({userId}) => {
      calls.push({route: 'profile', userId});
      return settings.getAccount ? settings.getAccount({userId}, api) : {id: userId, approved};
    },
    authenticate: async (candidate, context) => {
      admitted.push({session: candidate, context});
      return settings.authenticate ? settings.authenticate(candidate, context, api) : true;
    },
    onChange: state => states.push(state)});
  client.auth.onAuthStateChange((event, current) => events.push({event, id: current?.user?.id, state: flow.snapshot()}));
  return Object.assign(api, {client, signInClient, isolatedValues, flow, registration, authentication});
}

test('server readiness and secure WebAuthn support are mandatory before any request', async () => {
  let count = 0;
  const client = {auth: {signInWithPasskey() { count++; }, passkey: {startRegistration() { count++; }}}};
  const good = {isSecureContext: true, AbortController, atob, btoa, PublicKeyCredential: function () {}, navigator: {credentials: {create() {}, get() {}}}};
  for (const enabled of [undefined, false, 'true', 1]) {
    const flow = passkeys.create({client, enabled, environment: good});
    assert.equal(await flow.signIn(), false); assert.equal(await flow.register(), false);
    assert.equal(flow.snapshot().message, passkeys.messages.unavailable);
  }
  for (const env of [{...good, isSecureContext: false}, {...good, PublicKeyCredential: undefined},
    {...good, navigator: {credentials: {get() {}}}}, {...good, navigator: undefined}, {...good, AbortController: undefined}]) {
    const flow = passkeys.create({client, enabled: true, environment: env});
    assert.equal(await flow.signIn(), false); assert.equal(flow.snapshot().supported, false);
  }
  assert.equal(count, 0);
});

test('enrollment uses official challenge and verify endpoints after confirmed-account approval', async () => {
  const f = await fixture({signedIn: true});
  const key = await f.flow.register();
  assert.equal(key.id, SAVED.id);
  assert.equal(f.flow.snapshot().busy, false);
  assert.equal(f.flow.snapshot().phase, 'success');
  assert.equal(f.browserCalls.length, 1);
  const native = f.browserCalls[0].options.publicKey;
  assert.equal(Buffer.from(native.challenge).toString(), 'fresh-registration-challenge');
  assert.equal(Buffer.from(native.user.id).toString(), USER.id);
  assert.equal(Buffer.from(native.excludeCredentials[0].id).toString(), 'existing-credential');
  assert.equal(native.authenticatorSelection.userVerification, 'required');
  const optionsIndex = f.calls.findIndex(call => call.route === '/passkeys/registration/options');
  assert.ok(f.calls.slice(0, optionsIndex).some(call => call.route === 'profile'));
  const verification = f.calls.find(call => call.route === '/passkeys/registration/verify');
  assert.equal(verification.method, 'POST');
  assert.equal(verification.body.challenge_id, 'registration-challenge');
  assert.equal(verification.body.credential.rawId, b64('credential-id'));
  assert.equal(verification.body.credential.response.attestationObject, b64('attestation'));
  assert.equal(verification.body.credential.response.clientDataJSON, b64('client-data'));
  assert.ok(verification.authorization.startsWith('Bearer '));
  assert.deepEqual(f.calls.filter(call => /signup|admin|otp|password|verify$/.test(call.route)).map(call => call.route), ['/passkeys/registration/verify']);
  assert.equal(f.admitted.length, 0);
  assert.ok(!JSON.stringify(f.states).match(/PRIVATE_FIXTURE|MUST_NOT_REACH_UI|attestation|access_token|refresh_token/));
  f.flow.destroy();
});

test('discoverable sign-in stores SDK session but host gate sees it only after server identity validation', async () => {
  const f = await fixture();
  assert.equal(await f.flow.signIn(), true);
  assert.equal(f.browserCalls.length, 1);
  const native = f.browserCalls[0];
  assert.equal(native.method, 'get');
  assert.equal(Buffer.from(native.options.publicKey.challenge).toString(), 'fresh-authentication-challenge');
  assert.equal(native.options.publicKey.allowCredentials, undefined);
  assert.equal(native.options.publicKey.userVerification, 'required');
  const signed = f.events.find(event => event.event === 'SIGNED_IN');
  assert.equal(signed.state.busy, true); assert.equal(signed.state.operation, 'signIn'); assert.equal(signed.state.validated, false);
  assert.equal(f.calls.at(-1).route, '/user');
  assert.equal(f.admitted.length, 1); assert.equal(f.admitted[0].session.user.id, USER.id);
  assert.equal(f.admitted[0].context.signal.aborted, false);
  assert.equal(f.flow.snapshot().validated, true); assert.equal(f.flow.snapshot().busy, false);
  assert.equal(JSON.parse(f.values.get(KEY)).user.id, USER.id);
  const verify = f.calls.find(call => call.route === '/passkeys/authentication/verify');
  assert.equal(verify.body.credential.response.signature, b64('signature'));
  assert.ok(!JSON.stringify(f.states).match(/PRIVATE_FIXTURE|access_token|refresh_token/));
  f.flow.destroy();
});

test('unconfirmed, anonymous, unapproved and wrong-profile users cannot enroll or list keys', async () => {
  for (const settings of [{user: {...USER, email_confirmed_at: null}}, {user: {...USER, is_anonymous: true}},
    {approved: false}, {getAccount: () => ({id: OTHER.id, approved: true})}]) {
    const f = await fixture({...settings, signedIn: true});
    assert.equal(await f.flow.register(), false); assert.equal(await f.flow.list(), false);
    assert.equal(f.browserCalls.length, 0);
    assert.equal(f.calls.some(call => call.route.startsWith('/passkeys')), false);
    assert.equal(f.flow.snapshot().message, passkeys.messages.account);
    f.flow.destroy();
  }
});

test('an account switch during native creation prevents submitting the registration credential', async () => {
  const f = await fixture({signedIn: true, create: async (_options, api) => {
    await api.changeAccount(OTHER); return new api.Credential('create');
  }});
  assert.equal(await f.flow.register(), false);
  assert.equal(f.calls.some(call => call.route === '/passkeys/registration/verify'), false);
  assert.equal(f.flow.snapshot().message, passkeys.messages.changed);
  assert.equal(JSON.parse(f.values.get(KEY)).user.id, OTHER.id);
  f.flow.destroy();
});

test('profile approval revoked during native creation prevents server credential enrollment', async () => {
  const f = await fixture({signedIn: true, create: async (_options, api) => {
    api.setApproval(false); return new api.Credential('create');
  }});
  assert.equal(await f.flow.register(), false);
  assert.equal(f.calls.some(call => call.route === '/passkeys/registration/verify'), false);
  f.flow.destroy();
});

test('duplicate clicks cannot overlap ceremonies and native cancellation is retryable', async () => {
  const started = defer(); let shouldWait = true;
  const f = await fixture({get: (options, api) => {
    if (!shouldWait) return new api.Credential('get');
    started.resolve();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('private-browser-detail', 'AbortError')), {once: true}));
  }});
  const attempt = f.flow.signIn(); await started.promise;
  assert.equal(await f.flow.signIn(), false); assert.equal(await f.flow.register(), false); assert.equal(await f.flow.list(), false);
  assert.equal(f.flow.cancel(), true); assert.equal(await attempt, false);
  assert.equal(f.flow.snapshot().message, passkeys.messages.cancelled); assert.equal(f.flow.snapshot().busy, false);
  assert.equal(f.calls.some(call => call.route === '/passkeys/authentication/verify'), false);
  shouldWait = false; assert.equal(await f.flow.signIn(), true);
  f.flow.destroy();
});

test('cancel during an unabortable SDK verify discards and removes the late session', async () => {
  const started = defer(), release = defer();
  const f = await fixture({isolatedSignIn: true, http: async call => {
    if (call.route === '/passkeys/authentication/verify') { started.resolve(); await release.promise; }
  }});
  const attempt = f.flow.signIn(); await started.promise;
  f.flow.cancel(); assert.equal(f.flow.snapshot().busy, true); assert.equal(await f.flow.signIn(), false);
  release.resolve(); assert.equal(await attempt, false);
  assert.equal(f.admitted.length, 0); assert.equal(f.values.has(KEY), false);
  assert.equal(f.events.some(event => event.event === 'SIGNED_IN' || event.event === 'SIGNED_OUT'), false);
  assert.equal(f.isolatedValues.size, 0);
  assert.equal(f.calls.filter(call => call.route === '/logout').length, 1);
  assert.equal(f.states.at(-1).busy, false); assert.equal(f.states.at(-1).operation, 'signIn');
  assert.equal(f.states.at(-1).validated, false);
  f.flow.destroy();
});

test('server identity mismatch and rejected host gate never report a successful sign-in', async () => {
  for (const settings of [{identity: () => OTHER}, {authenticate: () => false}, {authenticate: () => { throw Error('private-profile-detail'); }}]) {
    const f = await fixture(settings);
    assert.equal(await f.flow.signIn(), false);
    assert.equal(f.flow.snapshot().validated, false); assert.equal(f.values.has(KEY), false);
    if (settings.identity) assert.equal(f.admitted.length, 0);
    assert.ok(!JSON.stringify(f.states).includes('private-profile-detail'));
    f.flow.destroy();
  }
});

test('failed sign-in cleanup cannot sign out an independently replaced account', async () => {
  const f = await fixture({authenticate: async (_session, _context, api) => {
    await api.changeAccount(OTHER); return false;
  }});
  assert.equal(await f.flow.signIn(), false);
  assert.equal(JSON.parse(f.values.get(KEY)).user.id, OTHER.id);
  assert.equal(f.calls.some(call => call.route === '/logout'), false);
  f.flow.destroy();
});

test('rejected isolated sign-in never persists or notifies the main account, including failed logout', async () => {
  for (const logoutFails of [false, true]) {
    const f = await fixture({signedIn: true, user: OTHER, isolatedSignIn: true, authenticate: () => false,
      http: call => logoutFails && call.route === '/logout' ?
        new Response(JSON.stringify({message: 'PRIVATE_OFFLINE_FIXTURE'}), {status: 500, headers: {'content-type': 'application/json'}}) : undefined});
    const original = f.values.get(KEY);
    assert.equal(await f.flow.signIn(), false);
    assert.equal(f.values.get(KEY), original);
    assert.equal(f.events.some(event => event.event === 'SIGNED_IN' || event.event === 'SIGNED_OUT'), false);
    assert.equal(f.isolatedValues.size, 0);
    assert.equal(f.flow.snapshot().validated, false);
    const isolatedSession = (await f.signInClient.auth.getSession()).data.session;
    assert.equal(isolatedSession?.user?.id || null, logoutFails ? USER.id : null);
    // Even a failed server logout leaves the unapproved session only in the
    // temporary client's memory, never in the restorable application's store.
    f.flow.destroy();
  }
});

test('isolated successful verification reaches the host before any main-session import', async () => {
  const f = await fixture({isolatedSignIn: true, authenticate: (_session, _context, api) => {
    assert.equal(api.values.has(KEY), false);
    assert.equal(api.events.some(event => event.event === 'SIGNED_IN'), false);
    return true;
  }});
  assert.equal(await f.flow.signIn(), true);
  assert.equal(f.values.has(KEY), false);
  assert.equal(f.isolatedValues.size, 0);
  assert.equal((await f.signInClient.auth.getSession()).data.session.user.id, USER.id);
  assert.equal(f.admitted[0].session.user.id, USER.id);
  f.flow.destroy();
});

test('list returns only verified-user metadata and never changes a credential', async () => {
  const f = await fixture({signedIn: true, keys: [{...SAVED, private_key: 'PRIVATE_FIXTURE', friendly_name: 'Phone\u0000'}]});
  const result = await f.flow.list();
  assert.equal(result.length, 1); assert.equal(result[0].friendly_name, 'Phone');
  assert.deepEqual(Object.keys(result[0]), ['id', 'friendly_name', 'created_at', 'last_used_at']);
  result[0].friendly_name = 'mutated'; assert.equal(f.flow.snapshot().credentials[0].friendly_name, 'Phone');
  assert.equal(f.browserCalls.length, 0); assert.equal(f.calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method)), false);
  assert.ok(!JSON.stringify(f.states).includes('PRIVATE_FIXTURE'));
  await f.changeAccount(OTHER);
  assert.deepEqual(f.flow.snapshot().credentials, []);
  f.flow.destroy();
});

test('device unlock remains required when the server only prefers user verification', async () => {
  const f = await fixture({signedIn: true});
  f.registration.options.authenticatorSelection.userVerification = 'preferred';
  f.registration.options.authenticatorSelection.residentKey = 'discouraged';
  f.authentication.options.userVerification = 'preferred';
  assert.ok(await f.flow.register()); assert.equal(await f.flow.signIn(), true);
  assert.equal(f.browserCalls[0].options.publicKey.authenticatorSelection.userVerification, 'required');
  assert.equal(f.browserCalls[0].options.publicKey.authenticatorSelection.residentKey, 'required');
  assert.equal(f.browserCalls[1].options.publicKey.userVerification, 'required');
  f.flow.destroy();
});

test('browser and server errors use safe Russian messages and release the operation', async () => {
  for (const [name, message] of [['NotAllowedError', passkeys.messages.cancelled], ['SecurityError', passkeys.messages.origin],
    ['NotSupportedError', passkeys.messages.unsupported], ['NetworkError', passkeys.messages.network]]) {
    const f = await fixture({get: () => { throw new DOMException('PRIVATE_FIXTURE_ERROR', name); }});
    assert.equal(await f.flow.signIn(), false); assert.equal(f.flow.snapshot().message, message);
    assert.equal(f.flow.snapshot().busy, false); assert.equal(f.admitted.length, 0);
    f.flow.destroy();
  }
  for (const [code, message] of [['passkey_disabled', passkeys.messages.unavailable], ['webauthn_credential_not_found', passkeys.messages.missing],
    ['webauthn_challenge_expired', passkeys.messages.expired], ['webauthn_verification_failed', passkeys.messages.error]]) {
    const f = await fixture({http: call => call.route === '/passkeys/authentication/options' ?
      new Response(JSON.stringify({code, message: 'PRIVATE_FIXTURE_ERROR'}), {status: 400, headers: {'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01'}}) : undefined});
    assert.equal(await f.flow.signIn(), false); assert.equal(f.flow.snapshot().message, message);
    assert.equal(f.flow.snapshot().busy, false); assert.equal(f.browserCalls.length, 0);
    f.flow.destroy();
  }
});
