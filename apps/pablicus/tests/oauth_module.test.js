'use strict';
// Exact bundled SDK bytes execute in a browser-like worker VM. Real network is
// forbidden; these tests verify the client contract, not provider provisioning.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const {webcrypto, createHash} = require('node:crypto');
const oauth = require('../src/oauth-login.js');
const PROJECT = 'https://oauth-fixture.invalid';
const REDIRECT = 'https://pablicus-fixture.invalid/pablicus/';
const config = {publicSignupReady: true, providers: Object.fromEntries(oauth.catalog.map(p => [p.id, true]))};

function sdkFixture({flowType = 'pkce'} = {}) {
  const calls = [], values = new Map();
  const runtime = {
    module: {exports: {}}, exports: {}, URL, URLSearchParams, Headers, Request, Response,
    AbortController, TextEncoder, TextDecoder, crypto: webcrypto, btoa, atob, console, WebSocket,
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: PROJECT + '/vendor/supabase.js',
    importScripts() { throw Error('Unexpected import'); },
    fetch(url) { calls.push(String(url)); throw Error('Unexpected network'); }
  };
  runtime.self = runtime;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../vendor/supabase.js'), 'utf8'), runtime,
    {filename: 'supabase-browser-bundle', timeout: 3000});
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }
  };
  const client = (runtime.supabase || runtime.module.exports).createClient(PROJECT, 'PUBLIC_FIXTURE_KEY', {
    auth: {flowType, storage, storageKey: 'oauth-test', persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false}, global: {fetch: runtime.fetch}
  });
  const navigated = [], states = [];
  const flow = oauth.create({client, projectUrl: PROJECT, redirectTo: REDIRECT, config,
    onNavigate: url => navigated.push(url), onChange: state => states.push(state)});
  return {client, flow, calls, values, navigated, states};
}

test('each provider uses real SDK OAuth with stored S256 verifier, same-window destination and no mailbox request', async () => {
  for (const provider of oauth.catalog) {
    const f = sdkFixture();
    assert.equal(await f.flow.start(provider.id), true);
    assert.equal(f.navigated.length, 1);
    const url = new URL(f.navigated[0]);
    assert.equal(url.origin, PROJECT);
    assert.equal(url.pathname, '/auth/v1/authorize');
    assert.equal(url.searchParams.get('provider'), provider.id);
    assert.equal(url.searchParams.get('redirect_to'), REDIRECT);
    // skipBrowserRedirect suppresses SDK navigation; the URL still performs
    // the normal server redirect when our validated navigation is invoked.
    assert.equal(url.searchParams.has('skip_http_redirect'), false);
    assert.equal(url.searchParams.get('code_challenge_method'), 's256');
    const verifier = JSON.parse(f.values.get('oauth-test-code-verifier'));
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
    assert.equal(url.searchParams.get('scopes'), provider.id === 'azure' ? 'email' : null);
    for (const key of ['password', 'email', 'access_type', 'prompt']) assert.equal(url.searchParams.has(key), false);
    assert.deepEqual(f.calls, []);
    assert.equal(f.flow.snapshot().phase, 'redirecting');
  }
});

test('provider catalog is immutable and email suggestions use exact known domains', () => {
  assert.ok(Object.isFrozen(oauth.catalog));
  for (const provider of oauth.catalog) {
    assert.ok(Object.isFrozen(provider) && Object.isFrozen(provider.domains));
    for (const domain of provider.domains) assert.equal(oauth.providerForEmail(' Me@' + domain.toUpperCase() + ' ').id, provider.id);
  }
  for (const email of ['me@gmail.com.evil.invalid', 'me@sub.gmail.com', 'me@@mail.ru', '@mail.ru', 'me@unknown.invalid', 'me @mail.ru', null]) {
    assert.equal(oauth.providerForEmail(email), null);
  }
});

test('absent configuration, non-boolean flags, unknown providers and unready public signup never call SDK', async () => {
  let called = 0;
  const client = {auth: {signInWithOAuth() { called++; throw Error('Unexpected call'); }}};
  for (const cfg of [undefined, {}, {publicSignupReady: false, providers: {google: true}},
    {publicSignupReady: true, providers: {google: 'true'}},
    {publicSignupReady: true, providers: Object.create({google: true})}]) {
    const flow = oauth.create({client, config: cfg});
    assert.equal(await flow.start('google'), false);
    assert.equal(flow.snapshot().message, 'Этот способ входа ещё подключается.');
  }
  assert.equal(await oauth.create({client, config}).start('unexpected'), false);
  assert.equal(called, 0);
});

test('concurrent starts cannot replace the PKCE verifier; browser back allows a new attempt', async () => {
  const f = sdkFixture();
  const first = f.flow.start('google');
  assert.equal(await f.flow.start('custom:yandex'), false);
  assert.equal(await first, true);
  assert.equal(await f.flow.start('azure'), false);
  assert.equal(f.navigated.length, 1);
  const original = f.values.get('oauth-test-code-verifier');
  f.flow.resume();
  assert.equal(await f.flow.start('custom:yandex'), true);
  assert.notEqual(f.values.get('oauth-test-code-verifier'), original);
  assert.equal(f.navigated.length, 2);
});

test('implicit SDK configuration is rejected before navigation', async () => {
  const f = sdkFixture({flowType: 'implicit'});
  assert.equal(await f.flow.start('google'), false);
  assert.equal(f.navigated.length, 0);
  assert.equal(f.flow.snapshot().phase, 'error');
});

test('destination validation rejects other origins, paths, providers, redirects, credentials and non-S256 challenges', async () => {
  const f = sdkFixture();
  assert.equal(await f.flow.start('google'), true);
  const valid = f.navigated[0];
  const mutations = [
    u => { u.hostname = 'other-fixture.invalid'; },
    u => { u.protocol = 'http:'; },
    u => { u.pathname = '/auth/v1/user/identities/authorize'; },
    u => { u.searchParams.set('provider', 'azure'); },
    u => { u.searchParams.append('provider', 'google'); },
    u => { u.searchParams.set('redirect_to', 'https://other-fixture.invalid/'); },
    u => { u.username = 'unexpected'; },
    u => { u.hash = 'unexpected'; },
    u => { u.searchParams.set('code_challenge_method', 'plain'); },
    u => { u.searchParams.delete('code_challenge'); },
    u => { u.searchParams.set('code_challenge', 'malformed'); }
  ];
  for (const mutate of mutations) {
    const url = new URL(valid); mutate(url);
    let navigated = false;
    const client = {auth: {signInWithOAuth: async () => ({data: {provider: 'google', url: url.href}, error: null})}};
    const flow = oauth.create({client, projectUrl: PROJECT, redirectTo: REDIRECT, config,
      onNavigate: () => { navigated = true; }});
    assert.equal(await flow.start('google'), false);
    assert.equal(navigated, false);
    assert.equal(flow.snapshot().message, 'Не удалось открыть вход. Попробуйте ещё раз.');
  }
});

test('server errors and thrown exceptions remain safe and retryable', async () => {
  for (const fail of [async () => ({error: {message: '<script>private-provider-detail</script>'}}),
    async () => { throw Error('private-provider-detail'); }]) {
    const client = {auth: {signInWithOAuth: fail}};
    const flow = oauth.create({client, projectUrl: PROJECT, redirectTo: REDIRECT, config,
      onNavigate: () => assert.fail('Unexpected navigation')});
    assert.equal(await flow.start('google'), false);
    assert.equal(flow.snapshot().busy, false);
    assert.ok(!JSON.stringify(flow.snapshot()).includes('private-provider-detail'));
  }
});
