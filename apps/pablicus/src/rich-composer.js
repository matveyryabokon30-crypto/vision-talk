/* Ordered message composition. Blobs stay local until the host queues a message. */
(function (global) {
  'use strict';
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_MESSAGE_BYTES = 100 * 1024 * 1024;
  const MAX_BLOCKS = 100;
  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);
  const ACCEPTED_MIMES = {
    image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']),
    video: new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']),
    audio: new Set(['audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/x-m4a']),
  };
  const EXTENSION_MIMES = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac'};
  const uid = () => global.crypto?.randomUUID?.() || `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const textBlock = (text = '') => ({id: uid(), type: 'text', text});
  const mimeFor = file => {
    const supplied = String(file.type || '').split(';')[0].trim().toLowerCase();
    if (supplied && supplied !== 'application/octet-stream') return supplied;
    return EXTENSION_MIMES[String(file.name || '').split('.').at(-1).toLowerCase()] || 'application/octet-stream';
  };
  const kindFor = file => {
    const mime = mimeFor(file);
    for (const kind of ['image', 'video', 'audio']) if (ACCEPTED_MIMES[kind].has(mime)) return kind;
    return 'document';
  };

  function create({container, input, onChange = () => {}, onError = () => {}, onGeometry = () => {}, acceptFile} = {}) {
    if (!container || !input || input.tagName !== 'TEXTAREA') throw Error('Rich composer needs a container and textarea');
    let blocks = [textBlock(input.value)];
    let files = new Map();
    let selected = {blockId: blocks[0].id, start: input.selectionStart || 0, end: input.selectionEnd || 0, direction: 'none'};
    let destroyed = false, revision = 0, requesting = false, permissionEpoch = 0, recording = null;
    let geometryFrame = 0, resizeObserver = null;
    const nodes = new Map(), urls = new Map(), cleanups = [], textListeners = new Map(), composing = new Set();
    const originalLabel = input.getAttribute('aria-label');
    const composeBox = container.closest('#composeBox');
    container.classList.add('richEditor');
    composeBox?.classList.add('rich-composer');

    function listen(target, event, listener, options) {
      target.addEventListener(event, listener, options);
      cleanups.push(() => target.removeEventListener(event, listener, options));
    }
    function error(message) { if (!destroyed) onError(message); }
    function geometry() {
      if (geometryFrame || destroyed) return;
      geometryFrame = requestAnimationFrame(() => {
        geometryFrame = 0;
        if (!destroyed) onGeometry();
      });
    }
    function readText() {
      for (const block of blocks) if (block.type === 'text') {
        const element = nodes.get(block.id);
        if (element) block.text = element.value;
      }
    }
    function remember(element) {
      if (element?.tagName !== 'TEXTAREA' || !element.dataset.richBlock) return;
      selected = {blockId: element.dataset.richBlock, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection || 'none'};
    }
    function capture() {
      readText();
      if (container.contains(document.activeElement)) remember(document.activeElement);
      const snapshot = {
        text: blocks.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        blocks: blocks.map(block => ({...block})),
        files: [...files.values()].map(file => ({...file})),
        selection: {...selected},
      };
      if (recording) snapshot.recording = {active: true, startedAt: recording.startedAt, assetId: recording.assetId};
      return snapshot;
    }
    function changed() { if (!destroyed) { onChange(capture()); geometry(); } }
    function sizeText(element) {
      if (!element) return;
      element.style.height = '40px';
      element.style.height = `${Math.max(40, element.scrollHeight)}px`;
    }
    function bindText(element, block) {
      element.dataset.richBlock = block.id;
      element.classList.add('richText');
      if (element !== input) {
        element.rows = 1;
        element.placeholder = 'Продолжить сообщение…';
        element.setAttribute('aria-label', 'Продолжение текста сообщения');
      }
      element.value = block.text;
      if (textListeners.has(element)) return element;
      const bound = [];
      const on = (event, callback) => { element.addEventListener(event, callback); bound.push(() => element.removeEventListener(event, callback)); };
      textListeners.set(element, () => { bound.forEach(remove => remove()); textListeners.delete(element); });
      const changedText = () => {
        const current = blocks.find(item => item.id === element.dataset.richBlock);
        if (current) current.text = element.value;
        remember(element); sizeText(element); changed();
      };
      on('input', changedText);
      on('compositionstart', () => { composing.add(element); changed(); });
      on('compositionend', () => { composing.delete(element); changedText(); });
      for (const event of ['select', 'keyup', 'pointerup', 'blur']) on(event, () => {
        if (event === 'select' && document.activeElement !== element) return;
        remember(element); changed();
      });
      on('focus', () => { remember(element); geometry(); });
      // The original textarea already has the host's paste handler.
      if (element !== input) on('paste', event => {
        const attached = [...(event.clipboardData?.files || [])];
        if (attached.length) { event.preventDefault(); addFiles(attached).catch(failure => error(failure.message)); }
      });
      return element;
    }
    function objectURL(file) {
      if (!urls.has(file.id)) urls.set(file.id, URL.createObjectURL(file.file));
      return urls.get(file.id);
    }
    function revokeUnused() {
      for (const [id, url] of urls) if (!files.has(id)) { URL.revokeObjectURL(url); urls.delete(id); }
    }
    function button(label, text, action) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'richAction';
      element.setAttribute('aria-label', label);
      element.title = label;
      element.textContent = text;
      element.addEventListener('click', action);
      return element;
    }
    function mediaNode(block) {
      const card = document.createElement('section');
      card.className = `richMedia richMedia-${block.type}`;
      card.dataset.richBlock = block.id;
      card.dataset.assetId = block.assetId;
      card.setAttribute('aria-label', ({image: 'Фото', video: 'Видео', audio: 'Голосовое сообщение', document: 'Документ'})[block.type]);
      const head = document.createElement('div');
      head.className = 'richMediaHead';
      const label = document.createElement('span');
      label.className = 'richMediaName';
      const file = files.get(block.assetId);
      label.textContent = block.pending ? 'Идёт запись голоса' : file?.name || 'Вложение недоступно';
      head.append(label);
      const remove = button(block.pending ? 'Отменить запись' : 'Убрать вложение', '×', () => {
        if (recording?.assetId === block.assetId) cancelRecording();
        removeBlock(block.id);
      });
      head.append(remove);
      card.append(head);
      if (block.pending) {
        const state = document.createElement('div');
        state.className = 'richRecordingState';
        const time = document.createElement('span');
        time.className = 'richRecordingTime';
        time.textContent = '00:00';
        state.append(time, document.createTextNode(' · Можно писать и добавлять файлы'));
        card.append(state);
      } else if (file?.file instanceof Blob) {
        if (block.type === 'image') {
          const img = document.createElement('img');
          img.className = 'richImage';
          img.alt = file.name || 'Фото в сообщении';
          img.loading = 'lazy';
          img.src = objectURL(file);
          img.addEventListener('load', geometry);
          img.addEventListener('error', () => {
            img.hidden = true;
            label.textContent = `${file.name} · предпросмотр недоступен`;
            geometry();
          }, {once: true});
          card.append(img);
        } else if (block.type === 'audio') {
          const audio = document.createElement('audio');
          audio.controls = true;
          audio.preload = 'none';
          audio.src = objectURL(file);
          audio.setAttribute('aria-label', 'Прослушать голосовое сообщение');
          card.append(audio);
        } else if (block.type === 'video') {
          const play = button('Предпросмотр видео', '▷ Посмотреть видео', () => {
            if (card.querySelector('video')) return;
            const video = document.createElement('video');
            video.controls = true;
            video.playsInline = true;
            video.preload = 'metadata';
            video.src = objectURL(file);
            play.replaceWith(video);
            video.addEventListener('loadedmetadata', geometry);
            video.play().catch(() => {});
            geometry();
          });
          play.classList.add('richVideoPreview');
          card.append(play);
        }
        const detail = document.createElement('small');
        detail.className = 'richMediaDetails';
        detail.textContent = `${({image: 'Фото', video: 'Видео', audio: 'Аудио', document: 'Документ'})[block.type]} · ${file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} КБ` : `${(file.size / 1024 / 1024).toFixed(1)} МБ`}`;
        card.append(detail);
      } else {
        card.classList.add('richMissing');
        const warning = document.createElement('p');
        warning.textContent = 'Файл не сохранился. Добавьте его снова перед отправкой.';
        card.append(warning);
      }
      return card;
    }
    function render(restoreFocus = true) {
      if (destroyed) return;
      const hadFocus = container.contains(document.activeElement);
      const liveIds = new Set(blocks.map(block => block.id));
      for (const [id, node] of nodes) if (!liveIds.has(id)) { composing.delete(node); textListeners.get(node)?.(); node.remove(); nodes.delete(id); }
      container.classList.toggle('richHasMedia', blocks.some(block => block.type !== 'text'));
      composeBox?.classList.toggle('rich-has-media', blocks.some(block => block.type !== 'text'));
      let anchor = container.firstChild;
      blocks.forEach((block, index) => {
        let node = nodes.get(block.id);
        if (!node) {
          node = block.type === 'text' ? bindText(index === 0 ? input : document.createElement('textarea'), block) : mediaNode(block);
          nodes.set(block.id, node);
        }
        if (node !== anchor) container.insertBefore(node, anchor);
        anchor = node.nextSibling;
        if (block.type === 'text') sizeText(node);
      });
      revokeUnused();
      if (hadFocus && restoreFocus) focus();
      geometry();
    }
    function focus() {
      if (destroyed) return;
      const desired = {...selected};
      const target = nodes.get(selected.blockId) || input;
      if (target.tagName !== 'TEXTAREA') return;
      target.focus({preventScroll: true});
      target.setSelectionRange(Math.min(desired.start, target.value.length), Math.min(desired.end, target.value.length), desired.direction || 'none');
      remember(target);
      sizeText(target);
    }
    function blur() { if (container.contains(document.activeElement)) { remember(document.activeElement); document.activeElement.blur(); } }
    function restoreSelection(selection, focusNow = false) {
      if (!selection || !blocks.some(block => block.id === selection.blockId && block.type === 'text')) return;
      selected = {...selection};
      const target = nodes.get(selected.blockId);
      if (target) target.setSelectionRange(Math.min(selected.start || 0, target.value.length), Math.min(selected.end || 0, target.value.length), selected.direction || 'none');
      if (focusNow) focus();
    }
    function insert(media, insertion = selected) {
      readText();
      let index = blocks.findIndex(block => block.id === insertion.blockId && block.type === 'text');
      if (index < 0) index = blocks.findLastIndex(block => block.type === 'text');
      const before = blocks[index];
      const position = Math.max(0, Math.min(insertion.start, before.text.length));
      const after = textBlock(before.text.slice(position));
      before.text = before.text.slice(0, position);
      nodes.get(before.id).value = before.text;
      const inserted = media.flatMap((block, position) => position < media.length - 1 ? [block, textBlock()] : [block]);
      blocks.splice(index + 1, 0, ...inserted, after);
      selected = {blockId: after.id, start: 0, end: 0, direction: 'none'};
      render();
      focus();
      changed();
    }
    function removeBlock(id) {
      readText();
      const index = blocks.findIndex(block => block.id === id);
      if (index < 0 || blocks[index].type === 'text') return;
      const removed = blocks.splice(index, 1)[0];
      files.delete(removed.assetId);
      // Join adjacent text without dropping their line boundaries.
      const before = blocks[index - 1], after = blocks[index];
      if (before?.type === 'text' && after?.type === 'text') {
        const split = before.text.length;
        before.text += after.text;
        nodes.get(before.id).value = before.text;
        blocks.splice(index, 1);
        selected = {blockId: before.id, start: split, end: split, direction: 'none'};
      }
      render();
      changed();
    }
    async function addFiles(incoming) {
      const currentRevision = revision;
      capture();
      const insertion = {...selected};
      const accepted = [];
      let totalBytes = [...files.values()].reduce((sum, file) => sum + file.size, 0);
      for (const file of Array.from(incoming || [])) {
        if (!(file instanceof Blob)) { error('Этот файл не удалось открыть. Выберите его ещё раз.'); continue; }
        if (!file.size) { error('Пустой файл нельзя отправить.'); continue; }
        if ((file.name || '').length > 255) { error('Название файла слишком длинное. Сократите его до 255 символов.'); continue; }
        if (file.size > MAX_FILE_BYTES) { error('Размер одного файла — до 25 МБ.'); continue; }
        if (totalBytes + file.size > MAX_MESSAGE_BYTES) { error('В одном сообщении можно отправить до 100 МБ файлов.'); continue; }
        if (blocks.length + (accepted.length + 1) * 2 > MAX_BLOCKS) { error('В сообщении слишком много вставок. Отправьте часть отдельным сообщением.'); break; }
        if (acceptFile && await acceptFile(file) === false) continue;
        if (destroyed || revision !== currentRevision) return;
        const id = uid(), kind = kindFor(file);
        accepted.push({id, name: file.name || 'Файл', type: mimeFor(file), kind, size: file.size, lastModified: file.lastModified || Date.now(), file});
        totalBytes += file.size;
      }
      if (destroyed || revision !== currentRevision || !accepted.length) return;
      for (const file of accepted) files.set(file.id, file);
      insert(accepted.map(file => ({id: uid(), type: file.kind, assetId: file.id})), insertion);
    }
    function reset(snapshot = {}) {
      revision++;
      composing.clear();
      cancelRecording();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      for (const node of nodes.values()) if (node !== input) { textListeners.get(node)?.(); node.remove(); }
      nodes.clear();
      files = new Map((snapshot.files || []).map(file => [file.id, {...file}]));
      const recoveredRecording = Boolean(snapshot.recording || snapshot.blocks?.some(block => block.pending));
      blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks.filter(block => !block.pending && (block.type === 'text' || MEDIA_TYPES.has(block.type))).map(block => block.type === 'text' ? {id: block.id || uid(), type: 'text', text: String(block.text || '')} : {id: block.id || uid(), type: block.type, assetId: block.assetId}) : [textBlock(String(snapshot.text || '')), ...(snapshot.files || []).map(file => ({id: uid(), type: file.kind === 'photo' ? 'image' : MEDIA_TYPES.has(file.kind) ? file.kind : kindFor(file), assetId: file.id}))];
      if (blocks[0]?.type !== 'text') blocks.unshift(textBlock());
      if (blocks.at(-1)?.type !== 'text') blocks.push(textBlock());
      // IDs from a damaged/old draft may repeat; never let two blocks share a DOM node.
      const seen = new Set();
      for (const block of blocks) { if (seen.has(block.id)) block.id = uid(); seen.add(block.id); }
      const usedFiles = new Set(blocks.filter(block => block.type !== 'text').map(block => block.assetId));
      for (const id of files.keys()) if (!usedFiles.has(id)) files.delete(id);
      selected = {...(snapshot.selection || {}), blockId: blocks.some(block => block.type === 'text' && block.id === snapshot.selection?.blockId) ? snapshot.selection.blockId : blocks[0].id};
      selected.start = Math.max(0, Number(selected.start) || 0);
      selected.end = Math.max(selected.start, Number(selected.end) || selected.start);
      selected.direction ||= 'none';
      input.value = blocks[0].text;
      render(false);
      // Restoring a draft must not summon the keyboard.
      restoreSelection(selected);
      if (recoveredRecording) error('Незавершённая запись голоса прервалась. Текст и добавленные файлы восстановлены.');
    }

    const voiceButton = document.createElement('button');
    voiceButton.type = 'button';
    voiceButton.id = 'richVoice';
    voiceButton.className = 'cicon richVoice';
    voiceButton.setAttribute('aria-label', 'Записать голосовое сообщение');
    voiceButton.setAttribute('aria-pressed', 'false');
    const microphone = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    microphone.setAttribute('viewBox', '0 0 24 24');
    microphone.setAttribute('aria-hidden', 'true');
    const micPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    micPath.setAttribute('d', 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1M12 18v4m-4 0h8');
    microphone.append(micPath);
    const voiceStop = document.createElement('span');
    voiceStop.className = 'richVoiceStop';
    voiceStop.setAttribute('aria-hidden', 'true');
    voiceStop.hidden = true;
    voiceButton.append(microphone, voiceStop);
    function paintVoice() {
      const active = Boolean(recording || requesting);
      voiceButton.classList.toggle('is-recording', active);
      voiceButton.setAttribute('aria-pressed', String(active));
      voiceButton.setAttribute('aria-label', requesting ? 'Отменить включение микрофона' : recording ? 'Остановить запись голоса' : 'Записать голосовое сообщение');
      voiceButton.title = voiceButton.getAttribute('aria-label');
      microphone.hidden = active;
      voiceStop.hidden = !active;
    }
    function releaseRecording(rec) {
      clearInterval(rec.timer);
      for (const [track, ended, muted] of rec.listeners) {
        track.removeEventListener('ended', ended);
        track.removeEventListener('mute', muted);
      }
      rec.stream.getTracks().forEach(track => track.stop());
    }
    function cancelRecording() {
      permissionEpoch++;
      requesting = false;
      const rec = recording;
      if (rec) {
        rec.cancelled = true;
        recording = null;
        releaseRecording(rec);
        if (rec.recorder.state !== 'inactive') { try { rec.recorder.stop(); } catch (_) {} }
        rec.resolve(capture());
      }
      paintVoice();
    }
    async function startRecording() {
      if (recording || requesting || destroyed) return;
      if (blocks.length + 2 > MAX_BLOCKS) { error('В сообщении слишком много вставок. Отправьте часть отдельным сообщением.'); return; }
      if (!navigator.mediaDevices?.getUserMedia || typeof global.MediaRecorder !== 'function') {
        error('Этот браузер не поддерживает запись голоса. Откройте Pablicus в Safari или Chrome.');
        return;
      }
      requesting = true;
      const epoch = ++permissionEpoch;
      paintVoice();
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});
        if (destroyed || epoch !== permissionEpoch) { stream.getTracks().forEach(track => track.stop()); return; }
        const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => global.MediaRecorder.isTypeSupported(type));
        const recorder = new global.MediaRecorder(stream, mimeType ? {mimeType} : undefined);
        const assetId = uid();
        const rec = {recorder, stream, assetId, blockId: uid(), startedAt: Date.now(), chunks: [], bytes: 0, listeners: [], cancelled: false, ending: false, timer: null};
        rec.finished = new Promise((resolve, reject) => { rec.resolve = resolve; rec.reject = reject; });
        // A microphone can stop without a user calling stopRecording().
        rec.finished.catch(() => {});
        recording = rec;
        requesting = false;
        recorder.addEventListener('dataavailable', event => {
          if (rec.cancelled || !event.data?.size) return;
          rec.chunks.push(event.data);
          rec.bytes += event.data.size;
          if (rec.bytes >= MAX_FILE_BYTES && !rec.ending) {
            error('Запись остановлена: достигнут предел 25 МБ.');
            stopRecording().catch(() => {});
          }
        });
        recorder.addEventListener('error', () => {
          error('Запись голоса прервалась. Проверьте сохранённую запись перед отправкой.');
          if (recorder.state !== 'inactive') stopRecording().catch(() => {});
        });
        recorder.addEventListener('stop', () => {
          releaseRecording(rec);
          if (rec.cancelled || destroyed) return;
          recording = null;
          const type = recorder.mimeType || rec.chunks[0]?.type || 'audio/webm';
          const blob = new Blob(rec.chunks, {type});
          const block = blocks.find(item => item.id === rec.blockId);
          const totalBytes = [...files.values()].reduce((sum, file) => sum + file.size, 0);
          if (!block || !blob.size || blob.size > MAX_FILE_BYTES || totalBytes + blob.size > MAX_MESSAGE_BYTES) {
            if (block) removeBlock(block.id);
            paintVoice();
            const failure = Error(totalBytes + blob.size > MAX_MESSAGE_BYTES ? 'С голосовым получается больше 100 МБ. Уберите часть файлов и запишите голосовое ещё раз.' : blob.size > MAX_FILE_BYTES ? 'Голосовое больше 25 МБ. Запишите более короткое сообщение.' : 'Не удалось сохранить звук. Запишите голосовое ещё раз.');
            error(failure.message);
            rec.reject(failure);
            return;
          }
          const extension = /mp4|m4a/i.test(type) ? 'm4a' : /ogg/i.test(type) ? 'ogg' : 'webm';
          const name = `Голосовое ${new Date(rec.startedAt).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}.${extension}`;
          const file = new File([blob], name, {type, lastModified: Date.now()});
          files.set(assetId, {id: assetId, name, type: mimeFor(file), kind: 'audio', size: file.size, lastModified: file.lastModified, file});
          delete block.pending;
          nodes.get(block.id)?.remove();
          nodes.delete(block.id);
          paintVoice();
          render();
          changed();
          rec.resolve(capture());
        }, {once: true});
        for (const track of stream.getAudioTracks()) {
          const interrupted = () => {
            if (recording !== rec || rec.ending || rec.cancelled) return;
            error('Микрофон прервался. Запись остановлена; текст и файлы остаются в сообщении.');
            stopRecording().catch(() => {});
          };
          track.addEventListener('ended', interrupted);
          track.addEventListener('mute', interrupted);
          rec.listeners.push([track, interrupted, interrupted]);
        }
        recorder.start(1000);
        insert([{id: rec.blockId, type: 'audio', assetId, pending: true}]);
        rec.timer = setInterval(() => {
          const timer = nodes.get(rec.blockId)?.querySelector('.richRecordingTime');
          const seconds = Math.floor((Date.now() - rec.startedAt) / 1000);
          if (timer) timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        }, 500);
        paintVoice();
      } catch (failure) {
        stream?.getTracks().forEach(track => track.stop());
        if (epoch !== permissionEpoch || destroyed) return;
        requesting = false;
        if (recording) cancelRecording();
        paintVoice();
        error(failure.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в настройках браузера, чтобы записать голосовое.' : failure.name === 'NotFoundError' ? 'Микрофон не найден. Можно продолжить сообщение текстом и файлами.' : 'Не удалось включить микрофон. Попробуйте записать ещё раз.');
      }
    }
    async function stopRecording() {
      if (requesting) { permissionEpoch++; requesting = false; paintVoice(); return capture(); }
      const rec = recording;
      if (!rec) return capture();
      if (!rec.ending) {
        rec.ending = true;
        if (rec.recorder.state !== 'inactive') rec.recorder.stop();
      }
      return rec.finished;
    }
    listen(voiceButton, 'click', () => (recording || requesting ? stopRecording() : startRecording()).catch(failure => error(failure.message)));
    // Remember the cursor before the host opens a menu or a system file picker.
    listen(container, 'focusout', event => remember(event.target));
    if (typeof ResizeObserver === 'function') {
      let previousWidth = 0;
      resizeObserver = new ResizeObserver(entries => {
        const width = Math.round(entries[0].contentRect.width);
        if (width === previousWidth) return;
        previousWidth = width;
        for (const block of blocks) if (block.type === 'text') sizeText(nodes.get(block.id));
        geometry();
      });
      resizeObserver.observe(container);
    }
    render();
    paintVoice();
    return {
      capture, restore: reset, clear() { reset(); changed(); }, addFiles, focus, blur, voiceButton,
      startRecording, stopRecording, restoreSelection,
      get selection() { return {...selected}; },
      get composing() { return composing.size > 0; },
      get recording() { return Boolean(recording || requesting); },
      get height() { return Math.ceil([...nodes.values()].reduce((sum, node) => sum + node.getBoundingClientRect().height + (node.tagName === 'TEXTAREA' ? 0 : 8), 0)) + (container.classList.contains('richHasMedia') ? 6 : 0); },
      destroy() {
        if (destroyed) return;
        cancelRecording();
        destroyed = true;
        revision++;
        cleanups.forEach(cleanup => cleanup());
        for (const remove of [...textListeners.values()]) remove();
        resizeObserver?.disconnect();
        cancelAnimationFrame(geometryFrame);
        for (const url of urls.values()) URL.revokeObjectURL(url);
        urls.clear();
        for (const node of nodes.values()) if (node !== input) node.remove();
        nodes.clear();
        composing.clear();
        input.classList.remove('richText');
        delete input.dataset.richBlock;
        if (originalLabel) input.setAttribute('aria-label', originalLabel);
        container.classList.remove('richEditor', 'richHasMedia');
        composeBox?.classList.remove('rich-composer', 'rich-has-media');
        voiceButton.remove();
      },
    };
  }
  global.PablicusRichComposer = {create, kindFor, mimeFor, MAX_FILE_BYTES};
})(typeof window === 'undefined' ? globalThis : window);
