/* Account-scoped shortcuts. Scheduling and push delivery stay on the server. */
(function (scope) {
  'use strict';

  let instanceId = 0;
  const KINDS = ['tasks', 'projects'];
  const PAGE_SIZE = 40;
  const POLL_MS = 30000;
  const taskWord = count => {
    const hundred = count % 100, ten = count % 10;
    return hundred >= 11 && hundred <= 14 ? 'дел' : ten === 1 ? 'дело' : ten >= 2 && ten <= 4 ? 'дела' : 'дел';
  };
  const localToday = () => {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  };
  const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  function create(options) {
    const document = scope.document;
    if (!document || !options?.host || typeof options.getContext !== 'function' || typeof options.loadTasks !== 'function' || typeof options.loadProjects !== 'function') {
      throw new Error('Для быстрого доступа нужен текущий аккаунт.');
    }
    const uid = 'pwq-' + (++instanceId);
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (className, label) => {
      const node = el('button', className, label);
      node.type = 'button';
      return node;
    };
    const icon = (name) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', name === 'close' ? 'm6 6 12 12M18 6 6 18' : 'm8 10 4 4 4-4');
      svg.append(path);
      return svg;
    };

    const bar = el('nav', 'pablicusWorkspaceQuick');
    bar.setAttribute('aria-label', 'Дела и проекты из всех чатов');
    bar.hidden = true;
    const chips = {};
    for (const kind of KINDS) {
      const chip = button('pwqChip', '');
      chip.dataset.kind = kind;
      chip.id = uid + '-chip-' + kind;
      chip.setAttribute('aria-haspopup', 'dialog');
      chip.setAttribute('aria-controls', uid + '-popover');
      chip.setAttribute('aria-expanded', 'false');
      chip.append(el('span', 'pwqChipLabel', kind === 'tasks' ? 'Сегодня' : 'Проекты'), icon('chevron'));
      chip.addEventListener('pointerdown', event => {
        // A shortcut must not dismiss the keyboard or stop an active recording.
        if (event.button === 0 && document.activeElement?.matches('input,textarea,[contenteditable="true"]')) event.preventDefault();
      });
      chip.addEventListener('click', event => { void toggle(kind, event.detail === 0); });
      chips[kind] = chip;
      bar.append(chip);
    }
    options.host.append(bar);

    const popover = el('section', 'pwqPopover');
    popover.id = uid + '-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');
    popover.setAttribute('aria-labelledby', uid + '-title');
    popover.hidden = true;
    const head = el('div', 'pwqHead');
    const heading = el('h2', 'pwqHeading');
    heading.id = uid + '-title';
    const closeButton = button('pwqClose', '');
    closeButton.setAttribute('aria-label', 'Закрыть быстрый доступ');
    closeButton.append(icon('close'));
    const scroll = el('div', 'pwqScroll');
    const status = el('p', 'pwqStatus');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const list = el('div', 'pwqList');
    const retry = button('pwqRetry', 'Повторить загрузку');
    const more = button('pwqMore', 'Показать ещё');
    retry.hidden = true;
    more.hidden = true;
    head.append(heading, closeButton);
    scroll.append(status, list, retry, more);
    popover.append(head, scroll);
    document.body.append(popover);

    const makeState = () => ({ items: [], total: null, next: null, loaded: false, loading: false, error: false, appendError: false, refreshPending: false, controller: null, ticket: 0 });
    let states = { tasks: makeState(), projects: makeState() };
    let context = null, generation = 0, destroyed = false, opened = null, timer = 0, frame = 0;
    let loadedDay = '', loadedTimezone = '', keyboardOpened = false;
    const composer = options.host.closest('#composer');

    const sizeObserver = typeof scope.ResizeObserver === 'function' ? new scope.ResizeObserver(queuePosition) : null;
    sizeObserver?.observe(options.host);
    if (composer && composer !== options.host) sizeObserver?.observe(composer);

    function current(ticket) {
      if (destroyed || ticket !== generation || !context) return false;
      const now = options.getContext() || {};
      if (!now.active || now.userId !== context.userId || now.epoch !== context.epoch) { reset(); return false; }
      return true;
    }
    function visible() {
      return !document.hidden && !bar.hidden && options.host.isConnected && options.host.getClientRects().length > 0;
    }
    function syncContext() {
      if (destroyed) return false;
      const next = options.getContext() || {};
      if (!next.active || !next.userId) { reset(); return false; }
      if (!context || next.userId !== context.userId || next.epoch !== context.epoch) {
        reset();
        context = { ...next };
      }
      bar.hidden = false;
      return true;
    }
    function abortReads() {
      for (const state of Object.values(states)) { state.ticket++; state.controller?.abort(); state.controller = null; state.loading = false; }
    }
    function updateChips() {
      const taskCount = states.tasks.total;
      chips.tasks.querySelector('.pwqChipLabel').textContent = taskCount === null ? 'Сегодня' : 'Сегодня ' + taskCount;
      chips.tasks.setAttribute('aria-label', taskCount === null ? 'Дела на сегодня' : 'Сегодня: ' + taskCount + ' ' + taskWord(taskCount));
      const projectCount = states.projects.total;
      chips.projects.querySelector('.pwqChipLabel').textContent = projectCount === null ? 'Проекты' : 'Проекты ' + projectCount;
      chips.projects.setAttribute('aria-label', projectCount === null ? 'Все проекты' : 'Все проекты: ' + projectCount);
      for (const kind of KINDS) chips[kind].setAttribute('aria-expanded', String(opened === kind));
    }
    function timeLabel(task) {
      if (!task.due_at) return 'Сегодня';
      const date = new Date(task.due_at);
      if (Number.isNaN(date.getTime())) return 'Сегодня';
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    function itemKey(kind, item) { return kind === 'tasks' ? item.id : item.conversation_id; }
    function renderPopover() {
      if (!opened || !current(generation)) return;
      const kind = opened, state = states[kind];
      const focused = document.activeElement;
      const focusKey = list.contains(focused) ? focused.closest('.pwqRow')?.dataset.key : null;
      heading.textContent = kind === 'tasks' ? 'Дела на сегодня' : 'Все проекты';
      popover.dataset.kind = kind;
      popover.dataset.state = state.loading ? 'loading' : state.error ? 'error' : state.loaded ? 'ready' : 'idle';
      list.setAttribute('aria-busy', String(state.loading));
      const fragment = document.createDocumentFragment();
      for (const item of state.items) {
        const row = button('pwqRow', '');
        row.dataset.key = itemKey(kind, item);
        row.dataset.conversationId = item.conversation_id;
        if (kind === 'tasks') row.dataset.taskId = item.id;
        row.append(el('span', 'pwqRowTitle', item.title || 'Проект'));
        const metadata = [kind === 'tasks' ? timeLabel(item) : '', item.conversation_title || 'Разговор'].filter(Boolean).join(' · ');
        row.append(el('span', 'pwqRowMeta', metadata));
        row.setAttribute('aria-label', (kind === 'tasks' ? 'Открыть дело: ' : 'Открыть проект: ') + (item.title || 'Проект') + '. ' + metadata);
        row.addEventListener('click', () => { void openItem(kind, item); });
        fragment.append(row);
      }
      list.replaceChildren(fragment);
      status.textContent = state.error ? 'Не удалось загрузить ' + (kind === 'tasks' ? 'дела.' : 'проекты.') : state.loading && !state.loaded ? 'Загружаем…' : state.loaded && !state.items.length ? kind === 'tasks' ? 'На сегодня дел нет.' : 'Проектов пока нет. Создайте проект в полотне любого чата.' : '';
      status.hidden = !status.textContent;
      retry.hidden = !state.error;
      retry.disabled = state.loading;
      more.hidden = !state.next || state.error;
      more.disabled = state.loading;
      more.textContent = state.loading ? 'Загружаем…' : 'Показать ещё';
      if (focusKey && document.activeElement !== focused) {
        const replacement = Array.from(list.children).find(row => row.dataset.key === focusKey);
        (replacement || closeButton).focus({ preventScroll: true });
      }
      queuePosition();
    }
    function normalize(kind, data) {
      const items = data?.[kind];
      if (!Array.isArray(items) || items.length > PAGE_SIZE || !Number.isSafeInteger(data.total_count) || data.total_count < 0) throw new Error('invalid_quick_page');
      const seen = new Set();
      for (const item of items) {
        const id = itemKey(kind, item || {});
        if (!item || typeof id !== 'string' || !id || typeof item.conversation_id !== 'string' || !item.conversation_id || typeof item.title !== 'string' || seen.has(id)) throw new Error('invalid_quick_item');
        seen.add(id);
      }
      if (data.next_cursor != null) {
        const cursor = data.next_cursor;
        if (typeof cursor !== 'object' || Array.isArray(cursor) || !items.length || (kind === 'tasks' ? typeof cursor.created_at !== 'string' || typeof cursor.id !== 'string' : typeof cursor.conversation_id !== 'string')) throw new Error('invalid_quick_cursor');
      }
      return data;
    }
    async function loadPage(kind, append) {
      const lifecycle = generation;
      if (!current(lifecycle)) return false;
      if (kind === 'tasks' && loadedDay && (loadedDay !== localToday() || loadedTimezone !== localTimezone())) {
        states.tasks.ticket++; states.tasks.controller?.abort(); states.tasks = makeState();
        loadedDay = ''; loadedTimezone = ''; append = false;
        updateChips();
      }
      const state = states[kind];
      if (state.loading) { if (!append) state.refreshPending = true; return false; }
      if (append && (!state.loaded || !state.next)) return false;
      const controller = new AbortController();
      state.controller = controller;
      const ticket = ++state.ticket;
      const cursor = append ? { ...state.next } : null;
      const today = localToday(), timezone = localTimezone();
      state.loading = true; state.error = false; state.appendError = !!append;
      if (opened === kind) renderPopover();
      try {
        const loader = kind === 'tasks' ? options.loadTasks : options.loadProjects;
        const response = await loader({ today, timezone, cursor, limit: PAGE_SIZE, signal: controller.signal, context: { ...context } });
        if (!current(lifecycle) || state !== states[kind] || ticket !== state.ticket || controller.signal.aborted) return false;
        if (kind === 'tasks' && (today !== localToday() || timezone !== localTimezone())) {
          Promise.resolve().then(() => { if (current(lifecycle)) void refresh(); });
          return false;
        }
        const data = normalize(kind, response);
        if (append && data.next_cursor && JSON.stringify(cursor) === JSON.stringify(data.next_cursor)) throw new Error('repeated_quick_cursor');
        const merged = new Map(append ? state.items.map(item => [itemKey(kind, item), item]) : []);
        for (const item of data[kind]) merged.set(itemKey(kind, item), item);
        state.items = Array.from(merged.values());
        state.total = data.total_count;
        state.next = data.next_cursor ? { ...data.next_cursor } : null;
        state.loaded = true;
        if (kind === 'tasks') { loadedDay = today; loadedTimezone = timezone; }
        return true;
      } catch (error) {
        if (!current(lifecycle) || state !== states[kind] || ticket !== state.ticket || controller.signal.aborted) return false;
        state.error = true;
        return false;
      } finally {
        if (current(lifecycle) && state === states[kind] && ticket === state.ticket) {
          state.loading = false; state.controller = null;
          updateChips();
          if (opened === kind) renderPopover();
          if (state.refreshPending) { state.refreshPending = false; void loadPage(kind, false); }
        }
      }
    }
    function position() {
      frame = 0;
      if (!opened || popover.hidden) return;
      const viewport = scope.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || scope.innerWidth, height = viewport?.height || scope.innerHeight;
      const anchor = chips[opened].getBoundingClientRect();
      const composeBox = composer?.querySelector('#composeBox');
      const composeRect = composeBox?.getBoundingClientRect();
      const margin = 8;
      const maxWidth = Math.max(120, Math.min(340, width - margin * 2));
      const bottom = Math.min(topEdge + height - margin, (composeRect?.top ?? anchor.top) - margin);
      const available = Math.max(0, bottom - topEdge - margin);
      // When the expanded editor fills the viewport, anchor above its shortcut row.
      const anchorBottom = available >= 112 ? bottom : Math.min(topEdge + height - margin, anchor.top - margin);
      const maxHeight = Math.max(0, Math.min(390, anchorBottom - topEdge - margin));
      popover.style.width = maxWidth + 'px';
      popover.style.maxHeight = maxHeight + 'px';
      const left = Math.min(leftEdge + width - maxWidth - margin, Math.max(leftEdge + margin, anchor.left));
      popover.style.left = left + 'px';
      const actualHeight = popover.getBoundingClientRect().height;
      popover.style.top = Math.max(topEdge + margin, anchorBottom - actualHeight) + 'px';
    }
    function queuePosition() {
      if (!opened || frame || destroyed) return;
      frame = scope.requestAnimationFrame(position);
    }
    function close(restoreFocus) {
      const previous = opened;
      opened = null;
      popover.hidden = true;
      updateChips();
      if (frame) scope.cancelAnimationFrame(frame);
      frame = 0;
      if (restoreFocus && previous && !bar.hidden) chips[previous].focus({ preventScroll: true });
      keyboardOpened = false;
    }
    async function toggle(kind, keyboard) {
      if (!syncContext()) return;
      if (opened === kind) { close(keyboard); return; }
      opened = kind;
      keyboardOpened = keyboard;
      popover.hidden = false;
      scroll.scrollTop = 0;
      updateChips(); renderPopover(); position();
      if (keyboard) closeButton.focus({ preventScroll: true });
      if (!states[kind].loaded && !states[kind].loading) await loadPage(kind, false);
    }
    async function openItem(kind, item) {
      const lifecycle = generation;
      if (!current(lifecycle)) return;
      const callback = kind === 'tasks' ? options.onTask : options.onProject;
      if (typeof callback !== 'function') return;
      close(false);
      try { await callback(item, { context: { ...context } }); }
      catch (error) { if (current(lifecycle)) options.onError?.(error); }
    }
    function schedulePoll() {
      scope.clearTimeout(timer);
      if (destroyed || !context) return;
      timer = scope.setTimeout(() => {
        timer = 0;
        if (!current(generation)) return;
        const dayChanged = loadedDay && (loadedDay !== localToday() || loadedTimezone !== localTimezone());
        if (visible() && (!opened || dayChanged)) void refresh();
        else schedulePoll();
      }, POLL_MS);
    }
    async function refresh() {
      if (!syncContext()) return false;
      const dayChanged = loadedDay && (loadedDay !== localToday() || loadedTimezone !== localTimezone());
      if (dayChanged) {
        states.tasks.ticket++; states.tasks.controller?.abort(); states.tasks = makeState();
        loadedDay = ''; loadedTimezone = '';
        updateChips();
      }
      const results = await Promise.allSettled(KINDS.map(kind => loadPage(kind, false)));
      schedulePoll();
      return results.every(result => result.status === 'fulfilled' && result.value);
    }
    function reset() {
      generation++;
      abortReads();
      scope.clearTimeout(timer); timer = 0;
      close(false);
      states = { tasks: makeState(), projects: makeState() };
      context = null; loadedDay = ''; loadedTimezone = '';
      list.replaceChildren(); status.textContent = ''; heading.textContent = '';
      bar.hidden = true;
      updateChips();
    }
    function outside(event) {
      if (opened && !popover.contains(event.target) && !bar.contains(event.target)) close(false);
    }
    function onKey(event) {
      if (!opened) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        close(keyboardOpened || popover.contains(document.activeElement));
      }
    }
    function onVisibility() { if (!document.hidden && context) void refresh(); }
    closeButton.addEventListener('pointerdown', event => {
      if (event.button === 0 && document.activeElement?.matches('input,textarea,[contenteditable="true"]')) event.preventDefault();
    });
    closeButton.addEventListener('click', event => close(event.detail === 0 || keyboardOpened));
    more.addEventListener('click', () => { if (opened) void loadPage(opened, true); });
    retry.addEventListener('click', () => { if (opened) void loadPage(opened, states[opened].appendError); });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVisibility);
    scope.addEventListener('resize', queuePosition);
    scope.visualViewport?.addEventListener('resize', queuePosition);
    scope.visualViewport?.addEventListener('scroll', queuePosition);
    function destroy() {
      if (destroyed) return;
      reset(); destroyed = true;
      sizeObserver?.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onVisibility);
      scope.removeEventListener('resize', queuePosition);
      scope.visualViewport?.removeEventListener('resize', queuePosition);
      scope.visualViewport?.removeEventListener('scroll', queuePosition);
      bar.remove(); popover.remove();
    }
    updateChips();
    return { refresh, reset, destroy, close };
  }

  scope.PablicusWorkspaceQuick = Object.freeze({ create });
})(window);
