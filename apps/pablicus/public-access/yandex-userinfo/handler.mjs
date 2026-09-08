const USERINFO_URL = 'https://login.yandex.ru/info?format=json';
const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_TOKEN_LENGTH = 4096;

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      ...extraHeaders,
    },
  });
}

function invalidToken() {
  return jsonResponse(401, { error: 'invalid_token' }, {
    'WWW-Authenticate': 'Bearer',
  });
}

async function readLimitedJson(response) {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  if (!response.body) throw new Error('Missing response');

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function displayName(profile) {
  for (const value of [profile.display_name, profile.real_name]) {
    if (typeof value !== 'string') continue;
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (clean) return Array.from(clean).slice(0, 128).join('');
  }
  return undefined;
}

/**
 * Adapts Yandex's authenticated identity to Supabase's canonical UserInfo shape.
 * This endpoint does not create users, issue sessions, or verify an email address.
 * fetchImpl is injectable so tests make no real OAuth requests.
 */
export function createYandexUserinfoHandler({
  expectedClientId,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  if (typeof expectedClientId !== 'string' || !expectedClientId.trim()
    || expectedClientId !== expectedClientId.trim()
    || expectedClientId.length > 512 || /[\s\u0000-\u001f\u007f]/.test(expectedClientId)) {
    throw new Error('YANDEX_CLIENT_ID must be configured');
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('Invalid timeout');
  }

  return async function yandexUserinfo(request) {
    if (request.method !== 'GET') {
      return jsonResponse(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    }

    // Do not accept a query token, a cookie, or a caller-supplied identity.
    const authorization = request.headers.get('Authorization') || '';
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization);
    if (!match || match[1].length > MAX_TOKEN_LENGTH) return invalidToken();

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const upstream = await fetchImpl(USERINFO_URL, {
        method: 'GET',
        headers: { Authorization: `OAuth ${match[1]}`, Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
      });
      if (upstream.status === 401 || upstream.status === 403) {
        await upstream.body?.cancel();
        return invalidToken();
      }
      if (upstream.status !== 200 || upstream.redirected) {
        await upstream.body?.cancel();
        return jsonResponse(502, { error: 'identity_provider_unavailable' });
      }

      const profile = await readLimitedJson(upstream);
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)
        || profile.client_id !== expectedClientId
        || typeof profile.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(profile.id)) {
        return invalidToken();
      }

      // Deliberately no email, email_verified, tokens, roles, or raw metadata.
      // email_optional=true lets Supabase use the authenticated provider + sub.
      const result = { sub: profile.id };
      const name = displayName(profile);
      if (name) result.name = name;
      return jsonResponse(200, result);
    } catch {
      return jsonResponse(timedOut ? 504 : 502, {
        error: timedOut ? 'identity_provider_timeout' : 'identity_provider_unavailable',
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}
