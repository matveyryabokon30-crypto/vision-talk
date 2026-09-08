/* OAuth UI only. Provider credentials and public account provisioning must be
 * configured and verified on the server before its readiness flags are enabled.
 * This module never receives mailbox passwords or marks profiles approved. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PablicusOAuth = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const catalog = Object.freeze([
    {id: 'google', name: 'Google', domains: ['gmail.com', 'googlemail.com']},
    {id: 'custom:yandex', name: 'Яндекс', domains: ['yandex.ru', 'yandex.com', 'ya.ru']},
    {id: 'custom:mailru', name: 'Mail.ru', domains: ['mail.ru', 'inbox.ru', 'list.ru', 'bk.ru']},
    {id: 'azure', name: 'Outlook / Hotmail', domains: ['outlook.com', 'hotmail.com', 'live.com']}
  ].map(function (provider) {
    return Object.freeze({...provider, domains: Object.freeze(provider.domains)});
  }));
  const messages = Object.freeze({
    unavailable: 'Этот способ входа ещё подключается.',
    opening: 'Открываем страницу входа…',
    error: 'Не удалось открыть вход. Попробуйте ещё раз.',
    pending: 'Вход через почтовые аккаунты подключается.',
    ready: 'Выберите свой сервис. Отдельный пароль Pablicus не нужен.'
  });

  function providerForEmail(email) {
    if (typeof email !== 'string') return null;
    const parts = email.trim().toLowerCase().split('@');
    if (parts.length !== 2 || !parts[0] || /\s/.test(parts[0])) return null;
    return catalog.find(function (provider) { return provider.domains.includes(parts[1]); }) || null;
  }

  function isEnabled(config, id) {
    return !!(catalog.some(function (provider) { return provider.id === id; }) &&
      config && config.publicSignupReady === true && config.providers &&
      Object.prototype.hasOwnProperty.call(config.providers, id) && config.providers[id] === true);
  }

  function validateAuthorizeUrl(value, projectUrl, provider, redirectTo) {
    const project = new URL(projectUrl);
    const redirect = new URL(redirectTo);
    const url = new URL(value);
    if (project.protocol !== 'https:' || project.username || project.password ||
        redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash ||
        url.origin !== project.origin || url.pathname !== '/auth/v1/authorize' ||
        url.username || url.password || url.hash) throw new Error('invalid_oauth_destination');
    function single(name) {
      const values = url.searchParams.getAll(name);
      if (values.length !== 1) throw new Error('invalid_oauth_parameters');
      return values[0];
    }
    if (single('provider') !== provider || single('redirect_to') !== redirect.href ||
        single('code_challenge_method') !== 's256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(single('code_challenge'))) throw new Error('invalid_oauth_parameters');
    return url.href;
  }

  function create(options) {
    options = options || {};
    const {client, projectUrl, redirectTo, config} = options;
    const onNavigate = options.onNavigate || function (url) { window.location.assign(url); };
    const onChange = options.onChange || function () {};
    let state = {phase: 'idle', provider: null, message: ''};
    let busy = false;
    function snapshot() { return {...state, busy}; }
    function update(patch) { state = {...state, ...patch}; onChange(snapshot()); }

    async function start(id) {
      if (busy) return false;
      if (!isEnabled(config, id)) {
        update({phase: 'error', provider: null, message: messages.unavailable});
        return false;
      }
      busy = true;
      update({phase: 'opening', provider: id, message: messages.opening});
      try {
        const authOptions = {redirectTo, skipBrowserRedirect: true};
        if (id === 'azure') authOptions.scopes = 'email';
        const result = await client.auth.signInWithOAuth({provider: id, options: authOptions});
        if (!result || result.error || !result.data || result.data.provider !== id || !result.data.url) {
          throw new Error('oauth_unavailable');
        }
        const url = validateAuthorizeUrl(result.data.url, projectUrl, id, redirectTo);
        update({phase: 'redirecting'});
        await onNavigate(url);
        return true;
      } catch (_) {
        busy = false;
        update({phase: 'error', provider: null, message: messages.error});
        return false;
      }
    }

    // Returning through the browser's back/forward cache must allow another try.
    function resume() {
      if (state.phase !== 'redirecting') return;
      busy = false;
      update({phase: 'idle', provider: null, message: ''});
    }
    return {start, snapshot, resume};
  }

  function mount(options) {
    const element = options.element;
    const doc = element.ownerDocument;
    const view = doc.defaultView;
    const list = doc.createElement('div');
    list.className = 'oauth-providers';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Вход через почтовый аккаунт');
    const status = doc.createElement('p');
    status.className = 'oauth-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const buttons = catalog.map(function (provider) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'oauth-provider';
      button.dataset.oauthProvider = provider.id;
      list.appendChild(button);
      return {provider, button};
    });
    element.replaceChildren(list, status);
    function render(state) {
      let enabledCount = 0;
      buttons.forEach(function ({provider, button}) {
        const enabled = isEnabled(options.config, provider.id);
        if (enabled) enabledCount++;
        button.disabled = !enabled || state.busy;
        button.textContent = enabled ? 'Войти через ' + provider.name : provider.name + ' — Подключается';
      });
      element.setAttribute('aria-busy', String(state.busy));
      status.textContent = state.message || (enabledCount ? messages.ready : messages.pending);
      if (options.onChange) options.onChange(state);
    }
    const flow = create({...options, onChange: render});
    const listeners = buttons.map(function ({provider, button}) {
      const listener = function () { void flow.start(provider.id); };
      button.addEventListener('click', listener);
      return {button, listener};
    });
    const resume = function (event) { if (event.persisted) flow.resume(); };
    if (view) view.addEventListener('pageshow', resume);
    render(flow.snapshot());
    return {...flow, destroy: function () {
      listeners.forEach(function ({button, listener}) { button.removeEventListener('click', listener); });
      if (view) view.removeEventListener('pageshow', resume);
    }};
  }

  return Object.freeze({catalog, providerForEmail, isEnabled, validateAuthorizeUrl, create, mount});
});
