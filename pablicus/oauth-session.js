/* Exchange OAuth codes in the initiating browser. No cross-browser relay.
 * Password and email-proof sign-ins keep the existing Supabase session key.
 */
(function (root) {
  'use strict';
  const callbackKeys = ['code', 'error', 'error_code', 'error_description', 'error_uri'];
  const retryMessage = 'Не удалось завершить вход. Нажмите кнопку своей почты и попробуйте снова.';
  const otherBrowserMessage = 'Начните вход заново в этом окне: здесь нет подтверждения начатого входа.';
  const fragmentKeys = [...callbackKeys, 'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'token_type', 'expires_in', 'expires_at', 'type'];
  function capture({href = location.href, replaceUrl = url => history.replaceState(null, '', url)} = {}) {
    const url = new URL(href), fragment = new URLSearchParams(url.hash.slice(1));
    let changed = false;
    for (const key of callbackKeys) if (url.searchParams.has(key)) {url.searchParams.delete(key);changed = true;}
    if (fragmentKeys.some(key => fragment.has(key))) {
      for (const key of fragmentKeys) fragment.delete(key);
      url.hash = fragment.toString();changed = true;
    }
    if (changed) replaceUrl(url.href);
    return href;
  }

  async function restore({client, storageKey, href = location.href,
    storage = localStorage, replaceUrl = url => history.replaceState(null, '', url)}) {
    const url = new URL(href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const hasCallback = callbackKeys.some(key => url.searchParams.has(key)) || fragmentKeys.some(key => fragment.has(key));
    if (!hasCallback) {
      const result = await client.auth.getSession();
      if (result.error) throw Error(retryMessage);
      return result.data?.session || null;
    }
    const codes = url.searchParams.getAll('code');
    const denied = url.searchParams.get('error') === 'access_denied' || fragment.get('error') === 'access_denied';
    const hasError = ['error', 'error_code', 'error_description'].some(key => url.searchParams.has(key) || fragment.has(key));
    // Remove provider-supplied text and the code before any network operation.
    capture({href,replaceUrl});
    if (hasError) throw Error(denied ? 'Вход отменён. Можно выбрать аккаунт и попробовать снова.' : retryMessage);
    if (fragment.has('access_token') || fragment.has('refresh_token')) throw Error(retryMessage);
    if (codes.length !== 1 || !codes[0] || codes[0].length > 2048) throw Error(retryMessage);
    let verifier;
    try { verifier = storage.getItem(storageKey + '-code-verifier'); } catch {}
    if (!verifier) throw Error(otherBrowserMessage);
    let exchanged = false;
    try {
      const result = await client.auth.exchangeCodeForSession(codes[0]);
      if (result.error || !result.data?.session?.user?.id) throw Error(retryMessage);
      exchanged = true;
      const identity = await client.auth.getUser();
      if (identity.error || identity.data?.user?.id !== result.data.session.user.id) throw Error(retryMessage);
      return {...result.data.session, user: identity.data.user};
    } catch {
      if (exchanged) {
        try { await client.auth.signOut({scope: 'local'}); } catch {}
      }
      throw Error(retryMessage);
    } finally {
      try { storage.removeItem(storageKey + '-code-verifier'); } catch {}
    }
  }
  const api = Object.freeze({capture,restore});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PablicusOAuthSession = api;
})(globalThis);
