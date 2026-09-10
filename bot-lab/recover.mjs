/** Refresh only known public shell cache entries, after a complete network preflight.
 * Never reads/writes Auth storage, IndexedDB, messages, or service worker registration.
 */
export const RELEASE = '20260910-login-recovery-1';
const MAX_BYTES = 2_000_000;
const MAX_FILES = 90;
const CACHE_PREFIX = 'pablicus-shell-';
const fileExtension = /\.(?:html|js|mjs|css)$/i;

export function resourceUrls(html, base, Parser = DOMParser) {
  const doc = new Parser().parseFromString(html, 'text/html');
  const urls = new Set([base.href, new URL('index.html', base).href, new URL('app.js', base).href]);
  const nodes = doc.querySelectorAll('script[src],link[rel="stylesheet"][href]');
  for (const node of nodes) {
    const url = new URL(node.getAttribute(node.tagName === 'SCRIPT' ? 'src' : 'href'), base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) ||
        url.search || url.hash || !fileExtension.test(url.pathname)) {
      throw new Error('Страница ссылается на неожиданный ресурс. Обновление остановлено.');
    }
    urls.add(url.href);
  }
  if (urls.size > MAX_FILES || !doc.querySelector('script[src="app.js"]')) {
    throw new Error('Получена другая версия страницы. Обновление остановлено.');
  }
  return [...urls];
}

function verifyText(text, kind) {
  if (kind === 'html' && (!/<!doctype html/i.test(text) || !/id=["']loginPane["']/.test(text))) {
    throw new Error('Сервер вернул не страницу входа Public. Ничего не изменено.');
  }
  if (kind === 'app' && (!text.includes('supabase.createClient') || /\$\(['"]logo['"]\)\s*\.\s*src\s*=/.test(text))) {
    throw new Error('Свежий серверный файл не прошёл проверку. Ничего не изменено. Пришлите диагностику.');
  }
}

export async function prepareLogin({base, fetcher = fetch, cacheStorage = globalThis.caches,
  Parser = DOMParser, onProgress = () => {}, nonce = crypto.randomUUID()}) {
  if (base.protocol !== 'https:' || base.origin !== 'https://matveyryabokon30-crypto.github.io' ||
      base.pathname !== '/vision-talk/pablicus/' || base.search || base.hash) throw new Error('Недопустимый адрес входа.');
  const report = {release: RELEASE, state: 'checking', filesChecked: 0, cachesRefreshed: 0,
    writes: 0, privateDataAccessed: false, authSettingsChanged: false, serviceWorkerChanged: false};
  const fresh = new Map();
  async function load(canonical, kind = '') {
    const url = new URL(canonical); url.searchParams.set('bot_lab_asset', nonce);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetcher(url.href, {cache:'no-store', credentials:'omit', redirect:'error',
        referrerPolicy:'no-referrer', signal:controller.signal});
      if (!response.ok || response.type === 'opaque') throw new Error('Не удалось загрузить свежие файлы. Проверьте интернет.');
      const actual = response.url && new URL(response.url);
      if (actual && (actual.origin !== base.origin || actual.pathname !== url.pathname)) throw new Error('Неожиданный ответ сервера.');
      const size = Number(response.headers.get('content-length'));
      if (size > MAX_BYTES) throw new Error('Неожиданный размер файла.');
      const bytes = await response.clone().arrayBuffer();
      if (bytes.byteLength > MAX_BYTES) throw new Error('Неожиданный размер файла.');
      const text = new TextDecoder().decode(bytes);
      if (kind) verifyText(text, kind);
      if (fileExtension.test(url.pathname) && !url.pathname.endsWith('.html') && /^\s*<!doctype html/i.test(text)) {
        throw new Error('Вместо файла получена HTML-страница. Обновление остановлено.');
      }
      fresh.set(canonical, response); report.filesChecked += 1;
      onProgress(`Проверяю свежие файлы: ${report.filesChecked}`, {...report});
      return text;
    } finally { clearTimeout(timer); }
  }
  const htmlUrl = new URL('index.html', base).href;
  const html = await load(htmlUrl, 'html');
  const urls = resourceUrls(html, base, Parser);
  await load(new URL('app.js',base).href, 'app');
  // GET / and index.html contain the same canonical shell; no private URLs are copied.
  fresh.set(base.href, fresh.get(htmlUrl).clone());
  const pending = urls.filter(url => !fresh.has(url));
  let index = 0;
  await Promise.all(Array.from({length:Math.min(4,pending.length)}, async () => {
    while (index < pending.length) { const url = pending[index++]; await load(url); }
  }));
  // No cache mutations occur until EVERY referenced JS/CSS file has been fetched.
  if (cacheStorage) {
    const names = (await cacheStorage.keys()).filter(name => name.startsWith(CACHE_PREFIX));
    for (const name of names) {
      const cache = await cacheStorage.open(name);
      const keys = await cache.keys();
      const hasShell = keys.some(req => {
        const u = new URL(req.url);
        return u.origin === base.origin && u.pathname.startsWith(base.pathname);
      });
      if (!hasShell) continue;
      for (const url of urls) {
        await cache.put(url, fresh.get(url).clone()); report.writes += 1;
      }
      report.cachesRefreshed += 1;
    }
  }
  report.state = 'prepared';
  report.cacheFound = report.cachesRefreshed > 0;
  report.loginNotTested = true;
  const login = new URL(base); login.searchParams.set('bot_lab_login', RELEASE);
  report.loginUrl = login.href;
  return report;
}

export function mount() {
  const $ = id => document.getElementById(id);
  const base = new URL('../pablicus/', location.href);
  let report = {release:RELEASE,state:'not_started'}, busy = false;
  const say = (text,error=false) => {$('status').textContent=text; $('status').className=error?'bad':'muted';};
  $('prepare').onclick = async () => {
    if (busy) return; busy=true; $('prepare').disabled=true; $('openLogin').hidden=true;
    $('copy').disabled=true; $('report').hidden=true;
    try {
      if (!isSecureContext) throw new Error('Откройте страницу по HTTPS в Safari.');
      report = await prepareLogin({base,onProgress:(text,snapshot)=>{report=snapshot;say(text);}});
      $('openLogin').href=report.loginUrl; $('openLogin').hidden=false;
      say(report.cacheFound ? 'Сохранённые файлы интерфейса обновлены. Теперь нажмите «Войти в Public».' :
        'Свежие файлы проверены. Старый кэш Public в этом браузере не найден. Нажмите «Войти в Public».');
    } catch (error) {
      report={...report,state:'failed',error:error?.name==='AbortError'?'NETWORK_TIMEOUT':String(error.message||'Не удалось подготовить вход.')};
      say('Подготовка не завершена. '+report.error+' Нажмите «Скопировать диагностику» и пришлите её Эмбер.',true);
    } finally {busy=false;$('prepare').disabled=false;$('copy').disabled=false;}
  };
  $('copy').onclick=async()=>{
    const value=JSON.stringify(report,null,2);
    try{await navigator.clipboard.writeText(value);say('Диагностика скопирована. Вставьте её в чат.');}
    catch{$('report').value=value;$('report').hidden=false;$('report').focus();$('report').select();say('Выделите и скопируйте текст диагностики ниже.');}
  };
}
if (typeof document !== 'undefined' && document.getElementById('recovery')) mount();
