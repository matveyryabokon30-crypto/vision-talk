/* All conversation tasks. Authenticated transport remains owned by the app. */
(function (scope) {
  'use strict';

  let instanceId = 0;
  const VIEWS = [['open', 'Все'], ['mine', 'Мне'], ['overdue', 'Просрочено'], ['completed', 'Готово']];
  const POLL_MS = 15000;

  function create(options) {
    options = options || {};
    const document = scope.document;
    if (!document || typeof options.getContext !== 'function' || typeof options.load !== 'function') {
      throw new Error('Для списка дел нужен текущий аккаунт.');
    }
    const uid = 'pth-' + (++instanceId);
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const icon = (name) => {
      const paths = {
        refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7A7 7 0 0 1 18 5l2 2M4 17l2 2a7 7 0 0 0 11.9-2',
        search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
        close: 'm6 6 12 12M18 6 6 18',
        check: 'm5 12 4 4 10-10',
        calendar: 'M5 5h14v15H5ZM8 3v4M16 3v4M5 10h14',
      };
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', paths[name] || paths.check);
      svg.append(path);
      return svg;
    };
    const button = (className, label, iconName) => {
      const node = el('button', className);
      node.type = 'button';
      node.setAttribute('aria-label', label);
      if (iconName) { node.title = label; node.append(icon(iconName)); }
      else node.textContent = label;
      return node;
    };

    const pane = el('section', 'pablicusTasksHome');
    pane.setAttribute('aria-label', 'Дела из ваших чатов');
    pane.hidden = true;
    const toolbar = el('div', 'pthToolbar');
    const tabs = el('div', 'pthTabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Какие дела показать');
    const tabButtons = VIEWS.map(([value, label]) => {
      const node = button('pthTab', label);
      node.dataset.view = value;
      node.id = uid + '-tab-' + value;
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-controls', uid + '-results');
      tabs.append(node);
      return node;
    });
    const refresh = button('pthIcon pthRefresh', 'Обновить дела', 'refresh');
    toolbar.append(tabs, refresh);
    const searchForm = el('form', 'pthSearch');
    searchForm.setAttribute('role', 'search');
    const searchLabel = el('label', 'pthSearchLabel', 'Поиск по названию дела');
    searchLabel.htmlFor = uid + '-search';
    const searchField = el('div', 'pthSearchField');
    const searchInput = el('input', 'pthSearchInput');
    searchInput.id = uid + '-search';
    searchInput.type = 'search';
    searchInput.maxLength = 200;
    searchInput.autocomplete = 'off';
    searchInput.placeholder = 'Найти дело';
    searchInput.enterKeyHint = 'search';
    const clearSearch = button('pthIcon pthClear', 'Очистить поиск', 'close');
    clearSearch.hidden = true;
    searchField.append(icon('search'), searchInput, clearSearch);
    searchForm.append(searchLabel, searchField);
    const results = el('div', 'pthResults');
    results.id = uid + '-results';
    results.setAttribute('role', 'tabpanel');
    const status = el('p', 'pthStatus');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const notice = el('p', 'pthNotice');
    notice.setAttribute('role', 'alert');
    notice.hidden = true;
    const retry = button('pthButton pthRetry', 'Повторить загрузку');
    retry.hidden = true;
    const list = el('div', 'pthList');
    const empty = el('div', 'pthEmpty');
    const emptyTitle = el('p', 'pthEmptyTitle');
    const emptyDetail = el('p', 'pthEmptyDetail');
    empty.append(emptyTitle, emptyDetail);
    empty.hidden = true;
    const more = button('pthButton pthMore', 'Показать ещё');
    more.hidden = true;
    results.append(status, notice, retry, empty, list, more);
    pane.append(toolbar, searchForm, results);

    let mounted = false, destroyed = false, context = null, generation = 0;
    let view = 'open', query = '', queryEpoch = 0, tasks = [], nextCursor = null;
    let pageCount = 0, loadedToday = null, loading = false, loadError = false, errorWasMore = false;
    let readController = null, readTicket = 0, pollTimer = 0, searchTimer = 0, composing = false;
    const mutations = new Map();
    const uncertain = new Set();
    const controllers = new Set();

    function localToday() {
      const now = new Date();
      return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
    function current(ticket) {
      if (destroyed || !mounted || ticket !== generation) return false;
      const now = options.getContext() || {};
      if (!context || !now.active || now.userId !== context.userId || now.epoch !== context.epoch) { reset(); return false; }
      return true;
    }
    function visible() {
      return !document.hidden && pane.isConnected && !pane.hidden && pane.getClientRects().length > 0;
    }
    function dateLabel(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
      const parsed = new Date(value + 'T12:00:00');
      return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: parsed.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    }
    function setNotice(text) {
      notice.textContent = text || '';
      notice.hidden = !text;
    }
    function abortRead() {
      readTicket++;
      readController?.abort();
      readController = null;
      loading = false;
    }
    function updateControls() {
      for (const node of tabButtons) {
        const selected = node.dataset.view === view;
        node.setAttribute('aria-selected', String(selected));
        node.tabIndex = selected ? 0 : -1;
      }
      results.setAttribute('aria-labelledby', uid + '-tab-' + view);
      results.setAttribute('aria-busy', String(loading));
      clearSearch.hidden = !searchInput.value;
      refresh.disabled = loading || mutations.size > 0;
      more.hidden = !nextCursor || loadError;
      more.disabled = loading || mutations.size > 0;
      more.textContent = loading && pageCount > 0 ? 'Загружаем…' : 'Показать ещё';
      retry.hidden = !loadError;
      retry.disabled = loading || mutations.size > 0;
      empty.hidden = tasks.length > 0 || loading || loadError || !pageCount;
      const words = query ? ['Ничего не найдено', 'Попробуйте другое название дела.'] : {
        open: ['Пока нет открытых дел', 'Создайте дело в полотне чата или из меню сообщения. Оно появится здесь.'],
        mine: ['Вам пока ничего не назначено', 'Здесь собраны открытые дела, в которых вы — исполнитель.'],
        overdue: ['Просроченных дел нет', 'Здесь появятся незавершённые дела, срок которых уже прошёл.'],
        completed: ['Завершённых дел пока нет', 'Отмеченные дела из ваших чатов появятся здесь.'],
      }[view];
      emptyTitle.textContent = words[0];
      emptyDetail.textContent = words[1];
      pane.dataset.state = loading ? 'loading' : loadError ? 'error' : pageCount ? 'ready' : 'idle';
      for (const node of list.querySelectorAll('.pthTask')) {
        const id = node.dataset.taskId;
        const busy = mutations.has(id);
        node.dataset.busy = String(busy);
        node.querySelector('.pthToggle').disabled = busy || uncertain.has(id) || typeof options.onToggle !== 'function';
        node.querySelector('.pthOpen').disabled = busy || typeof options.onOpen !== 'function';
      }
    }
    function renderTasks() {
      const focused = document.activeElement;
      const focusId = list.contains(focused) ? focused.closest('.pthTask')?.dataset.taskId : null;
      const focusType = focused?.classList.contains('pthToggle') ? '.pthToggle' : '.pthOpen';
      const fragment = document.createDocumentFragment();
      const today = localToday();
      for (const task of tasks) {
        const row = el('article', 'pthTask');
        row.dataset.taskId = task.id;
        row.dataset.completed = String(task.completed);
        row.dataset.conversationId = task.conversation_id;
        const toggle = button('pthIcon pthToggle', (task.completed ? 'Вернуть в работу: ' : 'Завершить: ') + task.title);
        toggle.setAttribute('role', 'checkbox');
        toggle.setAttribute('aria-checked', String(task.completed));
        const check = el('span', 'pthCheck');
        if (task.completed) check.append(icon('check'));
        toggle.append(check);
        toggle.addEventListener('click', () => { void toggleTask(task); });
        const open = button('pthOpen', 'Открыть дело «' + task.title + '» в чате');
        const title = el('span', 'pthTaskTitle', task.title);
        const chat = el('span', 'pthConversation', task.conversation_title || 'Разговор');
        const details = el('span', 'pthTaskMeta');
        const assignee = el('span', 'pthAssignee', task.assignee_id === context?.userId ? 'Вам' : task.assignee_name || (task.assignee_id ? 'Участник' : 'Без исполнителя'));
        details.append(assignee);
        const date = dateLabel(task.due_date);
        if (date) {
          const due = el('span', 'pthDue');
          const overdue = !task.completed && task.due_date < today;
          due.dataset.overdue = String(overdue);
          due.append(icon('calendar'), el('span', '', (overdue ? 'Просрочено · ' : '') + date));
          details.append(due);
        }
        open.replaceChildren(title, chat, details);
        open.addEventListener('click', () => { void openTask(task); });
        row.append(toggle, open);
        fragment.append(row);
      }
      list.replaceChildren(fragment);
      updateControls();
      if (focusId && focused !== document.activeElement) {
        const row = Array.from(list.children).find(node => node.dataset.taskId === focusId);
        const target = row?.querySelector(focusType);
        if (target && !target.disabled) target.focus({ preventScroll: true });
      }
    }
    function normalize(data) {
      if (!data || !Array.isArray(data.tasks) || data.tasks.length > 60) throw new Error('invalid_tasks_page');
      const seen = new Set();
      for (const task of data.tasks) {
        if (!task || typeof task.id !== 'string' || typeof task.conversation_id !== 'string' || typeof task.title !== 'string' || typeof task.completed !== 'boolean' || !Number.isInteger(task.revision) || typeof task.created_at !== 'string' || seen.has(task.id)) throw new Error('invalid_task');
        seen.add(task.id);
      }
      if (data.next_cursor != null && (typeof data.next_cursor.created_at !== 'string' || typeof data.next_cursor.id !== 'string')) throw new Error('invalid_tasks_cursor');
      return data;
    }
    function schedulePoll() {
      scope.clearTimeout(pollTimer);
      if (!mounted || destroyed) return;
      pollTimer = scope.setTimeout(() => {
        if (!current(generation)) return;
        if (visible() && (pageCount <= 1 || loadedToday !== localToday()) && !loading && !mutations.size && !searchTimer && !composing && !loadError && document.activeElement !== searchInput) void loadPage(false, true);
        else schedulePoll();
      }, POLL_MS);
    }
    async function loadPage(append, quiet) {
      const lifecycle = generation;
      if (!current(lifecycle) || mutations.size) return false;
      if (append && (!nextCursor || loading || !pageCount)) return false;
      const today = localToday();
      // A cursor belongs to its filter date. Midnight must start a fresh list.
      if (loadedToday && loadedToday !== today) {
        append = false;
        tasks = []; nextCursor = null; pageCount = 0; loadedToday = null;
        renderTasks();
      }
      scope.clearTimeout(searchTimer); searchTimer = 0;
      scope.clearTimeout(pollTimer);
      abortRead();
      const controller = new AbortController();
      readController = controller;
      controllers.add(controller);
      const ticket = ++readTicket;
      const filterTicket = queryEpoch;
      const cursor = append ? { ...nextCursor } : null;
      const requestContext = { ...context };
      loading = true;
      loadError = false;
      errorWasMore = !!append;
      if (!quiet || !pageCount) status.textContent = append ? 'Загружаем ещё…' : 'Загружаем дела…';
      updateControls();
      try {
        const result = normalize(await options.load({ context: requestContext, view, query, today, cursor, signal: controller.signal }));
        if (!current(lifecycle) || ticket !== readTicket || filterTicket !== queryEpoch || controller.signal.aborted) return false;
        if (append && result.next_cursor && result.next_cursor.id === cursor.id && result.next_cursor.created_at === cursor.created_at) throw new Error('tasks_cursor_did_not_advance');
        if (append) {
          const known = new Set(tasks.map(task => task.id));
          tasks = tasks.concat(result.tasks.filter(task => !known.has(task.id)));
          pageCount++;
        } else {
          tasks = result.tasks.slice();
          pageCount = 1;
          loadedToday = today;
          uncertain.clear();
        }
        nextCursor = result.next_cursor ? { ...result.next_cursor } : null;
        status.textContent = tasks.length ? 'Показано: ' + tasks.length + (nextCursor ? ' · ниже есть ещё' : '') : '';
        renderTasks();
        return true;
      } catch (error) {
        if (!current(lifecycle) || ticket !== readTicket || filterTicket !== queryEpoch || controller.signal.aborted || error?.name === 'AbortError') return false;
        loadError = true;
        const denied = error?.code === '42501' || error?.status === 401 || error?.status === 403;
        if (denied) { tasks = []; nextCursor = null; pageCount = 0; loadedToday = null; errorWasMore = false; renderTasks(); }
        status.textContent = denied ? 'Доступ к делам изменился. Повторите загрузку.' : append ? 'Не удалось загрузить следующие дела. Уже загруженные остаются здесь.' : 'Не удалось обновить дела. Повторите загрузку.';
        return false;
      } finally {
        controllers.delete(controller);
        if (current(lifecycle) && ticket === readTicket && filterTicket === queryEpoch) {
          loading = false;
          readController = null;
          updateControls();
          schedulePoll();
        }
      }
    }
    function invalidateQuery() {
      scope.clearTimeout(searchTimer); searchTimer = 0;
      scope.clearTimeout(pollTimer);
      queryEpoch++;
      abortRead();
      tasks = []; nextCursor = null; pageCount = 0; loadedToday = null; loadError = false; errorWasMore = false;
      status.textContent = 'Загружаем дела…';
      setNotice('');
      renderTasks();
    }
    function changeView(value) {
      if (!current(generation) || view === value) return;
      view = value;
      invalidateQuery();
      void loadPage(false, false);
    }
    function changeSearch(immediate) {
      if (!current(generation)) return;
      const value = searchInput.value.slice(0, 200).trim();
      clearSearch.hidden = !searchInput.value;
      if (query !== value) { query = value; invalidateQuery(); }
      else if (!immediate) return;
      scope.clearTimeout(searchTimer); searchTimer = 0;
      if (composing) return;
      if (immediate) void loadPage(false, false);
      else searchTimer = scope.setTimeout(() => { searchTimer = 0; void loadPage(false, false); }, 250);
    }
    async function toggleTask(task) {
      const lifecycle = generation;
      if (!current(lifecycle) || mutations.has(task.id) || uncertain.has(task.id) || typeof options.onToggle !== 'function') return;
      const present = tasks.find(item => item.id === task.id);
      if (present !== task) return;
      abortRead();
      scope.clearTimeout(pollTimer);
      const controller = new AbortController();
      const operation = { controller, filterTicket: queryEpoch };
      controllers.add(controller);
      mutations.set(task.id, operation);
      setNotice('');
      updateControls();
      let failure = null;
      try {
        await options.onToggle({ context: { ...context }, task: { ...task }, completed: !task.completed, signal: controller.signal });
      } catch (error) { failure = error; }
      finally { controllers.delete(controller); }
      if (!current(lifecycle) || controller.signal.aborted || mutations.get(task.id) !== operation) return;
      mutations.delete(task.id);
      if (failure) {
        uncertain.add(task.id);
        const conflict = failure.code === '40001' || /task_revision_conflict/.test(failure.message || '');
        if (operation.filterTicket === queryEpoch) setNotice(conflict ? 'Это дело изменилось у собеседника. Загружаем актуальную версию; ваша отметка не применена.' : 'Не удалось подтвердить изменение. Обновляем список — проверьте, сохранилась ли отметка.');
      }
      updateControls();
      // A failed response may follow a committed write. Re-read; never invert or retry it automatically.
      if (!mutations.size) {
        const refreshed = await loadPage(false, false);
        if (!current(lifecycle)) return;
        if (failure && refreshed && operation.filterTicket === queryEpoch) {
          const conflict = failure.code === '40001' || /task_revision_conflict/.test(failure.message || '');
          setNotice(conflict ? 'Список обновлён. Дело изменилось у собеседника — проверьте его перед повторной отметкой.' : 'Список обновлён. Не удалось подтвердить изменение — проверьте текущее состояние дела.');
        }
      }
    }
    async function openTask(task) {
      const lifecycle = generation, filterTicket = queryEpoch;
      if (!current(lifecycle) || mutations.has(task.id) || typeof options.onOpen !== 'function' || !tasks.includes(task)) return;
      try { await options.onOpen({ context: { ...context }, task: { ...task } }); }
      catch (_) { if (current(lifecycle) && filterTicket === queryEpoch) setNotice('Не удалось открыть чат с этим делом. Попробуйте ещё раз.'); }
    }

    tabButtons.forEach((node, index) => {
      node.addEventListener('click', () => changeView(node.dataset.view));
      node.addEventListener('keydown', event => {
        let next = null;
        if (event.key === 'ArrowRight') next = (index + 1) % tabButtons.length;
        if (event.key === 'ArrowLeft') next = (index + tabButtons.length - 1) % tabButtons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabButtons.length - 1;
        if (next === null) return;
        event.preventDefault();
        changeView(tabButtons[next].dataset.view);
        tabButtons[next].focus();
      });
    });
    searchInput.addEventListener('input', () => changeSearch(false));
    searchInput.addEventListener('compositionstart', () => { composing = true; });
    searchInput.addEventListener('compositionend', () => { composing = false; changeSearch(true); });
    searchForm.addEventListener('submit', event => { event.preventDefault(); changeSearch(true); });
    clearSearch.addEventListener('click', () => { searchInput.value = ''; changeSearch(true); searchInput.focus(); });
    refresh.addEventListener('click', () => { void loadPage(false, false); });
    retry.addEventListener('click', () => { void loadPage(errorWasMore, false); });
    more.addEventListener('click', () => { void loadPage(true, false); });
    function foreground() {
      if (!current(generation)) return;
      if (visible() && (pageCount <= 1 || loadedToday !== localToday()) && !loading && !mutations.size && !searchTimer && !composing && document.activeElement !== searchInput) void loadPage(false, true);
    }
    scope.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);

    function reset() {
      generation++; queryEpoch++;
      mounted = false;
      context = null;
      scope.clearTimeout(pollTimer); pollTimer = 0;
      scope.clearTimeout(searchTimer); searchTimer = 0;
      abortRead();
      for (const controller of controllers) controller.abort();
      controllers.clear(); mutations.clear(); uncertain.clear();
      tasks = []; nextCursor = null; pageCount = 0; loadedToday = null; loading = false; loadError = false; errorWasMore = false;
      view = 'open'; query = ''; composing = false;
      searchInput.value = ''; status.textContent = ''; setNotice('');
      list.replaceChildren(); updateControls();
      pane.hidden = true;
    }
    function mount(host) {
      if (destroyed || !host || typeof host.append !== 'function') return;
      const now = options.getContext() || {};
      if (!now.userId || !now.active) { reset(); return; }
      if (mounted && context && context.userId === now.userId && context.epoch === now.epoch) {
        host.append(pane); pane.hidden = false;
        if (!loading && !mutations.size) void loadPage(false, true);
        return;
      }
      reset();
      context = { userId: now.userId, epoch: now.epoch, active: true };
      mounted = true;
      host.append(pane); pane.hidden = false;
      void loadPage(false, false);
    }
    function destroy() {
      if (destroyed) return;
      reset(); destroyed = true;
      scope.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
      pane.remove();
    }
    return { mount, reset, destroy };
  }
  scope.PablicusTasksHome = Object.freeze({ create });
})(window);
