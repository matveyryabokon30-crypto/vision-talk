(() => {
'use strict';

const VERSION = 'media-v32';
const SUPABASE_URL = 'https://ctcoqgsztdtsazdiwcmd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw';
const BUCKET = 'message-media';
const PAGE_SIZE = 30;
const STANDARD_UPLOAD_LIMIT = 6 * 1024 * 1024;
const TUS_CHUNK = 6 * 1024 * 1024;
const MAX_FILE = 1024 * 1024 * 1024;
const OUTBOX_KEY = 'vision-talk-outbox-media-v32';

const root = document.getElementById('root');
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const state = {
  session: null,
  profile: null,
  current: null,
  dialogs: [],
  rendered: new Set(),
  lastSeq: 0,
  oldestSeq: Infinity,
  hasOlder: true,
  loadingOlder: false,
  channel: null,
  pollTimer: null,
  dialogsTimer: null,
  signed: new Map(),
  mediaObserver: null,
  activePreview: null,
  opening: false,
  atBottom: true,
  selected: [],
  selectedUrls: [],
  activeTab: 'gallery',
  uploads: [],
  processingUploads: false,
  flushingText: false,
  viewer: null,
  peerRead: 0
};

const icons = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7M12 5v14"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6 13 4h-2L9.5 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4.5Z"/><circle cx="12" cy="12.5" r="3.5"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  contact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10"/></svg>'
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function size(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} Б`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} КБ`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} МБ`;
}

function toast(text, type = '') {
  let node = document.getElementById('toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    document.body.appendChild(node);
  }
  node.className = `status-toast ${type}`;
  node.textContent = text;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.remove(), type === 'bad' ? 4200 : 1800);
}

function metaObject(message) {
  const value = message?.attachment_metadata;
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function messageKey(message) {
  return message.client_message_id || message.id;
}

function isMine(message) {
  return message.sender_id === state.session?.user?.id;
}

function readMeta(seq, mine) {
  if (!mine) return `#${seq}`;
  const peerRead = Number(state.peerRead || 0);
  return `#${seq} · ${Number(seq) <= peerRead ? '✓✓' : '✓'}`;
}

function safeName(name, mime) {
  let value = String(name || 'file').normalize('NFKC').replace(/[\\/\u0000-\u001f\u007f]+/g, '-').trim().slice(0, 100) || 'file';
  if (value.includes('.')) return value;
  const ext = String(mime || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  return ext ? `${value}.${ext}` : value;
}

function classify(file, source) {
  if (source === 'document' || source === 'files' || source === 'scan') return 'document';
  if ((file.type || '').startsWith('image/')) return 'image';
  if ((file.type || '').startsWith('video/')) return 'video';
  return 'document';
}

function stopLive() {
  clearInterval(state.pollTimer);
  clearInterval(state.dialogsTimer);
  state.pollTimer = null;
  state.dialogsTimer = null;
  if (state.channel) {
    try { sb.removeChannel(state.channel); } catch {}
    state.channel = null;
  }
  if (state.mediaObserver) {
    state.mediaObserver.disconnect();
    state.mediaObserver = null;
  }
  if (state.activePreview) {
    try { state.activePreview.pause(); } catch {}
    state.activePreview = null;
  }
}

function renderBoot(title = 'Загрузка…', subtitle = 'Нативная архитектура чата.') {
  root.innerHTML = `<div class="screen"><div class="boot-card"><div class="brand">VISION TALK</div><div class="auth-title">${esc(title)}</div><div class="auth-sub">${esc(subtitle)}</div><div class="version">${VERSION}</div></div></div>`;
}

async function boot() {
  renderBoot();
  try {
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    if (!state.session) return renderLogin();
    const { data: profile, error } = await sb.from('profiles').select('id,username,display_name,is_approved').eq('id', state.session.user.id).single();
    if (error) throw error;
    if (!profile?.is_approved) throw new Error(`Ожидается доступ для @${profile?.username || 'user'}`);
    state.profile = profile;
    await renderDialogs();
    flushTextOutbox();
  } catch (error) {
    root.innerHTML = `<div class="screen"><div class="boot-card"><div class="brand">VISION TALK</div><div class="auth-title">Не удалось запустить</div><div class="auth-sub">${esc(error.message || error)}</div><button id="retryBoot" class="auth-button">Повторить</button><div class="version">${VERSION}</div></div></div>`;
    document.getElementById('retryBoot').onclick = boot;
  }
}

function renderLogin(message = '') {
  stopLive();
  root.innerHTML = `<div class="screen"><div class="auth-card"><div class="brand">VISION TALK</div><div class="auth-title">Вход</div><div class="auth-sub">Закрытый мессенджер · стабильный MVP</div><input id="email" class="auth-input" type="email" placeholder="email"><input id="password" class="auth-input" type="password" placeholder="пароль"><button id="login" class="auth-button">Войти</button><div id="loginError" class="error">${esc(message)}</div><div class="version">${VERSION}</div></div></div>`;
  document.getElementById('login').onclick = async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) document.getElementById('loginError').textContent = error.message;
    else boot();
  };
}

async function renderDialogs() {
  stopLive();
  state.current = null;
  root.innerHTML = `<div class="screen dialogs-screen"><header class="dialogs-header"><div><div class="brand">VISION TALK</div><div class="dialogs-title">Диалоги</div></div><div class="account"><span>@${esc(state.profile.username)}</span><button id="logout" class="link-btn">Выйти</button></div></header><div class="new-dialog"><input id="targetUser" placeholder="username"><button id="startDialog">+</button></div><div id="startError" class="error" style="padding:0 27px"></div><main id="dialogList" class="dialog-list"></main><div class="version" style="padding:0 27px 30px">Vision Talk · ${VERSION}</div></div>`;
  document.getElementById('logout').onclick = async () => { await sb.auth.signOut(); renderLogin(); };
  document.getElementById('startDialog').onclick = startDirectDialog;
  await loadDialogs();
  state.dialogsTimer = setInterval(() => {
    if (!document.hidden && !state.current) loadDialogs();
  }, 2200);
}

async function loadDialogs() {
  const list = document.getElementById('dialogList');
  if (!list) return;
  const { data, error } = await sb.rpc('my_conversations_v2');
  if (error) {
    list.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    return;
  }
  state.dialogs = data || [];
  if (!state.dialogs.length) {
    list.innerHTML = '<div class="empty">Диалогов пока нет.</div>';
    return;
  }
  list.innerHTML = state.dialogs.map(dialog => `<button class="dialog-card" data-id="${esc(dialog.id)}"><div class="dialog-row"><div class="dialog-name">${esc(dialog.title || 'Диалог')}</div>${Number(dialog.unread_count) > 0 ? `<div class="unread">${dialog.unread_count}</div>` : ''}</div><div class="dialog-preview">${esc(dialog.last_message || 'Нет сообщений')}</div></button>`).join('');
  list.querySelectorAll('.dialog-card').forEach(button => {
    button.onclick = () => openConversation(state.dialogs.find(item => item.id === button.dataset.id));
  });
}

async function startDirectDialog() {
  const username = document.getElementById('targetUser').value.trim().replace(/^@/, '');
  if (!username) return;
  const errorNode = document.getElementById('startError');
  errorNode.textContent = '';
  const { data, error } = await sb.rpc('start_direct_conversation', { target_username: username });
  if (error) {
    errorNode.textContent = error.message;
    return;
  }
  await openConversation({ id: data, title: `@${username}`, last_seq: 0 });
}

function renderChatShell(dialog) {
  const initial = (dialog.title || '?').replace('@', '')[0]?.toUpperCase() || '?';
  root.innerHTML = `<div class="chat-screen"><header class="chat-header"><button id="back" class="round-btn">${icons.back}</button><div class="avatar">${esc(initial)}</div><div class="chat-title"><div class="chat-name">${esc(dialog.title || 'Диалог')}</div><div class="chat-status">Vision Talk · ${VERSION}</div></div></header><section class="message-stage"><div id="messageLoader" class="message-loader">Открываю последние сообщения…</div><div id="messages" class="messages initializing"></div><button id="newMessagesBadge" class="new-badge" hidden>Новые сообщения ↓</button></section><footer class="composer"><button id="attach" class="round-btn">${icons.plus}</button><div class="composer-field"><input id="messageInput" class="composer-input" placeholder="Сообщение"><button id="camera" class="round-btn">${icons.camera}</button></div><button id="send" class="round-btn">${icons.mic}</button></footer></div>`;
  document.getElementById('back').onclick = renderDialogs;
  document.getElementById('attach').onclick = openAttachmentSheet;
  document.getElementById('camera').onclick = () => pick('cameraInput');
  document.getElementById('newMessagesBadge').onclick = () => scrollBottom(true);
  const input = document.getElementById('messageInput');
  const send = document.getElementById('send');
  input.oninput = () => {
    const ready = Boolean(input.value.trim());
    send.classList.toggle('send-ready', ready);
    send.innerHTML = ready ? icons.send : icons.mic;
  };
  input.onfocus = closeAttachmentSheet;
  send.onclick = sendText;
  installHiddenInputs();
}

async function openConversation(dialog) {
  if (!dialog || state.opening) return;
  state.opening = true;
  stopLive();
  state.current = dialog;
  state.rendered.clear();
  state.lastSeq = 0;
  state.oldestSeq = Infinity;
  state.hasOlder = true;
  state.loadingOlder = false;
  state.peerRead = 0;
  renderChatShell(dialog);

  try {
    await loadInitialPage(dialog.id);
    await markRead();
    await loadPeerRead();
    subscribeConversation(dialog.id);
    state.pollTimer = setInterval(() => {
      if (!document.hidden && state.current?.id === dialog.id) {
        fetchNewMessages();
        markRead();
        loadPeerRead();
      }
    }, 1800);
    flushTextOutbox();
    processUploads();
  } finally {
    state.opening = false;
  }
}

function createHistoryLoader() {
  const node = document.createElement('div');
  node.id = 'historyLoader';
  node.className = 'history-loader';
  node.textContent = '';
  return node;
}

async function loadInitialPage(conversationId) {
  const box = document.getElementById('messages');
  const loader = document.getElementById('messageLoader');
  const { data, error } = await sb.from('messages')
    .select('id,client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_path,attachment_metadata,created_at')
    .eq('conversation_id', conversationId)
    .order('server_seq', { ascending: false })
    .limit(PAGE_SIZE);

  if (!box || state.current?.id !== conversationId) return;
  if (error) {
    box.classList.remove('initializing');
    loader.textContent = error.message;
    return;
  }

  const ordered = (data || []).slice().reverse();
  state.hasOlder = ordered.length === PAGE_SIZE;
  const fragment = document.createDocumentFragment();
  fragment.appendChild(createHistoryLoader());
  for (const message of ordered) {
    const node = buildMessageNode(message);
    if (node) fragment.appendChild(node);
  }
  box.replaceChildren(fragment);
  scrollBottom(false);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  scrollBottom(false);
  box.classList.remove('initializing');
  loader.classList.add('hide');
  setTimeout(() => loader.remove(), 160);
  installScrollHandlers();
  observeMediaCards(box);
}

function stableRatio(message) {
  const meta = metaObject(message);
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (width > 0 && height > 0) return `${width}/${height}`;
  if (message.type === 'video') return '9/16';
  return '4/5';
}

function buildMessageNode(message) {
  const key = messageKey(message);
  if (!key || state.rendered.has(key)) return null;
  state.rendered.add(key);
  state.lastSeq = Math.max(state.lastSeq, Number(message.server_seq || 0));
  state.oldestSeq = Math.min(state.oldestSeq, Number(message.server_seq || Infinity));

  const mine = isMine(message);
  const row = document.createElement('div');
  row.className = `row ${mine ? 'mine' : ''}`;
  row.dataset.key = key;
  row.dataset.seq = message.server_seq || 0;

  if (!message.attachment_path) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.appendChild(document.createTextNode(message.body || ''));
    const meta = document.createElement('span');
    meta.className = 'seq';
    meta.textContent = readMeta(message.server_seq, mine);
    bubble.appendChild(meta);
    row.appendChild(bubble);
    return row;
  }

  const metadata = metaObject(message);
  const name = metadata.name || 'Файл';

  if (message.type === 'document' || message.type === 'file') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble document-bubble';
    bubble.innerHTML = `<button class="document-card" data-path="${esc(message.attachment_path)}" data-name="${esc(name)}"><div class="document-icon">${icons.file}</div><div><div class="document-name">${esc(name)}</div><div class="document-size">${esc(size(metadata.size_bytes || 0))}</div></div></button><div class="document-footer"><span>${esc(name)}</span><span>${esc(readMeta(message.server_seq, mine))}</span></div>`;
    row.appendChild(bubble);
    const card = bubble.querySelector('.document-card');
    card.onclick = () => openDocument(message.attachment_path, name);
    return row;
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble media-bubble';
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `media-card ${message.type === 'video' ? 'video' : 'image'}`;
  card.style.setProperty('--ratio', stableRatio(message));
  card.dataset.path = message.attachment_path;
  card.dataset.kind = message.type;
  card.dataset.name = name;
  card.dataset.key = key;
  card.dataset.hydrated = '0';
  card.innerHTML = `<div class="media-skeleton"></div>${metadata.thumb_data_url ? `<img class="media-poster" src="${esc(metadata.thumb_data_url)}" alt="">` : ''}${message.type === 'video' ? '<span class="media-badge">Видео</span>' : ''}<span class="media-meta">${esc(readMeta(message.server_seq, mine))}</span>`;
  bubble.appendChild(card);
  row.appendChild(bubble);
  bindMediaCardTap(card);
  return row;
}

function insertConfirmedNode(node, seq) {
  const box = document.getElementById('messages');
  if (!box) return;
  const number = Number(seq || 0);
  const rows = [...box.querySelectorAll('.row:not(.pending)')];
  const after = rows.find(row => Number(row.dataset.seq || 0) > number);
  if (after) box.insertBefore(node, after);
  else box.appendChild(node);
}

function appendMessages(messages, forceBottom = false) {
  const box = document.getElementById('messages');
  if (!box) return;
  const shouldStick = forceBottom || nearBottom();
  let changed = false;
  for (const message of messages || []) {
    const key = messageKey(message);
    document.getElementById(`pending-${key}`)?.remove();
    const node = buildMessageNode(message);
    if (!node) continue;
    insertConfirmedNode(node, message.server_seq);
    changed = true;
  }
  if (changed) observeMediaCards(box);
  if (changed && shouldStick) scrollBottom(true);
  if (changed && !shouldStick) document.getElementById('newMessagesBadge').hidden = false;
}

function installScrollHandlers() {
  const box = document.getElementById('messages');
  if (!box || box.dataset.bound === '1') return;
  box.dataset.bound = '1';
  box.addEventListener('scroll', () => {
    state.atBottom = nearBottom();
    if (state.atBottom) document.getElementById('newMessagesBadge').hidden = true;
    if (box.scrollTop < 140) loadOlderMessages();
  }, { passive: true });
}

function nearBottom() {
  const box = document.getElementById('messages');
  if (!box) return true;
  return box.scrollHeight - box.scrollTop - box.clientHeight < 130;
}

function scrollBottom(smooth = false) {
  const box = document.getElementById('messages');
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  state.atBottom = true;
  const badge = document.getElementById('newMessagesBadge');
  if (badge) badge.hidden = true;
}

async function loadOlderMessages() {
  if (!state.current || state.loadingOlder || !state.hasOlder || !Number.isFinite(state.oldestSeq)) return;
  const box = document.getElementById('messages');
  const loader = document.getElementById('historyLoader');
  if (!box || !loader) return;
  state.loadingOlder = true;
  loader.textContent = 'Загружаю историю…';
  const heightBefore = box.scrollHeight;
  const topBefore = box.scrollTop;

  const { data, error } = await sb.from('messages')
    .select('id,client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_path,attachment_metadata,created_at')
    .eq('conversation_id', state.current.id)
    .lt('server_seq', state.oldestSeq)
    .order('server_seq', { ascending: false })
    .limit(PAGE_SIZE);

  if (!error && data?.length) {
    const fragment = document.createDocumentFragment();
    for (const message of data.slice().reverse()) {
      const node = buildMessageNode(message);
      if (node) fragment.appendChild(node);
    }
    loader.after(fragment);
    const delta = box.scrollHeight - heightBefore;
    box.scrollTop = topBefore + delta;
    state.hasOlder = data.length === PAGE_SIZE;
    observeMediaCards(box);
  } else if (!data?.length) {
    state.hasOlder = false;
  }
  loader.textContent = state.hasOlder ? '' : 'Начало переписки';
  state.loadingOlder = false;
}

function observeMediaCards(scope = document) {
  if (!state.mediaObserver) {
    state.mediaObserver = new IntersectionObserver(entries => {
      let best = null;
      for (const entry of entries) {
        const card = entry.target;
        if (entry.isIntersecting) hydrateMediaCard(card);
        if (card.dataset.kind === 'video') {
          if (entry.intersectionRatio > 0.62 && (!best || entry.intersectionRatio > best.ratio)) best = { card, ratio: entry.intersectionRatio };
          if (entry.intersectionRatio < 0.25) card.querySelector('video')?.pause();
        }
      }
      if (best) activatePreview(best.card.querySelector('video'));
    }, { root: document.getElementById('messages'), rootMargin: '500px 0px 500px 0px', threshold: [0, .25, .62, .9] });
  }
  scope.querySelectorAll('.media-card[data-hydrated="0"]').forEach(card => state.mediaObserver.observe(card));
}

async function signedUrl(path) {
  const cached = state.signed.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  state.signed.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

async function hydrateMediaCard(card) {
  if (!card || card.dataset.hydrated !== '0') return;
  card.dataset.hydrated = 'loading';
  try {
    const url = await signedUrl(card.dataset.path);
    if (!card.isConnected) return;
    card.dataset.url = url;
    if (card.dataset.kind === 'image') {
      const image = document.createElement('img');
      image.className = 'media-full';
      image.alt = card.dataset.name || 'Фото';
      image.onload = () => {
        image.classList.add('ready');
        card.classList.add('loaded');
      };
      image.src = url;
      card.appendChild(image);
    } else {
      const video = document.createElement('video');
      video.className = 'media-video';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.disablePictureInPicture = true;
      video.src = url;
      video.addEventListener('loadeddata', () => {
        video.classList.add('ready');
        card.classList.add('loaded');
        activatePreview(video);
      }, { once: true });
      video.addEventListener('loadedmetadata', () => {
        if (video.videoWidth > video.videoHeight) {
          card.classList.add('landscape');
          card.style.setProperty('--ratio', '16/9');
        }
      }, { once: true });
      card.appendChild(video);
      if (isCardMostlyVisible(card)) activatePreview(video);
    }
    card.dataset.hydrated = '1';
  } catch (error) {
    card.dataset.hydrated = 'error';
    const errorNode = document.createElement('div');
    errorNode.className = 'media-error';
    errorNode.innerHTML = 'Не удалось загрузить вложение<button class="retry">Повторить</button>';
    errorNode.querySelector('.retry').onclick = event => {
      event.stopPropagation();
      errorNode.remove();
      card.dataset.hydrated = '0';
      hydrateMediaCard(card);
    };
    card.appendChild(errorNode);
  }
}

function isCardMostlyVisible(card) {
  const box = document.getElementById('messages');
  if (!box || !card) return false;
  const a = card.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const visible = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return visible / Math.max(1, a.height) > .62;
}

function activatePreview(video) {
  if (!video || !video.isConnected || state.viewer) return;
  if (state.activePreview && state.activePreview !== video) {
    try { state.activePreview.pause(); } catch {}
  }
  state.activePreview = video;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.play().catch(() => {});
}

function bindMediaCardTap(card) {
  let x = 0, y = 0, moved = false;
  card.addEventListener('pointerdown', event => { x = event.clientX; y = event.clientY; moved = false; }, { passive: true });
  card.addEventListener('pointermove', event => {
    if (Math.abs(event.clientX - x) > 10 || Math.abs(event.clientY - y) > 10) moved = true;
  }, { passive: true });
  card.addEventListener('pointerup', event => {
    if (moved) return;
    event.preventDefault();
    openMediaViewer(card);
  });
}

async function openMediaViewer(card) {
  if (!card || state.viewer) return;
  if (card.dataset.hydrated === '0') await hydrateMediaCard(card);
  const url = card.dataset.url;
  if (!url) return;

  if (card.dataset.kind === 'image') {
    openImageViewer(url, card.dataset.name || 'Фото');
    return;
  }

  let video = card.querySelector('video');
  if (!video) {
    await new Promise(resolve => setTimeout(resolve, 80));
    video = card.querySelector('video');
  }
  if (!video) return;
  openVideoViewer(card, video);
}

function openImageViewer(url, name) {
  const viewer = document.createElement('div');
  viewer.className = 'viewer';
  viewer.innerHTML = `<header class="viewer-head"><button class="round-btn viewer-back">${icons.back}</button><div class="viewer-title">${esc(name)}</div></header><main class="viewer-body"><img src="${esc(url)}" alt="${esc(name)}"></main>`;
  document.body.appendChild(viewer);
  state.viewer = viewer;
  installViewerGestures(viewer, () => closeViewer(viewer));
  viewer.querySelector('.viewer-back').onclick = () => closeViewer(viewer);
}

function openVideoViewer(card, video) {
  if (state.activePreview && state.activePreview !== video) state.activePreview.pause();
  state.activePreview = null;
  const placeholder = document.createComment('video-slot');
  video.parentNode.insertBefore(placeholder, video);
  const previousClass = video.className;
  const previousStyle = video.getAttribute('style') || '';
  const previousMuted = video.muted;
  const previousLoop = video.loop;
  video.pause();

  const viewer = document.createElement('div');
  viewer.className = 'viewer';
  viewer.innerHTML = `<header class="viewer-head"><button class="round-btn viewer-back">${icons.back}</button><div class="viewer-title">${esc(card.dataset.name || 'Видео')}</div></header><main class="viewer-body"><div class="viewer-controls-hint">Тап — показать управление · свайп вниз — закрыть</div></main>`;
  const body = viewer.querySelector('.viewer-body');
  document.body.appendChild(viewer);
  body.prepend(video);
  video.className = '';
  video.style.cssText = 'width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;background:#000;opacity:1;';
  video.muted = false;
  video.loop = true;
  video.controls = false;
  video.playsInline = true;
  video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
  state.viewer = viewer;

  const close = () => {
    if (!viewer.isConnected) return;
    video.pause();
    placeholder.parentNode?.insertBefore(video, placeholder);
    placeholder.remove();
    video.className = previousClass;
    video.setAttribute('style', previousStyle);
    video.muted = previousMuted;
    video.loop = previousLoop;
    video.controls = false;
    viewer.remove();
    state.viewer = null;
    if (isCardMostlyVisible(card)) activatePreview(video);
  };

  viewer.querySelector('.viewer-back').onclick = close;
  video.addEventListener('click', event => {
    event.stopPropagation();
    video.controls = !video.controls;
    viewer.classList.toggle('show-hint', !video.controls);
  });
  installViewerGestures(viewer, close);
}

function installViewerGestures(viewer, close) {
  let startX = 0, startY = 0, drag = 0, active = false;
  const begin = (x, y) => { startX = x; startY = y; drag = 0; active = true; };
  const move = (x, y, event) => {
    if (!active) return;
    const dx = x - startX;
    const dy = y - startY;
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
      drag = dy;
      viewer.style.setProperty('--drag', `${dy}px`);
      if (event?.cancelable) event.preventDefault();
    }
  };
  const end = () => {
    if (!active) return;
    active = false;
    if (drag > 105) close();
    else viewer.style.setProperty('--drag', '0px');
  };
  viewer.addEventListener('pointerdown', event => begin(event.clientX, event.clientY));
  viewer.addEventListener('pointermove', event => move(event.clientX, event.clientY, event));
  viewer.addEventListener('pointerup', end);
  viewer.addEventListener('pointercancel', end);
  viewer.addEventListener('touchstart', event => {
    const touch = event.touches[0];
    if (touch) begin(touch.clientX, touch.clientY);
  }, { passive: true });
  viewer.addEventListener('touchmove', event => {
    const touch = event.touches[0];
    if (touch) move(touch.clientX, touch.clientY, event);
  }, { passive: false });
  viewer.addEventListener('touchend', end, { passive: true });
}

function closeViewer(viewer) {
  viewer.remove();
  state.viewer = null;
  const visible = [...document.querySelectorAll('.media-card.video video')].find(video => isCardMostlyVisible(video.closest('.media-card')));
  if (visible) activatePreview(visible);
}

async function openDocument(path, name) {
  try {
    const url = await signedUrl(path);
    const viewer = document.createElement('div');
    viewer.className = 'viewer';
    const pdf = name.toLowerCase().endsWith('.pdf');
    viewer.innerHTML = `<header class="viewer-head"><button class="round-btn viewer-back">${icons.back}</button><div class="viewer-title">${esc(name)}</div><a class="download" href="${esc(url)}" download>Скачать</a></header><main class="viewer-body">${pdf ? `<iframe src="${esc(url)}" style="width:100%;height:100%;border:0;background:#fff"></iframe>` : `<div class="auth-card" style="position:relative;top:auto;left:auto;right:auto"><div class="brand">VISION TALK</div><div class="auth-title" style="font-size:30px">Документ</div><div class="auth-sub">${esc(name)}</div><a class="auth-button" href="${esc(url)}" download style="display:flex;align-items:center;justify-content:center;text-decoration:none">Скачать</a></div>`}</main>`;
    document.body.appendChild(viewer);
    state.viewer = viewer;
    viewer.querySelector('.viewer-back').onclick = () => closeViewer(viewer);
  } catch (error) {
    toast(error.message || 'Не удалось открыть документ', 'bad');
  }
}

function subscribeConversation(conversationId) {
  try {
    state.channel = sb.channel(`v32-${conversationId}`).on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}`
    }, payload => appendMessages([payload.new], nearBottom())).subscribe();
  } catch {}
}

async function fetchNewMessages() {
  if (!state.current) return;
  const { data } = await sb.from('messages')
    .select('id,client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_path,attachment_metadata,created_at')
    .eq('conversation_id', state.current.id)
    .gt('server_seq', state.lastSeq)
    .order('server_seq', { ascending: true });
  if (data?.length) appendMessages(data, nearBottom());
}

async function markRead() {
  if (!state.current || !state.lastSeq || !navigator.onLine) return;
  await sb.rpc('mark_conversation_read', { p_conversation_id: state.current.id, p_last_read_seq: state.lastSeq });
}

async function loadPeerRead() {
  if (!state.current) return;
  const { data } = await sb.from('conversation_members').select('last_read_seq').eq('conversation_id', state.current.id).neq('user_id', state.session.user.id).limit(1).maybeSingle();
  const next = Number(data?.last_read_seq || 0);
  if (next === state.peerRead) return;
  state.peerRead = next;
  document.querySelectorAll('.row.mine').forEach(row => {
    const seq = Number(row.dataset.seq || 0);
    row.querySelector('.seq')?.replaceChildren(document.createTextNode(readMeta(seq, true)));
    const media = row.querySelector('.media-meta');
    if (media) media.textContent = readMeta(seq, true);
  });
}

function textOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; }
}

function saveTextOutbox(items) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
}

function sendText() {
  const input = document.getElementById('messageInput');
  const body = input?.value.trim();
  if (!body || !state.current) return;
  const item = { conversation_id: state.current.id, client_message_id: uuid(), body };
  const queue = textOutbox();
  queue.push(item);
  saveTextOutbox(queue);
  input.value = '';
  input.dispatchEvent(new Event('input'));
  appendPendingText(item);
  flushTextOutbox();
}

function appendPendingText(item) {
  const box = document.getElementById('messages');
  if (!box || document.getElementById(`pending-${item.client_message_id}`)) return;
  const row = document.createElement('div');
  row.id = `pending-${item.client_message_id}`;
  row.className = 'row mine pending';
  row.innerHTML = `<div class="bubble">${esc(item.body)}<span class="seq"><span class="spinner"></span></span></div>`;
  box.appendChild(row);
  scrollBottom(false);
}

async function flushTextOutbox() {
  if (state.flushingText || !navigator.onLine || !state.session) return;
  state.flushingText = true;
  try {
    for (const item of textOutbox()) {
      const { data, error } = await sb.rpc('send_message', {
        p_conversation_id: item.conversation_id,
        p_client_message_id: item.client_message_id,
        p_type: 'text',
        p_body: item.body,
        p_attachment_path: null
      });
      if (error) break;
      saveTextOutbox(textOutbox().filter(value => value.client_message_id !== item.client_message_id));
      if (data && state.current?.id === item.conversation_id) appendMessages([data], true);
    }
  } finally {
    state.flushingText = false;
  }
}

function installHiddenInputs() {
  const chat = document.querySelector('.chat-screen');
  if (!chat || document.getElementById('galleryInput')) return;
  const defs = [
    ['galleryInput', 'image/*,video/*', true, 'gallery', ''],
    ['cameraInput', 'image/*,video/*', false, 'camera', 'environment'],
    ['documentInput', '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.zip,.rar,.7z', true, 'document', ''],
    ['filesInput', '', true, 'files', ''],
    ['scanInput', 'image/*', false, 'scan', 'environment'],
    ['contactInput', '.vcf,text/vcard,text/x-vcard', false, 'contact', '']
  ];
  for (const [id, accept, multiple, source, capture] of defs) {
    const input = document.createElement('input');
    input.type = 'file'; input.id = id; input.hidden = true; input.dataset.source = source;
    if (accept) input.accept = accept;
    if (multiple) input.multiple = true;
    if (capture) input.setAttribute('capture', capture);
    chat.appendChild(input);
  }
  for (const id of ['galleryInput', 'cameraInput', 'documentInput', 'filesInput', 'scanInput']) {
    document.getElementById(id).onchange = event => {
      addSelectedFiles(event.target.files, event.target.dataset.source);
      event.target.value = '';
    };
  }
  document.getElementById('contactInput').onchange = readContact;
}

function pick(id) { document.getElementById(id)?.click(); }

function clearSelection() {
  for (const url of state.selectedUrls) URL.revokeObjectURL(url);
  state.selectedUrls = [];
  state.selected = [];
}

function addSelectedFiles(files, source) {
  for (const file of Array.from(files || [])) {
    if (!file?.size) continue;
    if (file.size > MAX_FILE) { toast('Файл больше 1 ГБ не добавлен', 'bad'); continue; }
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (state.selected.some(item => item.key === key)) continue;
    const kind = classify(file, source);
    const url = kind === 'document' ? '' : URL.createObjectURL(file);
    if (url) state.selectedUrls.push(url);
    state.selected.push({ key, file, kind, source, url });
  }
  renderAttachmentSheet();
}

function openAttachmentSheet() {
  if (document.getElementById('attachmentSheet')) { closeAttachmentSheet(); return; }
  state.activeTab = 'gallery';
  clearSelection();
  const chat = document.querySelector('.chat-screen');
  const backdrop = document.createElement('div');
  backdrop.id = 'attachmentSheet';
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<section class="sheet"><header class="sheet-head"><button id="sheetClose" class="round-btn sheet-close">×</button><div id="sheetTitle" class="sheet-title"></div><span></span></header><main id="sheetBody" class="sheet-body"></main><div id="sendDock" class="send-dock"><button id="sendFiles" class="send-files">Отправить</button></div><nav class="sheet-tabs"><button class="sheet-tab active" data-tab="gallery">${icons.camera}<span>Галерея</span></button><button class="sheet-tab" data-tab="location">${icons.pin}<span>Геопозиция</span></button><button class="sheet-tab" data-tab="contact">${icons.contact}<span>Контакт</span></button><button class="sheet-tab" data-tab="documents">${icons.file}<span>Документы</span></button></nav></section>`;
  chat.appendChild(backdrop);
  backdrop.onclick = event => { if (event.target === backdrop) closeAttachmentSheet(); };
  backdrop.querySelector('.sheet').onclick = event => event.stopPropagation();
  document.getElementById('sheetClose').onclick = closeAttachmentSheet;
  document.getElementById('sendFiles').onclick = sendSelectedFiles;
  backdrop.querySelectorAll('.sheet-tab').forEach(tab => {
    tab.onclick = () => { state.activeTab = tab.dataset.tab; renderAttachmentSheet(); };
  });
  renderAttachmentSheet();
}

function closeAttachmentSheet() { document.getElementById('attachmentSheet')?.remove(); }

function renderAttachmentSheet() {
  const body = document.getElementById('sheetBody');
  const title = document.getElementById('sheetTitle');
  const dock = document.getElementById('sendDock');
  const send = document.getElementById('sendFiles');
  if (!body) return;
  const titles = { gallery: 'Недавние', location: 'Геопозиция', contact: 'Контакты', documents: 'Документы' };
  title.innerHTML = `${titles[state.activeTab]}<span class="sheet-sub">${state.selected.length ? `Выбрано: ${state.selected.length}` : VERSION}</span>`;
  document.querySelectorAll('.sheet-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === state.activeTab));
  dock.classList.toggle('show', state.selected.length > 0);
  send.textContent = state.selected.length ? `Отправить ${state.selected.length} · ${size(state.selected.reduce((sum, item) => sum + item.file.size, 0))}` : 'Отправить';

  if (state.activeTab === 'gallery') body.innerHTML = galleryMarkup();
  else if (state.activeTab === 'location') body.innerHTML = `<div class="sheet-panel"><button id="sendLocation" class="panel-action">${icons.pin}<span><strong>Отправить геопозицию</strong><small>Текущая точка по GPS</small></span></button></div>`;
  else if (state.activeTab === 'contact') body.innerHTML = `<div class="sheet-panel"><button id="selectContact" class="panel-action">${icons.contact}<span><strong>Выбрать контакт</strong><small>Контакт из телефона или vCard</small></span></button></div>`;
  else body.innerHTML = `<div class="sheet-panel"><button id="selectDocument" class="panel-action">${icons.file}<span><strong>Выбрать документ</strong><small>PDF, Word, Excel, презентации, архивы</small></span></button><button id="selectFiles" class="panel-action">${icons.file}<span><strong>Выбрать из файлов</strong><small>Любой файл из приложения «Файлы»</small></span></button><button id="scanDocument" class="panel-action">${icons.scan}<span><strong>Сканировать документ</strong><small>Открыть камеру для скана</small></span></button>${selectedDocumentsMarkup()}</div>`;
  bindAttachmentActions();
}

function galleryMarkup() {
  const media = state.selected.filter(item => item.kind !== 'document');
  const thumbs = media.map(item => `<button class="tile thumb" data-remove="${esc(item.key)}">${item.kind === 'video' ? `<video src="${esc(item.url)}" muted playsinline preload="metadata"></video><span class="thumb-type">Видео</span>` : `<img src="${esc(item.url)}" alt="">`}<span class="thumb-check">✓</span></button>`).join('');
  return `<div class="gallery-grid"><button id="cameraTile" class="tile camera-tile">${icons.camera}<span>Камера</span></button>${thumbs}${Array.from({ length: Math.max(0, 3 - media.length) }, () => '<button class="tile empty-tile" data-open-gallery></button>').join('')}<button id="openGallery" class="tile gallery-open">${icons.camera}<span>Открыть галерею</span></button></div>`;
}

function selectedDocumentsMarkup() {
  const docs = state.selected.filter(item => item.kind === 'document');
  if (!docs.length) return '';
  return `<div class="file-list">${docs.map(item => `<div class="file-row"><div class="file-icon">${icons.file}</div><div><div class="file-name">${esc(item.file.name)}</div><div class="file-meta">${size(item.file.size)}</div></div></div>`).join('')}</div>`;
}

function bindAttachmentActions() {
  document.getElementById('cameraTile')?.addEventListener('click', () => pick('cameraInput'));
  document.getElementById('openGallery')?.addEventListener('click', () => pick('galleryInput'));
  document.querySelectorAll('[data-open-gallery]').forEach(button => button.onclick = () => pick('galleryInput'));
  document.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {
    const index = state.selected.findIndex(item => item.key === button.dataset.remove);
    if (index < 0) return;
    const [item] = state.selected.splice(index, 1);
    if (item.url) { URL.revokeObjectURL(item.url); state.selectedUrls = state.selectedUrls.filter(url => url !== item.url); }
    renderAttachmentSheet();
  });
  document.getElementById('sendLocation')?.addEventListener('click', sendLocation);
  document.getElementById('selectContact')?.addEventListener('click', chooseContact);
  document.getElementById('selectDocument')?.addEventListener('click', () => pick('documentInput'));
  document.getElementById('selectFiles')?.addEventListener('click', () => pick('filesInput'));
  document.getElementById('scanDocument')?.addEventListener('click', () => pick('scanInput'));
}

function sendLocation() {
  closeAttachmentSheet();
  if (!navigator.geolocation) return toast('Геолокация недоступна', 'bad');
  toast('Определяю геопозицию…');
  navigator.geolocation.getCurrentPosition(position => {
    const input = document.getElementById('messageInput');
    input.value = `📍 Геопозиция\nhttps://maps.google.com/?q=${position.coords.latitude.toFixed(6)},${position.coords.longitude.toFixed(6)}`;
    sendText();
  }, error => toast(error.message || 'Не удалось получить геопозицию', 'bad'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

function chooseContact() {
  if (navigator.contacts?.select) {
    navigator.contacts.select(['name', 'tel', 'email'], { multiple: false }).then(result => {
      const contact = result?.[0];
      if (!contact) return;
      const input = document.getElementById('messageInput');
      closeAttachmentSheet();
      input.value = [`👤 ${contact.name?.[0] || 'Контакт'}`, contact.tel?.[0] || '', contact.email?.[0] || ''].filter(Boolean).join('\n');
      sendText();
    }).catch(() => pick('contactInput'));
  } else pick('contactInput');
}

async function readContact(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const text = await file.text().catch(() => '');
  const name = (text.match(/^FN:(.+)$/mi)?.[1] || file.name).trim();
  const tel = (text.match(/^TEL[^:]*:(.+)$/mi)?.[1] || '').trim();
  const mail = (text.match(/^EMAIL[^:]*:(.+)$/mi)?.[1] || '').trim();
  const input = document.getElementById('messageInput');
  closeAttachmentSheet();
  input.value = [`👤 ${name}`, tel, mail].filter(Boolean).join('\n');
  sendText();
}

async function sendSelectedFiles() {
  if (!state.selected.length || !state.current) return;
  const selected = state.selected.slice();
  closeAttachmentSheet();
  clearSelection();
  for (const item of selected) {
    const job = await createUploadJob(item);
    state.uploads.push(job);
    appendUploadCard(job);
  }
  processUploads();
}

async function createUploadJob(item) {
  const clientId = uuid();
  const preview = item.kind === 'document' ? '' : URL.createObjectURL(item.file);
  const info = await createMediaInfo(item.file, item.kind).catch(() => ({}));
  return {
    clientId,
    conversationId: state.current.id,
    file: item.file,
    kind: item.kind,
    name: item.file.name || 'Файл',
    mime: item.file.type || 'application/octet-stream',
    size: item.file.size,
    path: `${state.current.id}/${state.session.user.id}/${clientId}/${safeName(item.file.name, item.file.type)}`,
    preview,
    thumbDataUrl: info.thumbDataUrl || null,
    width: info.width || 0,
    height: info.height || 0,
    duration: info.duration || 0,
    progress: 0,
    uploaded: false,
    status: 'queued',
    error: ''
  };
}

async function createMediaInfo(file, kind) {
  if (kind === 'document') return {};
  const url = URL.createObjectURL(file);
  try {
    if (kind === 'image') {
      const image = await new Promise((resolve, reject) => {
        const node = new Image(); node.onload = () => resolve(node); node.onerror = reject; node.src = url;
      });
      return { width: image.naturalWidth, height: image.naturalHeight, duration: 0, thumbDataUrl: drawThumbnail(image, image.naturalWidth, image.naturalHeight) };
    }
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.src = url;
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
    const duration = Number(video.duration || 0);
    try {
      video.currentTime = Math.min(Math.max(.12, duration * .08), Math.max(.12, duration - .05));
      await new Promise(resolve => { video.onseeked = resolve; setTimeout(resolve, 1200); });
    } catch {}
    const thumbDataUrl = drawThumbnail(video, video.videoWidth, video.videoHeight);
    return { width: video.videoWidth, height: video.videoHeight, duration, thumbDataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawThumbnail(source, width, height) {
  if (!width || !height) return null;
  const max = 480;
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .68);
}

function appendUploadCard(job) {
  const box = document.getElementById('messages');
  if (!box) return;
  const row = document.createElement('div');
  row.id = `upload-${job.clientId}`;
  row.className = 'row mine pending';
  row.innerHTML = uploadMarkup(job);
  box.appendChild(row);
  bindUploadRetry(row);
  scrollBottom(false);
}

function uploadMarkup(job) {
  if (job.kind === 'document') {
    return `<div class="bubble document-bubble"><div class="upload-document"><div class="document-card"><div class="document-icon">${icons.file}</div><div><div class="document-name">${esc(job.name)}</div><div class="document-size">${size(job.size)} · ${esc(uploadState(job))}</div></div></div>${job.status === 'error' ? `<div class="error">${esc(job.error)}<br><button class="retry" data-retry="${job.clientId}">Повторить</button></div>` : ''}</div></div>`;
  }
  return `<div class="bubble media-bubble"><div class="upload-card ${job.kind === 'image' ? 'image' : ''}">${job.kind === 'video' ? `<video src="${esc(job.preview)}" muted loop playsinline autoplay></video>` : `<img src="${esc(job.preview)}" alt="">`}<div class="upload-overlay"><div class="progress-ring" style="--p:${job.progress}"><span class="progress-text">${job.progress}%</span></div><span>${esc(uploadState(job))}</span>${job.status === 'error' ? `<button class="retry" data-retry="${job.clientId}">Повторить</button>` : ''}</div></div></div>`;
}

function uploadState(job) {
  if (job.status === 'error') return 'Не удалось отправить';
  if (job.status === 'sending') return 'Создаю сообщение…';
  if (job.status === 'uploading') return `Загрузка ${job.progress}%`;
  return 'Ожидает отправки';
}

function repaintUpload(job) {
  const row = document.getElementById(`upload-${job.clientId}`);
  if (!row) return;
  row.innerHTML = uploadMarkup(job);
  bindUploadRetry(row);
}

function bindUploadRetry(scope) {
  scope.querySelectorAll('[data-retry]').forEach(button => {
    button.onclick = () => {
      const job = state.uploads.find(item => item.clientId === button.dataset.retry);
      if (!job) return;
      job.status = 'queued'; job.error = ''; job.progress = 0; job.uploaded = false;
      repaintUpload(job);
      processUploads();
    };
  });
}

async function processUploads() {
  if (state.processingUploads || !navigator.onLine || !state.session) return;
  state.processingUploads = true;
  try {
    for (const job of state.uploads) {
      if (job.status === 'done' || job.status === 'error') continue;
      try {
        job.status = 'uploading';
        repaintUpload(job);
        if (!job.uploaded) {
          if (job.size > STANDARD_UPLOAD_LIMIT) await tusUpload(job);
          else {
            const { error } = await sb.storage.from(BUCKET).upload(job.path, job.file, { cacheControl: '3600', contentType: job.mime, upsert: false });
            if (error && !/exists|duplicate/i.test(error.message || '')) throw error;
            job.progress = 100;
          }
          job.uploaded = true;
        }
        job.status = 'sending';
        repaintUpload(job);
        const { data, error } = await sb.rpc('send_attachment_message', {
          p_conversation_id: job.conversationId,
          p_client_message_id: job.clientId,
          p_type: job.kind,
          p_attachment_path: job.path,
          p_attachment_name: job.name,
          p_mime_type: job.mime,
          p_size_bytes: job.size,
          p_caption: null,
          p_thumb_data_url: job.thumbDataUrl
        });
        if (error) throw error;
        job.status = 'done';
        document.getElementById(`upload-${job.clientId}`)?.remove();
        if (data && state.current?.id === job.conversationId) appendMessages([data], true);
        setTimeout(() => { if (job.preview) URL.revokeObjectURL(job.preview); }, 5000);
      } catch (error) {
        job.error = error.message || String(error);
        job.status = (!navigator.onLine || /network|fetch|load failed/i.test(job.error)) ? 'queued' : 'error';
        repaintUpload(job);
        toast(job.status === 'queued' ? 'Сеть потеряна · повторю позже' : job.error, 'bad');
        if (job.status === 'queued') break;
      }
    }
  } finally {
    state.processingUploads = false;
  }
}

function encodeMetadata(value) {
  return btoa(unescape(encodeURIComponent(String(value))));
}

async function tusUpload(job) {
  const endpoint = `${SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`;
  const common = { authorization: `Bearer ${state.session.access_token}`, apikey: SUPABASE_KEY, 'Tus-Resumable': '1.0.0' };
  const metadata = { bucketName: BUCKET, objectName: job.path, contentType: job.mime, cacheControl: '3600' };
  const create = await fetch(endpoint, {
    method: 'POST',
    headers: { ...common, 'Upload-Length': String(job.size), 'Upload-Metadata': Object.entries(metadata).map(([key, value]) => `${key} ${encodeMetadata(value)}`).join(','), 'x-upsert': 'false' }
  });
  if (!create.ok) throw await uploadResponseError(create);
  let uploadUrl = create.headers.get('Location');
  if (!uploadUrl) throw new Error('Supabase не вернул адрес resumable-загрузки');
  uploadUrl = new URL(uploadUrl, endpoint).href;
  let offset = 0;
  while (offset < job.size) {
    const end = Math.min(offset + TUS_CHUNK, job.size);
    const chunk = job.file.slice(offset, end);
    let attempt = 0;
    while (true) {
      const response = await fetch(uploadUrl, { method: 'PATCH', headers: { ...common, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) }, body: chunk });
      if (response.ok) {
        offset = Number(response.headers.get('Upload-Offset') || end);
        job.progress = Math.min(100, Math.round(offset / job.size * 100));
        repaintUpload(job);
        break;
      }
      if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, [700, 1500, 3000, 5000, 8000][attempt++]));
        continue;
      }
      throw await uploadResponseError(response);
    }
  }
}

async function uploadResponseError(response) {
  let text = '';
  try { text = await response.text(); } catch {}
  if (response.status === 413 || /maximum allowed size|too large/i.test(text)) return new Error('Видео превышает фактический лимит хранилища');
  return new Error(`Загрузка не удалась (${response.status})${text ? `: ${text.slice(0, 180)}` : ''}`);
}

window.addEventListener('online', () => { toast('Сеть восстановлена', 'good'); flushTextOutbox(); processUploads(); fetchNewMessages(); });
window.addEventListener('offline', () => toast('Нет сети · очередь сохранена', 'bad'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    fetchNewMessages();
    processUploads();
    const video = [...document.querySelectorAll('.media-card.video video')].find(item => isCardMostlyVisible(item.closest('.media-card')));
    if (video) activatePreview(video);
  } else if (state.activePreview) state.activePreview.pause();
});

boot();
})();
