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
        copy: 'M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
        previous: 'm14 6-6 6 6 6',
        next: 'm10 6 6 6-6 6',
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
    const planLabel = el('h3', 'pccLabel', 'Проекты');
    const refresh = button('pccIcon pccRefresh', 'Обновить полотно', 'refresh');
    head.append(planLabel, refresh);
    const status = el('p', 'pccStatus');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = button('pccButton pccRetry', 'Повторить загрузку');
    retry.hidden = true;
    const content = el('div', 'pccContent');
    const planSection = el('section', 'pccPlan');
    // One persistent surface owns the summary and the full project. The native
    // button toggles disclosure; media/edit controls are siblings, never nested.
    const planSurface = el('article', 'pccProject');
    const planCard = button('pccProjectCard', 'Открыть проект');
    planCard.setAttribute('aria-controls', uid + '-project-content');
    planCard.setAttribute('aria-expanded', 'false');
    const planTitle = el('span', 'pccProjectTitle');
    const planExcerpt = el('span', 'pccProjectExcerpt');
    const planAttachments = el('span', 'pccAttachmentSummary');
    planCard.replaceChildren(planTitle, planExcerpt, planAttachments, icon('next'));
    const planView = el('div', 'pccProjectView');
    planView.id = uid + '-project-content';
    planView.hidden = true;
    const planViewContent = el('div', 'pccProjectViewContent');
    const planActions = el('div', 'pccProjectActions');
    const planCopy = button('pccTextButton pccPlanCopy', 'Копировать текст');
    planCopy.textContent = '';
    const planCopyLabel = el('span', 'pccCopyLabel', 'Копировать');
    planCopy.append(icon('copy'), planCopyLabel);
    const planCopyStatus = el('span', 'pccCopyStatus');
    planCopyStatus.setAttribute('role', 'status');
    planCopyStatus.setAttribute('aria-live', 'polite');
    const planEdit = button('pccTextButton pccPlanEdit', 'Изменить проект');
    planEdit.prepend(icon('edit'));
    planActions.append(planCopy, planEdit, planCopyStatus);
    planView.append(planViewContent, planActions);
    const planNew = button('pccButton pccPlanNew', 'Добавить проект');
    planNew.prepend(icon('plus'));
    const planEditorHost = el('div', 'pccPlanEditor');
    planEditorHost.hidden = true;
    const planFoot = el('div', 'pccFormFoot');
    const planNotice = el('p', 'pccNotice pccPlanNotice');
    planNotice.setAttribute('role', 'status');
    const planSave = button('pccButton pccPlanSave', 'Сохранить проект');
    const planCancel = button('pccTextButton pccPlanCancel', 'Отмена');
    planCancel.hidden = true;
    planFoot.append(planNotice, planCancel, planSave);
    const planConflict = el('div', 'pccConflict pccPlanConflict');
    planConflict.hidden = true;
    const planServerLabel = el('p', 'pccConflictLabel', 'Общая версия проекта');
    const planServerBody = el('p', 'pccServerBody pccPlanServerBody');
    const planConflictActions = el('div', 'pccConflictActions');
    const planUseServer = button('pccTextButton pccPlanUseServer', 'Принять общую версию');
    const planReplace = button('pccButton pccPlanReplace', 'Сохранить мою версию');
    planConflictActions.append(planUseServer, planReplace);
    planConflict.append(planServerLabel, planServerBody, planConflictActions);
    planSurface.append(planCard, planView);
    planSection.append(planSurface, planNew, planEditorHost, planFoot, planConflict);
    const tasksSection = el('section', 'pccTasks');
    const tasksHead = el('div', 'pccTasksHead');
    const tasksHeading = el('h3', 'pccLabel', 'Дела');
    const taskCount = el('span', 'pccTaskCount');
    const add = button('pccButton pccTaskAdd', 'Новое дело');
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
    let planBaseContent = { v: 1, blocks: [] }, planBaseRevision = 0, planDirty = false, planChanged = false;
    let planEditor = null, planEditing = false, planExpanded = false, planViewCleanup = null, planRenderedContent = '', planInputState = '', planCopyTimer = 0, taskEditor = null;
    let taskDraft = null, taskForm = null, taskBusy = false, pendingSource = null;
    let taskOperation = null, planError = false;
    let taskView = 'open', pendingTask = null, taskLinkNotice = '';
    let taskSheet = null, taskReturnFocus = null, taskSheetHistory = false, taskSheetBackPending = false;
    const controllers = new Set();

    function richContent(value, fallback) {
      if (value && Array.isArray(value.blocks)) return { v: 1, blocks: value.blocks };
      return { v: 1, blocks: fallback ? [{ id: uid + '-legacy-text', type: 'text', text: String(fallback) }] : [] };
    }
    function contentText(value) { return (value?.blocks || []).filter(block => block.type === 'text').map(block => block.text || '').join('\n').trim(); }
    function hasContent(value) { return (value?.blocks || []).some(block => block.type !== 'text' || String(block.text || '').trim()); }
    function attachmentSummary(value) {
      const counts = {};
      for (const block of value?.blocks || []) if (block.type !== 'text') counts[block.type] = (counts[block.type] || 0) + 1;
      const labels = { image: 'Фото', video: 'Видео', audio: 'Аудио', document: 'Файлы', file: 'Файлы' };
      const parts = Object.entries(counts).map(([kind, count]) => (labels[kind] || 'Вложения') + '\u00a0' + count);
      const links = contentText(value).match(/https?:\/\/[^\s]+/gi) || [];
      if (links.length) parts.push('Ссылки\u00a0' + links.length);
      return parts.join(' · ');
    }
    function editorOptions(host, value, placeholder, onChange, onError) {
      return { host, content: value, placeholder, onChange, onError, resolveUrl: options.resolveUrl };
    }
    function editorState(draft) { return JSON.stringify([draft.content, !!draft.recording, !!draft.pending]); }
    function ensurePlanEditor() {
      if (planEditor) return planEditor;
      planEditor = scope.PablicusWorkspaceEditor.create(editorOptions(planEditorHost, planBaseContent,
        'Проект…', draft => {
          const next = editorState(draft);
          if (next === planInputState) return;
          planInputState = next;
          planDirty = planEditor.isDirty();
          planError = false;
          if (!planChanged) planState('', planDirty ? 'dirty' : '');
          updatePlanControls();
        }, error => planState(error?.message || String(error), 'error')));
      const input = planEditorHost.querySelector('textarea');
      if (input) { input.classList.add('pccPlanBody'); input.id = uid + '-plan'; }
      planInputState = editorState(planEditor.snapshot());
      return planEditor;
    }
    function renderProject() {
      const value = richContent(snapshot?.canvas.content, snapshot?.canvas.body);
      const exists = hasContent(value);
      planSurface.hidden = !exists || planEditing;
      planSurface.dataset.expanded = String(planExpanded && !planEditing);
      planNew.hidden = exists || planEditing;
      planEditorHost.hidden = !planEditing;
      planView.hidden = !exists || planEditing || !planExpanded;
      planCard.setAttribute('aria-expanded', String(planExpanded && !planEditing));
      const text = contentText(value), lines = text.split(/\n+/).filter(Boolean);
      planTitle.textContent = (lines[0] || 'Проект с вложениями').slice(0, 90);
      planExcerpt.textContent = lines.length > 1 ? lines.slice(1).join(' ') : text.length > 90 ? text.slice(90) : '';
      planTitle.hidden = planExpanded;
      planExcerpt.hidden = planExpanded || !planExcerpt.textContent;
      planAttachments.textContent = attachmentSummary(value);
      planAttachments.hidden = planExpanded || !planAttachments.textContent;
      planCopy.hidden = !text;
      const disclosureLabel = planExpanded ? 'Свернуть проект' : 'Открыть проект';
      planCard.title = disclosureLabel;
      planCard.setAttribute('aria-label', disclosureLabel);
      const signature = planView.hidden ? '' : JSON.stringify(value);
      if (signature === planRenderedContent) return;
      if (planViewCleanup) { planViewCleanup(); planViewCleanup = null; }
      planViewContent.replaceChildren();
      planRenderedContent = signature;
      if (signature) {
        if (options.renderContent) planViewCleanup = options.renderContent({ host: planViewContent, content: value, context: { ...context } });
        else planViewContent.textContent = text;
      }
    }
    async function copyProjectText() {
      const text = contentText(richContent(snapshot?.canvas.content, snapshot?.canvas.body));
      if (!text) return;
      let temporary = null;
      try {
        if (scope.navigator?.clipboard?.writeText) await scope.navigator.clipboard.writeText(text);
        else {
          temporary = el('textarea');
          temporary.value = text;
          temporary.setAttribute('readonly', '');
          temporary.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none';
          document.body.append(temporary);
          temporary.select();
          if (!document.execCommand?.('copy')) throw new Error('copy_failed');
        }
        temporary?.remove();
        planCopyLabel.textContent = 'Скопировано';
        planCopyStatus.textContent = 'Текст проекта скопирован';
        clearTimeout(planCopyTimer);
        planCopyTimer = scope.setTimeout(() => {
          if (!destroyed) { planCopyLabel.textContent = 'Копировать'; planCopyStatus.textContent = ''; }
        }, 2400);
      } catch (_) {
        temporary?.remove();
        planCopyLabel.textContent = 'Повторить';
        planCopyStatus.textContent = 'Не удалось скопировать. Нажмите ещё раз.';
      }
    }
    function editProject() {
      if (!snapshot || savingPlan) return;
      const editor = ensurePlanEditor();
      planEditing = true;
      if (!planError && !planChanged) planState('', planDirty ? 'dirty' : '');
      renderProject(); updatePlanControls(); editor.focus();
    }
    async function preparedContent(editor, controller, ticket) {
      await editor.stopRecording();
      if (!current(ticket) || controller.signal.aborted) return null;
      const draft = editor.snapshot();
      const validation = editor.validate?.();
      if (validation?.ok === false || draft.errors?.length) throw new Error((validation?.errors || draft.errors).map(error => error.message || String(error)).join(' '));
      const value = options.uploadContent ? await options.uploadContent({ context: { ...context }, snapshot: draft, signal: controller.signal }) : draft.content;
      return current(ticket) && !controller.signal.aborted ? value : null;
    }

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
    function planState(text, state) {
      planNotice.textContent = text;
      planNotice.dataset.state = state || '';
      planFoot.hidden = planSave.hidden && !text && !planEditing;
    }
    function updatePlanControls() {
      planEditor?.setDisabled(!snapshot || savingPlan);
      planSave.disabled = !snapshot || (!planDirty && !planEditor?.recording && !planEditor?.pending) || savingPlan;
      planSave.textContent = savingPlan ? 'Сохраняем…' : 'Сохранить проект';
      planSave.hidden = !snapshot || !planEditing || planChanged;
      planCancel.hidden = !planEditing;
      planCancel.disabled = savingPlan;
      planFoot.hidden = planSave.hidden && !planNotice.textContent && !planEditing;
      planReplace.disabled = !snapshot || savingPlan;
      planUseServer.disabled = savingPlan;
      planConflict.hidden = !planChanged;
      if (planChanged) {
        const value = richContent(snapshot?.canvas.content, snapshot?.canvas.body);
        planServerBody.textContent = [contentText(value), attachmentSummary(value)].filter(Boolean).join('\n') || 'Проект пока пуст.';
      }
    }
    function updateTaskControls() {
      add.disabled = !snapshot || taskBusy || !!taskDraft;
      add.hidden = !!taskDraft;
      if (!taskForm) return;
      for (const input of taskForm.querySelectorAll('input,textarea,select,button')) input.disabled = taskBusy;
      taskEditor?.setDisabled(taskBusy);
      for (const input of taskForm.querySelectorAll('.pccTaskReminder')) input.disabled = taskBusy || !taskDraft.dueDate || !taskDraft.dueTime;
      for (const input of taskForm.querySelectorAll('.pccTaskDone,.pccTaskArchive,.pccTaskRestore')) input.disabled = taskBusy || !!taskDraft.conflict;
      const save = taskForm.querySelector('.pccTaskSave');
      save.disabled = taskBusy || (!hasContent(taskEditor?.getContent() || taskDraft.content) && !taskEditor?.recording && !taskEditor?.pending);
      save.textContent = taskBusy ? 'Сохраняем…' : (taskDraft.isNew ? 'Добавить' : 'Сохранить');
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
        planBaseContent = richContent(data.canvas.content, data.canvas.body);
        ensurePlanEditor().setContent(planBaseContent, { clean: true });
        planInputState = editorState(planEditor.snapshot());
        planBaseRevision = data.canvas.revision;
        planChanged = false;
        if (!planError) planState('', '');
      } else if (planDirty && !savingPlan && data.canvas.revision !== planBaseRevision) {
        planChanged = true;
        planState('Проект изменился у собеседника. Ваши изменения остаются в поле выше.', 'conflict');
      }
      updatePlanControls();
      renderProject();
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
      if (!current(ticket) || !snapshot || savingPlan || (!planDirty && !planEditor?.recording && !planEditor?.pending)) return;
      if (planChanged && !replace) return;
      const expectedRevision = replace ? snapshot.canvas.revision : planBaseRevision;
      const controller = mutationController();
      savingPlan = true;
      planError = false;
      planState('Сохраняем…', 'pending');
      updatePlanControls();
      try {
        const value = await preparedContent(planEditor, controller, ticket);
        if (!value) return;
        const data = await options.savePlan({ context: { ...context }, content: value, body: contentText(value), expectedRevision, signal: controller.signal });
        if (!current(ticket) || controller.signal.aborted) return;
        savingPlan = false;
        planDirty = false;
        planChanged = false;
        planEditing = false;
        planExpanded = false;
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
          planState(data ? 'Проект изменился у собеседника. Ваши изменения остаются в поле выше.' : 'Проект изменился. Обновите полотно, чтобы сравнить версии. Ваши изменения остаются в поле.', 'conflict');
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
        const value = richContent(task.content, task.title);
        const edit = button('pccTaskEdit', 'Изменить дело: ' + task.title);
        edit.textContent = '';
        edit.append(el('span', 'pccTaskText', task.title), icon('edit'));
        edit.onclick = () => startTask(task);
        edit.disabled = taskBusy || !!taskOperation;
        body.append(edit);
        const attachments = attachmentSummary(value);
        if (attachments) body.append(el('p', 'pccTaskMeta pccAttachmentSummary', attachments));
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
        const data = await options.updateTask({ context: { ...context }, id: task.id, title: task.title, content: richContent(task.content, task.title),
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
      const value = richContent(latest.content, latest.title);
      const text = [contentText(value), attachmentSummary(value), latest.assignee_id ? person(latest.assignee_id) : '', scheduleLabel(latest), latest.archived_at ? 'В архиве' : latest.completed ? 'Выполнено' : 'В работе'].filter(Boolean).join('\n');
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
        taskEditor?.focus();
        return;
      }
      if (taskLinkNotice) { taskLinkNotice = ''; status.textContent = ''; }
      taskReturnFocus = document.activeElement;
      const defaultTime = new Date();
      defaultTime.setHours(defaultTime.getHours() + 1, 0, 0, 0);
      const timed = localFields(task?.due_at || (!task ? defaultTime.toISOString() : null));
      taskDraft = {
        id: task?.id || newId(), isNew: !task,
        title: task?.title || String(source?.text || source?.title || '').slice(0, 500),
        content: richContent(task?.content || source?.content, task?.title || source?.text || source?.title || ''),
        assigneeId: task ? task.assignee_id || null : context.userId, dueDate: timed.date || task?.due_date || null,
        dueTime: timed.time, baseDueDate: task?.due_date || null, schedule: scheduleOf(task || {}), scheduleChanged: !task, deadlineChanged: !task,
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
      showTaskSheet();
    }
    function updateSheetViewport() {
      if (!taskSheet?.open) return;
      const viewport = scope.visualViewport;
      taskSheet.style.setProperty('--pcc-viewport-top', (viewport?.offsetTop || 0) + 'px');
      taskSheet.style.setProperty('--pcc-viewport-height', (viewport?.height || scope.innerHeight) + 'px');
    }
    function ensureSheetHistory() {
      if (taskSheetHistory || taskSheetBackPending) return;
      try {
        scope.history.pushState({ ...scope.history.state, pccTaskSheet: uid }, '', scope.location.href);
        taskSheetHistory = true;
      } catch (_) { /* The native dialog still supports its close button and Escape. */ }
    }
    function showTaskSheet() {
      if (!taskSheet || !opened) return;
      if (!taskSheet.open) taskSheet.showModal();
      updateSheetViewport();
      ensureSheetHistory();
      const target = taskDraft.review ? taskForm.querySelector('.pccTaskDone') : taskForm.querySelector('.pccCalendarDay[aria-pressed="true"]');
      (target || taskForm.querySelector('.pccTaskCancel')).focus({ preventScroll: true });
    }
    function hideTaskSheet() {
      if (taskSheet?.open) taskSheet.close();
      if (taskSheetHistory) {
        taskSheetHistory = false;
        if (scope.history.state?.pccTaskSheet === uid) {
          taskSheetBackPending = true;
          scope.history.back();
        }
      }
    }
    function onSheetBack() {
      // A close may be followed by another task before the asynchronous traversal.
      // Wait for that traversal before registering the new sheet's back entry.
      if (taskSheetBackPending) {
        taskSheetBackPending = false;
        if (taskSheet?.open && opened && !destroyed) ensureSheetHistory();
        return;
      }
      if (!taskSheetHistory || scope.history.state?.pccTaskSheet === uid) return;
      taskSheetHistory = false;
      if (taskBusy) {
        try {
          scope.history.pushState({ ...scope.history.state, pccTaskSheet: uid }, '', scope.location.href);
          taskSheetHistory = true;
        } catch (_) { /* Keep the in-flight form until its response resolves. */ }
      } else dismissTask();
    }
    function renderTaskForm() {
      const wasOpen = !!taskSheet?.open;
      if (wasOpen) taskSheet.close();
      if (taskEditor) {
        const draft = taskEditor.snapshot();
        taskDraft.content = draft.content;
        taskDraft.files = draft.files;
        taskEditor.destroy();
        taskEditor = null;
      }
      taskSheet = el('dialog', 'pccTaskSheet');
      taskSheet.setAttribute('aria-modal', 'true');
      taskSheet.setAttribute('aria-labelledby', uid + '-task-heading');
      taskSheet.oncancel = event => { event.preventDefault(); dismissTask(); };
      taskSheet.onclick = event => { if (event.target === taskSheet) dismissTask(); };
      taskForm = el('form', 'pccTaskForm');
      taskForm.dataset.taskId = taskDraft.isNew ? 'new' : taskDraft.id;
      taskForm.setAttribute('aria-label', taskDraft.isNew ? 'Новое дело' : 'Редактирование дела');
      const heading = el('div', 'pccTaskSheetHead');
      const cancel = button('pccIcon pccTaskCancel', 'Закрыть дело', 'close');
      cancel.onclick = dismissTask;
      const caption = el('h4', 'pccFormTitle', taskDraft.isNew ? 'Новое дело' : 'Дело');
      caption.id = uid + '-task-heading';
      heading.append(cancel, caption);
      taskForm.append(heading);
      if (taskDraft.review && !taskDraft.completed && !taskDraft.archived) taskForm.append(el('p', 'pccTaskReview', 'Получилось сделать дело?'));
      const calendar = el('section', 'pccCalendar');
      calendar.setAttribute('aria-label', 'Дата дела');
      const monthBar = el('div', 'pccCalendarHead');
      const monthName = el('p', 'pccCalendarMonth');
      monthName.id = uid + '-task-month';
      monthName.setAttribute('aria-live', 'polite');
      const previous = button('pccIcon pccCalendarPrev', 'Предыдущий месяц', 'previous');
      const next = button('pccIcon pccCalendarNext', 'Следующий месяц', 'next');
      monthBar.append(monthName, previous, next);
      const weekdays = el('div', 'pccCalendarWeekdays');
      weekdays.setAttribute('aria-hidden', 'true');
      for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) weekdays.append(el('span', '', day));
      const grid = el('div', 'pccCalendarGrid');
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-labelledby', monthName.id);
      const date = el('input', 'pccTaskDate');
      date.type = 'hidden';
      date.value = taskDraft.dueDate || '';
      const selectedDate = () => new Date((taskDraft.dueDate || localFields(new Date().toISOString()).date) + 'T12:00:00');
      let visibleMonth = selectedDate();
      visibleMonth.setDate(1);
      const dateKey = value => localFields(value.toISOString()).date;
      const fullDate = value => value.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      function markDeadline() {
        taskDraft.dirty = true; taskDraft.scheduleChanged = true; taskDraft.deadlineChanged = true;
        updateTaskControls();
      }
      function chooseDate(value, focus) {
        taskDraft.dueDate = value;
        date.value = value;
        markDeadline();
        renderCalendar(value, focus);
      }
      function renderCalendar(focusDate, focus) {
        const year = visibleMonth.getFullYear(), month = visibleMonth.getMonth();
        const monthText = visibleMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/ г\.$/, '');
        monthName.textContent = monthText.charAt(0).toUpperCase() + monthText.slice(1);
        grid.replaceChildren();
        const offset = (new Date(year, month, 1).getDay() + 6) % 7;
        const count = new Date(year, month + 1, 0).getDate();
        const today = localFields(new Date().toISOString()).date;
        const focused = focusDate || (taskDraft.dueDate?.startsWith(dateKey(visibleMonth).slice(0, 7)) ? taskDraft.dueDate : dateKey(visibleMonth));
        for (let week = 0; week < Math.ceil((offset + count) / 7); week++) {
          const row = el('div', 'pccCalendarWeek'); row.setAttribute('role', 'row');
          for (let weekday = 0; weekday < 7; weekday++) {
            const cell = el('div', 'pccCalendarCell'); cell.setAttribute('role', 'gridcell');
            const day = week * 7 + weekday - offset + 1;
            if (day >= 1 && day <= count) {
              const value = new Date(year, month, day, 12), key = dateKey(value);
              const choice = button('pccCalendarDay', fullDate(value));
              choice.textContent = String(day);
              choice.dataset.date = key;
              choice.setAttribute('aria-pressed', String(key === taskDraft.dueDate));
              if (key === today) choice.setAttribute('aria-current', 'date');
              choice.tabIndex = key === focused ? 0 : -1;
              choice.disabled = taskBusy;
              choice.onclick = () => chooseDate(key, true);
              choice.onkeydown = event => {
                const movement = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday }[event.key];
                const target = new Date(value);
                if (movement !== undefined) target.setDate(target.getDate() + movement);
                else if (event.key === 'PageUp' || event.key === 'PageDown') {
                  target.setDate(1); target.setMonth(target.getMonth() + (event.key === 'PageUp' ? -1 : 1));
                  target.setDate(Math.min(day, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
                } else return;
                event.preventDefault();
                visibleMonth = new Date(target.getFullYear(), target.getMonth(), 1, 12);
                renderCalendar(dateKey(target), true);
              };
              cell.append(choice);
            }
            row.append(cell);
          }
          grid.append(row);
        }
        if (focus) grid.querySelector('[data-date="' + focused + '"]')?.focus({ preventScroll: true });
      }
      function changeMonth(direction) {
        visibleMonth.setMonth(visibleMonth.getMonth() + direction);
        renderCalendar();
      }
      previous.onclick = () => changeMonth(-1);
      next.onclick = () => changeMonth(1);
      date.onchange = () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return;
        visibleMonth = new Date(date.value + 'T12:00:00'); visibleMonth.setDate(1);
        chooseDate(date.value, false);
      };
      calendar.append(monthBar, weekdays, grid, date);
      taskForm.append(calendar);
      const details = el('div', 'pccTaskFields');
      const time = el('input', 'pccTaskTime');
      time.type = 'time'; time.value = taskDraft.dueTime || ''; time.step = '60';
      time.onchange = () => {
        taskDraft.dueTime = time.value;
        if (time.value && !taskDraft.dueDate) chooseDate(localFields(new Date().toISOString()).date, false);
        markDeadline();
      };
      const reminder = el('select', 'pccTaskReminder');
      for (const [value, text] of [['', 'Нет'], ['0', 'В момент дела'], ['15', 'За 15 минут'], ['30', 'За 30 минут'], ['60', 'За час'], ['1440', 'За день']]) {
        const choice = el('option', '', text); choice.value = value; reminder.append(choice);
      }
      reminder.value = taskDraft.reminderMinutes == null ? '' : String(taskDraft.reminderMinutes);
      reminder.onchange = () => {
        taskDraft.reminderMinutes = reminder.value === '' ? null : Number(reminder.value);
        taskDraft.scheduleChanged = true; taskDraft.dirty = true;
        updateTaskControls();
        if (taskDraft.reminderMinutes == null || options.notificationsEnabled?.() === true || typeof options.onEnableNotifications !== 'function') return;
        const activeForm = taskForm;
        try {
          const request = options.onEnableNotifications();
          Promise.resolve(request).catch(() => {
            if (taskForm === activeForm) taskNotice('Для напоминаний разрешите уведомления в профиле.', 'error');
          });
        } catch (_) { taskNotice('Для напоминаний разрешите уведомления в профиле.', 'error'); }
      };
      details.append(formField('Время', time, 'task-time'), formField('Напомнить', reminder, 'task-reminder'));
      taskForm.append(details);
      const editorHost = el('div', 'pccTaskEditor');
      taskForm.append(editorHost);
      const notice = el('p', 'pccNotice pccTaskNotice'); notice.setAttribute('role', 'status');
      const conflict = el('div', 'pccConflict pccTaskConflict'); conflict.hidden = true;
      const replace = button('pccButton pccTaskReplace', 'Сохранить мою версию'); replace.onclick = () => saveTask(true);
      conflict.append(el('p', 'pccConflictLabel', 'Сейчас в общем деле'), el('p', 'pccServerBody pccTaskServerBody'), replace);
      const actions = el('div', 'pccTaskActions');
      const save = button('pccButton pccTaskSave', taskDraft.isNew ? 'Добавить' : 'Сохранить'); save.type = 'submit';
      actions.append(save);
      const confirm = button('pccButton pccTaskDeleteConfirm', 'Удалить дело для всех навсегда');
      confirm.hidden = true; confirm.onclick = deleteTask;
      taskForm.append(notice, conflict, actions);
      if (!taskDraft.isNew) {
        const more = el('details', 'pccTaskMore');
        const moreToggle = el('summary', 'pccTaskMoreToggle', 'Действия с делом');
        const lifecycle = el('div', 'pccTaskLifecycle');
        const done = button('pccTextButton pccTaskDone', taskDraft.completed ? 'Вернуть в работу' : 'Сделано');
        done.onclick = () => { void saveTask(false, { completed: !taskDraft.completed, archived: false }); };
        const postpone = button('pccTextButton pccTaskPostpone', 'Перенести');
        postpone.onclick = () => {
          taskDraft.postponing = true; taskDraft.dirty = true; more.open = false;
          taskNotice('Выберите новую дату и время.', '');
          calendar.scrollIntoView({ block: 'nearest' });
          grid.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
        };
        const archive = button('pccTextButton ' + (taskDraft.archived ? 'pccTaskRestore' : 'pccTaskArchive'), taskDraft.archived ? 'Из архива' : 'В архив');
        archive.onclick = () => { void saveTask(false, { archived: !taskDraft.archived }); };
        const remove = button('pccTextButton pccTaskDelete', 'Удалить');
        remove.onclick = () => { taskDraft.confirmDelete = !taskDraft.confirmDelete; updateTaskControls(); };
        lifecycle.append(done, postpone, archive, remove);
        more.append(moreToggle, lifecycle, confirm);
        if (taskDraft.sourceMessageId) {
          const source = button('pccTextButton pccTaskSource', 'Из переписки'); source.prepend(icon('source'));
          source.onclick = () => locateSource(taskDraft.sourceMessageId, source); more.append(source);
        }
        taskForm.append(more);
        if (taskDraft.review) {
          more.open = true;
          taskForm.querySelector('.pccTaskReview')?.after(more);
        }
      } else taskForm.append(confirm);
      taskForm.onsubmit = event => { event.preventDefault(); void saveTask(false); };
      taskSheet.append(taskForm); taskFormHost.replaceChildren(taskSheet);
      let inputState = '';
      taskEditor = scope.PablicusWorkspaceEditor.create(editorOptions(editorHost, taskDraft.content,
        'Что нужно сделать?', draft => {
          if (!taskDraft) return;
          const next = editorState(draft);
          if (next === inputState) return;
          inputState = next;
          taskDraft.title = draft.text;
          taskDraft.content = draft.content;
          taskDraft.files = draft.files;
          taskDraft.dirty = true;
          updateTaskControls();
        }, error => taskNotice(error?.message || String(error), 'error')));
      if (taskDraft.files?.length) taskEditor.setContent(taskDraft.content, { files: taskDraft.files });
      inputState = editorState(taskEditor.snapshot());
      const title = editorHost.querySelector('textarea');
      if (title) { title.classList.add('pccTaskTitle'); title.id = uid + '-task-title'; title.setAttribute('aria-label', 'Что нужно сделать?'); }
      renderCalendar(); updateTaskControls();
      if (wasOpen) showTaskSheet();
    }
    function dismissTask() {
      if (taskBusy) return;
      const previousFocus = taskReturnFocus, previousTaskId = taskDraft?.isNew ? null : taskDraft?.id;
      const ticket = generation;
      hideTaskSheet();
      taskEditor?.destroy(); taskEditor = null;
      taskDraft = null; taskForm = null; taskSheet = null;
      taskFormHost.replaceChildren();
      renderTasks(); updateTaskControls();
      taskReturnFocus = null;
      scope.requestAnimationFrame(() => {
        if (!opened || destroyed || ticket !== generation || taskSheet?.open) return;
        const editedRow = previousTaskId && [...taskList.querySelectorAll('.pccTask')].find(row => row.dataset.taskId === previousTaskId);
        const candidate = previousFocus?.isConnected ? previousFocus : editedRow?.querySelector('.pccTaskEdit') || add;
        if (!candidate.disabled && !candidate.closest('[hidden]')) candidate.focus({ preventScroll: true });
      });
    }
    async function saveTask(replace, changes) {
      const ticket = generation;
      if (!current(ticket) || !taskDraft || taskBusy || (!hasContent(taskEditor?.getContent() || taskDraft.content) && !taskEditor?.recording && !taskEditor?.pending)) return;
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
        const value = await preparedContent(taskEditor, controller, ticket);
        if (!value) return;
        const inputSignature = JSON.stringify(taskEditor.getContent());
        draft.title = contentText(value);
        draft.content = value;
        const payload = { context: { ...context }, id: draft.id, content: value, title: draft.title.slice(0, 500),
          assigneeId: draft.assigneeId, dueDate, schedule, signal: controller.signal };
        if (draft.isNew && !taskDraft.createAttempt) {
          taskDraft.createAttempt = { id: draft.id, title: payload.title, content: value, inputSignature, assigneeId: draft.assigneeId,
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
        } else if (created && (inputSignature !== attempt.inputSignature || draft.assigneeId !== attempt.assigneeId || dueDate !== attempt.dueDate || JSON.stringify(schedule) !== JSON.stringify(attempt.schedule))) {
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
      if (taskDraft && !settings?.taskId) showTaskSheet();
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
      hideTaskSheet();
      if (planViewCleanup) { planViewCleanup(); planViewCleanup = null; }
      planRenderedContent = '';
      planViewContent.replaceChildren();
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
      planEditor?.destroy(); planEditor = null;
      taskEditor?.destroy(); taskEditor = null;
      planBaseContent = { v: 1, blocks: [] };
      planEditing = false;
      planExpanded = false;
      if (planViewCleanup) { planViewCleanup(); planViewCleanup = null; }
      planViewContent.replaceChildren();
      planBaseRevision = 0;
      planDirty = false;
      planChanged = false;
      planError = false;
      scope.clearTimeout(planCopyTimer);
      planCopyTimer = 0;
      planCopyLabel.textContent = 'Копировать';
      planCopyStatus.textContent = '';
      planState('', '');
      planServerBody.textContent = '';
      planConflict.hidden = true;
      taskDraft = null;
      taskForm = null;
      taskSheet = null;
      taskReturnFocus = null;
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
      return open({ sourceMessage: { title: source?.title, content: source?.content, source_message_id: source?.source_message_id, source_block_id: source?.source_block_id } });
    }
    function hasUnsavedChanges() { return sameIdentity() && (planDirty || !!planEditor?.recording || !!planEditor?.pending || !!taskDraft?.dirty || !!taskEditor?.recording || !!taskEditor?.pending); }
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
      scope.removeEventListener('resize', updateSheetViewport);
      scope.removeEventListener('popstate', onSheetBack);
      scope.visualViewport?.removeEventListener('resize', updateSheetViewport);
      scope.visualViewport?.removeEventListener('scroll', updateSheetViewport);
    }
    planCard.onclick = () => { planExpanded = !planExpanded; renderProject(); };
    planCopy.onclick = () => { void copyProjectText(); };
    planEdit.onclick = editProject;
    planNew.onclick = editProject;
    planCancel.onclick = () => {
      if (savingPlan) return;
      planDirty = false; planChanged = false; planError = false;
      planEditing = false; planExpanded = false;
      planEditor?.destroy(); planEditor = null;
      applySnapshot(snapshot);
      planState('', '');
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
    scope.addEventListener('resize', updateSheetViewport);
    scope.addEventListener('popstate', onSheetBack);
    scope.visualViewport?.addEventListener('resize', updateSheetViewport);
    scope.visualViewport?.addEventListener('scroll', updateSheetViewport);
    const api = { mount, open, close, reset, newTask, hasUnsavedChanges, destroy, element: pane };
    if (options.host) mount(options.host);
    reset();
    return api;
  }
  scope.PablicusChatCanvas = { create };
})(window);
