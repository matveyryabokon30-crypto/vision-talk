/* Complete conversation search and materials. The host owns authenticated reads. */
(function (scope) {
  'use strict';

  const TABS = { search: 'Поиск', media: 'Медиа', documents: 'Файлы', audio: 'Голосовые', links: 'Ссылки' };
  const LABELS = { image: 'Фото', video: 'Видео', audio: 'Голосовое сообщение', document: 'Файл', file: 'Файл' };
  let nextId = 0;

  function safeUrl(value, media) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new scope.URL(value);
      return (media ? ['https:', 'http:', 'blob:'] : ['https:', 'http:']).includes(url.protocol) ? url.href : null;
    } catch (_) { return null; }
  }

  function readableSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    return bytes >= 1048576 ? (bytes / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ' : Math.max(1, Math.round(bytes / 1024)) + ' КБ';
  }

  function duration(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function dateLabel(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function material(value) {
    return {
      ...value,
      messageId: value.messageId || value.message_id || value.id,
      blockId: value.blockId || value.block_id || '',
      blockIndex: value.blockIndex ?? value.block_index ?? 0,
      type: value.type === 'file' ? 'document' : value.type,
      path: value.path || value.attachment_path || '',
      name: value.name || value.attachment_metadata?.name || LABELS[value.type] || 'Вложение',
      mime: value.mime || value.attachment_metadata?.mime_type || '',
      size: value.size ?? value.attachment_metadata?.size_bytes,
      createdAt: value.createdAt || value.created_at,
    };
  }

  function create(options) {
    options = options || {};
    const document = scope.document;
    if (!document?.body || typeof options.getContext !== 'function') throw new Error('Для поиска нужен открытый разговор.');
    const id = 'pcl-' + (++nextId);
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (className, label, iconName) => {
      const node = element('button', className);
      node.type = 'button';
      node.setAttribute('aria-label', label);
      node.title = label;
      if (iconName && scope.PablicusMessageMenu?.icon) node.append(scope.PablicusMessageMenu.icon(iconName));
      else node.textContent = label;
      return node;
    };
    const dialog = element('dialog', 'pablicusChatLibrary');
    dialog.setAttribute('aria-labelledby', id + '-title');
    const header = element('header', 'pclHeader');
    const heading = element('div', 'pclHeading');
    const title = element('h2', 'pclTitle');
    title.id = id + '-title';
    heading.append(title, element('p', 'pclSubtitle', 'Сообщения и материалы'));
    const closeButton = button('pclIcon pclClose', 'Закрыть поиск и материалы', 'close');
    header.append(heading, closeButton);
    const tabs = element('div', 'pclTabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Поиск и материалы чата');
    const tabButtons = new Map();
    for (const [key, label] of Object.entries(TABS)) {
      const tab = button('pclTab', label);
      tab.dataset.tab = key;
      tab.id = id + '-tab-' + key;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', id + '-panel');
      tab.onclick = () => selectTab(key);
      tabButtons.set(key, tab);
      tabs.append(tab);
    }
    const form = element('form', 'pclSearch');
    form.setAttribute('role', 'search');
    const label = element('label', 'pclSearchLabel', 'Текст сообщения');
    label.htmlFor = id + '-query';
    const searchField = element('div', 'pclSearchField');
    if (scope.PablicusMessageMenu?.icon) searchField.append(scope.PablicusMessageMenu.icon('search'));
    const input = element('input', 'pclSearchInput');
    input.id = id + '-query';
    input.type = 'search';
    input.maxLength = 200;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('enterkeyhint', 'search');
    const clear = button('pclIcon pclClear', 'Очистить поиск', 'close');
    clear.hidden = true;
    searchField.append(input, clear);
    form.append(label, searchField);
    const panel = element('section', 'pclPanel');
    panel.id = id + '-panel';
    panel.setAttribute('role', 'tabpanel');
    const status = element('p', 'pclStatus');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const scroller = element('div', 'pclScroller');
    const empty = element('div', 'pclEmpty');
    const emptyTitle = element('h3', 'pclEmptyTitle');
    const emptyDetail = element('p', 'pclEmptyDetail');
    empty.append(emptyTitle, emptyDetail);
    const results = element('div', 'pclResults');
    const more = button('pclMore', 'Показать ещё');
    more.hidden = true;
    scroller.append(empty, results, more);
    panel.append(status, scroller);
    dialog.append(header, tabs, form, panel);

    let opened = false, destroyed = false, context = null, tab = 'search', query = '';
    let generation = 0, controller = null, debounce = 0, busy = false, cursor = null, retryPage = false;
    let items = [], total = null, restoreFocus = null, oldBodyOverflow = '', observer = null;
    let thumbnailQueue = [], thumbnailBusy = 0, thumbnailFrame = 0;
    const thumbnailItems = new Set(), audios = new Set(), itemKeys = new Set();

    function sameContext() {
      const now = options.getContext() || {};
      return !!context && now.userId === context.userId && now.conversationId === context.conversationId && now.epoch === context.epoch;
    }

    function isCurrent(ticket) {
      if (!opened || destroyed || ticket !== generation) return false;
      if (sameContext()) return true;
      close();
      return false;
    }

    function report(error) {
      if (typeof options.onError === 'function') {
        try { options.onError(error); } catch (_) { /* Host notifications are optional. */ }
      }
    }

    function stopAudio(release) {
      for (const audio of audios) {
        audio.pause();
        if (release) {
          audio.removeAttribute('src');
          audio.load();
        }
      }
      if (release) audios.clear();
    }

    function abort() {
      ++generation;
      scope.clearTimeout(debounce);
      debounce = 0;
      controller?.abort();
      controller = null;
      busy = false;
      if (observer) observer.disconnect();
      observer = null;
      thumbnailQueue = [];
      thumbnailBusy = 0;
      for (const entry of thumbnailItems) entry.finish?.();
      thumbnailItems.clear();
      if (thumbnailFrame) {
        if (scope.cancelAnimationFrame) scope.cancelAnimationFrame(thumbnailFrame);
        else scope.clearTimeout(thumbnailFrame);
      }
      thumbnailFrame = 0;
      stopAudio(true);
      for (const image of results.querySelectorAll('img')) image.removeAttribute('src');
    }

    function setEmpty(titleText, detail) {
      empty.hidden = !titleText;
      emptyTitle.textContent = titleText || '';
      emptyDetail.textContent = detail || '';
    }

    function resultStatus() {
      if (total !== null) status.textContent = cursor !== null ? 'Показано: ' + items.length + ' из ' + total : 'Найдено: ' + total;
      else status.textContent = (cursor !== null ? 'Показано: ' : 'Найдено: ') + items.length;
      more.hidden = cursor === null;
      more.disabled = false;
      more.textContent = 'Показать ещё';
    }

    function highlighted(node, value) {
      const text = String(value || '');
      const match = query && text.toLocaleLowerCase('ru').indexOf(query.toLocaleLowerCase('ru'));
      if (query && match >= 0) {
        node.append(document.createTextNode(text.slice(0, match)), element('mark', '', text.slice(match, match + query.length)), document.createTextNode(text.slice(match + query.length)));
      } else node.textContent = text;
    }

    async function checkedMessage(messageId, ticket) {
      if (!isCurrent(ticket)) return false;
      if (typeof options.getMessage !== 'function') return true;
      const result = await options.getMessage(messageId, { ...context });
      if (!isCurrent(ticket)) return false;
      const message = result?.data !== undefined ? result.data : result;
      if (!message || message.deleted_at || (message.conversation_id && message.conversation_id !== context.conversationId)) throw new Error('Исходное сообщение больше недоступно.');
      return message;
    }

    function actionError(node, error) {
      node.textContent = error?.message || 'Не удалось открыть. Повторите попытку.';
      node.hidden = false;
      report(error);
    }

    function locateButton(messageId, notice) {
      const locate = button('pclIcon pclLocate', 'Перейти к сообщению', 'corner-up-left');
      locate.onclick = () => locateMessage(messageId, locate, notice);
      return locate;
    }

    async function locateMessage(messageId, trigger, notice) {
      const ticket = generation;
      if (!isCurrent(ticket) || trigger.disabled) return;
      trigger.disabled = true;
      try {
        if (!await checkedMessage(messageId, ticket) || !isCurrent(ticket)) return;
        if (typeof options.onLocate !== 'function') throw new Error('Переход к сообщению недоступен.');
        close();
        await options.onLocate(messageId);
      } catch (error) {
        if (isCurrent(ticket)) actionError(notice, error);
        else if (!opened && sameContext()) report(error);
      } finally { trigger.disabled = false; }
    }

    function renderMessage(value) {
      const messageId = value.message_id || value.id;
      const row = element('article', 'pclResult');
      row.dataset.messageId = messageId;
      const open = button('pclMessageOpen', 'Перейти к сообщению');
      open.replaceChildren();
      const metadata = element('span', 'pclMetadata');
      metadata.textContent = [value.sender_name || value.display_name, dateLabel(value.created_at)].filter(Boolean).join(' · ');
      const snippet = element('span', 'pclSnippet');
      highlighted(snippet, value.snippet || value.body || value.text || value.attachment_metadata?.blocks?.map(block => block.text || block.name || LABELS[block.type] || '').join('\n') || 'Сообщение');
      open.append(metadata, snippet);
      const notice = element('p', 'pclItemNotice');
      notice.hidden = true;
      open.onclick = () => locateMessage(messageId, open, notice);
      row.append(open, locateButton(messageId, notice), notice);
      return row;
    }

    async function activateMaterial(item, trigger, notice) {
      const ticket = generation;
      if (!isCurrent(ticket) || trigger.disabled) return;
      trigger.disabled = true;
      try {
        if (!await checkedMessage(item.messageId, ticket) || !isCurrent(ticket)) return;
        if (item.type === 'image' || item.type === 'video') {
          if (typeof options.onOpenMedia !== 'function') throw new Error('Просмотр вложений недоступен.');
          stopAudio(false);
          scope.PablicusRichMessage?.stopAll?.();
          const gallery = items.filter(value => value.type === 'image' || value.type === 'video');
          await options.onOpenMedia(gallery, Math.max(0, gallery.indexOf(item)));
        } else {
          if (typeof options.onDownload !== 'function') throw new Error('Загрузка файлов недоступна.');
          await options.onDownload(item);
        }
        if (isCurrent(ticket)) notice.hidden = true;
      } catch (error) { if (isCurrent(ticket)) actionError(notice, error); }
      finally { trigger.disabled = false; }
    }

    function queueThumbnail(entry) {
      if (entry.queued || !isCurrent(entry.ticket)) return;
      entry.queued = true;
      thumbnailQueue.push(entry);
      pumpThumbnails();
    }

    function pumpThumbnails() {
      while (thumbnailBusy < 3 && thumbnailQueue.length) {
        const entry = thumbnailQueue.shift();
        if (!isCurrent(entry.ticket)) continue;
        ++thumbnailBusy;
        loadThumbnail(entry).finally(() => {
          if (isCurrent(entry.ticket)) {
            --thumbnailBusy;
            pumpThumbnails();
          }
        });
      }
    }

    async function loadThumbnail(entry) {
      try {
        if (typeof options.resolveUrl !== 'function') return;
        const resolved = await options.resolveUrl(entry.item);
        if (!isCurrent(entry.ticket) || !entry.image.isConnected) return;
        const url = safeUrl(resolved, true);
        if (!url) throw new Error('Адрес фото недоступен.');
        await new Promise(resolve => {
          const finish = () => {
            scope.clearTimeout(timer);
            entry.image.onload = entry.image.onerror = null;
            entry.finish = null;
            resolve();
          };
          const timer = scope.setTimeout(finish, 18000);
          entry.finish = finish;
          entry.image.onload = () => {
            if (isCurrent(entry.ticket)) entry.tile.classList.add('pclThumbnailReady');
            finish();
          };
          entry.image.onerror = finish;
          entry.image.src = url;
        });
      } catch (_) { /* An unavailable thumbnail still opens the retryable media viewer. */ }
    }

    function observeThumbnail(entry) {
      thumbnailItems.add(entry);
      if (scope.IntersectionObserver) {
        if (!observer) observer = new scope.IntersectionObserver(records => {
          for (const record of records) {
            if (!record.isIntersecting) continue;
            const current = [...thumbnailItems].find(candidate => candidate.tile === record.target);
            if (current) queueThumbnail(current);
            observer?.unobserve(record.target);
          }
        }, { root: scroller, rootMargin: '100px' });
        observer.observe(entry.tile);
      } else scheduleVisibleThumbnails();
    }

    function scheduleVisibleThumbnails() {
      if (scope.IntersectionObserver || thumbnailFrame || !opened) return;
      const frame = callback => scope.requestAnimationFrame ? scope.requestAnimationFrame(callback) : scope.setTimeout(callback, 16);
      thumbnailFrame = frame(() => {
        thumbnailFrame = 0;
        const bounds = scroller.getBoundingClientRect();
        for (const entry of thumbnailItems) {
          const box = entry.tile.getBoundingClientRect();
          if (box.bottom >= bounds.top - 100 && box.top <= bounds.bottom + 100) queueThumbnail(entry);
        }
      });
    }

    function renderVisual(item) {
      const card = element('article', 'pclMaterial pclVisual');
      card.dataset.messageId = item.messageId;
      card.dataset.blockId = item.blockId;
      const tile = button('pclMediaTile', 'Открыть ' + (item.name || LABELS[item.type]));
      tile.replaceChildren();
      const placeholder = element('span', 'pclTilePlaceholder');
      if (item.type === 'video' && scope.PablicusMessageMenu?.icon) placeholder.append(scope.PablicusMessageMenu.icon('play'));
      placeholder.append(element('span', '', LABELS[item.type]));
      tile.append(placeholder);
      if (item.type === 'image') {
        const image = element('img', 'pclThumbnail');
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        tile.append(image);
        observeThumbnail({ item, image, tile, ticket: generation, queued: false });
      }
      if (item.type === 'video' && Number(item.duration) > 0) tile.append(element('span', 'pclDuration', duration(item.duration)));
      const notice = element('p', 'pclItemNotice');
      notice.hidden = true;
      tile.onclick = () => activateMaterial(item, tile, notice);
      const footer = element('div', 'pclVisualFooter');
      const caption = element('span', 'pclVisualCaption', item.name);
      caption.title = item.name + (item.createdAt ? ' · ' + dateLabel(item.createdAt) : '');
      footer.append(caption, locateButton(item.messageId, notice));
      card.append(tile, footer, notice);
      return card;
    }

    function renderAudio(item, card, notice) {
      const player = element('div', 'pclAudio');
      const play = button('pclIcon pclAudioPlay', 'Воспроизвести голосовое сообщение', 'play');
      const audio = element('audio', 'pclAudioElement');
      audio.controls = true;
      audio.preload = 'none';
      audio.setAttribute('playsinline', '');
      audio.setAttribute('aria-label', item.name);
      audio.hidden = true;
      const detail = element('span', 'pclAudioDetail', Number(item.duration) > 0 ? duration(item.duration) : 'Нажмите для прослушивания');
      const ticket = generation;
      audios.add(audio);
      audio.addEventListener('play', () => {
        if (!isCurrent(ticket)) { audio.pause(); return; }
        scope.PablicusRichMessage?.stopAll?.();
        for (const other of audios) if (other !== audio) other.pause();
      });
      audio.addEventListener('error', () => {
        if (!isCurrent(ticket)) return;
        audio.hidden = true;
        play.hidden = false;
        detail.hidden = false;
        notice.hidden = false;
        notice.textContent = 'Не удалось воспроизвести. Нажмите, чтобы повторить.';
      });
      play.onclick = async () => {
        if (!isCurrent(ticket) || play.disabled) return;
        play.disabled = true;
        detail.textContent = 'Загрузка…';
        notice.hidden = true;
        try {
          if (!await checkedMessage(item.messageId, ticket) || !isCurrent(ticket)) return;
          if (typeof options.resolveUrl !== 'function') throw new Error('Прослушивание недоступно.');
          const resolved = await options.resolveUrl(item);
          if (!isCurrent(ticket)) return;
          const url = safeUrl(resolved, true);
          if (!url) throw new Error('Голосовое сообщение недоступно.');
          stopAudio(false);
          scope.PablicusRichMessage?.stopAll?.();
          audio.src = url;
          audio.hidden = false;
          play.hidden = true;
          detail.hidden = true;
          try { await audio.play(); }
          catch (error) {
            if (isCurrent(ticket) && error?.name !== 'AbortError') {
              notice.hidden = false;
              notice.textContent = 'Нажмите воспроизведение в плеере.';
            }
          }
        } catch (error) {
          if (isCurrent(ticket)) {
            detail.textContent = 'Повторить';
            actionError(notice, error);
          }
        } finally { play.disabled = false; }
      };
      player.append(play, detail, audio);
      card.append(player);
    }

    function renderMaterial(item) {
      if (item.type === 'image' || item.type === 'video') return renderVisual(item);
      const card = element('article', 'pclMaterial pclFile');
      card.dataset.messageId = item.messageId;
      card.dataset.blockId = item.blockId;
      const notice = element('p', 'pclItemNotice');
      notice.hidden = true;
      const isLink = tab === 'links' || item.kind === 'links' || item.type === 'link';
      const top = element('div', 'pclFileTop');
      const description = element('div', 'pclFileDescription');
      if (isLink) {
        const url = safeUrl(item.url, false);
        const link = element(url ? 'a' : 'span', 'pclFileName pclLink');
        if (url) {
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          const ticket = generation;
          link.onclick = event => { if (!isCurrent(ticket)) event.preventDefault(); };
        }
        highlighted(link, item.url || item.body || 'Ссылка недоступна');
        description.append(link);
        if (item.body && item.body !== item.url) {
          const excerpt = element('span', 'pclLinkExcerpt');
          highlighted(excerpt, item.body);
          description.append(excerpt);
        }
      } else if (item.type === 'audio') description.append(element('span', 'pclFileName', item.name));
      else {
        const download = button('pclFileName pclFileDownload', 'Скачать ' + item.name);
        download.replaceChildren();
        highlighted(download, item.name);
        download.onclick = () => activateMaterial(item, download, notice);
        description.append(download);
      }
      description.append(element('span', 'pclMetadata', [!isLink ? readableSize(item.size) : '', dateLabel(item.createdAt)].filter(Boolean).join(' · ')));
      top.append(description, locateButton(item.messageId, notice));
      card.append(top);
      if (item.type === 'audio') renderAudio(item, card, notice);
      card.append(notice);
      return card;
    }

    async function fetchPage(append) {
      const ticket = generation;
      if (!isCurrent(ticket) || busy) return;
      if (tab === 'search' && !query) {
        status.textContent = '';
        setEmpty('Поиск по всему разговору', 'Введите слово или фразу.');
        more.hidden = true;
        return;
      }
      busy = true;
      retryPage = append;
      controller = new scope.AbortController();
      const request = controller;
      panel.setAttribute('aria-busy', 'true');
      status.textContent = append ? 'Загружаем ещё…' : 'Ищем по всему разговору…';
      more.disabled = true;
      if (!append) setEmpty('');
      try {
        const fetcher = tab === 'search' ? options.searchMessages : options.listMaterials;
        if (typeof fetcher !== 'function') throw new Error('Поиск пока недоступен.');
        const response = await fetcher({ context: { ...context }, tab, query, cursor: append ? cursor : null, limit: 36, signal: request.signal });
        if (!isCurrent(ticket) || request.signal.aborted) return;
        if (response?.error) throw response.error;
        const received = Array.isArray(response) ? response : response?.items || response?.data || [];
        if (!Array.isArray(received)) throw new Error('Не удалось получить результаты поиска.');
        const nextCursor = response?.nextCursor ?? null;
        cursor = nextCursor;
        total = typeof response?.total === 'number' && Number.isFinite(response.total) ? response.total : null;
        for (const value of received) {
          const item = tab === 'search' ? value : material(value);
          const key = tab === 'search' ? item.message_id || item.id : [item.messageId, item.blockId, item.blockIndex, item.type, item.url].join(':');
          if (!key || itemKeys.has(key)) continue;
          itemKeys.add(key);
          items.push(item);
          results.append(tab === 'search' ? renderMessage(item) : renderMaterial(item));
        }
        resultStatus();
        if (!items.length) setEmpty(query ? 'Ничего не найдено' : 'Пока нет материалов', query ? (tab === 'search' ? 'Попробуйте другое слово или фразу.' : 'Попробуйте другое слово или имя файла.') : 'Материалы появятся здесь после отправки в этот чат.');
        else setEmpty('');
      } catch (error) {
        if (!isCurrent(ticket) || request.signal.aborted || error?.name === 'AbortError') return;
        status.textContent = scope.navigator?.onLine === false ? 'Нет сети. Подключитесь и повторите поиск.' : 'Не удалось загрузить результаты.';
        if (!items.length) setEmpty('Поиск недоступен', error?.message || 'Повторите попытку чуть позже.');
        more.textContent = 'Повторить';
        more.hidden = false;
        more.disabled = false;
        report(error);
      } finally {
        if (isCurrent(ticket)) {
          busy = false;
          panel.setAttribute('aria-busy', 'false');
          if (controller === request) controller = null;
        }
      }
    }

    function prepareSearch() {
      abort();
      items = [];
      itemKeys.clear();
      total = null;
      cursor = null;
      retryPage = false;
      results.replaceChildren();
      results.classList.toggle('pclMediaGrid', tab === 'media');
      more.hidden = true;
      scroller.scrollTop = 0;
      query = input.value.trim();
      clear.hidden = !input.value;
      status.textContent = '';
      panel.setAttribute('aria-busy', 'false');
      setEmpty('');
    }

    function selectTab(value) {
      if (!opened || !Object.hasOwn(TABS, value)) return;
      tab = value;
      for (const [key, tabButton] of tabButtons) {
        tabButton.setAttribute('aria-selected', String(key === tab));
        tabButton.tabIndex = key === tab ? 0 : -1;
      }
      panel.setAttribute('aria-labelledby', id + '-tab-' + tab);
      label.textContent = tab === 'search' ? 'Текст сообщения' : tab === 'links' ? 'Ссылка или текст сообщения' : 'Имя файла или текст сообщения';
      input.placeholder = tab === 'search' ? 'Найти в переписке' : tab === 'links' ? 'Найти ссылку' : 'Найти материал';
      prepareSearch();
      return fetchPage(false);
    }

    function cleanClose() {
      if (!opened) return;
      opened = false;
      abort();
      items = [];
      itemKeys.clear();
      results.replaceChildren();
      input.value = '';
      query = '';
      cursor = null;
      status.textContent = '';
      setEmpty('');
      document.body.style.overflow = oldBodyOverflow;
      if (restoreFocus?.isConnected && typeof restoreFocus.focus === 'function') {
        try { restoreFocus.focus({ preventScroll: true }); } catch (_) { restoreFocus.focus(); }
      }
      restoreFocus = null;
    }

    function close() {
      if (!opened) return;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      cleanClose();
    }

    async function open(value) {
      if (destroyed) throw new Error('Поиск уже закрыт.');
      const nextContext = options.getContext() || {};
      if (!nextContext.userId || !nextContext.conversationId) throw new Error('Сначала откройте разговор.');
      if (opened && !sameContext()) close();
      context = { ...nextContext };
      title.textContent = context.title || 'Разговор';
      if (!dialog.isConnected) document.body.append(dialog);
      if (!opened) {
        restoreFocus = document.activeElement;
        oldBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        opened = true;
        try {
          if (typeof dialog.showModal === 'function') dialog.showModal();
          else dialog.setAttribute('open', '');
        } catch (error) { cleanClose(); throw error; }
      }
      scope.PablicusRichMessage?.stopAll?.();
      input.value = typeof value?.query === 'string' ? value.query.slice(0, 200) : '';
      const result = selectTab(Object.hasOwn(TABS, value?.tab) ? value.tab : 'search');
      // Keep the first screen stable on phones; the search field opens the keyboard on tap.
      closeButton.focus({ preventScroll: true });
      await result;
    }

    closeButton.onclick = close;
    clear.onclick = () => { input.value = ''; prepareSearch(); fetchPage(false); input.focus(); };
    input.addEventListener('input', () => {
      if (!opened) return;
      prepareSearch();
      const ticket = generation;
      debounce = scope.setTimeout(() => { if (isCurrent(ticket)) fetchPage(false); }, 250);
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      prepareSearch();
      input.blur();
      fetchPage(false);
    });
    more.onclick = () => fetchPage(more.textContent === 'Повторить' ? retryPage : true);
    scroller.addEventListener('scroll', scheduleVisibleThumbnails, { passive: true });
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const keys = [...tabButtons.keys()], index = keys.indexOf(tab);
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
      selectTab(keys[target]);
      tabButtons.get(keys[target]).focus();
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (!dialog.open) cleanClose(); });
    const api = {
      open, close,
      reset() { close(); context = null; },
      destroy() { close(); destroyed = true; context = null; dialog.remove(); },
    };
    return api;
  }

  scope.PablicusChatLibrary = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
