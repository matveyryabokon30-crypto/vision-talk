/* Native Supabase passkeys. Server readiness must be explicitly enabled.
 * The host must hold Auth events during signIn until authenticate has checked
 * the profile. No biometric data or private key is available to this module. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PablicusPasskeys = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const messages = Object.freeze({
    unavailable: 'Вход с ключом доступа ещё подключается.',
    unsupported: 'Этот браузер не поддерживает ключи доступа. Войдите другим способом или откройте Pablicus в Safari или Chrome.',
    insecure: 'Ключ доступа работает только на защищённом адресе Pablicus. Откройте сайт по HTTPS.',
    checking: 'Проверяем доступ к аккаунту…',
    registering: 'Создайте ключ доступа в системном окне устройства…',
    signingIn: 'Выберите ключ доступа в системном окне устройства…',
    verifying: 'Проверяем ключ доступа…',
    registered: 'Ключ доступа добавлен. Теперь с ним можно входить в Pablicus.',
    signedIn: 'Вход выполнен.',
    cancelled: 'Действие отменено или время ожидания истекло. Можно попробовать снова.',
    account: 'Сначала войдите в подтверждённый аккаунт Pablicus с разрешённым доступом.',
    changed: 'Аккаунт изменился. Откройте профиль нужного аккаунта и попробуйте снова.',
    network: 'Не удалось связаться с сервером. Проверьте интернет и попробуйте снова.',
    origin: 'Ключ доступа недоступен на этом адресе. Откройте основной адрес Pablicus.',
    exists: 'Этот ключ доступа уже добавлен. Можно использовать его для входа.',
    missing: 'Ключ доступа не найден. Выберите другой ключ или войдите другим способом.',
    limit: 'Достигнут предел ключей доступа для этого аккаунта.',
    expired: 'Время проверки истекло. Попробуйте снова.',
    error: 'Не удалось завершить действие с ключом доступа. Попробуйте снова или войдите другим способом.'
  });

  function support(environment) {
    const env = environment || globalThis;
    if (env.isSecureContext !== true) return {supported: false, message: messages.insecure};
    const credentials = env.navigator && env.navigator.credentials;
    if (typeof env.PublicKeyCredential !== 'function' || typeof env.AbortController !== 'function' ||
        typeof env.atob !== 'function' || typeof env.btoa !== 'function' || !credentials ||
        typeof credentials.create !== 'function' || typeof credentials.get !== 'function') {
      return {supported: false, message: messages.unsupported};
    }
    return {supported: true, message: ''};
  }

  function failure(error) {
    const code = error && error.code, name = error && error.name;
    if (code === 'passkey_disabled' || code === 'passkey_unavailable') return messages.unavailable;
    if (name === 'AuthSessionMissingError' || code === 'account_required' || code === 'email_not_confirmed' || code === 'phone_not_confirmed' ||
        code === 'user_banned' || code === 'anonymous_provider_disabled') return messages.account;
    if (code === 'account_changed') return messages.changed;
    if (name === 'AbortError' || name === 'NotAllowedError' || code === 'cancelled') return messages.cancelled;
    if (name === 'SecurityError' || code === 'webauthn_rp_id_mismatch' || code === 'webauthn_origin_mismatch') return messages.origin;
    if (name === 'NotSupportedError' || code === 'webauthn_not_supported') return messages.unsupported;
    if (name === 'InvalidStateError' || code === 'webauthn_credential_exists') return messages.exists;
    if (code === 'webauthn_credential_not_found') return messages.missing;
    if (code === 'too_many_passkeys') return messages.limit;
    if (code === 'webauthn_challenge_expired' || code === 'webauthn_challenge_not_found') return messages.expired;
    if (name === 'AuthRetryableFetchError' || name === 'NetworkError' || name === 'TypeError' ||
        error && [502, 503, 504].includes(error.status)) return messages.network;
    // SDK WebAuthn wrappers preserve the native DOMException as their cause.
    if (error && error.cause && error.cause !== error) {
      const cause = failure({name: error.cause.name, code: error.cause.code});
      if (cause !== messages.error) return cause;
    }
    return messages.error;
  }

  function stop(code) { const error = new Error(code); error.code = code; return error; }
  function data(result) {
    if (!result || result.error) throw result && result.error || stop('invalid_response');
    return result.data;
  }
  function confirmed(user) {
    return !!(user && typeof user.id === 'string' && user.id && user.is_anonymous !== true &&
      (user.email_confirmed_at || user.phone_confirmed_at || user.confirmed_at));
  }
  function decode(value, env) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw stop('invalid_response');
    const text = env.atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(text, function (character) { return character.charCodeAt(0); });
  }
  function encode(value, env) {
    let text = '';
    for (const byte of new Uint8Array(value)) text += String.fromCharCode(byte);
    return env.btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function creationOptions(options, env) {
    if (!options || !options.user || !options.rp) throw stop('invalid_response');
    // Explicit conversion also supports Safari versions predating the JSON API.
    return {...options, challenge: decode(options.challenge, env),
      user: {...options.user, id: decode(options.user.id, env)},
      authenticatorSelection: {...options.authenticatorSelection, residentKey: 'required', userVerification: 'required'},
      ...(options.excludeCredentials ? {excludeCredentials: options.excludeCredentials.map(function (credential) {
        return {...credential, id: decode(credential.id, env)};
      })} : {})};
  }
  function requestOptions(options, env) {
    if (!options || !options.rpId) throw stop('invalid_response');
    return {...options, challenge: decode(options.challenge, env), userVerification: 'required',
      ...(options.allowCredentials ? {allowCredentials: options.allowCredentials.map(function (credential) {
        return {...credential, id: decode(credential.id, env)};
      })} : {})};
  }
  function registrationJSON(credential, env) {
    if (!credential || credential.type !== 'public-key' || !credential.response ||
        !credential.rawId || !credential.response.clientDataJSON || !credential.response.attestationObject) {
      throw stop('invalid_response');
    }
    const response = credential.response;
    return {id: credential.id, rawId: encode(credential.rawId, env), type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: typeof credential.getClientExtensionResults === 'function' ? credential.getClientExtensionResults() : {},
      response: {clientDataJSON: encode(response.clientDataJSON, env), attestationObject: encode(response.attestationObject, env),
        transports: typeof response.getTransports === 'function' ? response.getTransports() : []}};
  }
  function authenticationJSON(credential, env) {
    if (!credential || credential.type !== 'public-key' || !credential.response || !credential.rawId ||
        !credential.response.clientDataJSON || !credential.response.authenticatorData || !credential.response.signature) {
      throw stop('invalid_response');
    }
    const response = credential.response;
    return {id: credential.id, rawId: encode(credential.rawId, env), type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: typeof credential.getClientExtensionResults === 'function' ? credential.getClientExtensionResults() : {},
      response: {clientDataJSON: encode(response.clientDataJSON, env), authenticatorData: encode(response.authenticatorData, env),
        signature: encode(response.signature, env), userHandle: response.userHandle ? encode(response.userHandle, env) : undefined}};
  }
  function metadata(passkey) {
    if (!passkey || typeof passkey.id !== 'string' || !passkey.id || passkey.id.length > 128) throw stop('invalid_response');
    return {id: passkey.id,
      friendly_name: typeof passkey.friendly_name === 'string' ? passkey.friendly_name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) : '',
      created_at: typeof passkey.created_at === 'string' ? passkey.created_at.slice(0, 64) : '',
      last_used_at: typeof passkey.last_used_at === 'string' ? passkey.last_used_at.slice(0, 64) : null};
  }

  function create(options) {
    options = options || {};
    const client = options.client, signInClient = options.signInClient || client, env = options.environment || globalThis;
    const capability = support(env), enabled = options.enabled === true;
    const onChange = options.onChange || function () {};
    let state = {phase: 'idle', operation: null, message: !enabled ? messages.unavailable : capability.message,
      validated: false, credentials: []};
    let active = null, destroyed = false, credentialsUserId = null;
    function snapshot() { return {...state, credentials: state.credentials.map(function (item) { return {...item}; }),
      busy: !!active, enabled, supported: capability.supported}; }
    function update(patch) {
      state = {...state, ...patch};
      try { onChange(snapshot()); } catch (_) { /* A UI observer cannot interrupt a credential operation. */ }
    }
    function guard(task) {
      if (task.changed) throw stop('account_changed');
      if (destroyed || task !== active || task.controller.signal.aborted) throw stop('cancelled');
    }
    async function identity(task, expectedId) {
      guard(task);
      const identityClient = task.operation === 'signIn' ? signInClient : client;
      const user = data(await identityClient.auth.getUser())?.user;
      guard(task);
      if (expectedId && user?.id !== expectedId) throw stop('account_changed');
      if (!confirmed(user)) throw stop('account_required');
      return user;
    }
    async function account(task, expectedId) {
      const user = await identity(task, expectedId);
      if (typeof options.getAccount !== 'function') throw stop('account_required');
      const profile = await options.getAccount({userId: user.id});
      guard(task);
      if (!profile || profile.id !== user.id || profile.approved !== true) throw stop('account_required');
      await identity(task, user.id);
      if (credentialsUserId && credentialsUserId !== user.id) state.credentials = [];
      task.userId = user.id;
      return user;
    }
    function begin(operation) {
      if (active || destroyed) return null;
      if (!enabled || !capability.supported) {
        update({phase: 'error', operation, validated: false, message: !enabled ? messages.unavailable : capability.message});
        return null;
      }
      active = {operation, controller: new env.AbortController(), userId: null, changed: false};
      update({phase: 'working', operation, validated: false, message: operation === 'signIn' ? messages.signingIn : messages.checking,
        ...(operation === 'list' ? {credentials: []} : {})});
      return active;
    }
    function finish(task, patch) {
      if (task !== active) return;
      active = null;
      // operation remains visible for this final notification so the host can
      // discard held SIGNED_IN events when validated is false.
      update(patch);
    }
    async function clearCandidate(session) {
      if (!session?.user?.id) return;
      try {
        const current = data(await signInClient.auth.getSession())?.session;
        if (current?.user?.id === session.user.id && current.access_token === session.access_token) {
          await signInClient.auth.signOut({scope: 'local'});
        }
      } catch (_) { /* Host never admits an unvalidated session, even if cleanup is offline. */ }
    }

    async function signIn() {
      const task = begin('signIn');
      if (!task) return false;
      let session = null;
      try {
        if (typeof signInClient?.auth?.passkey?.startAuthentication !== 'function' ||
            typeof signInClient.auth.passkey.verifyAuthentication !== 'function' || typeof options.authenticate !== 'function') throw stop('passkey_unavailable');
        const challenge = data(await signInClient.auth.passkey.startAuthentication());
        guard(task);
        if (!challenge?.challenge_id) throw stop('invalid_response');
        // The high-level method offers no userVerification override. The
        // documented two-step API lets us require the device's unlock proof.
        const credential = await env.navigator.credentials.get({publicKey: requestOptions(challenge.options, env), signal: task.controller.signal});
        guard(task);
        if (!credential) throw stop('cancelled');
        update({message: messages.verifying});
        const result = await signInClient.auth.passkey.verifyAuthentication({challengeId: challenge.challenge_id,
          credential: authenticationJSON(credential, env)});
        session = result?.data?.session || null;
        data(result);
        guard(task);
        if (!session?.user?.id || !session.access_token || result.data.user?.id !== session.user.id) throw stop('invalid_response');
        const user = await identity(task, session.user.id);
        if (await options.authenticate({...session, user}, {signal: task.controller.signal}) !== true) throw stop('account_required');
        guard(task);
        finish(task, {phase: 'success', validated: true, message: messages.signedIn});
        return true;
      } catch (error) {
        await clearCandidate(session);
        finish(task, {phase: 'error', validated: false, message: failure(error)});
        return false;
      }
    }

    async function register() {
      const task = begin('register');
      if (!task) return false;
      try {
        if (typeof client?.auth?.passkey?.startRegistration !== 'function' ||
            typeof client.auth.passkey.verifyRegistration !== 'function') throw stop('passkey_unavailable');
        const user = await account(task);
        const challenge = data(await client.auth.passkey.startRegistration());
        if (!challenge?.challenge_id) throw stop('invalid_response');
        await identity(task, user.id);
        update({message: messages.registering});
        const credential = await env.navigator.credentials.create({publicKey: creationOptions(challenge.options, env), signal: task.controller.signal});
        guard(task);
        if (!credential) throw stop('cancelled');
        // The high-level registerPasskey method obtains the current session
        // again after the browser prompt. Split the documented API so an account
        // switch cannot attach this credential to a replacement session.
        await account(task, user.id);
        update({message: messages.verifying});
        const passkey = metadata(data(await client.auth.passkey.verifyRegistration({
          challengeId: challenge.challenge_id, credential: registrationJSON(credential, env)})));
        await account(task, user.id);
        credentialsUserId = user.id;
        finish(task, {phase: 'success', message: messages.registered,
          credentials: state.credentials.filter(function (item) { return item.id !== passkey.id; }).concat([passkey])});
        return passkey;
      } catch (error) {
        finish(task, {phase: 'error', message: failure(error), credentials: []});
        return false;
      }
    }

    async function list() {
      const task = begin('list');
      if (!task) return false;
      try {
        if (typeof client?.auth?.passkey?.list !== 'function') throw stop('passkey_unavailable');
        const user = await account(task), result = data(await client.auth.passkey.list());
        if (!Array.isArray(result)) throw stop('invalid_response');
        await account(task, user.id);
        const credentials = result.map(metadata);
        credentialsUserId = user.id;
        finish(task, {phase: 'idle', message: '', credentials});
        return credentials.map(function (item) { return {...item}; });
      } catch (error) {
        finish(task, {phase: 'error', message: failure(error), credentials: []});
        return false;
      }
    }
    function cancel() {
      if (!active) return false;
      active.controller.abort();
      return true;
    }
    const subscription = client?.auth?.onAuthStateChange?.(function (_event, session) {
      // Synchronous only: Supabase invokes listeners while holding its lock.
      if (credentialsUserId && session?.user?.id !== credentialsUserId) {
        credentialsUserId = null;
        update({credentials: []});
      }
      if (!active || active.operation === 'signIn' || !active.userId) return;
      if (!session || session.user?.id !== active.userId) {
        active.changed = true;
        active.controller.abort();
      }
    })?.data?.subscription;
    function destroy() { destroyed = true; cancel(); subscription?.unsubscribe(); state.credentials = []; credentialsUserId = null; }
    return {signIn, register, list, cancel, destroy, snapshot};
  }
  return Object.freeze({create, support, messages});
});
