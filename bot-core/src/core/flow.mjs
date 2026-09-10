import {assert, object, text, identifier, integer} from './errors.mjs';
const TYPES = new Set(['say','ask','choice','save','end']);
const SAFE_KEYS = new Set(['__proto__','prototype','constructor']);

/** Validate a declarative graph. No expressions, arbitrary code, regex or URLs execute. */
export function validateFlow(input) {
  assert(object(input), 'INVALID_FLOW', 'Сценарий должен быть JSON-объектом.');
  assert(new TextEncoder().encode(JSON.stringify(input)).length <= 65536, 'INVALID_FLOW', 'Сценарий превышает 64 КиБ.');
  assert(input.version === 1, 'INVALID_FLOW', 'Поддерживается версия сценария 1.');
  identifier(input.start, 'Начальный шаг');
  assert(object(input.nodes), 'INVALID_FLOW', 'Нужен объект nodes.');
  const keys = Object.keys(input.nodes);
  assert(keys.length > 0 && keys.length <= 64, 'INVALID_FLOW', 'Допустимо 1–64 шага.');
  const clean = {version:1, start:input.start, nodes:{}};
  for (const id of keys) {
    identifier(id, 'Имя шага');
    const n = input.nodes[id];
    assert(object(n) && TYPES.has(n.type), 'INVALID_FLOW', `Неизвестный тип шага ${id}.`);
    const c = {type:n.type};
    if (['say','ask','choice','end'].includes(n.type)) c.text = text(n.text, `Текст ${id}`, 4000);
    if (['say','ask','save'].includes(n.type)) c.next = identifier(n.next, 'Следующий шаг');
    if (['ask','choice'].includes(n.type)) c.field = identifier(n.field, 'Поле');
    if (n.type === 'ask') {
      c.validation = n.validation || 'text';
      assert(['text','email','phone'].includes(c.validation), 'INVALID_FLOW', 'Неизвестная проверка ответа.');
      c.min = integer(n.min ?? 1, 'Минимальная длина', 1, 1000);
      c.max = integer(n.max ?? 500, 'Максимальная длина', c.min, 1000);
    }
    if (n.type === 'choice') {
      assert(Array.isArray(n.options) && n.options.length >= 1 && n.options.length <= 12, 'INVALID_FLOW', 'Нужно 1–12 вариантов ответа.');
      const used = new Set();
      c.options = n.options.map(o => {
        assert(object(o), 'INVALID_FLOW', 'Неверный вариант ответа.');
        const out = {id:identifier(o.id), label:text(o.label, 'Вариант', 120), next:identifier(o.next)};
        assert(!used.has(out.id.toLowerCase()) && !used.has(out.label.toLowerCase()), 'INVALID_FLOW', 'Варианты ответа неоднозначны.');
        used.add(out.id.toLowerCase()); used.add(out.label.toLowerCase());
        return out;
      });
    }
    if (n.type === 'save') c.kind = identifier(n.kind || 'request', 'Тип результата');
    clean.nodes[id] = c;
  }
  assert(Object.hasOwn(clean.nodes, clean.start), 'INVALID_FLOW', 'Начальный шаг не существует.');
  const next = id => {
    const n = clean.nodes[id];
    return n.type === 'choice' ? n.options.map(o => o.next) : n.next ? [n.next] : [];
  };
  for (const id of keys) for (const dest of next(id)) assert(Object.hasOwn(clean.nodes,dest), 'INVALID_FLOW', `${id}: отсутствует шаг ${dest}.`);
  const reached = new Set();
  function walk(id) { if (reached.has(id)) return; reached.add(id); next(id).forEach(walk); }
  walk(clean.start);
  assert(reached.size === keys.length, 'INVALID_FLOW', 'В сценарии есть недостижимые шаги.');
  // Automatic cycles can consume CPU without another human event.
  for (const start of keys) {
    const path = new Set(); let id = start;
    while (['say','save'].includes(clean.nodes[id]?.type)) {
      assert(!path.has(id), 'INVALID_FLOW', 'Обнаружен автоматический цикл.');
      path.add(id); assert(path.size < 32,'INVALID_FLOW','Слишком длинная автоматическая цепочка.');
      id = clean.nodes[id].next;
    }
  }
  return clean;
}

function render(template, data) {
  return template.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_, key) => SAFE_KEYS.has(key) ? '' : String(Object.hasOwn(data,key) ? data[key] : '')).slice(0,8000);
}
function prompt(n, data) {
  const answer = {text:render(n.text,data)};
  if (n.type === 'choice') answer.buttons = n.options.map(o => ({id:o.id,label:o.label}));
  return answer;
}
function validAnswer(n, value) {
  if (value.length < n.min || value.length > n.max) return false;
  if (n.validation === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (n.validation === 'phone') return /^\+?[0-9 ()-]{7,25}$/.test(value) && value.replace(/\D/g,'').length >= 7;
  return true;
}

/** Pure deterministic transition. Effects are data; persistence commits them atomically. */
export function advance(flow, previous, input) {
  let state = structuredClone(previous || {node:flow.start,data:{},done:false,started:false});
  const replies = [], records = [];
  const command = input.text.trim();
  if (command === '/start' || command === '/reset') state = {node:flow.start,data:{},done:false,started:false};
  if (!state.started) state.started = true;
  else if (command === '/cancel') {
    state.done = true; state.data = {};
    return {state,replies:[{text:'Диалог отменён. Для нового диалога отправьте /start.'}],records};
  } else if (state.done) return {state,replies:[{text:'Диалог завершён. Для нового запроса отправьте /start.'}],records};
  else {
    const n = flow.nodes[state.node];
    assert(n && ['ask','choice'].includes(n.type),'STATE_INVALID','Состояние сценария повреждено.',500);
    if (n.type === 'ask') {
      if (!validAnswer(n,command)) return {state,replies:[{text:`Проверьте ответ: ${n.validation === 'email' ? 'нужен адрес почты' : n.validation === 'phone' ? 'нужен номер телефона' : `от ${n.min} до ${n.max} символов`}.`},prompt(n,state.data)],records};
      state.data[n.field] = command; state.node = n.next;
    } else {
      const value = command.toLowerCase();
      const chosen = n.options.find(o => o.id.toLowerCase() === value || o.label.toLowerCase() === value);
      if (!chosen) return {state,replies:[{text:'Выберите один из предложенных вариантов.'},prompt(n,state.data)],records};
      state.data[n.field] = chosen.label; state.node = chosen.next;
    }
  }
  for (let steps = 0; steps < 32; steps++) {
    const n = flow.nodes[state.node];
    assert(n, 'STATE_INVALID','Шаг не найден.',500);
    if (n.type === 'save') records.push({kind:n.kind,data:structuredClone(state.data)});
    else replies.push(prompt(n,state.data));
    if (n.type === 'end') {state.done = true; return {state,replies,records};}
    if (['ask','choice'].includes(n.type)) return {state,replies,records};
    state.node = n.next;
  }
  throw new Error('Transition step budget exceeded');
}
