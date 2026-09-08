/* Public first-passkey page. No app session, password, email, private key or
 * biometric data is handled here. Only explicit clicks start API ceremonies. */
(function () {
  'use strict';
  const ORIGIN = 'https://matveyryabokon30-crypto.github.io';
  const RP_ID = 'matveyryabokon30-crypto.github.io';
  const PAGE = ORIGIN + '/vision-talk/pablicus/passkey-start.html';
  const API = 'https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/pablicus-passkey';
  const CALLBACK = 'https://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback';
  const STORAGE = 'pablicus-public-passkey-flow-v1';
  const MAX_AGE = 5 * 60 * 1000;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const SECRET = /^[A-Za-z0-9_-]{43}$/;
  let flow = null, initialFailure = '', active = null, finished = false;
  const text = Object.freeze({
    expired: 'Время входа истекло. Вернитесь в Pablicus и начните вход снова.',
    unsupported: 'Этот браузер не поддерживает ключи доступа. Откройте Pablicus в Safari или Chrome на устройстве с ключами доступа.',
    origin: 'Откройте эту страницу через основной адрес Pablicus.',
    storage: 'Браузер не смог сохранить начало входа. Откройте Pablicus в обычной вкладке Safari или Chrome.',
    name: 'Введите имя или псевдоним — от 1 до 80 символов.',
    prepare: 'Готовим ключ доступа…',
    register: 'Создайте ключ доступа в системном окне устройства…',
    signin: 'Выберите свой ключ доступа в системном окне устройства…',
    verify: 'Проверяем ключ доступа…',
    success: 'Ключ подтверждён. Возвращаемся в Pablicus…',
    cancelled: 'Действие отменено или время ожидания истекло. Можно попробовать снова.',
    network: 'Не удалось связаться с сервером. Проверьте интернет и попробуйте снова.',
    consumed: 'Не удалось завершить проверку. Вернитесь в Pablicus и начните вход снова.',
    unavailable: 'Создание аккаунтов с ключом пока недоступно. Вернитесь в Pablicus и попробуйте позже.',
    limited: 'Слишком много попыток. Подождите немного и попробуйте снова.',
    exists: 'Этот ключ уже существует. Нажмите «У меня уже есть ключ».',
    invalid: 'Не удалось получить данные для ключа доступа. Вернитесь в Pablicus и начните вход снова.'
  });

  function clearFlow() {
    flow = null;
    try { sessionStorage.removeItem(STORAGE); } catch (_) { /* No alternate persistence. */ }
  }
  function validFlow(value) {
    return value && UUID.test(value.flowId) && SECRET.test(value.secret) &&
      Number.isFinite(value.createdAt) && value.createdAt <= Date.now() && Date.now() - value.createdAt < MAX_AGE;
  }
  // This script is the first executable resource. Capture and remove the
  // fragment before listeners, UI, assets or any network ceremony is started.
  try {
    const incoming = location.hash;
    const correctPage = location.origin + location.pathname === PAGE && !location.search;
    history.replaceState(null, '', location.pathname);
    if (!correctPage || window.top !== window.self || !isSecureContext) {
      clearFlow();
      initialFailure = text.origin;
    } else if (incoming) {
      clearFlow();
      const params = new URLSearchParams(incoming.slice(1));
      const keys = Array.from(params.keys());
      if (incoming.length > 200 || keys.length !== 2 || !keys.includes('flow') || !keys.includes('secret')) throw new Error('invalid_flow');
      const candidate = {flowId: params.get('flow'), secret: params.get('secret'), createdAt: Date.now()};
      if (!validFlow(candidate)) throw new Error('invalid_flow');
      sessionStorage.setItem(STORAGE, JSON.stringify(candidate));
      flow = candidate;
    } else {
      const stored = sessionStorage.getItem(STORAGE);
      const candidate = stored && stored.length < 256 ? JSON.parse(stored) : null;
      if (!validFlow(candidate)) throw new Error('invalid_flow');
      flow = candidate;
    }
  } catch (error) {
    clearFlow();
    initialFailure = error && ['SecurityError', 'QuotaExceededError'].includes(error.name) ? text.storage : text.expired;
    try { history.replaceState(null, '', location.pathname); } catch (_) { /* Actions remain disabled. */ }
  }

  function fail(code) { const error = new Error(code); error.safeCode = code; return error; }
  function bytes(value, min, max) {
    if (typeof value !== 'string' || value.length > max * 2 || !/^[A-Za-z0-9_-]+$/.test(value)) throw fail('invalid');
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    if (binary.length < min || binary.length > max) throw fail('invalid');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  function encoded(value) {
    let binary = '';
    for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function descriptors(values) {
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.length > 100) throw fail('invalid');
    return values.map(value => {
      if (!value || value.type !== 'public-key') throw fail('invalid');
      const result = {type: 'public-key', id: bytes(value.id, 1, 1024)};
      if (Array.isArray(value.transports)) result.transports = value.transports.filter(item => ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'].includes(item));
      return result;
    });
  }
  function publicOptions(options, registration) {
    if (!options || (registration ? options.rp?.id : options.rpId) !== RP_ID) throw fail('invalid');
    const result = {challenge: bytes(options.challenge, 16, 256), timeout: 120000};
    if (registration) {
      if (!options.user || typeof options.user.name !== 'string' || options.user.name.length > 256 ||
          typeof options.user.displayName !== 'string' || options.user.displayName.length > 256 ||
          !Array.isArray(options.pubKeyCredParams) || !options.pubKeyCredParams.length || options.pubKeyCredParams.length > 20) throw fail('invalid');
      const algorithms = options.pubKeyCredParams.filter(param => param?.type === 'public-key' && [-7, -257, -8].includes(param.alg));
      if (!algorithms.length) throw fail('invalid');
      return {...result, rp: {id: RP_ID, name: 'Pablicus'},
        user: {id: bytes(options.user.id, 1, 64), name: options.user.name, displayName: options.user.displayName},
        pubKeyCredParams: algorithms, attestation: 'none', extensions: {credProps: true},
        authenticatorSelection: {residentKey: 'required', requireResidentKey: true, userVerification: 'required'},
        excludeCredentials: descriptors(options.excludeCredentials)};
    }
    return {...result, rpId: RP_ID, userVerification: 'required', allowCredentials: descriptors(options.allowCredentials)};
  }
  function credentialJSON(value, registration) {
    if (!value || value.type !== 'public-key' || !value.rawId || !value.response?.clientDataJSON) throw fail('invalid');
    const rawId = encoded(value.rawId), response = value.response;
    if (value.id !== rawId) throw fail('invalid');
    const serialized = {id: rawId, rawId, type: 'public-key',
      clientExtensionResults: typeof value.getClientExtensionResults === 'function' ? value.getClientExtensionResults() : {},
      ...(value.authenticatorAttachment ? {authenticatorAttachment: value.authenticatorAttachment} : {}),
      response: {clientDataJSON: encoded(response.clientDataJSON)}};
    if (registration) {
      if (!response.attestationObject) throw fail('invalid');
      serialized.response.attestationObject = encoded(response.attestationObject);
      serialized.response.transports = typeof response.getTransports === 'function' ? response.getTransports() : [];
    } else {
      if (!response.authenticatorData || !response.signature) throw fail('invalid');
      serialized.response.authenticatorData = encoded(response.authenticatorData);
      serialized.response.signature = encoded(response.signature);
      if (response.userHandle) serialized.response.userHandle = encoded(response.userHandle);
    }
    return serialized;
  }
  function redirectTarget(value) {
    if (typeof value !== 'string' || value.length > 4096 || !value.startsWith(CALLBACK + '?')) throw fail('invalid');
    const target = new URL(value);
    if (target.origin + target.pathname !== CALLBACK || target.username || target.password || target.hash || target.port) throw fail('invalid');
    const keys = Array.from(target.searchParams.keys());
    if (keys.length !== 2 || !keys.includes('code') || !keys.includes('state')) throw fail('invalid');
    for (const key of ['code', 'state']) {
      const item = target.searchParams.get(key);
      if (!item || item.length > 2048 || /[\u0000-\u001f\u007f]/.test(item)) throw fail('invalid');
    }
    return target.href;
  }
  async function request(path, payload, task) {
    if (!validFlow(flow)) throw fail('expired');
    const timeout = setTimeout(() => { task.timedOut = true; task.controller.abort(); }, 20000);
    try {
      const response = await fetch(API + path, {
        method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + flow.secret},
        body: JSON.stringify({flowId: flow.flowId, ...payload}), mode: 'cors', credentials: 'omit',
        cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: task.controller.signal
      });
      const body = await response.text();
      if (body.length > 131072) throw fail('invalid');
      let result;
      try { result = JSON.parse(body); } catch (_) { throw fail('invalid'); }
      if (!response.ok) {
        const error = fail('server');
        error.serverCode = typeof result?.error === 'string' ? result.error : '';
        error.status = response.status;
        throw error;
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('invalid');
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  function ready() {
    const get = id => document.getElementById(id);
    const form = get('createAccount'), name = get('displayName'), create = get('createKey'), use = get('useKey');
    const status = get('passkeyStatus'), cancel = get('cancelKey'), restart = get('restartLogin'), main = get('passkeyStart');
    const supported = typeof PublicKeyCredential === 'function' && typeof AbortController === 'function' &&
      typeof navigator.credentials?.create === 'function' && typeof navigator.credentials?.get === 'function';
    if (!initialFailure && !supported) initialFailure = text.unsupported;
    function render(message) {
      const disabled = !!initialFailure || !flow || !!active || finished;
      name.disabled = create.disabled = use.disabled = disabled;
      main.setAttribute('aria-busy', active ? 'true' : 'false');
      cancel.hidden = !active || active.verifying;
      restart.hidden = !!active || (!initialFailure && !!flow && !finished);
      status.textContent = message || '';
    }
    function current(task) {
      if (active !== task || task.controller.signal.aborted) throw fail('cancelled');
    }
    function explain(error, task) {
      if (task.verifying) return text.consumed;
      if (task.timedOut) return text.network;
      if (['AbortError', 'NotAllowedError'].includes(error?.name) || error?.safeCode === 'cancelled') return text.cancelled;
      if (error?.name === 'InvalidStateError') return text.exists;
      if (error?.name === 'NotSupportedError') return text.unsupported;
      if (error?.name === 'SecurityError') return text.origin;
      if (error?.safeCode === 'expired' || ['invalid_grant', 'invalid_token', 'invalid_flow', 'flow_expired', 'flow_consumed', 'challenge_consumed'].includes(error?.serverCode) || [401, 410].includes(error?.status)) return text.expired;
      if (error?.serverCode === 'forbidden_origin') return text.origin;
      if (['invalid_request', 'invalid_client', 'not_found', 'method_not_allowed'].includes(error?.serverCode)) return text.invalid;
      if (error?.status === 429 || error?.serverCode === 'rate_limited') return text.limited;
      if (error?.status === 503 || ['unavailable', 'not_configured', 'provider_disabled'].includes(error?.serverCode)) return text.unavailable;
      if (error?.safeCode === 'invalid') return text.invalid;
      return text.network;
    }
    async function ceremony(registration) {
      if (active || finished || initialFailure) return;
      if (!validFlow(flow)) {
        clearFlow(); initialFailure = text.expired; render(initialFailure); return;
      }
      const displayName = name.value.trim();
      if (registration && (!displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName))) {
        render(text.name); name.focus(); return;
      }
      const task = {controller: new AbortController(), verifying: false};
      active = task;
      render(text.prepare);
      try {
        const kind = registration ? '/registration' : '/authentication';
        const started = await request(kind + '/options', registration ? {name: displayName} : {}, task);
        current(task);
        const options = publicOptions(started.options, registration);
        render(registration ? text.register : text.signin);
        const credential = await navigator.credentials[registration ? 'create' : 'get']({publicKey: options, signal: task.controller.signal});
        current(task);
        if (!credential) throw fail('cancelled');
        const serialized = credentialJSON(credential, registration);
        task.verifying = true;
        render(text.verify);
        const checked = await request(kind + '/verify', {credential: serialized}, task);
        current(task);
        const redirect = redirectTarget(checked.redirectTo);
        clearFlow(); finished = true; active = null;
        render(text.success);
        location.replace(redirect);
      } catch (error) {
        if (active !== task) return;
        const message = explain(error, task);
        if (task.verifying || [text.expired, text.invalid, text.origin, text.unsupported, text.unavailable].includes(message)) {
          clearFlow(); initialFailure = message;
        }
        active = null;
        render(message);
      }
    }
    form.addEventListener('submit', event => { event.preventDefault(); void ceremony(true); });
    use.addEventListener('click', () => { void ceremony(false); });
    cancel.addEventListener('click', () => { if (active && !active.verifying) active.controller.abort(); });
    window.addEventListener('pagehide', () => {
      if (active) {
        active.controller.abort();
        if (active.verifying) clearFlow();
        active = null;
      }
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) {
        if (!validFlow(flow)) { clearFlow(); initialFailure = text.expired; }
        render(initialFailure);
      }
    });
    render(initialFailure);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true});
  else ready();
})();
