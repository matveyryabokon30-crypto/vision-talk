/* Ordered message blocks. Authorization and media dialogs remain with the host. */
(function (scope) {
  'use strict';

  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);
  const LABELS = { image: 'Фото', video: 'Видео', audio: 'Голосовое сообщение', document: 'Документ' };
  const activeViews = new Set();
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
    const images = [];
    // NaturalList renders measurement copies too. They must never resolve media URLs.
    const isLiveRow = () => root.isConnected && !!root.closest('#canvas') && !root.closest('.measureBox');
    const notifyResize = () => {
      if (disposed || resizeFrame !== null || typeof options.onResize !== 'function') return;
      resizeFrame = frame(() => {
        resizeFrame = null;
        if (!disposed && isLiveRow()) options.onResize(root);
      });
    };
    const state = { root, dispose() {
      disposed = true;
      if (observer) observer.disconnect();
      if (resizeFrame !== null) cancelFrame(resizeFrame);
      if (mountFrame !== null) cancelFrame(mountFrame);
      forgetView(state);
    } };
    const releaseObserverWhenFinished = () => {
      if (!images.some(item => item.status === 'waiting' || item.status === 'loading')) {
        if (observer) observer.disconnect();
        forgetView(state);
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

    async function openBlock(block, button, statusNode) {
      if (disposed || button.disabled) return;
      if (typeof options.openMedia !== 'function') {
        statusNode.textContent = 'Вложение пока недоступно.';
        notifyResize();
        return;
      }
      button.disabled = true;
      try {
        await options.openMedia(block);
        if (!disposed) statusNode.textContent = '';
      } catch (_) {
        if (!disposed) statusNode.textContent = 'Не удалось открыть. Нажмите, чтобы повторить.';
      } finally { button.disabled = false; notifyResize(); }
    }

    for (const block of checked.content.blocks) {
      if (block.type === 'text') {
        const text = element('div', 'richText', block.text);
        text.dataset.blockId = block.id;
        root.append(text);
        continue;
      }
      root.classList.add('richMessageHasMedia');
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
        const item = { block, button, image, statusNode, status: 'waiting' };
        images.push(item);
        button.addEventListener('click', event => {
          event.stopPropagation();
          if (item.status === 'failed') loadImage(item);
          else openBlock(block, button, statusNode);
        });
      } else {
        const icon = element('span', 'richMediaIcon', block.type === 'video' || block.type === 'audio' ? '▶' : '▤');
        icon.setAttribute('aria-hidden', 'true');
        const label = element('span', 'richMediaInfo');
        label.append(element('span', 'richMediaTitle', block.type === 'audio' ? LABELS.audio : (block.name || LABELS[block.type])));
        const details = [LABELS[block.type], readableDuration(block.duration), readableSize(block.size)].filter(Boolean);
        label.append(element('span', 'richMediaDetails', details.join(' · ')));
        label.append(statusNode);
        button.append(icon, label);
        button.addEventListener('click', event => { event.stopPropagation(); openBlock(block, button, statusNode); });
      }
      root.append(button);
    }

    function activate() {
      if (disposed || initialized || !isLiveRow()) return;
      initialized = true;
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

  const api = Object.freeze({ render, validate, textContent });
  scope.PablicusRichMessage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
