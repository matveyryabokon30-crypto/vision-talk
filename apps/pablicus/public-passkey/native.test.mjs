import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNative, NativeError} from './native.mjs';

const BASE = 'https://native-fixture.supabase.invalid';
const ORIGIN = 'https://pablicus-fixture.invalid';
const RP = new URL(ORIGIN).hostname;
const KEY = 'sb_publishable_native_fixture';
const ID = '71f5a801-f2d2-4c34-97a2-69efff2b989f';
const OTHER = '2aba78c0-5e2f-454b-b128-c658a8393e90';
const CHALLENGE = Buffer.alloc(32, 0x23).toString('base64url');
const CHALLENGE_ID = 'c4c1963a-90c3-4fc3-8048-7a326351392a';
const ACCESS = 'TEMPORARY_ACCESS_MUST_NOT_ESCAPE';
const REFRESH = 'TEMPORARY_REFRESH_MUST_NOT_ESCAPE';
const USER = {id: ID, email: 'fixture@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z',
  is_anonymous: false, user_metadata: {full_name: 'Fixture Person'}};
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function assertion({client = {}, rpId = RP, flags = 0x05, response = {}, credential = {}} = {}) {
  const authData = Buffer.alloc(37);
  createHash('sha256').update(rpId).digest().copy(authData);
  authData[32] = flags;
  return {id: encode('test-credential'), rawId: encode('test-credential'), type: 'public-key',
    response: {clientDataJSON: encode({type: 'webauthn.get', challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false, ...client}),
      authenticatorData: authData.toString('base64url'), signature: encode('signature-verified-by-native-server'),
      userHandle: encode(ID), ...response}, ...credential};
}

function fixture(overrides = {}) {
  const calls = [];
  const bridge = createNative({supabaseUrl: BASE, apiKey: KEY, rpId: RP, origin: ORIGIN,
    async fetchImpl(url, options) {
      const path = url.slice(BASE.length);
      const call = {url, path, method: options.method, headers: options.headers,
        body: options.body ? JSON.parse(options.body) : undefined, options};
      calls.push(call);
      if (overrides.fetch) {
        const custom = await overrides.fetch(call);
        if (custom !== undefined) return custom;
      }
      let result;
      if (path === '/auth/v1/passkeys/authentication/options') result = overrides.options || {
        challenge_id: CHALLENGE_ID, options: {challenge: CHALLENGE, rpId: RP, userVerification: 'preferred'},
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };
      else if (path === '/auth/v1/passkeys/authentication/verify') result = overrides.session || {
        access_token: ACCESS, refresh_token: REFRESH, token_type: 'bearer', user: {...USER, email: 'not-used@example.invalid'},
      };
      else if (path === '/auth/v1/user') result = overrides.user || USER;
      else if (path === '/rest/v1/profiles?select=id,is_approved&id=eq.' + ID) {
        result = overrides.profiles || [{id: ID, is_approved: true}];
      } else if (path === '/auth/v1/logout?scope=local') return new Response(null, {status: 204});
      else throw new Error('Unexpected fixture path');
      return Response.json(result);
    },
  });
  return {bridge, calls, verify: credential => bridge.verifyAuthentication({challengeId: CHALLENGE_ID,
    challenge: CHALLENGE, credential: credential || assertion()})};
}

function safeError(code) {
  return error => {
    assert.ok(error instanceof NativeError);
    assert.equal(error.code, code);
    const output = String(error.stack) + JSON.stringify(error);
    assert.ok(!output.includes(ACCESS));
    assert.ok(!output.includes(REFRESH));
    assert.ok(!output.includes('UPSTREAM_SECRET'));
    return true;
  };
}

test('native options use only public apikey and the official REST body; UV is required', async () => {
  const f = fixture();
  const result = await f.bridge.startAuthentication();
  assert.equal(result.challenge_id, CHALLENGE_ID);
  assert.equal(result.options.challenge, CHALLENGE);
  assert.equal(result.options.userVerification, 'required');
  assert.equal(result.options.rpId, RP);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, BASE + '/auth/v1/passkeys/authentication/options');
  assert.equal(f.calls[0].method, 'POST');
  assert.deepEqual(f.calls[0].body, {gotrue_meta_security: {}});
  assert.equal(f.calls[0].headers.apikey, KEY);
  assert.equal(f.calls[0].headers.Authorization, undefined);
});

test('native options reject a wrong RP or expired challenge', async () => {
  for (const options of [
    {challenge_id: CHALLENGE_ID, options: {rpId: 'wrong.invalid', challenge: CHALLENGE}},
    {challenge_id: CHALLENGE_ID, options: {rpId: RP, challenge: CHALLENGE}, expires_at: '2000-01-01T00:00:00Z'},
    {challenge_id: CHALLENGE_ID, options: {rpId: RP, challenge: CHALLENGE}, expires_at: Math.floor(Date.now() / 1000) - 1},
    {challenge_id: CHALLENGE_ID, options: {rpId: RP, challenge: CHALLENGE}, expires_at: null},
    {challenge_id: CHALLENGE_ID, options: {rpId: RP, challenge: CHALLENGE}, expires_at: false},
    {challenge_id: CHALLENGE_ID, options: {rpId: RP, challenge: CHALLENGE}, expires_at: 'invalid'},
    {challenge_id: CHALLENGE_ID, options: {rpId: RP, challenge: 'A'}},
  ]) await assert.rejects(fixture({options}).bridge.startAuthentication(), safeError('native_options'));
});

test('native Unix-seconds expiry is normalized to ISO without extending its lifetime', async () => {
  const expiry = Math.floor(Date.now() / 1000) + 30;
  const f = fixture({options: {challenge_id: CHALLENGE_ID,
    options: {rpId: RP, challenge: CHALLENGE}, expires_at: expiry}});
  const result = await f.bridge.startAuthentication();
  assert.equal(result.expires_at, new Date(expiry * 1000).toISOString());
});

test('native expiry is always ISO and capped at 120 seconds for absent, long numeric or long ISO values', async () => {
  for (const expires_at of [undefined, Math.floor(Date.now() / 1000) + 3600, new Date(Date.now() + 3600000).toISOString()]) {
    const before = Date.now();
    const f = fixture({options: {challenge_id: CHALLENGE_ID, options: {rpId: RP, challenge: CHALLENGE},
      ...(expires_at === undefined ? {} : {expires_at})}});
    const result = await f.bridge.startAuthentication();
    assert.equal(typeof result.expires_at, 'string');
    assert.ok(Date.parse(result.expires_at) >= before + 120000);
    assert.ok(Date.parse(result.expires_at) <= Date.now() + 120000);
  }
});

test('successful native assertion validates the server user/profile, cleans only its session, returns no tokens', async () => {
  const f = fixture();
  const credential = assertion();
  const userinfo = await f.verify(credential);
  assert.deepEqual(userinfo, {sub: 'native:' + ID, name: 'Fixture Person', email: USER.email, email_verified: true});
  assert.deepEqual(f.calls.map(call => [call.method, call.path]), [
    ['POST', '/auth/v1/passkeys/authentication/verify'], ['GET', '/auth/v1/user'],
    ['GET', '/rest/v1/profiles?select=id,is_approved&id=eq.' + ID], ['POST', '/auth/v1/logout?scope=local'],
  ]);
  assert.deepEqual(f.calls[0].body, {challenge_id: CHALLENGE_ID, credential});
  assert.equal(f.calls[0].headers.Authorization, undefined);
  for (const call of f.calls.slice(1)) assert.equal(call.headers.Authorization, 'Bearer ' + ACCESS);
  for (const call of f.calls) {
    assert.equal(call.headers.apikey, KEY);
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  assert.ok(!JSON.stringify(userinfo).includes(ACCESS));
  assert.ok(!JSON.stringify(userinfo).includes(REFRESH));
});

test('wrong origin, challenge, ceremony, RP, presence or UV is refused before upstream verification', async () => {
  const invalid = [
    assertion({client: {origin: 'https://attacker.invalid'}}),
    assertion({client: {challenge: encode('wrong-but-long-enough-challenge')}}),
    assertion({client: {type: 'webauthn.create'}}),
    assertion({client: {crossOrigin: true}}),
    assertion({client: {topOrigin: 'https://attacker.invalid'}}),
    assertion({rpId: 'attacker.invalid'}), assertion({flags: 0x01}), assertion({flags: 0x04}),
    assertion({credential: {rawId: encode('different-credential')}}),
    assertion({response: {clientDataJSON: 'invalid==='}}),
    assertion({response: {authenticatorData: encode('too-short')}}),
    assertion({response: {signature: ''}}),
  ];
  for (const credential of invalid) {
    const f = fixture();
    await assert.rejects(f.verify(credential), safeError('native_assertion'));
    assert.equal(f.calls.length, 0);
  }
});

test('native verification rejection is bounded and cannot disclose an upstream token or error', async () => {
  const f = fixture({fetch: () => Response.json({error: 'UPSTREAM_SECRET', access_token: ACCESS}, {status: 400})});
  await assert.rejects(f.verify(), safeError('native_assertion'));
  assert.equal(f.calls.length, 1);
});

test('mismatching getUser UID fails and still cleans the exact temporary session', async () => {
  const f = fixture({user: {...USER, id: OTHER}});
  await assert.rejects(f.verify(), safeError('native_identity'));
  assert.deepEqual(f.calls.map(call => call.path), [
    '/auth/v1/passkeys/authentication/verify', '/auth/v1/user', '/auth/v1/logout?scope=local',
  ]);
});

test('a missing verifier response user cannot become an identity but its temporary session is cleaned', async () => {
  const f = fixture({session: {access_token: ACCESS, refresh_token: REFRESH}});
  await assert.rejects(f.verify(), safeError('native_identity'));
  assert.deepEqual(f.calls.map(call => call.path), ['/auth/v1/passkeys/authentication/verify', '/auth/v1/logout?scope=local']);
});

test('anonymous, unconfirmed, malformed email and phone-only identities fail closed and are cleaned', async () => {
  const users = [
    {...USER, is_anonymous: true}, {...USER, is_anonymous: undefined},
    {...USER, email_confirmed_at: null}, {...USER, email_confirmed_at: 'invalid'},
    {...USER, email: 'invalid'}, {...USER, email: undefined, phone_confirmed_at: '2026-01-01T00:00:00Z'},
  ];
  for (const user of users) {
    const f = fixture({user});
    await assert.rejects(f.verify(), safeError('native_identity'));
    assert.equal(f.calls.at(-1).path, '/auth/v1/logout?scope=local');
    assert.equal(f.calls.some(call => call.path.startsWith('/rest/')), false);
  }
});

test('unapproved, missing, mismatching and ambiguous profiles fail despite a valid native session', async () => {
  for (const profiles of [[{id: ID, is_approved: false}], [], [{id: OTHER, is_approved: true}],
    [{id: ID, is_approved: true}, {id: OTHER, is_approved: true}]]) {
    const f = fixture({profiles});
    await assert.rejects(f.verify(), safeError('native_approval'));
    assert.equal(f.calls.at(-1).path, '/auth/v1/logout?scope=local');
  }
});

test('network and invalid JSON failures after acquiring a session still trigger cleanup', async () => {
  for (const brokenPath of ['/auth/v1/user', '/rest/v1/profiles?select=id,is_approved&id=eq.' + ID]) {
    for (const mode of ['network', 'json']) {
      const f = fixture({fetch(call) {
        if (call.path !== brokenPath) return;
        if (mode === 'network') throw new Error('UPSTREAM_SECRET ' + ACCESS);
        return new Response('UPSTREAM_SECRET ' + ACCESS, {status: 200});
      }});
      await assert.rejects(f.verify(), safeError(brokenPath === '/auth/v1/user' ? 'native_identity' : 'native_approval'));
      assert.equal(f.calls.at(-1).path, '/auth/v1/logout?scope=local');
    }
  }
});

test('cleanup failure suppresses otherwise successful identity and never revokes global/other sessions', async () => {
  const f = fixture({fetch(call) {
    if (call.path === '/auth/v1/logout?scope=local') return Response.json({access_token: ACCESS}, {status: 500});
  }});
  await assert.rejects(f.verify(), safeError('native_cleanup'));
  assert.equal(f.calls.filter(call => call.path.includes('/logout')).length, 1);
  assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer ' + ACCESS);
});

test('cleanup failure also supersedes a failed identity check', async () => {
  const f = fixture({user: {...USER, id: OTHER}, fetch(call) {
    if (call.path === '/auth/v1/logout?scope=local') throw new Error('UPSTREAM_SECRET ' + ACCESS);
  }});
  await assert.rejects(f.verify(), safeError('native_cleanup'));
});

test('user-editable metadata can affect only bounded display name, never identity or approval', async () => {
  const f = fixture({user: {...USER, user_metadata: {sub: 'native:' + OTHER, email: 'attacker@example.invalid',
    is_approved: true, email_verified: true, full_name: '  Name\n' + 'x'.repeat(100)}}});
  const userinfo = await f.verify();
  assert.equal(userinfo.sub, 'native:' + ID);
  assert.equal(userinfo.email, USER.email);
  assert.equal(userinfo.name.length, 80);
  assert.ok(!userinfo.name.includes('\n'));
});

test('adapter rejects secret/service keys, insecure URLs and a mismatching configured origin', () => {
  const common = {supabaseUrl: BASE, apiKey: KEY, rpId: RP, origin: ORIGIN};
  const serviceJwt = encode({alg: 'HS256'}) + '.' + encode({role: 'service_role'}) + '.signature';
  for (const change of [{apiKey: 'sb_secret_not_allowed'}, {apiKey: serviceJwt}, {supabaseUrl: 'http://insecure.invalid'},
    {supabaseUrl: BASE + '/other'}, {origin: ORIGIN + '/'}, {rpId: 'wrong.invalid'}]) {
    assert.throws(() => createNative({...common, ...change}), safeError('native_configuration'));
  }
  assert.doesNotThrow(() => createNative({...common,
    apiKey: encode({alg: 'HS256'}) + '.' + encode({role: 'anon'}) + '.signature'}));
});
