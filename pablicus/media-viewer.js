/* App-viewport media viewer. iPhone does not need the Fullscreen API. */
(function (scope) {
  'use strict';

  let activeViewer = null;

  function safeUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new scope.URL(value);
      return ['https:', 'http:', 'blob:'].includes(url.protocol) ? url.href : null;
    } catch (_) { return null; }
  }

  function create(options) {
    options = options || {};
    const document = scope.document;
    if (!document || typeof options.resolveUrl !== 'function') throw new Error('Для просмотра вложений нужен обработчик загрузки.');
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (className, label, text) => {
      const node = element('button', className, text);
      node.type = 'button';
      node.setAttribute('aria-label', label);
      node.title = label;
      return node;
    };
    const dialog = element('dialog', 'pablicusMediaViewer');
    dialog.setAttribute('aria-label', 'Просмотр фото и видео');
    const stage = element('div', 'pmvStage');
    const toolbar = element('div', 'pmvToolbar');
    const closeButton = button('pmvIcon pmvClose', 'Закрыть просмотр', '×');
    const description = element('div', 'pmvDescription');
    const name = element('div', 'pmvName');
    const counter = element('div', 'pmvCounter');
    counter.setAttribute('aria-live', 'polite');
    description.append(name, counter);
    const actions = element('div', 'pmvActions');
    const downloadButton = button('pmvAction pmvDownload', 'Скачать', 'Скачать');
    const replyButton = button('pmvAction pmvReply', 'Ответить на вложение', 'Ответить');
    downloadButton.hidden = typeof options.download !== 'function';
    replyButton.hidden = typeof options.onReply !== 'function';
    actions.append(replyButton, downloadButton);
    toolbar.append(closeButton, description, actions);
    const previous = button('pmvIcon pmvPrevious', 'Предыдущее вложение', '‹');
    const next = button('pmvIcon pmvNext', 'Следующее вложение', '›');
    const status = element('p', 'pmvStatus');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = button('pmvAction pmvRetry', 'Повторить загрузку', 'Повторить');
    retry.hidden = true;
    const notice = element('div', 'pmvNotice');
    notice.append(status, retry);
    dialog.append(stage, toolbar, previous, next, notice);

    let items = [], index = 0, epoch = 0, opened = false, destroyed = false;
    let currentMedia = null, restoreFocus = null, oldBodyOverflow = '', touch = null;

    function setStatus(message, canRetry) {
      status.textContent = message || '';
      retry.hidden = !canRetry;
      notice.hidden = !message && !canRetry;
    }

    function report(error, message, canRetry) {
      setStatus(message, canRetry);
      if (typeof options.onError === 'function') {
        try { options.onError(error); } catch (_) { /* A host notice must not break close/navigation. */ }
      }
    }

    function releaseMedia() {
      const media = currentMedia;
      currentMedia = null;
      if (media) {
        media.onload = media.onerror = media.onloadedmetadata = media.onplaying = null;
        if (media.tagName === 'VIDEO') {
          media.pause();
          media.removeAttribute('src');
          media.load();
        } else media.removeAttribute('src');
      }
      stage.replaceChildren();
    }

    async function show(target) {
      if (!opened || destroyed || target < 0 || target >= items.length) return;
      const ticket = ++epoch;
      index = target;
      releaseMedia();
      touch = null;
      const item = items[index];
      name.textContent = item.name || (item.type === 'image' ? 'Фото' : 'Видео');
      counter.textContent = items.length > 1 ? (index + 1) + ' из ' + items.length : '';
      previous.hidden = items.length < 2;
      next.hidden = items.length < 2;
      previous.disabled = index === 0;
      next.disabled = index === items.length - 1;
      downloadButton.disabled = false;
      downloadButton.textContent = 'Скачать';
      replyButton.disabled = false;
      setStatus('Загрузка…');
      try {
        const resolved = await options.resolveUrl(item);
        if (!opened || ticket !== epoch || destroyed) return;
        const url = safeUrl(resolved);
        if (!url) throw new Error('Не удалось получить адрес вложения.');
        const media = element(item.type === 'image' ? 'img' : 'video', 'pmvMedia');
        currentMedia = media;
        const ready = () => {
          if (opened && ticket === epoch && media === currentMedia) setStatus('');
        };
        media.onerror = () => {
          if (opened && ticket === epoch && media === currentMedia) {
            report(new Error('Браузер не смог открыть вложение.'), 'Не удалось открыть. Попробуйте скачать файл.', true);
          }
        };
        if (item.type === 'image') {
          media.alt = item.name || 'Фото';
          media.draggable = false;
          media.onload = ready;
        } else {
          media.controls = true;
          media.playsInline = true;
          media.setAttribute('playsinline', '');
          media.preload = 'metadata';
          media.onloadedmetadata = ready;
          media.onplaying = ready;
          media.setAttribute('aria-label', item.name || 'Видео');
        }
        stage.append(media);
        media.src = url;
      } catch (error) {
        if (opened && ticket === epoch && !destroyed) report(error, 'Не удалось загрузить вложение.', true);
      }
    }

    function cleanClose() {
      if (!opened) return;
      opened = false;
      ++epoch;
      touch = null;
      releaseMedia();
      items = [];
      setStatus('');
      document.body.style.overflow = oldBodyOverflow;
      if (activeViewer === api) activeViewer = null;
      if (restoreFocus && restoreFocus.isConnected && typeof restoreFocus.focus === 'function') {
        try { restoreFocus.focus({ preventScroll: true }); } catch (_) { restoreFocus.focus(); }
      }
      restoreFocus = null;
    }

    function close() {
      if (!opened) return;
      // Clear immediately: pending URL promises and playing video cannot survive dismissal.
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
      cleanClose();
    }

    async function open(value, selected) {
      if (destroyed) throw new Error('Просмотр уже закрыт.');
      const nextItems = Array.isArray(value) ? value.filter(item => item && ['image', 'video'].includes(item.type)).map(item => ({ ...item })) : [];
      if (!nextItems.length) throw new Error('Фото или видео не найдено.');
      if (activeViewer && activeViewer !== api) activeViewer.close();
      scope.PablicusRichMessage?.stopAll?.();
      if (!dialog.isConnected) document.body.append(dialog);
      if (!opened) {
        restoreFocus = document.activeElement;
        oldBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        opened = true;
        activeViewer = api;
        try {
          if (typeof dialog.showModal === 'function') dialog.showModal();
          else dialog.setAttribute('open', '');
        } catch (error) {
          cleanClose();
          throw error;
        }
        closeButton.focus({ preventScroll: true });
      }
      items = nextItems;
      const start = Number.isInteger(selected) ? Math.min(Math.max(selected, 0), items.length - 1) : 0;
      await show(start);
    }

    closeButton.onclick = close;
    previous.onclick = () => show(index - 1);
    next.onclick = () => show(index + 1);
    retry.onclick = () => show(index);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (!dialog.open) cleanClose(); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      // Video controls retain their native seek/volume keyboard shortcuts.
      if (event.target?.tagName === 'VIDEO') return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        show(index + (event.key === 'ArrowLeft' ? -1 : 1));
      }
    });
    stage.addEventListener('touchstart', event => {
      // A single horizontal swipe navigates images. Multi-touch stays available for zoom.
      if (event.touches.length !== 1 || currentMedia?.tagName === 'VIDEO' || scope.visualViewport?.scale > 1.05) { touch = null; return; }
      const point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, started: Date.now() };
    }, { passive: true });
    stage.addEventListener('touchend', event => {
      const start = touch;
      touch = null;
      if (!start || event.touches.length || !event.changedTouches.length || Date.now() - start.started > 650) return;
      const point = event.changedTouches[0], dx = point.clientX - start.x, dy = point.clientY - start.y;
      if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6) show(index + (dx < 0 ? 1 : -1));
    }, { passive: true });
    stage.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
    downloadButton.onclick = async () => {
      if (!opened || downloadButton.disabled || typeof options.download !== 'function') return;
      const ticket = epoch, item = items[index];
      downloadButton.disabled = true;
      downloadButton.textContent = 'Скачиваю…';
      try {
        await options.download(item);
        if (opened && ticket === epoch) setStatus('');
      } catch (error) {
        if (opened && ticket === epoch) report(error, 'Не удалось скачать. Нажмите «Скачать» ещё раз.');
      } finally {
        if (opened && ticket === epoch) {
          downloadButton.disabled = false;
          downloadButton.textContent = 'Скачать';
        }
      }
    };
    replyButton.onclick = async () => {
      if (!opened || replyButton.disabled || typeof options.onReply !== 'function') return;
      const item = items[index];
      close();
      try { await options.onReply(item); }
      catch (error) {
        if (typeof options.onError === 'function') {
          try { options.onError(error); } catch (_) { /* Preserve the closed viewer state. */ }
        }
      }
    };

    const api = { open, close, destroy() { close(); destroyed = true; dialog.remove(); }, get opened() { return opened; } };
    return api;
  }

  scope.PablicusMediaViewer = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
