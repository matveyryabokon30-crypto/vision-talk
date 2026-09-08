import assert from 'node:assert/strict';
import test from 'node:test';
import { createYandexUserinfoHandler } from './handler.mjs';

const CLIENT_ID = 'pablicus-yandex-test-client';
const TEST_TOKEN = 'test-access-token';
const UPSTREAM_URL = 'https://login.yandex.ru/info?format=json';

function request(authorization = `Bearer ${TEST_TOKEN}`, method = 'GET') {
  const headers = authorization === null ? {} : { Authorization: authorization };
  return new Request('https://pablicus-userinfo.invalid/yandex-userinfo', { method, headers });
}

function upstream(profile, status = 200) {
  return new Response(JSON.stringify(profile), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function handler(fetchImpl, extra = {}) {
  return createYandexUserinfoHandler({ expectedClientId: CLIENT_ID, fetchImpl, ...extra });
}

test('verified upstream identity yields only stable subject and display name', async () => {
  const seen = [];
  const handle = handler(async (url, options) => {
    seen.push({ url, options });
    return upstream({
      client_id: CLIENT_ID,
      id: '00012345678901234567890',
      display_name: '  Катя  ',
      default_email: 'unverified-address@example.invalid',
      email: 'unverified-address@example.invalid',
      emails: ['unverified-address@example.invalid'],
      email_verified: true,
      access_token: 'must-never-be-forwarded',
      is_approved: true,
      role: 'admin',
    });
  });
  const response = await handle(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sub: '00012345678901234567890', name: 'Катя' });
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, UPSTREAM_URL);
  assert.equal(seen[0].options.method, 'GET');
  assert.equal(seen[0].options.headers.Authorization, `OAuth ${TEST_TOKEN}`);
  assert.equal(seen[0].options.redirect, 'error');
  assert.equal(seen[0].options.cache, 'no-store');
  assert.equal(seen[0].options.body, undefined);
});

test('subject-only identity succeeds without requesting or inventing email', async () => {
  const response = await handler(async () => upstream({ client_id: CLIENT_ID, id: '987654' }))(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sub: '987654' });
});

test('invalid or missing configuration fails closed', () => {
  for (const expectedClientId of [undefined, '', ' ', ' padded ', 'two words', 'bad\nclient']) {
    assert.throws(() => createYandexUserinfoHandler({ expectedClientId }), /must be configured/);
  }
});

test('missing or malformed bearer and unsupported methods never contact upstream', async () => {
  let calls = 0;
  const handle = handler(async () => { calls += 1; throw new Error('Unexpected network request'); });
  for (const authorization of [null, '', 'Basic Zm9vOmJhcg==', 'Bearer ', 'Bearer a b',
    'Bearer first,Bearer second', `Bearer ${'a'.repeat(4097)}`]) {
    const response = await handle(request(authorization));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
  }
  const post = await handle(request(`Bearer ${TEST_TOKEN}`, 'POST'));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET');
  const queryOnly = new Request('https://pablicus-userinfo.invalid/yandex-userinfo?access_token=test-token');
  assert.equal((await handle(queryOnly)).status, 401);
  assert.equal(calls, 0);
});

test('token for another application or missing client claim cannot assert identity', async () => {
  for (const client_id of ['different-application', undefined, null, 123]) {
    const response = await handler(async () => upstream({ client_id, id: '12345' }))(request());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'invalid_token' });
  }
});

test('invalid upstream subject is rejected without coercion or fallback to email', async () => {
  for (const id of [undefined, null, 12345, '', ' spaces ', 'a\nb', {}, 'x'.repeat(129)]) {
    const response = await handler(async () => upstream({
      client_id: CLIENT_ID, id, email: 'cannot-be-an-identifier@example.invalid',
    }))(request());
    assert.equal(response.status, 401);
  }
});

test('upstream errors do not disclose tokens or the upstream response body', async () => {
  for (const status of [401, 403, 429, 500, 302]) {
    const response = await handler(async () => upstream({ sensitive: TEST_TOKEN }, status))(request());
    assert.equal(response.status, [401, 403].includes(status) ? 401 : 502);
    assert.doesNotMatch(await response.text(), /test-access-token|sensitive/);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  const response = await handler(async () => { throw new Error(`upstream failure ${TEST_TOKEN}`); })(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'identity_provider_unavailable' });
});

test('malformed JSON and oversized upstream bodies cannot produce an identity', async () => {
  const responses = [
    new Response('{invalid'),
    upstream(null),
    upstream([{ client_id: CLIENT_ID, id: '123' }]),
    upstream({ client_id: CLIENT_ID, id: '123', filler: 'x'.repeat(17000) }),
    new Response('{}', { headers: { 'Content-Length': '17000' } }),
  ];
  for (const incoming of responses) {
    const response = await handler(async () => incoming)(request());
    assert.ok([401, 502].includes(response.status));
    assert.equal('sub' in await response.json(), false);
  }
});

test('upstream timeout aborts the request and returns a bounded generic failure', async () => {
  let signal;
  const handle = handler(async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      reject(new Error('Aborted with private diagnostic data'));
    }, { once: true }));
  }, { timeoutMs: 10 });
  const response = await handle(request());
  assert.equal(signal.aborted, true);
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: 'identity_provider_timeout' });
});
