/* Vision Talk media-v31 — isolated chat-open/video transport patch */
(() => {
  'use strict';
  if (window.__VISION_MEDIA_V31__) return;
  window.__VISION_MEDIA_V31__ = true;

  const PATCH_VERSION = 'media-v31';
  const INITIAL_LIMIT = 40;
  const STANDARD_UPLOAD_LIMIT = 6 * 1024 * 1024;
  const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
  let stopBottomGuard = null;
  let viewerOpening = false;

  function setPatchLabel() {
    const presence = document.querySelector('.presence');
    if (presence) presence.textContent = `Vision Talk · ${PATCH_VERSION}`;
  }

  function scrollBottomNow(box) {
    if (!box || !box.isConnected) return;
    box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight);
  }

  function startBottomGuard(box, duration = 7000) {
    if (stopBottomGuard) stopBottomGuard();
    let active = true;
    const pin = () => {
      if (active) scrollBottomNow(box);
    };
    const interval = setInterval(pin, 45);
    const onLayout = () => pin();
    const stop = () => {
      if (!active) return;
      active = false;
      clearInterval(interval);
      clearTimeout(timer);
      box.removeEventListener('load', onLayout, true);
      box.removeEventListener('loadedmetadata', onLayout, true);
      box.removeEventListener('loadeddata', onLayout, true);
      box.removeEventListener('error', onLayout, true);
      box.removeEventListener('pointerdown', stop, true);
      box.removeEventListener('touchstart', stop, true);
      if (stopBottomGuard === stop) stopBottomGuard = null;
    };
    const timer = setTimeout(stop, duration);
    box.addEventListener('load', onLayout, true);
    box.addEventListener('loadedmetadata', onLayout, true);
    box.addEventListener('loadeddata', onLayout, true);
    box.addEventListener('error', onLayout, true);
    box.addEventListener('pointerdown', stop, { once: true, capture: true });
    box.addEventListener('touchstart', stop, { once: true, capture: true, passive: true });
    stopBottomGuard = stop;
    pin();
    requestAnimationFrame(() => {
      pin();
      requestAnimationFrame(pin);
    });
    return stop;
  }

  initialMessages = async function patchedInitialMessages() {
    const conversationId = currentConversation?.id;
    const box = document.getElementById('messages');
    if (!conversationId || !box) return;

    box.style.visibility = 'hidden';
    box.style.overflowY = 'hidden';
    box.style.scrollBehavior = 'auto';
    box.style.overflowAnchor = 'none';

    const { data, error } = await sb
      .from('messages')
      .select('id,client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_path,attachment_metadata,created_at')
      .eq('conversation_id', conversationId)
      .order('server_seq', { ascending: false })
      .limit(INITIAL_LIMIT);

    if (!box.isConnected || currentConversation?.id !== conversationId) return;
    if (error) {
      box.style.visibility = 'visible';
      box.style.overflowY = 'auto';
      box.innerHTML = `<div class="error">${esc(error.message)}</div>`;
      return;
    }

    rendered.clear();
    lastSeq = 0;
    box.textContent = '';
    appendMessages((data || []).slice().reverse(), false);
    syncPending();

    scrollBottomNow(box);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    scrollBottomNow(box);
    box.style.visibility = 'visible';
    box.style.overflowY = 'auto';
    startBottomGuard(box, 7000);
  };

  function bindMediaOpen(frame, type, url, name, sourceVideo = null) {
    if (!frame || !url) return;
    frame.dataset.openType = type;
    frame.dataset.openUrl = url;
    frame.dataset.openName = name || (type === 'video' ? 'Видео' : 'Медиа');
    if (frame.dataset.v31Bound === '1') return;
    frame.dataset.v31Bound = '1';
    frame.style.touchAction = 'pan-y';

    let startX = 0;
    let startY = 0;
    let moved = false;
    let openedAt = 0;

    frame.addEventListener('pointerdown', event => {
      startX = event.clientX;
      startY = event.clientY;
      moved = false;
    }, { passive: true });

    frame.addEventListener('pointermove', event => {
      if (Math.abs(event.clientX - startX) > 10 || Math.abs(event.clientY - startY) > 10) moved = true;
    }, { passive: true });

    const open = event => {
      if (moved || viewerOpening) return;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }
      openedAt = Date.now();
      viewerOpening = true;
      openViewer(
        frame.dataset.openType,
        frame.dataset.openUrl,
        frame.dataset.openName,
        sourceVideo || frame.querySelector('video')
      );
      setTimeout(() => { viewerOpening = false; }, 250);
    };

    frame.addEventListener('pointerup', open, true);
    frame.addEventListener('click', event => {
      if (Date.now() - openedAt < 450) return;
      open(event);
    }, true);
  }

  hydrateMedia = async function patchedHydrateMedia(row, message) {
    try {
      const url = await signed(message.attachment_path);
      const frame = row.querySelector('[data-frame]');
      const name = metaObj(message).name || 'Медиа';
      if (!frame || !row.isConnected) return;

      frame.dataset.url = url;
      frame.dataset.name = name;

      if (message.type === 'image') {
        frame.innerHTML = `<img src="${esc(url)}" alt="${esc(name)}"><span class="mediaSeq">${esc(meta(message.server_seq, mine(message)))}</span>`;
        bindMediaOpen(frame, 'image', url, name);
      } else if (message.type === 'video') {
        frame.innerHTML = `<video src="${esc(url)}" muted loop playsinline preload="metadata"></video><span class="videoLabel">Видео</span><span class="mediaSeq">${esc(meta(message.server_seq, mine(message)))}</span>`;
        const video = frame.querySelector('video');
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.disablePictureInPicture = true;
        bindMediaOpen(frame, 'video', url, name, video);
        video.addEventListener('loadedmetadata', () => {
          if (video.videoWidth > video.videoHeight) frame.classList.replace('portrait', 'landscape');
          tryStartOnePreview(video);
        }, { once: true });
        video.addEventListener('loadeddata', () => tryStartOnePreview(video), { once: true });
        setTimeout(() => tryStartOnePreview(video), 300);
      } else {
        bindMediaOpen(frame, 'document', url, name);
      }
    } catch (error) {
      const frame = row.querySelector('[data-frame]');
      if (frame) frame.outerHTML = '<div class="mediaErr">Не удалось открыть вложение<br><button class="retry">Повторить</button></div>';
      row.querySelector('.retry')?.addEventListener('click', () => hydrateMedia(row, message));
    }
  };

  setupPreviewAutoplay = function patchedPreviewAutoplay() {
    document.querySelectorAll('.videoFrame').forEach(frame => {
      const video = frame.querySelector('video');
      const url = frame.dataset.url || video?.currentSrc || video?.src;
      if (!video || !url) return;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.style.pointerEvents = 'none';
      bindMediaOpen(frame, 'video', url, frame.dataset.name || 'Видео', video);
      if (video.dataset.safeBound !== '1') {
        video.dataset.safeBound = '1';
        video.addEventListener('play', () => {
          if (activePreview && activePreview !== video) activePreview.pause();
          activePreview = video;
        });
      }
      tryStartOnePreview(video);
    });
  };

  openViewer = function patchedOpenViewer(type, url, name, sourceVideo = null) {
    if (!url) return;
    closeSheet();
    pausePreviews();
    document.querySelector('.viewer')?.remove();

    const viewer = document.createElement('div');
    viewer.className = 'viewer';
    viewer.innerHTML = `<div class="viewerTop"><button class="iconBtn" id="viewerBack">${icons.back}</button><div class="viewerTitle">${esc(name || 'Медиа')}</div>${type === 'document' ? `<a class="downloadBtn" href="${esc(url)}" download>Скачать</a>` : ''}</div><div class="viewerBody" id="viewerBody">${type === 'image' ? `<img src="${esc(url)}" alt="${esc(name || 'Фото')}">` : type === 'video' ? `<video id="viewerVideo" src="${esc(url)}" autoplay playsinline loop preload="auto"></video>` : String(name || '').toLowerCase().endsWith('.pdf') ? `<iframe src="${esc(url)}"></iframe>` : `<div class="card" style="margin:0"><div class="brand">VISION TALK</div><div class="title" style="font-size:30px">Документ</div><div class="muted">${esc(name || 'Файл')}</div><a class="btn full" href="${esc(url)}" download style="display:block;text-align:center;text-decoration:none">Скачать</a></div>`}</div>`;
    document.body.appendChild(viewer);

    const fullVideo = viewer.querySelector('#viewerVideo');
    if (sourceVideo) {
      try { sourceVideo.pause(); } catch {}
    }
    if (fullVideo) {
      fullVideo.muted = false;
      fullVideo.controls = false;
      fullVideo.playsInline = true;
      const syncTime = () => {
        if (sourceVideo && Number.isFinite(sourceVideo.currentTime)) {
          try { fullVideo.currentTime = sourceVideo.currentTime; } catch {}
        }
      };
      if (fullVideo.readyState >= 1) syncTime();
      else fullVideo.addEventListener('loadedmetadata', syncTime, { once: true });
      fullVideo.play().catch(() => {
        fullVideo.muted = true;
        fullVideo.play().catch(() => {});
      });
      fullVideo.addEventListener('click', event => {
        event.stopPropagation();
        fullVideo.controls = !fullVideo.controls;
      });
    }

    const close = () => {
      if (!viewer.isConnected) return;
      if (fullVideo && sourceVideo) {
        try { sourceVideo.currentTime = fullVideo.currentTime; } catch {}
      }
      viewer.remove();
      if (sourceVideo?.isConnected) tryStartOnePreview(sourceVideo);
      else resumePreview();
    };

    viewer.querySelector('#viewerBack').addEventListener('click', close);

    const body = viewer.querySelector('#viewerBody');
    let startY = 0;
    let startX = 0;
    let dragY = 0;
    let dragging = false;

    const begin = (x, y) => {
      startX = x;
      startY = y;
      dragY = 0;
      dragging = true;
    };
    const move = (x, y, event) => {
      if (!dragging) return;
      const dx = x - startX;
      const dy = y - startY;
      if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
        dragY = dy;
        body.style.setProperty('--drag', `${dragY}px`);
        if (event?.cancelable) event.preventDefault();
      }
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (dragY > 95) close();
      else body.style.setProperty('--drag', '0px');
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
  };

  function encodeMetadata(value) {
    return btoa(unescape(encodeURIComponent(String(value))));
  }

  async function responseError(response) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    if (response.status === 413 || /maximum allowed size|too large/i.test(detail)) {
      return new Error('Сервер отклонил размер видео: глобальный лимит Supabase ниже размера файла');
    }
    return new Error(`Загрузка не удалась (${response.status})${detail ? `: ${detail.slice(0, 220)}` : ''}`);
  }

  async function tusUpload(job) {
    const token = session?.access_token;
    if (!token) throw new Error('Сессия истекла. Войдите заново.');

    const endpoint = 'https://ctcoqgsztdtsazdiwcmd.storage.supabase.co/storage/v1/upload/resumable';
    const common = {
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_KEY,
      'Tus-Resumable': '1.0.0'
    };
    const metadata = {
      bucketName: BUCKET,
      objectName: job.path,
      contentType: job.mime,
      cacheControl: '3600'
    };

    const createResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...common,
        'Upload-Length': String(job.size),
        'Upload-Metadata': Object.entries(metadata).map(([key, value]) => `${key} ${encodeMetadata(value)}`).join(','),
        'x-upsert': 'false'
      }
    });
    if (!createResponse.ok) throw await responseError(createResponse);

    let uploadUrl = createResponse.headers.get('Location');
    if (!uploadUrl) throw new Error('Supabase не вернул адрес resumable-загрузки');
    uploadUrl = new URL(uploadUrl, endpoint).href;

    let offset = 0;
    while (offset < job.size) {
      const end = Math.min(offset + TUS_CHUNK_SIZE, job.size);
      const chunk = job.file.slice(offset, end);
      let attempt = 0;
      while (true) {
        const patchResponse = await fetch(uploadUrl, {
          method: 'PATCH',
          headers: {
            ...common,
            'Content-Type': 'application/offset+octet-stream',
            'Upload-Offset': String(offset)
          },
          body: chunk
        });
        if (patchResponse.ok) {
          offset = Number(patchResponse.headers.get('Upload-Offset') || end);
          job.progress = Math.min(100, Math.round((offset / job.size) * 100));
          repaintUpload(job);
          break;
        }
        if ([408, 429, 500, 502, 503, 504].includes(patchResponse.status) && attempt < 4) {
          await new Promise(resolve => setTimeout(resolve, [700, 1500, 3000, 5000, 8000][attempt++]));
          continue;
        }
        throw await responseError(patchResponse);
      }
    }
  }

  pendingHtml = function patchedPendingHtml(job) {
    const progress = Number(job.progress || 0);
    const state = job.status === 'error'
      ? 'Не удалось отправить'
      : job.status === 'sending'
        ? 'Создаю сообщение…'
        : job.status === 'uploading'
          ? `Загрузка ${progress}%`
          : 'Ожидает отправки';

    if (job.kind === 'document') {
      return `<div class="docCard"><div class="docIcon">${icons.file}</div><div><div class="docTitle">${esc(job.name)}</div><div class="docMeta">${size(job.size)} · ${esc(state)}</div></div></div>${job.status === 'error' ? `<div class="mediaErr">${esc(job.error)}<br><button class="retry" data-retry="${job.clientId}">Повторить</button></div>` : ''}`;
    }

    return `<div class="pendingPreview">${job.kind === 'video' ? `<video src="${esc(job.preview)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(job.preview)}" alt="">`}<div class="pendingOverlay">${job.status === 'error' ? '' : '<span class="spin"></span>'}<span>${esc(state)}</span>${job.status === 'error' ? `<button class="retry" data-retry="${job.clientId}">Повторить</button>` : ''}</div></div>`;
  };

  processUploads = async function patchedProcessUploads() {
    if (processing || !navigator.onLine || !session) return;
    processing = true;
    try {
      for (const job of uploadJobs) {
        if (job.status === 'done' || job.status === 'error') continue;
        try {
          job.status = 'uploading';
          job.progress = Number(job.progress || 0);
          repaintUpload(job);

          if (!job.uploaded) {
            if (job.size > STANDARD_UPLOAD_LIMIT) {
              await tusUpload(job);
            } else {
              const { error } = await sb.storage.from(BUCKET).upload(job.path, job.file, {
                cacheControl: '3600',
                contentType: job.mime,
                upsert: false
              });
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
            p_thumb_data_url: null
          });
          if (error) throw error;
          job.status = 'done';
          if (data && currentConversation?.id === job.conversationId) appendMessages([data], true);
        } catch (error) {
          job.error = error?.message || String(error);
          job.status = (!navigator.onLine || /network|fetch|load failed/i.test(job.error)) ? 'queued' : 'error';
          repaintUpload(job);
          status(job.status === 'queued' ? 'Сеть потеряна · повторю позже' : job.error, 'bad');
          if (job.status === 'queued') break;
        }
      }
    } finally {
      processing = false;
    }
  };

  const baseOpenDialog = openDialog;
  openDialog = async function patchedOpenDialog(dialog) {
    await baseOpenDialog(dialog);
    setPatchLabel();
  };

  const labelTimer = setInterval(setPatchLabel, 500);
  window.addEventListener('beforeunload', () => clearInterval(labelTimer), { once: true });
  document.documentElement.dataset.mediaPatch = PATCH_VERSION;
})();