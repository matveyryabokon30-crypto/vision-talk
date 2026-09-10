import { PROJECT, RELEASE, createPeerTester, readAccessToken, validateCode, validateActor } from './peer-core.mjs?v=20260910-peer-2';
const $ = id => document.getElementById(id);
const storage = { getItem: key => { try { return localStorage.getItem(key); } catch { return null; } } };
const getToken = () => readAccessToken(storage);
const tester = createPeerTester({ getToken });
const PENDING = 'public-bot-peer:v2:pending';
let target = null, expectedActor = null, active = null, busy = false, checking = false, result = null, ticket = 0;
function say(text, bad = false) { $('state').textContent = text; $('state').className = bad ? 'bad' : 'good'; }
function controls() {
  $('connect').disabled = busy || checking; $('useCode').disabled = busy || checking; $('target').disabled = busy || checking;
  $('runPeer').disabled = busy || checking || !active || !target;
  $('copyResult').disabled = !result || busy; $('saveResult').disabled = !result || busy;
}
function targetLabel() {
  $('targetState').textContent = target ? 'Код другого участника заполнен. Ничего переносить с другого телефона не нужно.' : 'Открой ссылку с кодом от Эмбер либо вставь код другого участника.';
  $('codeDetails').open = !target; controls();
}
function storeTarget() { try { sessionStorage.setItem(PENDING, JSON.stringify({target, expectedActor})); } catch {} }
function captureTarget() {
  const hash = location.hash;
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  try {
    if (hash) {
      if (hash.length > 4096) throw Error('Ссылка с кодом слишком длинная.');
      const params = new URLSearchParams(hash.slice(1));
      target = validateCode(params.get('code')); expectedActor = validateActor(params.get('actor')); storeTarget();
    } else {
      const saved = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
      if (saved?.target) { target = validateCode(saved.target); expectedActor = validateActor(saved.expectedActor); }
    }
    if (target) $('target').value = JSON.stringify(target, null, 2);
  } catch (e) { target = null; expectedActor = null; $('outcome').textContent = e.message; $('outcome').className = 'bad'; }
  targetLabel();
}
function render(r) {
  result = r; $('checks').replaceChildren();
  for (const row of r.checks || []) { const item = document.createElement('li'); item.className = row.pass === true ? 'good' : row.pass === false ? 'bad' : 'muted'; item.textContent = `${row.pass === true ? '✓' : row.pass === false ? '✕' : '—'} ${row.name} · HTTP ${row.status}`; $('checks').append(item); }
  $('outcome').textContent = r.complete ? '4 из 4 пройдены. Нажми «Скопировать результат» ниже.' : r.failure || `Проверка: ${r.checks.length} из 4…`;
  $('outcome').className = r.complete ? 'good' : r.failure ? 'bad' : 'muted'; controls();
}
async function connect() {
  if (busy || checking) return; checking = true; active = null; const id = ++ticket; controls();
  say('Подтверждаю вход на сервере…'); $('identity').textContent = '';
  try {
    const current = await tester.verify(expectedActor); if (id !== ticket) return;
    active = current; $('identity').textContent = 'Аккаунт подтверждён: ' + current.actor;
    say('Вход подтверждён. Теперь нажми «Проверить доступ — 4 проверки».'); $('loginHelp').hidden = true;
  } catch (e) { if (id !== ticket) return; active = null; say(e.message, true); $('loginHelp').hidden = false; }
  finally { checking = false; controls(); }
}
$('useCode').onclick = () => {
  if (busy || checking) return;
  try { const next = validateCode($('target').value); target = next; result = null; $('checks').replaceChildren(); $('outcome').textContent = 'Код принят. Проверь вход и запусти четыре проверки.'; storeTarget(); targetLabel(); }
  catch (e) { target = null; $('targetState').textContent = e.message; $('codeDetails').open = true; controls(); }
};
$('runPeer').onclick = async () => {
  if (busy || checking || !target || !active) return;
  const was = active.actor; busy = true; controls(); $('copyState').textContent = ''; $('resultText').hidden = true;
  try {
    const r = await tester.run(target, { expectedActor: expectedActor || was, onProgress: render });
    render(r);
    if (['SESSION_INVALID','SESSION_CHANGED','IDENTITY_UNCONFIRMED','WRONG_ACCOUNT'].includes(r.error?.code)) {
      active = null; say(r.failure, true); $('loginHelp').hidden = false; $('loginCard').scrollIntoView({block:'start'});
    }
  } finally { busy = false; controls(); }
};
$('copyResult').onclick = async () => {
  if (!result || busy) return;
  const text = JSON.stringify(result, null, 2); $('resultText').value = text; $('resultText').hidden = false;
  try { await navigator.clipboard.writeText(text); $('copyState').textContent = 'Скопировано. Вставь в чат с Эмбер.'; }
  catch { $('resultText').focus(); $('resultText').select(); $('copyState').textContent = 'Выделен текст ниже: выбери «Копировать» и отправь Эмбер.'; }
};
$('saveResult').onclick = () => {
  if (!result || busy) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})), a = document.createElement('a');
  a.href = url; a.download = 'Public-Bot-Peer-result.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function recheck() {
  if (busy || checking) return;
  if (active && active.token !== getToken()) { active = null; result = null; $('resultText').value='';$('resultText').hidden=true;$('checks').replaceChildren();controls(); }
  void connect();
}
$('connect').onclick = connect;
window.addEventListener('storage', event => { if (event.key?.startsWith('sb-') || event.key === 'pablicus:passkey-unvalidated') recheck(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
window.addEventListener('pageshow', event => { if (event.persisted) recheck(); });
captureTarget(); void connect();
