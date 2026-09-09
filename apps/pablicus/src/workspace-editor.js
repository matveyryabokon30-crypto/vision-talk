/* The task/project editor shares the message composer's ordered text/media model.
 * Existing server attachments are references; new files remain their original Blobs
 * until the host persists the exact snapshot. This module never sends a message. */
(function (scope) {
  'use strict';
  const MEDIA = new Set(['image', 'video', 'audio', 'document']);
  const LABELS = {image: 'Фото', video: 'Видео', audio: 'Аудио', document: 'Документ'};
  const MAX_TEXT = 20000, MAX_BLOCKS = 100, MAX_FILE = 25 * 1024 * 1024, MAX_TOTAL = 100 * 1024 * 1024;
  const uid = () => scope.crypto?.randomUUID?.() || `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  function safeUrl(value) {
    try { const url = new URL(typeof value === 'string' ? value : value?.url || value?.signedUrl); return ['https:', 'http:', 'blob:'].includes(url.protocol) ? url.href : null; }
    catch (_) { return null; }
  }
  function create(options = {}) {
    const host = options.host || options.container;
    if (!host?.append || !scope.PablicusRichComposer) throw Error('Редактор материалов недоступен.');
    let rich, destroyed = false, disabled = false, expanded = false, restoring = false, base = '', remote = new Map();
    let pendingAdds = 0, addQueue = Promise.resolve(), contentEpoch = 0;
    const root = element('section', 'workspaceEditor');
    root.setAttribute('aria-label', options.label || 'Материалы');
    const body = element('div', 'workspaceEditorBody');
    const input = element('textarea', 'workspaceEditorInput');
    input.rows = 1;
    input.placeholder = options.placeholder || 'Напишите и добавьте материалы…';
    input.setAttribute('aria-label', options.label || options.placeholder || 'Текст и материалы');
    body.append(input);
    const toolbar = element('div', 'workspaceEditorToolbar');
    const notice = element('p', 'workspaceEditorNotice');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.hidden = true;
    function button(label, text, action, className = '') {
      const node = element('button', `workspaceEditorButton ${className}`, text);
      node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
      node.addEventListener('click', action); return node;
    }
    const attach = button('Добавить вложение', '+', () => setMenu(menu.hidden), 'workspaceEditorAttach');
    attach.setAttribute('aria-expanded', 'false');
    const hint = element('span', 'workspaceEditorHint', 'Текст и вложения');
    const expand = button('Развернуть поле', '', () => setExpanded(!expanded), 'workspaceEditorExpand');
    expand.setAttribute('aria-expanded', 'false');
    const done = button('Готово, свернуть поле', 'Готово', () => setExpanded(false), 'workspaceEditorDone');
    done.hidden = true;
    const menu = element('div', 'workspaceEditorMenu'); menu.hidden = true;
    const picker = element('input'); picker.type = 'file'; picker.multiple = true; picker.hidden = true;
    const linkRow = element('div', 'workspaceEditorLink'); linkRow.hidden = true;
    const linkInput = element('input'); linkInput.type = 'url'; linkInput.placeholder = 'https://'; linkInput.setAttribute('aria-label', 'Ссылка');
    const insertLink = button('Добавить ссылку', 'Добавить', () => {
      const url = linkInput.value.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { report('Введите ссылку, начинающуюся с https:// или http://.'); return; }
      rich.focus();
      const selected = rich.selection;
      const target = [...body.querySelectorAll('textarea')].find(node => node.dataset.richBlock === selected.blockId);
      if (target) {
        target.setRangeText(url, selected.start, selected.end, 'end');
        target.dispatchEvent(new Event('input', {bubbles: true}));
      }
      linkInput.value = ''; linkRow.hidden = true;
    });
    linkInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); insertLink.click(); } });
    linkRow.append(linkInput, insertLink);
    const choices = [
      ['Фото', 'image/*'], ['Видео', 'video/*'], ['Аудио', 'audio/*'], ['Документ или файл', ''],
    ];
    for (const [label, accept] of choices) menu.append(button(label, label, () => {
      setMenu(false); picker.accept = accept; picker.value = ''; picker.click();
    }));
    menu.append(button('Добавить ссылку', 'Ссылка', () => { setMenu(false); linkRow.hidden = false; linkInput.focus(); }));
    root.append(body, linkRow, toolbar, notice, menu, picker);
    host.append(root);
    function report(message) {
      if (destroyed) return;
      message = String(message || '').replace(/перед отправкой/g, 'перед сохранением').replace(/В одном сообщении можно отправить/g, 'Можно сохранить').replace(/В сообщении слишком много вставок\. Отправьте часть отдельным сообщением\./g, 'Слишком много вставок. Сохраните часть в отдельном деле или проекте.');
      notice.textContent = message || ''; notice.hidden = !message;
      if (rich) rich.voiceButton.querySelector('svg')?.toggleAttribute('hidden', rich.recording);
      if (message) options.onError?.(message);
    }
    function rawSnapshot() {
      const draft = rich.capture();
      const files = draft.files.filter(file => !remote.has(file.id));
      const fileMap = new Map(files.map(file => [file.id, file]));
      const blocks = draft.blocks.map(block => {
        if (block.type === 'text') return {id: block.id, type: 'text', text: block.text};
        const existing = remote.get(block.assetId);
        if (existing) return {...existing, id: block.id};
        const file = fileMap.get(block.assetId);
        return {id: block.id, type: block.type, assetId: block.assetId,
          ...(file ? {name: file.name, mime: file.type, size: file.size} : {}), ...(block.pending ? {pending: true} : {})};
      });
      return {text: draft.text, content: {v: 1, blocks}, files, selection: draft.selection,
        ...(draft.recording ? {recording: draft.recording} : {}), pending: pendingAdds > 0};
    }
    function errorsFor(draft) {
      const errors = [], blocks = draft.content.blocks.filter(block => block.type !== 'text' || block.text.trim());
      if (blocks.filter(block => block.type === 'text').map(block => block.text).join('\n').length > MAX_TEXT) errors.push('Текст — до 20 000 символов.');
      if (blocks.length > MAX_BLOCKS) errors.push('Можно сохранить до 100 текстовых блоков и вложений.');
      const media = blocks.filter(block => MEDIA.has(block.type));
      if (media.some(block => Number(block.size) > MAX_FILE)) errors.push('Размер одного файла — до 25 МБ.');
      if (media.reduce((sum, block) => sum + (Number(block.size) || 0), 0) > MAX_TOTAL) errors.push('Общий размер вложений — до 100 МБ.');
      if (media.some(block => !block.path && !block.pending && !draft.files.some(file => file.id === block.assetId && file.file instanceof Blob))) errors.push('Один из файлов недоступен. Добавьте его ещё раз.');
      return errors;
    }
    function snapshot() { const draft = rawSnapshot(); return {...draft, errors: errorsFor(draft)}; }
    function fingerprint(draft) {
      // Empty text slots are editor insertion points, not saved user changes.
      return JSON.stringify(draft.content.blocks.filter(block => block.type !== 'text' || block.text).map(block => {
        const {id, ...rest} = block; return rest;
      }));
    }
    function paintDisabled() {
      root.classList.toggle('is-disabled', disabled);
      rich?.voiceButton.querySelector('svg')?.toggleAttribute('hidden', rich.recording);
      for (const node of root.querySelectorAll('button,input')) node.disabled = disabled;
      for (const node of body.querySelectorAll('textarea')) node.readOnly = disabled;
    }
    function decorateRemote() {
      if (!rich || destroyed) return;
      for (const card of body.querySelectorAll('.richMedia')) {
        const block = remote.get(card.dataset.assetId);
        if (!block || card.dataset.workspaceRemote) continue;
        card.dataset.workspaceRemote = 'true'; card.classList.remove('richMissing');
        card.querySelector('.richMediaName').textContent = block.name || LABELS[block.type];
        card.querySelector('.richMissing p')?.remove();
        for (const child of [...card.children]) if (!child.classList.contains('richMediaHead')) child.remove();
        const detail = element('small', 'richMediaDetails', `${LABELS[block.type]}${block.size ? ` · ${(block.size / 1024 / 1024).toFixed(1)} МБ` : ''}`);
        const open = button(`Открыть ${block.name || LABELS[block.type]}`, 'Открыть', async () => {
          if (typeof options.resolveUrl !== 'function') { report('Не удалось открыть вложение. Повторите попытку.'); return; }
          open.disabled = true;
          try {
            const url = safeUrl(await options.resolveUrl(block.path, {...block}));
            if (destroyed || !card.isConnected) return;
            if (!url) throw Error('Не удалось получить файл.');
            if (block.type === 'document') {
              const link = element('a', 'workspaceEditorFileLink', 'Открыть файл'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
              open.replaceWith(link); link.click();
            } else {
              const player = element(block.type === 'image' ? 'img' : block.type, 'workspaceEditorRemoteMedia');
              if (block.type === 'image') { player.alt = block.name || 'Фото'; player.loading = 'lazy'; }
              else { player.controls = true; player.preload = 'metadata'; if (block.type === 'video') player.playsInline = true; }
              player.src = url; open.replaceWith(player);
            }
          } catch (error) { report(error.message || 'Не удалось открыть вложение.'); }
          finally { if (open.isConnected) open.disabled = disabled; }
        }, 'workspaceEditorOpen');
        card.append(detail, open);
      }
      const textareas = body.querySelectorAll('textarea');
      textareas.forEach((node, index) => {
        node.placeholder = index === 0 ? input.placeholder : 'Продолжить текст…';
        node.setAttribute('aria-label', index === 0 ? options.label || options.placeholder || 'Текст и материалы' : 'Продолжение текста');
      });
      paintDisabled();
    }
    function changed() {
      if (destroyed || restoring || !rich) return;
      decorateRemote();
      const draft = snapshot();
      if (draft.errors.length) { notice.textContent = draft.errors[0]; notice.hidden = false; }
      else if (notice.textContent.startsWith('Текст —') || notice.textContent.startsWith('Общий размер') || notice.textContent.startsWith('Можно сохранить')) report('');
      options.onChange?.(draft);
    }
    rich = scope.PablicusRichComposer.create({container: body, input, onChange: changed, onError: report,
      onGeometry: decorateRemote, acceptFile: file => {
        const current = rawSnapshot();
        const bytes = current.content.blocks.filter(block => MEDIA.has(block.type)).reduce((sum, block) => sum + (Number(block.size) || 0), 0);
        if (bytes + file.size > MAX_TOTAL) { report('Общий размер вложений — до 100 МБ.'); return false; }
        return !destroyed;
      }});
    // RichComposer's chat-only ID must never collide with the actual message mic.
    rich.voiceButton.removeAttribute('id'); rich.voiceButton.classList.add('workspaceEditorVoice');
    rich.voiceButton.addEventListener('click', () => { queueMicrotask(changed); });
    toolbar.append(attach, hint, done, expand, rich.voiceButton);
    function setMenu(open) {
      if (destroyed || disabled) return;
      menu.hidden = !open; attach.setAttribute('aria-expanded', String(open));
      if (open) rich.capture();
    }
    function viewport() {
      if (!expanded) return;
      const view = scope.visualViewport;
      root.style.setProperty('--workspace-editor-top', `${view?.offsetTop || 0}px`);
      root.style.setProperty('--workspace-editor-height', `${view?.height || scope.innerHeight}px`);
    }
    function setExpanded(value) {
      if (destroyed) return;
      expanded = !!value; root.classList.toggle('is-expanded', expanded); done.hidden = !expanded;
      expand.setAttribute('aria-expanded', String(expanded)); expand.setAttribute('aria-label', expanded ? 'Свернуть поле' : 'Развернуть поле');
      viewport(); options.onGeometry?.();
    }
    function onOutside(event) { if (!root.contains(event.target)) { menu.hidden = true; attach.setAttribute('aria-expanded', 'false'); } }
    function onKey(event) {
      if (!root.contains(event.target) || event.key !== 'Escape') return;
      if (!menu.hidden || !linkRow.hidden || expanded) { event.preventDefault(); event.stopPropagation(); menu.hidden = true; linkRow.hidden = true; attach.setAttribute('aria-expanded', 'false'); setExpanded(false); }
    }
    async function addFiles(incoming) {
      if (destroyed || disabled) return;
      const values = Array.from(incoming || []), epoch = contentEpoch; pendingAdds++; changed();
      const job = addQueue.catch(() => {}).then(async () => {
        // Serialize files so the rich composer's byte guard includes every accepted
        // local file as well as references to existing server attachments.
        for (const file of values) { if (destroyed || epoch !== contentEpoch) break; await rich.addFiles([file]); }
      });
      addQueue = job;
      try { await job; } finally { pendingAdds--; changed(); }
    }
    picker.addEventListener('change', () => { void addFiles(picker.files).catch(error => report(error.message)); });
    body.addEventListener('paste', event => {
      const files = [...(event.clipboardData?.files || [])];
      if (!files.length) return;
      event.preventDefault(); event.stopImmediatePropagation(); void addFiles(files).catch(error => report(error.message));
    }, true);
    body.addEventListener('dragover', event => { if (!disabled && [...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
    body.addEventListener('drop', event => {
      const files = [...(event.dataTransfer?.files || [])]; if (!files.length) return;
      event.preventDefault(); void addFiles(files).catch(error => report(error.message));
    });
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey, true);
    scope.addEventListener('resize', viewport);
    scope.visualViewport?.addEventListener('resize', viewport);
    scope.visualViewport?.addEventListener('scroll', viewport);
    function setContent(content, settings = {}) {
      if (destroyed) return;
      contentEpoch++;
      restoring = true;
      try {
        remote = new Map();
        const files = (settings.files || []).map(file => ({...file}));
        const inputBlocks = typeof content === 'string' ? [{type: 'text', text: content}] : content?.blocks || [];
        const blocks = inputBlocks.filter(block => block && (block.type === 'text' || MEDIA.has(block.type))).map(block => {
          const id = block.id || uid();
          if (block.type === 'text') return {id, type: 'text', text: String(block.text || '')};
          if (block.path) {
            const assetId = `workspace-remote-${uid()}`;
            remote.set(assetId, {...block, id});
            files.push({id: assetId, name: block.name || LABELS[block.type], type: block.mime || '', kind: block.type, size: Number(block.size) || 0});
            return {id, type: block.type, assetId};
          }
          return {...block, id};
        });
        rich.restore({blocks, files, selection: settings.selection});
        decorateRemote(); report('');
        if (settings.clean !== false) base = fingerprint(rawSnapshot());
      } finally { restoring = false; }
    }
    setContent(options.content, {files: options.files, clean: true});
    const api = {
      element: root, snapshot, capture: snapshot, getContent: () => snapshot().content,
      setContent, addFiles, markClean() { base = fingerprint(rawSnapshot()); },
      isDirty: () => rich.recording || pendingAdds > 0 || fingerprint(rawSnapshot()) !== base,
      validate: () => { const errors = errorsFor(rawSnapshot()); return {ok: !errors.length, errors}; },
      get recording() { return rich.recording; }, get pending() { return pendingAdds > 0; },
      get content() { return snapshot().content; }, get files() { return snapshot().files; },
      async stopRecording() { await addQueue; await rich.stopRecording(); return snapshot(); },
      startRecording: () => disabled ? Promise.resolve() : rich.startRecording(),
      setDisabled(value) { disabled = !!value; if (disabled) { menu.hidden = true; attach.setAttribute('aria-expanded', 'false'); } paintDisabled(); },
      focus() { if (!disabled) rich.focus(); },
      destroy() {
        if (destroyed) return;
        destroyed = true; contentEpoch++; rich.destroy(); root.remove();
        document.removeEventListener('pointerdown', onOutside); document.removeEventListener('keydown', onKey, true);
        scope.removeEventListener('resize', viewport);
        scope.visualViewport?.removeEventListener('resize', viewport); scope.visualViewport?.removeEventListener('scroll', viewport);
        remote.clear();
      },
    };
    return api;
  }
  scope.PablicusWorkspaceEditor = {create};
})(typeof window === 'undefined' ? globalThis : window);
