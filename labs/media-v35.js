(() => {
'use strict';

const BUILD = 'media-v35';
const SUPABASE_URL = 'https://ctcoqgsztdtsazdiwcmd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw';
const BUCKET = 'message-media';
const root = document.getElementById('root');

if (!root || !window.supabase || window.__VISION_MEDIA_V35__) return;
window.__VISION_MEDIA_V35__ = true;

const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const signedCache = new Map();
let viewer = null;
let gesture = null;
let lastOpen = 0;

function cleanText(value) {
  return String(value || '').replace(/[&<>"']/g, '');
}

function markVersion(scope = document) {
  const statusNodes = [];
  if (scope instanceof Element && scope.matches('.chat-status')) statusNodes.push(scope);
  statusNodes.push(...scope.querySelectorAll?.('.chat-status') || []);
  for (const node of statusNodes) {
    const next = `Vision Talk · ${BUILD}`;
    if (node.textContent !== next) node.textContent = next;
  }

  const versionNodes = [];
  if (scope instanceof Element && scope.matches('.version')) versionNodes.push(scope);
  versionNodes.push(...scope.querySelectorAll?.('.version') || []);
  for (const node of versionNodes) {
    const next = BUILD;
    if (node.textContent !== next) node.textContent = next;
  }
}

async function signed(path) {
  const cached = signedCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

function removeInlineVideo(card) {
  if (!card) return;
  card.querySelectorAll('video').forEach(video => {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {}
    video.remove();
  });
}

function ensurePosterOrPlaceholder(card) {
  const poster = card.querySelector('.media-poster');
  if (poster) {
    poster.style.display = 'block';
    poster.style.opacity = '1';
    return;
  }
  if (!card.querySelector('.v35-video-placeholder')) {
    const fallback = document.createElement('div');
    fallback.className = 'v35-video-placeholder';
    fallback.textContent = 'Видео';
    card.prepend(fallback);
  }
}

function prepareCard(card) {
  if (!card || card.dataset.v35Prepared === '1') return;
  card.dataset.v35Prepared = '1';
  card.dataset.hydrated = 'v35-poster';
  removeInlineVideo(card);
  ensurePosterOrPlaceholder(card);

  if (card.dataset.path && !card.dataset.v35Signing) {
    card.dataset.v35Signing = '1';
    signed(card.dataset.path)
      .then(url => { if (card.isConnected) card.dataset.v35Url = url; })
      .catch(error => { if (card.isConnected) card.dataset.v35SignError = error.message || String(error); });
  }
}

function prepareUploadVideo(video) {
  if (!video || video.dataset.v35Prepared === '1') return;
  video.dataset.v35Prepared = '1';
  video.muted = true;
  video.loop = false;
  video.autoplay = false;
  video.playsInline = true;
  video.removeAttribute('autoplay');
  const freeze = () => {
    try {
      if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime === 0) {
        video.currentTime = Math.min(0.12, Math.max(0, video.duration - 0.05));
      }
      video.pause();
    } catch {}
  };
  video.addEventListener('loadeddata', freeze, { once: true });
  video.addEventListener('seeked', () => video.pause(), { once: true });
  freeze();
}

function closeViewer() {
  if (!viewer) return;
  const video = viewer.querySelector('video');
  try {
    video?.pause();
    video?.removeAttribute('src');
    video?.load();
  } catch {}
  viewer.remove();
  viewer = null;
}

function installSwipe(node) {
  let startY = 0;
  let startX = 0;
  let dragY = 0;
  let active = false;

  node.addEventListener('touchstart', event => {
    const touch = event.touches[0];
    if (!touch) return;
    startY = touch.clientY;
    startX = touch.clientX;
    dragY = 0;
    active = true;
  }, { passive: true });

  node.addEventListener('touchmove', event => {
    if (!active) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
      dragY = dy;
      node.style.setProperty('--drag', `${Math.min(dy, 240)}px`);
      if (event.cancelable) event.preventDefault();
    }
  }, { passive: false });

  node.addEventListener('touchend', () => {
    if (!active) return;
    active = false;
    if (dragY > 95) closeViewer();
    else node.style.setProperty('--drag', '0px');
  }, { passive: true });
}

async function openVideo(card) {
  if (!card || viewer || Date.now() - lastOpen < 300) return;
  lastOpen = Date.now();

  const name = card.dataset.name || 'Видео';
  const poster = card.querySelector('.media-poster')?.src || '';
  viewer = document.createElement('div');
  viewer.className = 'v35-viewer';
  viewer.innerHTML = `<header class="v35-viewer-head"><button class="v35-viewer-back" type="button">‹</button><div class="v35-viewer-title">${cleanText(name)}</div><span></span></header><main class="v35-viewer-body">${poster ? `<img class="v35-viewer-poster" src="${poster}" alt="">` : ''}<div class="v35-viewer-loading"></div></main>`;
  document.body.appendChild(viewer);
  viewer.querySelector('.v35-viewer-back').addEventListener('click', closeViewer);
  installSwipe(viewer);

  try {
    const url = card.dataset.v35Url || await signed(card.dataset.path);
    if (!viewer) return;
    card.dataset.v35Url = url;

    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'metadata';
    video.poster = poster;

    const ready = () => viewer?.classList.add('ready');
    video.addEventListener('loadeddata', ready, { once: true });
    video.addEventListener('canplay', ready, { once: true });
    video.addEventListener('error', () => {
      if (!viewer) return;
      const body = viewer.querySelector('.v35-viewer-body');
      if (!body.querySelector('.v35-viewer-error')) {
        body.insertAdjacentHTML('beforeend', '<div class="v35-viewer-error">Видео не удалось открыть в этом формате.</div>');
      }
    }, { once: true });

    viewer.querySelector('.v35-viewer-body').appendChild(video);
    video.load();
    video.play().catch(() => {});
  } catch (error) {
    if (!viewer) return;
    viewer.querySelector('.v35-viewer-body').insertAdjacentHTML('beforeend', `<div class="v35-viewer-error">${cleanText(error.message || error)}</div>`);
  }
}

function bindCardGesture(card) {
  if (!card || card.dataset.v35Gesture === '1') return;
  card.dataset.v35Gesture = '1';

  card.addEventListener('pointerdown', event => {
    gesture = { card, x: event.clientX, y: event.clientY, moved: false };
  }, true);

  card.addEventListener('pointermove', event => {
    if (!gesture || gesture.card !== card) return;
    if (Math.abs(event.clientX - gesture.x) > 10 || Math.abs(event.clientY - gesture.y) > 10) gesture.moved = true;
  }, true);

  card.addEventListener('pointerup', event => {
    if (!gesture || gesture.card !== card || gesture.moved) {
      gesture = null;
      return;
    }
    gesture = null;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openVideo(card);
  }, true);

  card.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);
}

function scan(scope = document) {
  markVersion(scope);

  const cards = [];
  if (scope instanceof Element && scope.matches('.media-card.video')) cards.push(scope);
  cards.push(...scope.querySelectorAll?.('.media-card.video') || []);
  for (const card of cards) {
    prepareCard(card);
    bindCardGesture(card);
  }

  const uploadVideos = [];
  if (scope instanceof Element && scope.matches('.upload-card video')) uploadVideos.push(scope);
  uploadVideos.push(...scope.querySelectorAll?.('.upload-card video') || []);
  uploadVideos.forEach(prepareUploadVideo);

  const nestedVideos = [];
  if (scope instanceof Element && scope.matches('.media-card.video video')) nestedVideos.push(scope);
  nestedVideos.push(...scope.querySelectorAll?.('.media-card.video video') || []);
  for (const video of nestedVideos) {
    const card = video.closest('.media-card.video');
    if (card?.dataset.v35Prepared === '1') removeInlineVideo(card);
  }
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) scan(node);
    }
  }
});
observer.observe(root, { childList: true, subtree: true });

scan(document);
document.documentElement.dataset.visionBuild = BUILD;
})();
