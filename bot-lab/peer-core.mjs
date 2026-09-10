/** Standalone peer check. No refresh tokens, Auth writes or legacy Lab-state writes. */
export const PROJECT = 'ctcoqgsztdtsazdiwcmd';
export const RELEASE = '20260910-peer-2';
export const API = `https://${PROJECT}.supabase.co/functions/v1/public-bot-core`;
export const AUTH_KEY = `sb-${PROJECT}-auth-token`;
const PUBLIC_KEY = 'sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fields = ['run_id', 'owner_id', 'bot_id', 'chat_id'];
export class CheckError extends Error {
  constructor(code, message, status = null, requestId = null) {
    super(message); this.code = code; this.status = status; this.requestId = requestId;
  }
}
export function readAccessToken(storage) {
  try {
    if (JSON.parse(storage.getItem('pablicus:passkey-unvalidated') || 'false') === true) return null;
    const value = JSON.parse(storage.getItem(AUTH_KEY) || 'null');
    const token = value?.access_token || value?.currentSession?.access_token || value?.session?.access_token;
    return typeof token === 'string' && token.length > 0 && token.length <= 16384 ? token : null;
  } catch { return null; }
}
export function validateCode(value) {
  let p = value;
  if (typeof p === 'string') {
    if (p.length > 2048) throw new CheckError('INVALID_CODE', 'Код слишком длинный. Нужен код теста, а не отчёт.');
    try { p = JSON.parse(p); } catch { throw new CheckError('INVALID_CODE', 'Вставь полный код от { до }. Ссылка и пароль здесь не подходят.'); }
  }
  if (!p || p.version !== 1 || p.project !== PROJECT || !fields.every(k => typeof p[k] === 'string' && UUID.test(p[k]))) {
    throw new CheckError('INVALID_CODE', 'Нужен полный код теста с owner_id, bot_id и chat_id.');
  }
  return { version: 1, project: PROJECT, ...Object.fromEntries(fields.map(k => [k, p[k].toLowerCase()])) };
}
export function validateActor(value) {
  if (!value) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new CheckError('INVALID_ACTOR', 'Некорректный идентификатор проверяющего аккаунта.');
  return value.toLowerCase();
}
const invalidSession = (status = 401, requestId = null) => new CheckError('SESSION_INVALID',
  'Сервер не подтвердил вход. Открой Public в этом браузере, затем вернись сюда и нажми «Проверить вход». Пароль менять не нужно.', status, requestId);
const safeCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : null;
const safeRequest = value => typeof value === 'string' && UUID.test(value) ? value : null;
export function createPeerTester({ getToken, fetcher = globalThis.fetch, now = () => new Date().toISOString(), randomUUID = () => crypto.randomUUID(), timeoutMs = 20000 }) {
  function same(token) {
    if (!token || getToken() !== token) throw new CheckError('SESSION_CHANGED', 'Вход изменился во время проверки. Нажми «Проверить вход».');
  }
  async function call(path, token, options = {}) {
    same(token);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetcher(API + path, { method: options.method || 'GET',
        headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}`, ...(options.data ? { 'Content-Type': 'application/json' } : {}) },
        body: options.data ? JSON.stringify(options.data) : undefined,
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
      same(token);
      // Unexpected successful target responses may contain someone else's data.
      // Never read, render, log or save that body. /me is the sole identity endpoint.
      if (path !== '/v1/me' && response.status >= 200 && response.status < 300) {
        try { await response.body?.cancel(); } catch {}
        return { status: response.status, code: null, request_id: null };
      }
      const text = await response.text();
      same(token);
      if (text.length > 131072) throw new CheckError('INVALID_RESPONSE', 'Ответ сервера слишком большой.', response.status);
      let body;
      try { body = JSON.parse(text); } catch { throw new CheckError('INVALID_RESPONSE', 'Сервер вернул ответ не в формате проверки.', response.status); }
      return { status: response.status, code: safeCode(body?.error?.code), request_id: safeRequest(body?.request_id),
        ...(path === '/v1/me' ? { identity: body } : {}) };
    } catch (error) {
      if (error instanceof CheckError) throw error;
      throw new CheckError('NETWORK_ERROR', 'Сервер не ответил. Результат не подтверждён; новый полный тест не запускай.');
    } finally { clearTimeout(timer); }
  }
  async function verify(expectedActor = null) {
    expectedActor = validateActor(expectedActor);
    const token = getToken();
    if (!token) throw invalidSession();
    const r = await call('/v1/me', token);
    if (r.status === 401) throw invalidSession(r.status, r.request_id);
    if (r.status !== 200 || r.identity?.scope !== 'manage' || !UUID.test(r.identity?.id || '')) {
      throw new CheckError('IDENTITY_UNCONFIRMED', 'Обычный аккаунт не подтверждён сервером. Открой Public и проверь вход.', r.status, r.request_id);
    }
    const actor = r.identity.id.toLowerCase();
    if (expectedActor && actor !== expectedActor) throw new CheckError('WRONG_ACCOUNT', 'Открыт не тот аккаунт. Эту обратную проверку нужно выполнить на телефоне первого участника, в его аккаунте.');
    return { actor, token };
  }
  async function run(value, { expectedActor = null, onProgress = () => {} } = {}) {
    const target = validateCode(value);
    const result = { version: 2, kind: 'peer_isolation_only', release: RELEASE, project: PROJECT, started_at: now(),
      target_run_id: target.run_id, first_owner: target.owner_id, second_owner: null, auth_verified: false,
      checks: [], complete: false, outcome: 'inconclusive',
      note: 'Только четыре проверки чужого доступа. Не повторяет и не заменяет 34 проверки сценария.' };
    const emit = () => { try { onProgress(structuredClone(result)); } catch {} };
    try {
      const { actor, token } = await verify(expectedActor);
      if (actor === target.owner_id) throw new CheckError('SAME_ACCOUNT', 'Открыт аккаунт владельца этого бота. Нужен другой аккаунт для проверки закрытого доступа.');
      result.second_owner = actor; result.auth_verified = true; emit();
      const paths = [
        ['Чужой бот закрыт', `/v1/bots/${target.bot_id}`],
        ['Чужая история закрыта', `/v1/chats/${target.chat_id}`],
        ['Чужие заявки закрыты', `/v1/bots/${target.bot_id}/records`],
        ['Нельзя открыть диалог с закрытым чужим ботом', `/v1/bots/${target.bot_id}/chats`, { method: 'POST', data: { id: randomUUID() } }]
      ];
      for (const [name, path, options] of paths) {
        const r = await call(path, token, options);
        if (r.status === 404 && r.code === 'NOT_FOUND') {
          result.checks.push({ name, pass: true, status: 404, code: r.code }); emit(); continue;
        }
        if (r.status >= 200 && r.status < 300) {
          result.checks.push({ name, pass: false, status: r.status }); result.outcome = 'failed';
          throw new CheckError('UNEXPECTED_ACCESS', 'Сервер разрешил запрос к чужому объекту. Проверка остановлена. Скопируй результат; содержимое ответа не показано и не сохранено.', r.status, r.request_id);
        }
        result.checks.push({ name, pass: null, status: r.status, ...(r.code ? { code: r.code } : {}) });
        if (r.status === 401) throw invalidSession(r.status, r.request_id);
        throw new CheckError(r.code || 'UNEXPECTED_STATUS', 'Проверка не завершена: получен HTTP ' + r.status + '. Это не подтверждение доступа к чужим данным. Скопируй результат.', r.status, r.request_id);
      }
      // Confirm that the same server-verified account is still signed in at completion.
      const final = await verify(actor); same(token);
      if (final.token !== token) throw new CheckError('SESSION_CHANGED', 'Сессия обновилась. Повтори только четыре проверки после проверки входа.');
      result.complete = true; result.outcome = 'passed';
    } catch (e) {
      result.failure = e instanceof CheckError ? e.message : 'Проверка остановилась из-за внутренней ошибки.';
      result.error = { code: e instanceof CheckError ? e.code : 'INTERNAL_ERROR', status: e.status || null,
        request_id: safeRequest(e.requestId) };
    } finally { result.finished_at = now(); emit(); }
    return result;
  }
  return { verify, run };
}
