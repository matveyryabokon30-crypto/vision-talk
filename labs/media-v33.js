(() => {
'use strict';

const PATCH = 'media-v33';
const root = document.getElementById('root');
let gesture = null;
let lastNativeOpen = 0;

function markVersion(scope = document) {
  scope.querySelectorAll('.chat-status').forEach(node => { node.textContent = `Vision Talk · ${PATCH}`; });
  scope.querySelectorAll('.version').forEach(node => {
    if (/media-v32|Vision Talk/i.test(node.textContent || '')) node.textContent = `Vision Talk · ${PATCH}`;
  });
}

function forceInstantScroll(box) {
  if (!box || box.dataset.v33ScrollPatched === '1') return;
  box.dataset.v33ScrollPatched = '1';
  const nativeScrollTo = box.scrollTo.bind(box);
  box.scrollTo = function scrollToInstantly(arg1, arg2) {
    if (arg1 && typeof arg1 === 'object') {
      return nativeScrollTo({ ...arg1, behavior: 'auto' });
    }
    return nativeScrollTo(arg1, arg2);
  };
}

function revealChat(chat) {
  if (!chat || chat.dataset.v33Prepared === '1') return;
  chat.dataset.v33Prepared = '1';
  chat.classList.add('v33-opening');
  markVersion(chat);

  const box = chat.querySelector('.messages');
  if (!box) return;
  forceInstantScroll(box);

  let revealed = false;
  let userTouched = false;
  const onTouch = () => { userTouched = true; };
  box.addEventListener('pointerdown', onTouch, { once: true, capture: true });
  box.addEventListener('touchstart', onTouch, { once: true, capture: true, passive: true });

  const pinBottom = () => {
    if (!box.isConnected || userTouched) return;
    box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight);
  };

  const finish = () => {
    if (revealed || box.classList.contains('initializing')) return;
    revealed = true;
    requestAnimationFrame(() => {
      pinBottom();
      requestAnimationFrame(() => {
        pinBottom();
        chat.classList.remove('v33-opening');
        chat.classList.add('v33-ready');
      });
    });
  };

  const observer = new MutationObserver(() => {
    if (!box.classList.contains('initializing')) finish();
  });
  observer.observe(box, { attributes: true, attributeFilter: ['class'], childList: true, subtree: false });

  box.addEventListener('load', pinBottom, true);
  box.addEventListener('loadedmetadata', pinBottom, true);
  setTimeout(() => {
    finish();
    observer.disconnect();
    box.removeEventListener('load', pinBottom, true);
    box.removeEventListener('loadedmetadata', pinBottom, true);
  }, 1600);
}

function prepareVideo(video) {
  if (!video || video.dataset.v33Prepared === '1') return;
  video.dataset.v33Prepared = '1';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.disablePictureInPicture = true;

  const card = video.closest('.media-card.video');
  const orient = () => {
    if (!card || !video.videoWidth || !video.videoHeight) return;
    card.classList.toggle('landscape', video.videoWidth > video.videoHeight);
  };
  video.addEventListener('loadedmetadata', orient);
  orient();
}

function restorePreview(video) {
  if (!video?.isConnected) return;
  video.controls = false;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  setTimeout(() => video.play().catch(() => {}), 80);
}

function openNativeVideo(card, video) {
  if (!video || Date.now() - lastNativeOpen < 350) return;
  lastNativeOpen = Date.now();
  document.querySelectorAll('.viewer').forEach(node => node.remove());

  const onEnd = () => {
    video.removeEventListener('webkitendfullscreen', onEnd);
    restorePreview(video);
  };

  try {
    video.pause();
    video.loop = false;
    video.muted = false;
    video.controls = true;

    if (typeof video.webkitEnterFullscreen === 'function') {
      video.addEventListener('webkitendfullscreen', onEnd, { once: true });
      video.webkitEnterFullscreen();
      video.play().catch(() => {});
      return;
    }

    if (typeof video.requestFullscreen === 'function') {
      const finish = () => {
        if (!document.fullscreenElement) {
          document.removeEventListener('fullscreenchange', finish);
          restorePreview(video);
        }
      };
      document.addEventListener('fullscreenchange', finish);
      video.requestFullscreen().then(() => video.play().catch(() => {})).catch(() => {
        document.removeEventListener('fullscreenchange', finish);
        video.play().catch(() => {});
      });
      return;
    }

    video.play().catch(() => {});
  } catch (_) {
    restorePreview(video);
  }
}

function videoCardFromEvent(event) {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest('.media-card.video') || null;
}

function bindGlobalVideoGesture() {
  document.addEventListener('pointerdown', event => {
    const card = videoCardFromEvent(event);
    if (!card) return;
    gesture = { card, x: event.clientX, y: event.clientY, moved: false };
  }, true);

  document.addEventListener('pointermove', event => {
    if (!gesture) return;
    if (Math.abs(event.clientX - gesture.x) > 10 || Math.abs(event.clientY - gesture.y) > 10) gesture.moved = true;
  }, true);

  document.addEventListener('pointerup', event => {
    const card = videoCardFromEvent(event);
    if (!gesture || !card || card !== gesture.card || gesture.moved) {
      gesture = null;
      return;
    }
    const video = card.querySelector('video');
    gesture = null;
    if (!video) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openNativeVideo(card, video);
  }, true);

  document.addEventListener('click', event => {
    const card = videoCardFromEvent(event);
    if (!card || Date.now() - lastNativeOpen < 500) return;
    const video = card.querySelector('video');
    if (!video) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openNativeVideo(card, video);
  }, true);
}

function scan(scope = document) {
  markVersion(scope);
  scope.querySelectorAll('.chat-screen').forEach(revealChat);
  scope.querySelectorAll('.media-card.video video, .upload-card video').forEach(prepareVideo);
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      scan(node);
    }
  }
  scan(document);
});
observer.observe(root, { childList: true, subtree: true });

bindGlobalVideoGesture();
scan(document);
document.documentElement.dataset.visionBuild = PATCH;
})();
