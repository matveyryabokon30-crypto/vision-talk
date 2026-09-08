/* Ordered message blocks. Images/video open in the host; voice plays in the row. */
(function (scope) {
  'use strict';

  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);
  const LABELS = { image: 'Фото', video: 'Видео', audio: 'Голосовое сообщение', document: 'Документ' };
  const activeViews = new Set();
  let activeAudio = null;
  let removalObserver = null;
  const frame = callback => scope.requestAnimationFrame ? scope.requestAnimationFrame(callback) : scope.setTimeout(callback, 0);
  const cancelFrame = id => scope.cancelAnimationFrame ? scope.cancelAnimationFrame(id) : scope.clearTimeout(id);

  /** Shape validation for display/local drafts; the transport validates server limits separately. */
  function validate(value) {
    const errors = [];
    if (!value || typeof value !== 'object' || value.v !== 1 || !Array.isArray(value.blocks)) {
      return { ok: false, errors: ['Ожидалось сообщение с блоками версии 1.'], content: null };
    }
    const blocks = [], ids = new Set();
    value.blocks.forEach((block, index) => {
      if (!block || typeof block !== 'object' || typeof block.id !== 'string' || !block.id.trim() || ids.has(block.id)) {
        errors.push('Некорректный или повторный идентификатор блока ' + (index + 1) + '.');
        return;
      }
      ids.add(block.id);
      if (block.type === 'text') {
        if (typeof block.text !== 'string') { errors.push('В текстовом блоке отсутствует текст.'); return; }
        blocks.push({ id: block.id, type: 'text', text: block.text });
        return;
      }
      if (!MEDIA_TYPES.has(block.type)) { errors.push('Неизвестный вид блока ' + (index + 1) + '.'); return; }
      const clean = { id: block.id, type: block.type };
      for (const key of ['path', 'assetId', 'name', 'mime']) {
        if (block[key] !== undefined && typeof block[key] !== 'string') {
          errors.push('Некорректное поле вложения: ' + key + '.');
          return;
        }
        if (typeof block[key] === 'string') clean[key] = block[key];
      }
      for (const key of ['size', 'width', 'height', 'duration']) {
        if (block[key] !== undefined && (typeof block[key] !== 'number' || !Number.isFinite(block[key]) || block[key] < 0)) {
          errors.push('Некорректный размер или длительность вложения.');
          return;
        }
        if (typeof block[key] === 'number') clean[key] = block[key];
      }
      blocks.push(clean);
    });
    return { ok: errors.length === 0, errors, content: errors.length ? null : { v: 1, blocks } };
  }

  function textContent(value) {
    const checked = validate(value);
    return checked.ok ? checked.content.blocks.filter(block => block.type === 'text').map(block => block.text).join('\n') : '';
  }

  // Only adjacent visual blocks share a tile group; prose/voice/documents retain
  // their position in the message. Empty editor insertion points are invisible.
  function groupBlocks(blocks) {
    const result = [];
    let visual = [];
    const flush = () => {
      if (visual.length > 1) result.push({ type: 'gallery', blocks: visual });
      else if (visual.length) result.push(visual[0]);
      visual = [];
    };
    for (const block of blocks) {
      if (block.type === 'text' && !block.text.trim()) continue;
      if (block.type === 'image' || block.type === 'video') visual.push(block);
      else { flush(); result.push(block); }
    }
    flush();
    return result;
  }

  function readableSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ' : Math.max(1, Math.round(bytes / 1024)) + ' КБ';
  }

  function readableDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const rounded = Math.floor(seconds);
    return Math.floor(rounded / 60) + ':' + String(rounded % 60).padStart(2, '0');
  }

  function safeResolvedUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const parsed = new scope.URL(value);
      return ['https:', 'http:', 'blob:'].includes(parsed.protocol) ? parsed.href : null;
    } catch (_) { return null; }
  }

  function rememberView(state) {
    activeViews.add(state);
    if (!removalObserver && scope.MutationObserver && scope.document.body) {
      removalObserver = new scope.MutationObserver(() => {
        for (const current of activeViews) if (!current.root.isConnected) current.dispose();
      });
      removalObserver.observe(scope.document.body, { childList: true, subtree: true });
    }
  }

  function forgetView(state) {
    activeViews.delete(state);
    if (!activeViews.size && removalObserver) { removalObserver.disconnect(); removalObserver = null; }
  }

  function stopAll() {
    for (const state of activeViews) state.stopAudio();
    activeAudio = null;
  }

  function render(value, options) {
    options = options || {};
    const document = scope.document;
    if (!document) throw new Error('Для отображения сообщения нужен DOM.');
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const root = element('div', 'richMessage');
    const checked = validate(value);
    if (!checked.ok) {
      root.append(element('p', 'richMessageUnavailable', 'Не удалось отобразить содержимое сообщения.'));
      return root;
    }
    let disposed = false, initialized = false, observer = null, resizeFrame = null, mountFrame = null;
    const images = [], audioPlayers = [];
    // NaturalList renders measurement copies too. They must never resolve media URLs.
    const isLiveRow = () => root.isConnected && !!root.closest('#canvas') && !root.closest('.measureBox');
    const notifyResize = () => {
      if (disposed || resizeFrame !== null || typeof options.onResize !== 'function') return;
      resizeFrame = frame(() => {
        resizeFrame = null;
        if (!disposed && isLiveRow()) options.onResize(root);
      });
    };
    const state = { root, stopAudio() {
      for (const player of audioPlayers) player.stop(true);
    }, dispose() {
      disposed = true;
      state.stopAudio();
      if (observer) observer.disconnect();
      if (resizeFrame !== null) cancelFrame(resizeFrame);
      if (mountFrame !== null) cancelFrame(mountFrame);
      forgetView(state);
    } };
    const releaseObserverWhenFinished = () => {
      if (!images.some(item => item.status === 'waiting' || item.status === 'loading')) {
        if (observer) observer.disconnect();
        if (!audioPlayers.length) forgetView(state);
      }
    };

    async function loadImage(item) {
      if (disposed || !isLiveRow() || item.status === 'loading' || item.status === 'ready') return;
      item.status = 'loading';
      item.button.classList.remove('richMediaError');
      item.statusNode.textContent = 'Загрузка фото…';
      if (observer) observer.unobserve(item.button);
      try {
        if (typeof options.resolveUrl !== 'function') throw new Error('Media resolver is unavailable');
        const resolved = await options.resolveUrl(item.block.path || item.block.assetId || item.block.id, item.block);
        if (disposed || !isLiveRow()) return;
        const url = safeResolvedUrl(resolved);
        if (!url) throw new Error('Invalid media URL');
        item.image.onload = () => {
          if (disposed || !isLiveRow()) return;
          item.status = 'ready';
          item.button.classList.add('richImageReady');
          item.statusNode.textContent = '';
          releaseObserverWhenFinished();
          notifyResize();
        };
        item.image.onerror = () => imageFailed(item);
        item.image.src = url;
      } catch (_) { imageFailed(item); }
    }

    function imageFailed(item) {
      if (disposed) return;
      item.status = 'failed';
      item.image.removeAttribute('src');
      item.button.classList.remove('richImageReady');
      item.button.classList.add('richMediaError');
      item.statusNode.textContent = 'Фото не загрузилось. Нажмите, чтобы повторить.';
      releaseObserverWhenFinished();
    }

    async function openBlock(block, button, statusNode, gallery) {
      if (disposed || !isLiveRow() || button.disabled) return;
      if (typeof options.openMedia !== 'function') {
        statusNode.textContent = 'Вложение пока недоступно.';
        notifyResize();
        return;
      }
      button.disabled = true;
      try {
        await options.openMedia(block, gallery);
        if (!disposed) statusNode.textContent = '';
      } catch (_) {
        if (!disposed) statusNode.textContent = 'Не удалось открыть. Нажмите, чтобы повторить.';
      } finally { button.disabled = false; notifyResize(); }
    }

    function renderAudio(block) {
      const container = element('div', 'richMedia richMedia-audio');
      container.dataset.blockId = block.id;
      container.setAttribute('role', 'group');
      container.setAttribute('aria-label', LABELS.audio);
      const audio = element('audio', 'richAudioElement');
      audio.preload = 'none';
      audio.setAttribute('playsinline', '');
      const play = element('button', 'richAudioPlay', '▶');
      play.type = 'button';
      const info = element('div', 'richAudioInfo');
      const seek = element('input', 'richAudioSeek');
      seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.step = '1'; seek.value = '0';
      seek.disabled = true;
      seek.setAttribute('aria-label', 'Перемотать голосовое сообщение');
      const footer = element('div', 'richAudioFooter');
      const time = element('span', 'richAudioTime');
      const status = element('span', 'richAudioStatus');
      status.setAttribute('role', 'status');
      footer.append(time, status); info.append(seek, footer);
      container.append(play, info, audio);
      if (typeof options.onReply === 'function') {
        const reply = element('button', 'richAudioReply', '↩');
        reply.type = 'button';
        reply.setAttribute('aria-label', 'Ответить на голосовое сообщение');
        reply.title = 'Ответить на голосовое сообщение';
        reply.addEventListener('click', event => {
          event.stopPropagation();
          if (!disposed && isLiveRow()) options.onReply(block);
        });
        container.append(reply);
      }
      let epoch = 0, loading = false, resolvedUrl = null;
      const duration = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
        if (block.duration > 0) return block.duration;
        const end = audio.seekable?.length ? audio.seekable.end(audio.seekable.length - 1) : 0;
        return Number.isFinite(end) && end > 0 ? end : 0;
      };
      const clock = seconds => readableDuration(Math.max(0, seconds)) || '0:00';
      function sync() {
        const length = duration();
        const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        seek.disabled = !resolvedUrl || length <= 0;
        seek.value = String(length > 0 ? Math.min(1000, Math.round(position / length * 1000)) : 0);
        seek.setAttribute('aria-valuetext', clock(position) + (length ? ' из ' + clock(length) : ''));
        time.textContent = clock(position) + (length ? ' / ' + clock(length) : '');
        play.textContent = loading ? '…' : audio.paused ? '▶' : 'Ⅱ';
        play.setAttribute('aria-label', loading ? 'Отменить загрузку голосового сообщения' : audio.paused ? 'Воспроизвести голосовое сообщение' : 'Приостановить голосовое сообщение');
        play.setAttribute('aria-pressed', String(!audio.paused));
        container.classList.toggle('richAudioPlaying', !audio.paused);
        container.classList.toggle('richAudioLoading', loading);
      }
      function stop(release) {
        ++epoch;
        loading = false;
        audio.pause();
        if (activeAudio === player) activeAudio = null;
        if (release) {
          resolvedUrl = null;
          audio.removeAttribute('src');
          audio.load();
          status.textContent = '';
        }
        sync();
      }
      function failed(error, operation) {
        if (disposed || operation !== epoch) return;
        loading = false;
        if (activeAudio === player) activeAudio = null;
        // iOS may require another gesture after a network lookup. Keep the URL so
        // that the retry calls play() synchronously from the next button tap.
        status.textContent = error?.name === 'NotAllowedError' ? 'Нажмите ▶ для воспроизведения' : 'Не удалось воспроизвести. Повторить ▶';
        sync();
      }
      function start(operation) {
        if (disposed || !isLiveRow() || operation !== epoch || activeAudio !== player) return;
        loading = false;
        if (audio.ended) audio.currentTime = 0;
        let result;
        try { result = audio.play(); } catch (error) { failed(error, operation); return; }
        if (result && typeof result.catch === 'function') result.catch(error => failed(error, operation));
        sync();
      }
      function toggle(event) {
        event?.stopPropagation();
        if (disposed || !isLiveRow()) return;
        rememberView(state);
        if (loading || !audio.paused) { stop(false); status.textContent = ''; return; }
        if (activeAudio && activeAudio !== player) activeAudio.stop(false);
        activeAudio = player;
        const operation = ++epoch;
        status.textContent = '';
        if (resolvedUrl) { start(operation); return; }
        loading = true; sync();
        Promise.resolve().then(() => {
          if (typeof options.resolveUrl !== 'function') throw new Error('Media resolver is unavailable');
          return options.resolveUrl(block.path || block.assetId || block.id, block);
        }).then(value => {
          if (disposed || !isLiveRow() || operation !== epoch || activeAudio !== player) return;
          const url = safeResolvedUrl(value);
          if (!url) throw new Error('Invalid media URL');
          resolvedUrl = url;
          audio.src = url;
          start(operation);
        }).catch(error => failed(error, operation));
      }
      const player = { stop };
      audioPlayers.push(player);
      play.addEventListener('click', toggle);
      container.addEventListener('click', event => {
        if (event.target.closest('button,input,audio')) return;
        toggle(event);
      });
      seek.addEventListener('click', event => event.stopPropagation());
      seek.addEventListener('input', event => {
        event.stopPropagation();
        const length = duration();
        if (!disposed && isLiveRow() && length > 0) {
          audio.currentTime = Number(seek.value) / 1000 * length;
          sync();
        }
      });
      for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'pause', 'play', 'ended']) audio.addEventListener(event, sync);
      audio.addEventListener('error', () => {
        if (!disposed && resolvedUrl) {
          resolvedUrl = null;
          failed(new Error('Audio unavailable'), epoch);
        }
      });
      sync();
      return container;
    }

    const displayBlocks = [];
    for (const item of groupBlocks(checked.content.blocks)) {
      if (item.type !== 'gallery') { displayBlocks.push({ block: item, parent: root }); continue; }
      const tiles = element('div', 'richMediaGallery');
      tiles.dataset.count = String(Math.min(item.blocks.length, 4));
      tiles.setAttribute('role', 'group');
      tiles.setAttribute('aria-label', 'Фото и видео: ' + item.blocks.length);
      for (const [index, block] of item.blocks.slice(0, 4).entries()) {
        displayBlocks.push({ block, parent: tiles, gallery: { items: item.blocks, index } });
      }
    }
    for (const { block, parent, gallery } of displayBlocks) {
      if (parent !== root && !parent.parentNode) root.append(parent);
      if (block.type === 'text') {
        const text = element('div', 'richText', block.text);
        text.dataset.blockId = block.id;
        root.append(text);
        continue;
      }
      root.classList.add('richMessageHasMedia');
      if (block.type === 'audio') {
        root.append(renderAudio(block));
        continue;
      }
      const button = element('button', 'richMedia richMedia-' + block.type);
      button.type = 'button';
      button.dataset.blockId = block.id;
      button.setAttribute('aria-label', 'Открыть: ' + (block.name || LABELS[block.type]));
      const statusNode = element('span', 'richMediaStatus');
      statusNode.setAttribute('role', 'status');
      if (block.type === 'image') {
        const image = element('img', 'richImage');
        image.alt = block.name || 'Фото';
        image.loading = 'lazy';
        image.decoding = 'async';
        if (block.width > 0 && block.height > 0) {
          button.style.setProperty('--rich-image-ratio', String(Math.min(2, Math.max(0.65, block.width / block.height))));
          image.width = Math.round(block.width);
          image.height = Math.round(block.height);
        }
        statusNode.textContent = 'Фото';
        button.append(image, statusNode);
        const item = { block, button, image, statusNode, gallery, status: 'waiting' };
        images.push(item);
        button.addEventListener('click', event => {
          event.stopPropagation();
          if (item.status === 'failed' && !gallery) loadImage(item);
          else openBlock(block, button, statusNode, gallery);
        });
      } else {
        const icon = element('span', 'richMediaIcon', block.type === 'video' ? '▶' : '▤');
        icon.setAttribute('aria-hidden', 'true');
        const label = element('span', 'richMediaInfo');
        label.append(element('span', 'richMediaTitle', block.name || LABELS[block.type]));
        const details = [LABELS[block.type], readableDuration(block.duration), readableSize(block.size)].filter(Boolean);
        label.append(element('span', 'richMediaDetails', details.join(' · ')));
        label.append(statusNode);
        button.append(icon, label);
        button.addEventListener('click', event => { event.stopPropagation(); openBlock(block, button, statusNode, gallery); });
      }
      if (gallery && gallery.index === 3 && gallery.items.length > 4) {
        const more = element('span', 'richMediaMore', '+' + (gallery.items.length - 4));
        more.setAttribute('aria-hidden', 'true');
        button.append(more);
        button.setAttribute('aria-label', button.getAttribute('aria-label') + '; ещё вложений: ' + (gallery.items.length - 4));
      }
      parent.append(button);
    }

    function activate() {
      if (disposed || initialized || !isLiveRow()) return;
      initialized = true;
      if (audioPlayers.length) rememberView(state);
      if (images.length) {
        rememberView(state);
        if (scope.IntersectionObserver) {
          observer = new scope.IntersectionObserver(entries => {
            for (const entry of entries) if (entry.isIntersecting) {
              const item = images.find(candidate => candidate.button === entry.target);
              if (item) loadImage(item);
            }
          }, { rootMargin: '120px' });
          for (const item of images) observer.observe(item.button);
        } else {
          // Native lazy image loading still applies on older browsers.
          for (const item of images) loadImage(item);
        }
      }
      notifyResize();
    }
    // Virtualized lists append synchronously. A host mounting later may call activate().
    root.activate = activate;
    root.dispose = state.dispose;
    mountFrame = frame(() => { mountFrame = null; activate(); });
    return root;
  }

  const api = Object.freeze({ render, validate, textContent, groupBlocks, stopAll });
  scope.PablicusRichMessage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
