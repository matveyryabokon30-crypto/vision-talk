/* A movable preview of real incoming messages from other conversations. */
(function (scope) {
  'use strict';

  const MEDIA = new Set(['image', 'video', 'audio', 'document']);
  function messageBlocks(message) {
    if (!message || typeof message !== 'object') return [];
    if (message.type === 'rich' && message.attachment_metadata?.v === 1 && Array.isArray(message.attachment_metadata.blocks)) {
      return message.attachment_metadata.blocks.filter(block => block && (
        (block.type === 'text' && typeof block.text === 'string') ||
        (MEDIA.has(block.type) && typeof block.path === 'string')
      )).map(block => ({ ...block }));
    }
    const blocks = [];
    if (typeof message.body === 'string' && message.body.trim()) blocks.push({ id: 'text', type: 'text', text: message.body });
    if (typeof message.attachment_path === 'string' && message.attachment_path) {
      const metadata = message.attachment_metadata || {};
      blocks.push({ id: 'media', type: MEDIA.has(message.type) ? message.type : 'document', path: message.attachment_path,
        name: typeof metadata.name === 'string' ? metadata.name : 'Вложение', mime: metadata.mime_type || '' });
    }
    return blocks;
  }

  function safeUrl(value) {
    if (typeof value !== 'string') return null;
    try { const url = new scope.URL(value); return ['https:', 'http:', 'blob:'].includes(url.protocol) ? url.href : null; }
    catch (_) { return null; }
  }

  function create(options) {
    options = options || {};
    const document = scope.document;
    if (!document?.body) throw new Error('Для мини-окошка нужен DOM.');
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const button = (className, label, text) => {
      const element = node('button', className, text);
      element.type = 'button'; element.setAttribute('aria-label', label); element.title = label;
      return element;
    };
    const root = node('aside', 'inboxMonitor');
    root.id = 'inboxMonitor'; root.hidden = true; root.setAttribute('aria-label', 'Сообщения из других чатов');
    const shell = node('div', 'inboxMonitorShell');
    const header = node('div', 'inboxMonitorHead');
    const handle = button('inboxMonitorDrag', 'Переместить окошко', '⠿');
    const heading = node('strong', 'inboxMonitorTitle');
    const collapseButton = button('inboxMonitorCollapse', 'Свернуть', '−');
    const closeButton = button('inboxMonitorClose', 'Закрыть уведомление', '×');
    header.append(handle, heading, collapseButton, closeButton);
    const body = node('div', 'inboxMonitorBody'); body.tabIndex = 0; body.setAttribute('aria-label', 'Содержимое сообщения');
    const footer = node('div', 'inboxMonitorFoot');
    const previous = button('inboxMonitorPrev', 'Предыдущее сообщение', '‹');
    const counter = node('span', 'inboxMonitorCount');
    const next = button('inboxMonitorNext', 'Следующее сообщение', '›');
    const open = button('inboxMonitorOpen', 'Открыть чат', 'Открыть чат');
    footer.append(previous, counter, next, open);
    const badge = button('inboxMonitorBadge', 'Развернуть сообщения', '');
    const announcement = node('span', 'inboxMonitorAnnounce'); announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
    shell.append(header, body, footer); root.append(shell, badge, announcement); document.body.append(root);

    let context = { userId: null, conversationId: null, active: false };
    let queue = [], index = 0, collapsed = false, destroyed = false, epoch = 0, opening = false;
    let observer = null, positionFrame = null, drag = null, dock = 'right', preferredY = null;
    const seen = new Set(), media = new Set(), pendingLoads = new Set();
    let activeVideo = null;
    const isVisible = () => !destroyed && !root.hidden && !collapsed && !document.hidden && !root.classList.contains('inboxMonitorSpaceHidden');

    function releaseMedia() {
      ++epoch;
      if (observer) observer.disconnect(); observer = null;
      for (const element of media) {
        element.onloadeddata = null; element.onerror = null; element.onload = null;
        if (typeof element.pause === 'function') element.pause();
        element.removeAttribute('src');
        if (typeof element.load === 'function') element.load();
      }
      media.clear(); pendingLoads.clear(); activeVideo = null;
    }

    function viewport() {
      const view = scope.visualViewport;
      return { x: view?.offsetLeft || 0, y: view?.offsetTop || 0, width: view?.width || scope.innerWidth, height: view?.height || scope.innerHeight };
    }

    function position() {
      positionFrame = null;
      if (destroyed || root.hidden || drag) return;
      const view = viewport(), margin = 10;
      const composer = document.getElementById('composer');
      const bounds = composer && composer.getClientRects().length ? composer.getBoundingClientRect() : null;
      let bottom = view.y + view.height - margin;
      if (bounds && bounds.top > view.y && bounds.top < bottom) bottom = bounds.top - 10;
      else bottom -= 60;
      const available = bottom - view.y - margin;
      const spaceHidden = available < 48 || !!document.querySelector('#app.composer-fullscreen');
      const wasHidden = root.classList.contains('inboxMonitorSpaceHidden');
      root.classList.toggle('inboxMonitorSpaceHidden', spaceHidden);
      if (spaceHidden) { if (!wasHidden) releaseMedia(); return; }
      const compact = collapsed || available < 146;
      const wasCompact = root.classList.contains('inboxMonitorCompact');
      root.classList.toggle('inboxMonitorCompact', compact);
      root.style.width = compact ? '72px' : Math.min(232, view.width - 2 * margin) + 'px';
      root.style.setProperty('--monitor-max-height', Math.max(120, Math.min(248, available)) + 'px');
      const rect = root.getBoundingClientRect();
      root.style.left = (dock === 'left' ? view.x + margin : view.x + view.width - rect.width - margin) + 'px';
      const desired = preferredY === null ? bottom - rect.height : preferredY;
      root.style.top = Math.max(view.y + margin, Math.min(bottom - rect.height, desired)) + 'px';
      if (compact && !wasCompact) releaseMedia();
      else if ((wasHidden || wasCompact) && !compact) renderBody();
    }

    function schedulePosition() {
      if (positionFrame === null) positionFrame = scope.requestAnimationFrame(position);
    }

    function playVisibleVideo(element) {
      if (!isVisible() || root.classList.contains('inboxMonitorCompact') || !element.isConnected || !element.dataset.visible) return;
      if (activeVideo && activeVideo !== element && !activeVideo.paused) return;
      if (Array.from(media).some(other => other !== element && other.tagName === 'AUDIO' && !other.paused)) return;
      activeVideo = element;
      // The system can decline muted autoplay; the native play button remains usable.
      const playing = element.play(); if (playing?.catch) playing.catch(() => {});
    }

    async function loadMedia(item, currentEpoch) {
      if (pendingLoads.has(item) || item.loaded || !isVisible() || root.classList.contains('inboxMonitorCompact')) return;
      pendingLoads.add(item);
      try {
        if (typeof options.resolveUrl !== 'function') throw new Error('Вложение пока недоступно.');
        const url = safeUrl(await options.resolveUrl(item.block, item.message));
        if (destroyed || epoch !== currentEpoch || !isVisible() || !item.element.isConnected) return;
        if (!url) throw new Error('Не удалось открыть вложение.');
        item.loaded = true;
        item.element.onerror = () => {
          if (epoch !== currentEpoch) return;
          item.label.hidden = false; item.label.textContent = 'Вложение не загрузилось. Откройте чат.';
        };
        item.element.onloadeddata = () => {
          if (epoch !== currentEpoch) return;
          item.label.hidden = true;
          if (item.block.type === 'video') playVisibleVideo(item.element);
        };
        if (item.block.type === 'image') item.element.onload = () => { if (epoch === currentEpoch) item.label.hidden = true; };
        item.element.src = url;
      } catch (error) {
        if (epoch === currentEpoch && !destroyed) { item.label.hidden = false; item.label.textContent = 'Вложение не загрузилось. Откройте чат.'; }
      } finally { pendingLoads.delete(item); }
    }

    function renderBody() {
      releaseMedia(); body.replaceChildren(); body.scrollTop = 0;
      const entry = queue[index];
      if (!entry || collapsed || document.hidden || destroyed) return;
      const currentEpoch = epoch, items = [];
      let visualGroup = null;
      const blocks = messageBlocks(entry.message);
      for (const block of blocks) {
        if (block.type === 'text') {
          if (block.text.trim()) { visualGroup = null; body.append(node('p', 'inboxMonitorText', block.text)); }
          continue;
        }
        if (block.type === 'document') {
          visualGroup = null;
          body.append(node('p', 'inboxMonitorDocument', '▤ ' + (block.name || 'Документ')));
          continue;
        }
        const tile = node('div', 'inboxMonitorTile inboxMonitorTile-' + block.type);
        if (block.type === 'image' || block.type === 'video') {
          if (!visualGroup) { visualGroup = node('div', 'inboxMonitorGallery'); body.append(visualGroup); }
          visualGroup.append(tile);
        } else { visualGroup = null; body.append(tile); }
        const label = node('span', 'inboxMonitorMediaStatus', block.type === 'audio' ? 'Голосовое сообщение' : block.type === 'video' ? 'Видео' : 'Фото');
        const element = node(block.type === 'image' ? 'img' : block.type, 'inboxMonitor' + block.type[0].toUpperCase() + block.type.slice(1));
        if (block.type === 'image') { element.alt = block.name || 'Фото'; element.decoding = 'async'; }
        else {
          element.controls = true; element.preload = 'metadata';
          element.setAttribute('aria-label', block.type === 'audio' ? 'Прослушать голосовое сообщение' : 'Посмотреть видео');
          if (block.type === 'video') {
            element.muted = true; element.defaultMuted = true; element.playsInline = true; element.setAttribute('playsinline', '');
            element.addEventListener('play', () => {
              if (!isVisible()) { element.pause(); return; }
              for (const other of media) if (other !== element && typeof other.pause === 'function') other.pause();
              activeVideo = element;
            });
          } else {
            element.addEventListener('play', () => {
              if (!isVisible()) { element.pause(); return; }
              for (const other of media) if (other !== element && typeof other.pause === 'function') other.pause();
            });
          }
        }
        tile.append(element, label); media.add(element);
        items.push({ block, message: entry.message, element, label, tile, loaded: false });
      }
      if (!blocks.length) body.append(node('p', 'inboxMonitorText', 'Новое сообщение'));
      if (scope.IntersectionObserver) {
        observer = new scope.IntersectionObserver(entries => {
          for (const observed of entries) {
            const item = items.find(candidate => candidate.tile === observed.target);
            if (!item) continue;
            if (observed.isIntersecting && observed.intersectionRatio >= 0.25) {
              item.element.dataset.visible = 'true';
              loadMedia(item, currentEpoch);
              if (item.loaded && item.block.type === 'video') playVisibleVideo(item.element);
            } else {
              delete item.element.dataset.visible;
              if (typeof item.element.pause === 'function') item.element.pause();
            }
          }
        }, { root: body, threshold: [0, 0.25] });
        for (const item of items) observer.observe(item.tile);
      } else {
        // Without intersection support, media are still explicit user controls.
        for (const item of items) loadMedia(item, currentEpoch);
      }
    }

    function render() {
      releaseMedia();
      const entry = queue[index];
      root.hidden = destroyed || !context.active || !context.userId || !entry || document.hidden;
      if (root.hidden) return;
      heading.textContent = entry.conversationTitle || 'Другой чат'; heading.title = heading.textContent;
      counter.textContent = (index + 1) + ' / ' + queue.length;
      previous.disabled = queue.length < 2; next.disabled = queue.length < 2;
      badge.textContent = 'Чаты · ' + queue.length;
      badge.setAttribute('aria-label', 'Развернуть сообщения: ' + queue.length);
      open.disabled = false;
      root.classList.toggle('inboxMonitorCompact', collapsed);
      renderBody(); position();
    }

    function push(entry) {
      const message = entry?.message;
      if (destroyed || !context.userId || !context.active || !message || !message.id || !message.conversation_id ||
          message.sender_id === context.userId || message.conversation_id === context.conversationId || seen.has(message.id)) return false;
      seen.add(message.id);
      if (seen.size > 400) seen.delete(seen.values().next().value);
      queue.push({ message, conversationTitle: typeof entry.conversationTitle === 'string' ? entry.conversationTitle : 'Другой чат' });
      if (queue.length > 20) {
        const discard = index === 0 ? 1 : 0;
        queue.splice(discard, 1); if (discard < index) --index;
      }
      // Do not interrupt the item the person is watching or reading.
      if (queue.length === 1) { index = 0; render(); }
      else {
        counter.textContent = (index + 1) + ' / ' + queue.length; previous.disabled = false; next.disabled = false;
        badge.textContent = 'Чаты · ' + queue.length; badge.setAttribute('aria-label', 'Развернуть сообщения: ' + queue.length);
      }
      announcement.textContent = 'Новое сообщение: ' + (entry.conversationTitle || 'другой чат');
      return true;
    }

    function setContext(nextContext) {
      if (destroyed) return;
      const nextValue = { ...context, ...nextContext };
      if (nextValue.userId !== context.userId) { clear(); seen.clear(); collapsed = false; preferredY = null; dock = 'right'; }
      const changed = nextValue.userId !== context.userId || nextValue.conversationId !== context.conversationId || nextValue.active !== context.active;
      context = nextValue;
      queue = queue.filter(entry => entry.message.conversation_id !== context.conversationId);
      index = Math.min(index, Math.max(0, queue.length - 1));
      if (changed) render();
    }

    function clear() {
      queue = []; index = 0; releaseMedia(); root.hidden = true; body.replaceChildren(); announcement.textContent = '';
    }

    function dismiss() {
      queue.splice(index, 1); index = Math.min(index, Math.max(0, queue.length - 1)); render();
    }
    previous.addEventListener('click', () => { index = (index + queue.length - 1) % queue.length; render(); });
    next.addEventListener('click', () => { index = (index + 1) % queue.length; render(); });
    closeButton.addEventListener('click', dismiss);
    collapseButton.addEventListener('click', () => { collapsed = true; render(); });
    badge.addEventListener('click', () => { collapsed = false; preferredY = null; render(); });
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { collapsed = true; render(); } });
    open.addEventListener('click', async () => {
      if (opening || !queue[index] || typeof options.openConversation !== 'function') return;
      const id = queue[index].message.conversation_id, account = context.userId;
      opening = true; open.disabled = true;
      try {
        await options.openConversation(id);
        if (!destroyed && account === context.userId) {
          queue = queue.filter(entry => entry.message.conversation_id !== id); index = Math.min(index, Math.max(0, queue.length - 1)); render();
        }
      } catch (error) { if (!destroyed && account === context.userId && options.onError) options.onError(error); }
      finally { opening = false; if (!destroyed) open.disabled = false; }
    });

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || destroyed) return;
      const rect = root.getBoundingClientRect();
      drag = { pointer: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId); root.classList.add('inboxMonitorDragging'); event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const view = viewport(), rect = root.getBoundingClientRect();
      const x = Math.max(view.x + 10, Math.min(view.x + view.width - rect.width - 10, event.clientX - drag.dx));
      const composer = document.getElementById('composer');
      const composerBounds = composer?.getClientRects().length ? composer.getBoundingClientRect() : null;
      const bottom = composerBounds && composerBounds.top > view.y ? Math.min(view.y + view.height - 10, composerBounds.top - 10) : view.y + view.height - 70;
      preferredY = Math.max(view.y + 10, Math.min(bottom - rect.height, event.clientY - drag.dy));
      root.style.left = x + 'px'; root.style.top = preferredY + 'px';
    });
    function finishDrag(event) {
      if (!drag || event.pointerId !== drag.pointer) return;
      const view = viewport(), rect = root.getBoundingClientRect();
      dock = rect.left + rect.width / 2 < view.x + view.width / 2 ? 'left' : 'right';
      drag = null; root.classList.remove('inboxMonitorDragging'); schedulePosition();
    }
    handle.addEventListener('pointerup', finishDrag); handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('lostpointercapture', finishDrag);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') dock = event.key === 'ArrowLeft' ? 'left' : 'right';
      else preferredY = root.getBoundingClientRect().top + (event.key === 'ArrowUp' ? -24 : 24);
      position();
    });

    const onVisibility = () => render();
    document.addEventListener('visibilitychange', onVisibility);
    scope.addEventListener('resize', schedulePosition);
    scope.visualViewport?.addEventListener('resize', schedulePosition);
    scope.visualViewport?.addEventListener('scroll', schedulePosition);
    const composer = document.getElementById('composer'), app = document.getElementById('app');
    const resizeObserver = scope.ResizeObserver ? new scope.ResizeObserver(schedulePosition) : null;
    if (resizeObserver && composer) resizeObserver.observe(composer);
    const appObserver = scope.MutationObserver && app ? new scope.MutationObserver(schedulePosition) : null;
    appObserver?.observe(app, { attributes: true, attributeFilter: ['class'] });

    function destroy() {
      if (destroyed) return;
      clear(); destroyed = true; seen.clear();
      if (positionFrame !== null) scope.cancelAnimationFrame(positionFrame);
      resizeObserver?.disconnect(); appObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      scope.removeEventListener('resize', schedulePosition);
      scope.visualViewport?.removeEventListener('resize', schedulePosition);
      scope.visualViewport?.removeEventListener('scroll', schedulePosition);
      root.remove();
    }
    return { push, setContext, clear, destroy };
  }

  const api = { create, messageBlocks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  scope.PablicusInboxMonitor = api;
})(typeof window !== 'undefined' ? window : globalThis);
