/* A shared plan and checklist. The host owns authenticated transport and navigation. */
(function (scope) {
  'use strict';

  let instanceId = 0;
  const POLL_MS = 8000;

  function create(options) {
    options = options || {};
    const document = scope.document;
    if (!document || typeof options.getContext !== 'function') throw new Error('Для полотна нужен открытый разговор.');
    const uid = 'pcc-' + (++instanceId);
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const icon = (name) => {
      const paths = {
        refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7A7 7 0 0 1 18 5l2 2M4 17l2 2a7 7 0 0 0 11.9-2',
        plus: 'M12 5v14M5 12h14',
        edit: 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z',
        source: 'M9 10 5 6l4-4M5 6h9a6 6 0 0 1 0 12h-2',
        close: 'm6 6 12 12M18 6 6 18',
        check: 'm5 12 4 4 10-10',
      };
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.6');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', paths[name] || paths.edit);
      svg.append(path);
      return svg;
    };
    const button = (className, label, iconName) => {
      const node = el('button', className);
      node.type = 'button';
      if (iconName) node.append(icon(iconName));
      else node.textContent = label;
      node.setAttribute('aria-label', label);
      node.title = label;
      return node;
    };
    const pane = el('section', 'pablicusChatCanvas');
    pane.setAttribute('aria-label', 'Общее полотно чата');
    pane.hidden = true;
    const head = el('div', 'pccProjectsHead');
    const planLabel = el('label', 'pccLabel', 'Проекты');
    planLabel.htmlFor = uid + '-plan';
    const refresh = button('pccIcon pccRefresh', 'Обновить полотно', 'refresh');
    head.append(planLabel, refresh);
    const status = el('p', 'pccStatus');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = button('pccButton pccRetry', 'Повторить загрузку');
    retry.hidden = true;
    const content = el('div', 'pccContent');
    const planSection = el('section', 'pccPlan');
    const planBody = el('textarea', 'pccPlanBody');
    planBody.id = uid + '-plan';
    planBody.maxLength = 20000;
    planBody.rows = 4;
    planBody.placeholder = 'О чём договорились, что важно, что дальше…';
    const planFoot = el('div', 'pccFormFoot');
    const planNotice = el('p', 'pccNotice pccPlanNotice');
    planNotice.setAttribute('role', 'status');
    const planSave = button('pccButton pccPlanSave', 'Сохранить проекты');
    planFoot.append(planNotice, planSave);
    const planConflict = el('div', 'pccConflict pccPlanConflict');
    planConflict.hidden = true;
    const planServerLabel = el('p', 'pccConflictLabel', 'Текущий текст проектов');
    const planServerBody = el('p', 'pccServerBody pccPlanServerBody');
    const planConflictActions = el('div', 'pccConflictActions');
    const planUseServer = button('pccTextButton pccPlanUseServer', 'Принять общий текст');
    const planReplace = button('pccButton pccPlanReplace', 'Сохранить мою версию');
    planConflictActions.append(planUseServer, planReplace);
    planConflict.append(planServerLabel, planServerBody, planConflictActions);
    planSection.append(planBody, planFoot, planConflict);
    const tasksSection = el('section', 'pccTasks');
    const tasksHead = el('div', 'pccTasksHead');
    const tasksHeading = el('h3', 'pccLabel', 'Дела');
    const taskCount = el('span', 'pccTaskCount');
    const add = button('pccButton pccTaskAdd', 'Добавить дело');
    add.prepend(icon('plus'));
    tasksHead.append(tasksHeading, taskCount, add);
    const taskFormHost = el('div', 'pccTaskFormHost');
    const taskViews = el('div', 'pccTaskViews');
    taskViews.setAttribute('role', 'tablist');
    taskViews.setAttribute('aria-label', 'Состояние дел');
    const taskViewButtons = [['open', 'В работе'], ['completed', 'Готово'], ['archived', 'Архив']].map(([value, label]) => {
      const node = button('pccTaskView', label);
      node.dataset.view = value;
      node.id = uid + '-tasks-' + value;
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-controls', uid + '-task-list');
      taskViews.append(node);
      return node;
    });
    const taskList = el('div', 'pccTaskList');
    taskList.id = uid + '-task-list';
    taskList.setAttribute('role', 'tabpanel');
    const taskEmpty = el('p', 'pccEmpty', 'Здесь будут ваши общие дела.');
    tasksSection.append(tasksHead, taskViews, taskFormHost, taskEmpty, taskList);
    content.append(planSection, tasksSection);
    pane.append(head, status, retry, content);

    let opened = false, destroyed = false, context = null, generation = 0, snapshot = null;
    let loadController = null, loadTicket = 0, pollTimer = 0, savingPlan = false;
    let planBaseBody = '', planBaseRevision = 0, planDirty = false, planChanged = false;
    let taskDraft = null, taskForm = null, taskBusy = false, pendingSource = null;
    let taskOperation = null, planError = false;
    let taskView = 'open', pendingTask = null, taskLinkNotice = '';
    const controllers = new Set();

    function sameIdentity() {
      const now = options.getContext() || {};
      return !!context && now.userId === context.userId && now.conversationId === context.conversationId;
    }
    function sameContext() {
      const now = options.getContext() || {};
      return !!context && now.userId === context.userId && now.conversationId === context.conversationId && now.epoch === context.epoch;
    }
    function current(ticket) {
      if (!opened || destroyed || ticket !== generation) return false;
      if (sameContext()) return true;
      reset();
      return false;
    }
    function errorMessage(error) {
      if (error?.code === '42501' || error?.status === 403) return 'Доступ к этому полотну изменился. Обновите разговор.';
      if (['task_limit_reached', 'canvas_task_limit'].includes(error?.message)) return 'В полотне уже 200 активных дел. Завершите дела или перенесите ненужные в архив, чтобы добавить новое.';
      if (['task_not_found', 'task deleted'].includes(error?.message)) return 'Это дело уже удалено другим участником.';
      if (error?.message === 'assignee not in conversation') return 'Исполнитель больше не в чате. Выберите другого участника или уберите исполнителя.';
      if (['source deleted', 'source block not found'].includes(error?.message)) return 'Исходное сообщение или его часть удалены. Добавьте новое дело без ссылки на них.';
      return 'Не удалось сохранить. Ваши изменения остаются здесь. Повторите попытку.';
    }
    function isConflict(error) {
      return error?.code === '40001' || /(?:canvas|task)_revision_conflict/.test(error?.message || '');
    }
    function isAbort(error) { return error?.name === 'AbortError'; }
    function formatDate(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
      const date = new Date(value + 'T12:00:00');
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function localZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    function localFields(value) {
      const date = new Date(value);
      if (!value || Number.isNaN(date.getTime())) return { date: '', time: '' };
      const pad = number => String(number).padStart(2, '0');
      return { date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()), time: pad(date.getHours()) + ':' + pad(date.getMinutes()) };
    }
    function scheduleOf(task) {
      return task.due_at ? { due_at: task.due_at, timezone: task.due_timezone || 'UTC', reminder_minutes: task.reminder_minutes ?? null, followup_minutes: task.followup_minutes ?? null } : { due_at: null };
    }
    function scheduleLabel(task) {
      if (!task.due_at) return formatDate(task.due_date);
      const value = new Date(task.due_at);
      if (Number.isNaN(value.getTime())) return formatDate(task.due_date);
      return value.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }
    function buildSchedule(draft) {
      if (!draft.scheduleChanged) return draft.schedule;
      if (!draft.deadlineChanged && draft.schedule.due_at) return { ...draft.schedule, reminder_minutes: draft.reminderMinutes, followup_minutes: draft.followupMinutes };
      if (!draft.dueTime) return { due_at: null };
      if (!draft.dueDate) throw new Error('Укажите дату для выбранного времени.');
      const value = new Date(draft.dueDate + 'T' + draft.dueTime + ':00');
      if (Number.isNaN(value.getTime())) throw new Error('Проверьте дату и время дела.');
      const fields = localFields(value.toISOString());
      if (fields.date !== draft.dueDate || fields.time !== draft.dueTime) throw new Error('Такого местного времени нет из-за перевода часов. Выберите другое время.');
      for (const minutes of [-120, -60, -30, 30, 60, 120]) {
        const other = localFields(new Date(value.getTime() + minutes * 60000).toISOString());
        if (other.date === fields.date && other.time === fields.time) throw new Error('Это время повторяется при переводе часов. Выберите время вне этого перехода.');
      }
      return { due_at: value.toISOString(), timezone: localZone(), reminder_minutes: draft.reminderMinutes, followup_minutes: draft.followupMinutes };
    }
    function notifyMutation(kind, taskId) {
      try { options.onMutation?.({ kind, taskId, context: { ...context } }); } catch (_) { /* Saved data must not depend on another view. */ }
    }
    function person(id) {
      if (!id) return 'Без исполнителя';
      const row = snapshot?.participants.find(item => item.id === id);
      return row?.display_name || (row?.username ? '@' + row.username : 'Участник');
    }
    function autosize(field, maxHeight) {
      field.style.height = 'auto';
      field.style.height = Math.min(maxHeight, Math.max(field === planBody ? 112 : 68, field.scrollHeight)) + 'px';
    }
    function planState(text, state) {
      planNotice.textContent = text;
      planNotice.dataset.state = state || '';
      planFoot.hidden = planSave.hidden && !text;
    }
    function updatePlanControls() {
      planBody.disabled = !snapshot || savingPlan;
      planSave.disabled = !snapshot || !planDirty || savingPlan;
      planSave.textContent = savingPlan ? 'Сохраняем…' : 'Сохранить проекты';
      planSave.hidden = !snapshot || (!planDirty && !savingPlan) || planChanged;
      planFoot.hidden = planSave.hidden && !planNotice.textContent;
      planReplace.disabled = !snapshot || savingPlan;
      planUseServer.disabled = savingPlan;
      planConflict.hidden = !planChanged;
      if (planChanged) planServerBody.textContent = snapshot?.canvas.body || 'Проекты пока не описаны.';
    }
    function updateTaskControls() {
      add.disabled = !snapshot || taskBusy || !!taskDraft;
      add.hidden = !!taskDraft;
      if (!taskForm) return;
      for (const input of taskForm.querySelectorAll('input,textarea,select,button')) input.disabled = taskBusy;
      for (const input of taskForm.querySelectorAll('.pccTaskReminder,.pccTaskFollowup')) input.disabled = taskBusy || !taskDraft.dueDate || !taskDraft.dueTime;
      for (const input of taskForm.querySelectorAll('.pccTaskDone,.pccTaskArchive,.pccTaskRestore')) input.disabled = taskBusy || !!taskDraft.conflict;
      const save = taskForm.querySelector('.pccTaskSave');
      save.disabled = taskBusy || !taskDraft.title.trim();
      save.textContent = taskBusy ? 'Сохраняем…' : (taskDraft.isNew ? 'Добавить дело' : 'Сохранить дело');
      save.hidden = !!taskDraft.conflict;
      taskForm.querySelector('.pccTaskConflict').hidden = !taskDraft.conflict;
      taskForm.querySelector('.pccTaskDeleteConfirm').hidden = !taskDraft.confirmDelete;
    }
    function normalize(data) {
      if (!data || !data.canvas || !Array.isArray(data.tasks) || !Array.isArray(data.participants)) throw new Error('invalid_canvas_snapshot');
      if (data.conversation_id && data.conversation_id !== context?.conversationId) throw new Error('invalid_canvas_context');
      return data;
    }
    function applySnapshot(data) {
      data = normalize(data);
      if (snapshot && Number(data.revision) < Number(snapshot.revision)) return;
      snapshot = data;
      pane.dataset.state = 'ready';
      content.hidden = false;
      if (!planDirty && !savingPlan) {
        planBody.value = String(data.canvas.body || '');
        planBaseBody = planBody.value;
        planBaseRevision = data.canvas.revision;
        planChanged = false;
        if (!planError) planState('', '');
        autosize(planBody, 360);
      } else if (planDirty && !savingPlan && data.canvas.revision !== planBaseRevision) {
        planChanged = true;
        planState('Текст проектов изменился у собеседника. Ваш текст сохранён в поле выше.', 'conflict');
      }
      updatePlanControls();
      renderTasks();
      if (taskDraft && !taskDraft.isNew) {
        const latest = data.tasks.find(item => item.id === taskDraft.id);
        if (!latest) {
          taskDraft.deleted = true;
          taskNotice('Это дело удалено другим участником. Текст остаётся в форме.', 'error');
        } else if (latest.revision !== taskDraft.baseRevision && !taskBusy) {
          taskDraft.conflict = true;
          taskNotice('Дело изменилось у собеседника. Проверьте общую версию ниже.', 'conflict');
          renderTaskConflict(latest);
        }
      }
      updateTaskControls();
      if (pendingSource) {
        const source = pendingSource;
        pendingSource = null;
        startTask(null, source);
      }
      if (pendingTask) {
        const requested = pendingTask;
        pendingTask = null;
        const selected = data.tasks.find(task => task.id === requested.id);
        if (selected) {
          taskView = selected.archived_at ? 'archived' : selected.completed ? 'completed' : 'open';
          renderTasks();
          startTask(selected, null, requested.review);
        } else {
          taskLinkNotice = 'Это дело удалено или больше недоступно.';
          status.textContent = taskLinkNotice;
        }
      }
    }
    function schedulePoll() {
      scope.clearTimeout(pollTimer);
      if (opened && !destroyed) pollTimer = scope.setTimeout(() => {
        if (!document.hidden && !savingPlan && !taskBusy && !taskOperation) void load(false);
        else schedulePoll();
      }, POLL_MS);
    }
    async function load(manual) {
      const ticket = generation;
      if (!current(ticket)) return;
      if (savingPlan || taskBusy || taskOperation) { schedulePoll(); return; }
      loadController?.abort();
      const controller = new scope.AbortController();
      loadController = controller;
      const request = ++loadTicket;
      if (!snapshot) {
        pane.dataset.state = 'loading';
        content.hidden = true;
        status.textContent = 'Загружаем общее полотно…';
      } else if (manual) status.textContent = 'Обновляем…';
      refresh.disabled = true;
      retry.hidden = true;
      try {
        const data = await options.load({ context: { ...context }, signal: controller.signal });
        if (!current(ticket) || request !== loadTicket || controller.signal.aborted) return;
        status.textContent = taskLinkNotice;
        applySnapshot(data);
      } catch (error) {
        if (!current(ticket) || request !== loadTicket || isAbort(error) || controller.signal.aborted) return;
        if (!snapshot) pane.dataset.state = 'error';
        status.textContent = snapshot ? 'Не удалось обновить. Показываем последнее загруженное полотно.' : 'Не удалось загрузить полотно. Проверьте соединение и повторите.';
        retry.hidden = false;
      } finally {
        if (current(ticket) && request === loadTicket) {
          refresh.disabled = false;
          loadController = null;
          schedulePoll();
        }
      }
    }
    function mutationController() {
      loadController?.abort();
      ++loadTicket;
      refresh.disabled = false;
      const controller = new scope.AbortController();
      controllers.add(controller);
      return controller;
    }
    async function recoverConflict(ticket) {
      const controller = new scope.AbortController();
      controllers.add(controller);
      try {
        const data = await options.load({ context: { ...context }, signal: controller.signal });
        if (!current(ticket) || controller.signal.aborted) return null;
        applySnapshot(data);
        return data;
      } catch (_) {
        return null;
      } finally { controllers.delete(controller); }
    }
    async function savePlan(replace) {
      const ticket = generation;
      if (!current(ticket) || !snapshot || savingPlan || !planDirty) return;
      if (planChanged && !replace) return;
      const body = planBody.value;
      const expectedRevision = replace ? snapshot.canvas.revision : planBaseRevision;
      const controller = mutationController();
      savingPlan = true;
      planError = false;
      planState('Сохраняем…', 'pending');
      updatePlanControls();
      try {
        const data = await options.savePlan({ context: { ...context }, body, expectedRevision, signal: controller.signal });
        if (!current(ticket) || controller.signal.aborted) return;
        savingPlan = false;
        planDirty = false;
        planChanged = false;
        applySnapshot(snapshot && Number(snapshot.revision) > Number(data.revision) ? snapshot : data);
        planState('Сохранено', 'saved');
        notifyMutation('plan');
      } catch (error) {
        if (!current(ticket) || isAbort(error) || controller.signal.aborted) return;
        savingPlan = false;
        planError = true;
        if (isConflict(error)) {
          const data = await recoverConflict(ticket);
          if (!current(ticket)) return;
          planChanged = !!data;
          planState(data ? 'Текст проектов изменился у собеседника. Ваш текст сохранён в поле выше.' : 'Текст проектов изменился. Обновите полотно, чтобы сравнить версии. Ваш текст сохранён.', 'conflict');
        } else planState(errorMessage(error), 'error');
      } finally {
        controllers.delete(controller);
        if (current(ticket)) {
          savingPlan = false;
          updatePlanControls();
          schedulePoll();
        }
      }
    }
    function renderTasks() {
      const tasks = (snapshot?.tasks || []).filter(task => taskView === 'archived' ? !!task.archived_at : !task.archived_at && (taskView === 'completed' ? task.completed : !task.completed));
      taskCount.textContent = tasks.length ? 'Всего: ' + tasks.length : '';
      for (const node of taskViewButtons) {
        node.setAttribute('aria-selected', String(node.dataset.view === taskView));
        node.tabIndex = node.dataset.view === taskView ? 0 : -1;
      }
      taskList.setAttribute('aria-labelledby', uid + '-tasks-' + taskView);
      taskEmpty.textContent = { open: 'Здесь будут ваши общие дела.', completed: 'Выполненные дела появятся здесь.', archived: 'В архиве пока ничего нет.' }[taskView];
      taskEmpty.hidden = tasks.length > 0 || !!taskDraft;
      taskList.replaceChildren();
      for (const task of [...tasks].sort((a, b) => Number(!!a.completed) - Number(!!b.completed))) {
        const card = el('article', 'pccTask');
        card.dataset.taskId = task.id;
        card.dataset.completed = String(!!task.completed);
        card.dataset.archived = String(!!task.archived_at);
        const toggle = button('pccIcon pccTaskToggle', task.completed ? 'Вернуть дело в работу' : 'Отметить дело выполненным');
        toggle.textContent = '';
        toggle.setAttribute('aria-pressed', String(!!task.completed));
        const circle = el('span', 'pccTaskCheck');
        if (task.completed) circle.append(icon('check'));
        toggle.append(circle);
        toggle.disabled = !!taskOperation;
        toggle.hidden = !!task.archived_at;
        toggle.onclick = () => toggleTask(task);
        const body = el('div', 'pccTaskBody');
        const edit = button('pccTaskEdit', 'Изменить дело: ' + task.title);
        edit.textContent = '';
        edit.append(el('span', 'pccTaskText', task.title), icon('edit'));
        edit.onclick = () => startTask(task);
        edit.disabled = taskBusy || !!taskOperation;
        body.append(edit);
        const metadata = [task.assignee_id ? person(task.assignee_id) : '', scheduleLabel(task)].filter(Boolean).join(' · ');
        if (metadata) body.append(el('p', 'pccTaskMeta', metadata));
        if (task.source_message_id) {
          const locate = button('pccTextButton pccTaskLocate', 'Из переписки');
          locate.prepend(icon('source'));
          locate.onclick = () => locateSource(task.source_message_id, locate);
          body.append(locate);
        }
        card.append(toggle, body);
        if (taskOperation?.id === task.id) card.setAttribute('aria-busy', 'true');
        taskList.append(card);
      }
    }
    async function toggleTask(task) {
      const ticket = generation;
      if (!current(ticket) || taskOperation || taskBusy) return;
      const controller = mutationController();
      taskOperation = { id: task.id };
      renderTasks();
      try {
        const data = await options.updateTask({ context: { ...context }, id: task.id, title: task.title,
          assigneeId: task.assignee_id || null, dueDate: task.due_date || null, completed: !task.completed,
          schedule: scheduleOf(task), archived: false,
          expectedRevision: task.revision, signal: controller.signal });
        if (!current(ticket) || controller.signal.aborted) return;
        applySnapshot(data);
        notifyMutation('task', task.id);
        status.textContent = task.completed ? 'Дело возвращено в работу' : 'Дело выполнено';
      } catch (error) {
        if (!current(ticket) || isAbort(error) || controller.signal.aborted) return;
        if (isConflict(error)) {
          await recoverConflict(ticket);
          if (!current(ticket)) return;
          status.textContent = 'Дело уже изменилось. Проверьте его состояние и повторите действие.';
        } else status.textContent = 'Не удалось изменить состояние дела. Повторите нажатие.';
      } finally {
        controllers.delete(controller);
        if (current(ticket)) { taskOperation = null; renderTasks(); schedulePoll(); }
      }
    }
    function formField(labelText, input, suffix) {
      const wrap = el('label', 'pccField');
      input.id = uid + '-' + suffix;
      wrap.htmlFor = input.id;
      wrap.append(el('span', 'pccFieldLabel', labelText), input);
      return wrap;
    }
    function taskNotice(text, state) {
      if (!taskForm) return;
      const notice = taskForm.querySelector('.pccTaskNotice');
      notice.textContent = text;
      notice.dataset.state = state || '';
    }
    function renderTaskConflict(latest) {
      if (!taskForm) return;
      const text = [latest.title, latest.assignee_id ? person(latest.assignee_id) : '', scheduleLabel(latest), latest.archived_at ? 'В архиве' : latest.completed ? 'Выполнено' : 'В работе'].filter(Boolean).join('\n');
      taskForm.querySelector('.pccTaskServerBody').textContent = text;
    }
    function newId() {
      if (scope.crypto?.randomUUID) return scope.crypto.randomUUID();
      const values = new Uint8Array(16);
      if (!scope.crypto?.getRandomValues) throw new Error('Не удалось создать идентификатор дела.');
      scope.crypto.getRandomValues(values);
      values[6] = values[6] & 15 | 64;
      values[8] = values[8] & 63 | 128;
      const hex = Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
      return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    }
    function startTask(task, source, review) {
      if (!snapshot || taskBusy || !current(generation)) return;
      if (taskDraft) {
        taskNotice('Завершите или отмените редактирование открытого дела.', '');
        taskForm.querySelector('.pccTaskTitle').focus();
        return;
      }
      if (taskLinkNotice) { taskLinkNotice = ''; status.textContent = ''; }
      const timed = localFields(task?.due_at);
      taskDraft = {
        id: task?.id || newId(), isNew: !task,
        title: task?.title || String(source?.text || source?.title || '').slice(0, 500),
        assigneeId: task?.assignee_id || null, dueDate: timed.date || task?.due_date || null,
        dueTime: timed.time, baseDueDate: task?.due_date || null, schedule: scheduleOf(task || {}), scheduleChanged: false, deadlineChanged: false,
        reminderMinutes: task?.reminder_minutes ?? null, followupMinutes: task?.due_at ? task.followup_minutes ?? null : 180,
        archived: !!task?.archived_at, review: !!review,
        completed: !!task?.completed, baseRevision: task?.revision || 0,
        sourceMessageId: task?.source_message_id || source?.id || source?.source_message_id || null,
        sourceBlockId: task?.source_block_id || source?.blockId || source?.source_block_id || null,
        conflict: false, confirmDelete: false, dirty: !task,
      };
      renderTaskForm();
      taskEmpty.hidden = true;
      updateTaskControls();
      taskForm.scrollIntoView({ block: review ? 'start' : 'nearest' });
      if (review) taskForm.querySelector('.pccTaskDone')?.focus({ preventScroll: true });
      else taskForm.querySelector('.pccTaskTitle').focus({ preventScroll: true });
    }
    function renderTaskForm() {
      taskForm = el('form', 'pccTaskForm');
      taskForm.dataset.taskId = taskDraft.isNew ? 'new' : taskDraft.id;
      taskForm.setAttribute('aria-label', taskDraft.isNew ? 'Новое дело' : 'Редактирование дела');
      taskForm.append(el('h4', 'pccFormTitle', taskDraft.isNew ? 'Новое дело' : 'Дело'));
      if (taskDraft.review && !taskDraft.completed && !taskDraft.archived) taskForm.append(el('p', 'pccTaskReview', 'Получилось сделать дело?'));
      const title = el('textarea', 'pccTaskTitle');
      title.maxLength = 500;
      title.rows = 2;
      title.required = true;
      title.placeholder = 'Что нужно сделать?';
      title.value = taskDraft.title;
      title.oninput = () => { taskDraft.title = title.value; taskDraft.dirty = true; autosize(title, 220); updateTaskControls(); };
      taskForm.append(formField('Дело', title, 'task-title'));
      const details = el('div', 'pccTaskFields');
      const assignee = el('select', 'pccTaskAssignee');
      const nobody = el('option', '', 'Без исполнителя');
      nobody.value = '';
      assignee.append(nobody);
      for (const participant of snapshot.participants) {
        const option = el('option', '', person(participant.id));
        option.value = participant.id;
        assignee.append(option);
      }
      if (taskDraft.assigneeId && !snapshot.participants.some(row => row.id === taskDraft.assigneeId)) {
        const option = el('option', '', 'Участник больше не в чате');
        option.value = taskDraft.assigneeId;
        assignee.append(option);
      }
      assignee.value = taskDraft.assigneeId || '';
      assignee.onchange = () => { taskDraft.assigneeId = assignee.value || null; taskDraft.dirty = true; };
      const date = el('input', 'pccTaskDate');
      date.type = 'date';
      date.value = taskDraft.dueDate || '';
      const time = el('input', 'pccTaskTime');
      time.type = 'time';
      time.value = taskDraft.dueTime || '';
      time.step = '60';
      const reminder = el('select', 'pccTaskReminder');
      for (const [value, text] of [['', 'Не напоминать'], ['0', 'В указанное время'], ['15', 'За 15 минут'], ['30', 'За 30 минут'], ['60', 'За час'], ['1440', 'За день']]) {
        const choice = el('option', '', text); choice.value = value; reminder.append(choice);
      }
      reminder.value = taskDraft.reminderMinutes == null ? '' : String(taskDraft.reminderMinutes);
      const followup = el('select', 'pccTaskFollowup');
      for (const [value, text] of [['180', 'Через 3 часа'], ['', 'Не спрашивать']]) {
        const choice = el('option', '', text); choice.value = value; followup.append(choice);
      }
      followup.value = taskDraft.followupMinutes == null ? '' : String(taskDraft.followupMinutes);
      const timezone = el('p', 'pccTaskTimezone', 'Время на этом устройстве: ' + localZone());
      const notificationHint = el('p', 'pccTaskNotificationHint', 'Напоминания приходят на устройства с включёнными уведомлениями.');
      const enableNotifications = button('pccTextButton pccTaskNotifications', 'Включить уведомления');
      enableNotifications.onclick = () => {
        let request;
        try { request = options.onEnableNotifications?.(); }
        catch (_) { taskNotice('Не удалось включить уведомления. Проверьте разрешение в настройках устройства.', 'error'); return; }
        Promise.resolve(request).then(() => { if (taskForm?.contains(enableNotifications)) updateScheduleControls(); }, () => { if (taskForm?.contains(enableNotifications)) taskNotice('Не удалось включить уведомления. Проверьте разрешение в настройках устройства.', 'error'); });
      };
      function updateScheduleControls() {
        const timed = !!(taskDraft.dueDate && taskDraft.dueTime);
        reminder.disabled = !timed || taskBusy;
        followup.disabled = !timed || taskBusy;
        timezone.hidden = !taskDraft.dueTime;
        const alarms = timed && (taskDraft.reminderMinutes != null || taskDraft.followupMinutes != null);
        notificationHint.hidden = !alarms;
        enableNotifications.hidden = !alarms || typeof options.onEnableNotifications !== 'function' || options.notificationsEnabled?.() === true;
      }
      date.onchange = () => {
        taskDraft.dueDate = date.value || null;
        if (!date.value) { taskDraft.dueTime = ''; time.value = ''; }
        taskDraft.dirty = true; taskDraft.scheduleChanged = true; taskDraft.deadlineChanged = true;
        updateScheduleControls();
      };
      time.onchange = () => {
        taskDraft.dueTime = time.value;
        if (time.value && !date.value) { date.value = localFields(new Date().toISOString()).date; taskDraft.dueDate = date.value; }
        taskDraft.dirty = true; taskDraft.scheduleChanged = true; taskDraft.deadlineChanged = true;
        updateScheduleControls();
      };
      reminder.onchange = () => { taskDraft.reminderMinutes = reminder.value === '' ? null : Number(reminder.value); taskDraft.scheduleChanged = true; taskDraft.dirty = true; updateScheduleControls(); };
      followup.onchange = () => { taskDraft.followupMinutes = followup.value === '' ? null : Number(followup.value); taskDraft.scheduleChanged = true; taskDraft.dirty = true; updateScheduleControls(); };
      const assigneeField = formField('Кто делает', assignee, 'task-assignee');
      assigneeField.classList.add('pccTaskAssigneeField');
      details.append(assigneeField, formField('Дата', date, 'task-date'), formField('Время', time, 'task-time'), formField('Напомнить', reminder, 'task-reminder'), formField('Уточнить выполнение', followup, 'task-followup'));
      taskForm.append(details);
      taskForm.append(timezone, notificationHint, enableNotifications);
      if (taskDraft.sourceMessageId) {
        const source = button('pccTextButton pccTaskSource', 'Из переписки');
        source.prepend(icon('source'));
        source.onclick = () => locateSource(taskDraft.sourceMessageId, source);
        taskForm.append(source);
      }
      const notice = el('p', 'pccNotice pccTaskNotice');
      notice.setAttribute('role', 'status');
      const conflict = el('div', 'pccConflict pccTaskConflict');
      conflict.hidden = true;
      const replace = button('pccButton pccTaskReplace', 'Сохранить мою версию');
      replace.onclick = () => saveTask(true);
      conflict.append(el('p', 'pccConflictLabel', 'Сейчас в общем деле'), el('p', 'pccServerBody pccTaskServerBody'), replace);
      const actions = el('div', 'pccTaskActions');
      const cancel = button('pccTextButton pccTaskCancel', 'Отмена');
      cancel.onclick = dismissTask;
      const save = button('pccButton pccTaskSave', taskDraft.isNew ? 'Добавить дело' : 'Сохранить дело');
      save.type = 'submit';
      if (!taskDraft.isNew) {
        const lifecycle = el('div', 'pccTaskLifecycle');
        const done = button('pccTextButton pccTaskDone', taskDraft.completed ? 'Вернуть в работу' : 'Сделано');
        done.onclick = () => { void saveTask(false, { completed: !taskDraft.completed, archived: false }); };
        const postpone = button('pccTextButton pccTaskPostpone', 'Перенести');
        postpone.onclick = () => {
          taskDraft.postponing = true; taskDraft.dirty = true;
          taskNotice('Выберите новую дату и время, затем сохраните дело.', '');
          date.focus();
        };
        const archive = button('pccTextButton ' + (taskDraft.archived ? 'pccTaskRestore' : 'pccTaskArchive'), taskDraft.archived ? 'Из архива' : 'В архив');
        archive.onclick = () => { void saveTask(false, { archived: !taskDraft.archived }); };
        lifecycle.append(done, postpone, archive);
        const reviewPrompt = taskForm.querySelector('.pccTaskReview');
        if (reviewPrompt) reviewPrompt.after(lifecycle);
        else taskForm.append(lifecycle);
        const remove = button('pccTextButton pccTaskDelete', 'Удалить дело');
        remove.onclick = () => { taskDraft.confirmDelete = !taskDraft.confirmDelete; updateTaskControls(); };
        actions.append(remove);
      }
      actions.append(cancel, save);
      const confirm = button('pccButton pccTaskDeleteConfirm', 'Удалить дело для всех навсегда');
      confirm.hidden = true;
      confirm.onclick = deleteTask;
      taskForm.append(notice, conflict, actions, confirm);
      taskForm.onsubmit = event => { event.preventDefault(); void saveTask(false); };
      taskFormHost.replaceChildren(taskForm);
      autosize(title, 220);
      updateTaskControls();
      updateScheduleControls();
    }
    function dismissTask() {
      if (taskBusy) return;
      taskDraft = null;
      taskForm = null;
      taskFormHost.replaceChildren();
      taskEmpty.hidden = (snapshot?.tasks.length || 0) > 0;
      updateTaskControls();
    }
    async function saveTask(replace, changes) {
      const ticket = generation;
      if (!current(ticket) || !taskDraft || taskBusy || !taskDraft.title.trim()) return;
      if (taskDraft.deleted) { taskNotice('Это дело удалено. Скопируйте текст и добавьте новое дело.', 'error'); return; }
      if (taskDraft.conflict && !replace) return;
      if (changes) { taskDraft.pendingState = { ...changes }; taskDraft.postponing = false; taskDraft.dirty = true; }
      const draft = { ...taskDraft };
      const latest = snapshot.tasks.find(item => item.id === draft.id);
      if (!draft.isNew && replace && !latest) return;
      let schedule;
      try {
        schedule = buildSchedule(draft);
        if (draft.postponing && (!draft.deadlineChanged || !draft.dueDate || (schedule.due_at ? new Date(schedule.due_at).getTime() <= Date.now() : draft.dueDate < localFields(new Date().toISOString()).date))) throw new Error('Укажите новую дату или время в будущем.');
      } catch (error) { taskNotice(error.message, 'error'); return; }
      const state = draft.postponing ? { completed: false, archived: false } : draft.pendingState || {};
      const dueDate = draft.deadlineChanged || !draft.schedule.due_at ? draft.dueDate : draft.baseDueDate;
      const controller = mutationController();
      taskBusy = true;
      taskNotice('Сохраняем…', 'pending');
      updateTaskControls();
      try {
        const payload = { context: { ...context }, id: draft.id, title: draft.title.trim(),
          assigneeId: draft.assigneeId, dueDate, schedule, signal: controller.signal };
        if (draft.isNew && !taskDraft.createAttempt) {
          taskDraft.createAttempt = { id: draft.id, title: payload.title, assigneeId: draft.assigneeId,
            dueDate, schedule: { ...schedule }, sourceMessageId: draft.sourceMessageId, sourceBlockId: draft.sourceBlockId };
        }
        const attempt = taskDraft.createAttempt;
        const data = draft.isNew
          ? await options.createTask({ ...payload, ...attempt })
          : await options.updateTask({ ...payload, completed: state.completed ?? (replace ? latest.completed : draft.completed),
            archived: state.archived ?? (replace ? !!latest.archived_at : draft.archived), expectedRevision: replace ? latest.revision : draft.baseRevision });
        if (!current(ticket) || controller.signal.aborted) return;
        taskBusy = false;
        notifyMutation('task', draft.id);
        const created = draft.isNew ? data.tasks.find(item => item.id === draft.id) : null;
        if (draft.isNew && !created) {
          applySnapshot(data);
          taskDraft.deleted = true;
          taskNotice('Это дело уже удалено. Текст остаётся в форме; его можно скопировать в новое дело.', 'error');
        } else if (created && (draft.title.trim() !== attempt.title || draft.assigneeId !== attempt.assigneeId || dueDate !== attempt.dueDate || JSON.stringify(schedule) !== JSON.stringify(attempt.schedule))) {
          // A retry must repeat the original request. Preserve edits made after a lost response.
          applySnapshot(data);
          taskDraft.isNew = false;
          taskDraft.baseRevision = created.revision;
          taskDraft.completed = created.completed;
          taskDraft.archived = !!created.archived_at;
          taskDraft.createAttempt = null;
          renderTaskForm();
          taskNotice('Дело добавлено. Сохраните последующие изменения из этой формы.', '');
        } else {
          dismissTask();
          applySnapshot(data);
          status.textContent = draft.isNew ? 'Дело добавлено' : draft.postponing ? 'Дело перенесено' : state.archived === true ? 'Дело в архиве' : state.completed === true ? 'Дело в разделе «Готово»' : 'Дело сохранено';
        }
      } catch (error) {
        if (!current(ticket) || isAbort(error) || controller.signal.aborted) return;
        taskBusy = false;
        if (draft.isNew && ['22023', '42501', '23514'].includes(error?.code)) taskDraft.createAttempt = null;
        if (isConflict(error)) {
          const data = await recoverConflict(ticket);
          if (!current(ticket)) return;
          const latestTask = data?.tasks.find(item => item.id === draft.id);
          taskDraft.conflict = !!latestTask;
          if (latestTask) renderTaskConflict(latestTask);
          taskNotice(latestTask ? 'Дело изменилось у собеседника. Ваши поля сохранены выше.' : 'Обновите полотно, чтобы проверить общее дело. Ваши поля сохранены.', 'conflict');
        } else taskNotice(errorMessage(error), 'error');
      } finally {
        controllers.delete(controller);
        if (current(ticket)) { taskBusy = false; updateTaskControls(); schedulePoll(); }
      }
    }
    async function deleteTask() {
      const ticket = generation;
      if (!current(ticket) || !taskDraft || taskDraft.isNew || taskBusy) return;
      const draft = { ...taskDraft };
      const controller = mutationController();
      taskBusy = true;
      updateTaskControls();
      taskNotice('Удаляем…', 'pending');
      try {
        const data = await options.deleteTask({ context: { ...context }, id: draft.id, expectedRevision: draft.baseRevision, signal: controller.signal });
        if (!current(ticket) || controller.signal.aborted) return;
        taskBusy = false;
        dismissTask();
        applySnapshot(data);
        notifyMutation('task', draft.id);
        status.textContent = 'Дело удалено';
      } catch (error) {
        if (!current(ticket) || isAbort(error) || controller.signal.aborted) return;
        taskBusy = false;
        if (isConflict(error)) {
          const data = await recoverConflict(ticket);
          if (!current(ticket)) return;
          const latest = data?.tasks.find(item => item.id === draft.id);
          if (latest) {
            taskDraft.baseRevision = latest.revision;
            taskDraft.conflict = true;
            renderTaskConflict(latest);
          }
          taskDraft.confirmDelete = false;
          taskNotice('Дело изменилось. Проверьте общую версию перед удалением.', 'conflict');
        } else taskNotice(errorMessage(error), 'error');
      } finally {
        controllers.delete(controller);
        if (current(ticket)) { taskBusy = false; updateTaskControls(); schedulePoll(); }
      }
    }
    async function locateSource(messageId, trigger) {
      const ticket = generation;
      if (!current(ticket) || trigger.disabled || typeof options.onLocate !== 'function') return;
      trigger.disabled = true;
      try { await options.onLocate(messageId); }
      catch (_) {
        if (sameContext()) {
          status.textContent = 'Исходное сообщение удалено или недоступно.';
          if (taskForm) taskNotice('Исходное сообщение удалено или недоступно.', 'error');
        }
      } finally { trigger.disabled = false; }
    }
    function stopRequests() {
      ++generation;
      ++loadTicket;
      scope.clearTimeout(pollTimer);
      pollTimer = 0;
      loadController?.abort();
      loadController = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      savingPlan = false;
      taskBusy = false;
      taskOperation = null;
      refresh.disabled = false;
    }
    function mount(host) {
      if (!host?.append) throw new Error('Не найдено место для полотна.');
      host.append(pane);
      return api;
    }
    function open(settings) {
      if (destroyed) return;
      const next = options.getContext() || {};
      if (!next.userId || !next.conversationId) return;
      if (!sameIdentity()) reset();
      else if (!sameContext()) stopRequests();
      context = { ...next };
      if (!opened) ++generation;
      opened = true;
      pane.hidden = false;
      if (settings?.sourceMessage) pendingSource = settings.sourceMessage;
      if (settings?.taskId) {
        // Explicit task navigation has already passed the host's unsaved-changes guard.
        // A previous form must not trap a link to another task in the same chat.
        if (taskDraft) {
          if (taskBusy) stopRequests();
          dismissTask();
        }
        pendingSource = null;
        taskLinkNotice = '';
        pendingTask = { id: settings.taskId, review: !!settings.taskReview };
      }
      if (pendingSource && snapshot) {
        const source = pendingSource;
        pendingSource = null;
        startTask(null, source);
      }
      updatePlanControls();
      updateTaskControls();
      return load(true);
    }
    function close() {
      opened = false;
      pane.hidden = true;
      stopRequests();
    }
    function reset() {
      close();
      context = null;
      snapshot = null;
      pendingSource = null;
      pendingTask = null;
      taskLinkNotice = '';
      taskView = 'open';
      planBody.value = '';
      planBaseBody = '';
      planBaseRevision = 0;
      planDirty = false;
      planChanged = false;
      planError = false;
      planState('', '');
      planServerBody.textContent = '';
      planConflict.hidden = true;
      taskDraft = null;
      taskForm = null;
      taskFormHost.replaceChildren();
      taskList.replaceChildren();
      taskCount.textContent = '';
      status.textContent = '';
      content.hidden = true;
      retry.hidden = true;
      pane.dataset.state = 'idle';
      updatePlanControls();
      updateTaskControls();
    }
    function newTask(source) {
      return open({ sourceMessage: { title: source?.title, source_message_id: source?.source_message_id, source_block_id: source?.source_block_id } });
    }
    function hasUnsavedChanges() { return sameIdentity() && (planDirty || !!taskDraft?.dirty); }
    function onFocus() { if (opened && !document.hidden) void load(false); }
    function onBeforeUnload(event) {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    }
    function destroy() {
      reset();
      destroyed = true;
      pane.remove();
      scope.removeEventListener('focus', onFocus);
      scope.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onFocus);
    }
    planBody.oninput = () => {
      planDirty = planBody.value !== planBaseBody;
      planError = false;
      if (!planChanged) planState(planDirty ? 'Есть несохранённые изменения' : '', planDirty ? 'dirty' : '');
      autosize(planBody, 360);
      updatePlanControls();
    };
    planSave.onclick = () => savePlan(false);
    planReplace.onclick = () => savePlan(true);
    planUseServer.onclick = () => {
      if (!snapshot || savingPlan) return;
      planDirty = false;
      planChanged = false;
      planError = false;
      applySnapshot(snapshot);
      planState('Открыта общая версия', 'saved');
    };
    add.onclick = () => startTask();
    taskViewButtons.forEach((node, index) => {
      const choose = () => { taskView = node.dataset.view; renderTasks(); };
      node.onclick = choose;
      node.onkeydown = event => {
        const indexNext = event.key === 'ArrowRight' ? (index + 1) % taskViewButtons.length : event.key === 'ArrowLeft' ? (index + taskViewButtons.length - 1) % taskViewButtons.length : event.key === 'Home' ? 0 : event.key === 'End' ? taskViewButtons.length - 1 : null;
        if (indexNext == null) return;
        event.preventDefault();
        taskView = taskViewButtons[indexNext].dataset.view;
        renderTasks();
        taskViewButtons[indexNext].focus();
      };
    });
    refresh.onclick = () => load(true);
    retry.onclick = () => load(true);
    scope.addEventListener('focus', onFocus);
    scope.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onFocus);
    const api = { mount, open, close, reset, newTask, hasUnsavedChanges, destroy, element: pane };
    if (options.host) mount(options.host);
    reset();
    return api;
  }
  scope.PablicusChatCanvas = { create };
})(window);
