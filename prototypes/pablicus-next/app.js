import { createEdgePicker } from '../../library/pablicus-ui/edge-picker.js';

const KEY = 'pablicus:next:prototype:v1';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const paths = {
  chats:'M4 4h16v12H9l-5 4V4Z', tasks:'m3 6 2 2 4-4m-6 12 2 2 4-4M12 6h9M12 16h9',
  bots:'M8 4h8l4 4v8l-4 4H8l-4-4V8l4-4ZM9 10v4m6-4v4',
  you:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  edit:'m5 19 1-5L17 3l4 4-11 11-5 1Z', material:'M6 3h9l4 4v14H6V3Zm8 0v6h5M9 13h7M9 17h5'
};
const icon = key => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[key]}"></path></svg>`;
const rooms = [
  { id:'launch', title:'Запуск проекта', mark:'З', preview:'Обсуждение, материалы и общие дела', topic:'Рабочая группа' },
  { id:'ideas', title:'Идеи на будущее', mark:'И', preview:'Место для того, что хочется сделать', topic:'Личные заметки' },
  { id:'saved', title:'Избранное', mark:'↗', preview:'Важное всегда под рукой', topic:'Только для вас' }
];
const views = [{id:'talk',label:'Разговор'},{id:'materials',label:'Материалы'},{id:'tasks',label:'Дела'}];
const defaults = () => ({ version:1, name:'Участник', theme:'light', edge:'right', drafts:{},
  messages:{ launch:[{text:'Давайте соберём в одном месте обсуждение и всё, что нужно для запуска.',mine:false},{text:'Начнём с самого важного. Материалы и дела — в переключателе справа.',mine:true}], ideas:[], saved:[] },
  tasks:[{id:'first',text:'Собрать материалы для запуска',done:false,room:'launch'},{id:'second',text:'Обсудить следующий шаг',done:false,room:'launch'}], taskDraft:'' });
let state = defaults(), storageError = false;
try {
  const raw = localStorage.getItem(KEY), data = raw && JSON.parse(raw);
  if (data?.version === 1 && rooms.every(r => Array.isArray(data.messages?.[r.id]) && data.messages[r.id].every(m=>typeof m.text==='string' && typeof m.mine==='boolean')) &&
      Array.isArray(data.tasks) && data.tasks.every(t=>typeof t.id==='string' && typeof t.text==='string' && typeof t.done==='boolean') && data.drafts && typeof data.drafts==='object') {
    state = { ...state, ...data, name: typeof data.name==='string' ? data.name : state.name,
      theme:data.theme==='dark'?'dark':'light', edge:data.edge==='left'?'left':'right', taskDraft:typeof data.taskDraft==='string'?data.taskDraft:'' };
  } else if (raw) storageError = true;
} catch { storageError = true; }
let picker = null, statusTimer;
function announce(message) { clearTimeout(statusTimer); $('#status').textContent=message; statusTimer=setTimeout(()=>$('#status').textContent='',4500); }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch { announce('Не удалось сохранить в браузере. Оставьте эту вкладку открытой.'); return false; }
}
function route() {
  const [tab='chats', room, view='talk'] = location.hash.slice(1).split('/');
  return { tab:['chats','tasks','bots','you'].includes(tab)?tab:'chats', room:rooms.find(r=>r.id===room), view:views.some(v=>v.id===view)?view:'talk' };
}
function shell(title, subtitle, content, eyebrow='Ваше пространство') {
  return `<section class="screen"><header class="page-head"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="muted">${subtitle}</p></header><div class="scroll"><div class="content">${content}</div></div></section>`;
}
function renderNav(tab) {
  $('#primary-nav').innerHTML = [['chats','Чаты'],['tasks','Дела'],['bots','Боты'],['you','Вы']].map(([id,label])=>
    `<a href="#${id}" ${tab===id?'aria-current="page"':''}>${icon(id)}<span>${label}</span></a>`).join('');
}
function chatList() {
  $('#workspace').innerHTML=shell('Ближе к важному','Люди, идеи и разговоры — в одном месте.',
    `<label class="search-label" for="search">Найти разговор</label><input class="search" id="search" type="search" placeholder="Название или сообщение" autocomplete="off"><div class="section-label"><span>Ваши разговоры</span><span>03</span></div><div class="chat-list" id="chat-list"></div>`,'Чаты');
  const show = () => {
    const query = $('#search').value.trim().toLocaleLowerCase('ru');
    const found = rooms.filter(r=>`${r.title} ${r.preview} ${state.messages[r.id].map(m=>m.text).join(' ')}`.toLocaleLowerCase('ru').includes(query));
    $('#chat-list').innerHTML=found.map(r=>{
      const last=state.messages[r.id].at(-1)?.text || r.preview;
      return `<button class="chat-row" data-room="${r.id}"><span class="avatar">${r.mark}</span><span class="row-copy"><strong>${r.title}</strong><small>${esc(last)}</small></span><span class="arrow" aria-hidden="true">↗</span></button>`;
    }).join('') || '<p class="empty">Ничего не найдено. Попробуйте другое слово.</p>';
  };
  $('#search').addEventListener('input',show);
  $('#chat-list').addEventListener('click',e=>{const id=e.target.closest('[data-room]')?.dataset.room; if(id) location.hash=`chats/${id}/talk`;}); show();
}
function taskMarkup(room) {
  const list=state.tasks.filter(t=>!room || t.room===room);
  return `<form class="task-form" id="task-form"><label for="task-title">Что нужно сделать?</label><div class="form-row"><input id="task-title" name="task" maxlength="240" required placeholder="Одно конкретное дело" value="${esc(state.taskDraft)}"><button class="pb-primary" type="submit">Добавить дело</button></div></form><div id="task-list">${list.map(t=>`<label class="task-row"><input type="checkbox" data-task="${esc(t.id)}" ${t.done?'checked':''}><span>${esc(t.text)}</span></label>`).join('')||'<p class="empty">Пока всё спокойно. Добавьте первое дело.</p>'}</div>`;
}
function wireTasks(room) {
  $('#task-title').addEventListener('input',e=>{state.taskDraft=e.target.value;save();});
  $('#task-form').addEventListener('submit',e=>{
    e.preventDefault(); const text=$('#task-title').value.trim(); if(!text) return;
    state.tasks.push({id:crypto.randomUUID(),text,done:false,room:room||null});state.taskDraft='';save();render(false);$('#task-title').focus();
  });
  $('#task-list').addEventListener('change',e=>{
    const t=state.tasks.find(t=>t.id===e.target.dataset.task); if(t){t.done=e.target.checked;save();}
  });
}
function conversation(r, view) {
  $('#workspace').innerHTML=`<section class="screen conversation"><header class="page-head"><button class="back" id="back" aria-label="К списку чатов">←</button><div><h1>${r.title}</h1><div class="view-name">${r.topic} · <span id="view-label">${views.find(v=>v.id===view).label}</span></div></div></header><div class="scroll" id="conversation-scroll"><div class="content" id="view-body"></div></div><form class="composer" id="composer"><div><label for="message">${r.id==='saved'?'Заметка для себя':'Сообщение'}</label><textarea id="message" name="message" rows="2" maxlength="10000" placeholder="Напишите здесь…"></textarea></div><button type="submit" class="pb-primary" id="send" aria-label="${r.id==='saved'?'Сохранить заметку':'Добавить сообщение'}">↑</button></form></section>`;
  $('#back').addEventListener('click',()=>location.hash='chats');
  picker=createEdgePicker({host:$('#workspace'),bounds:$('#conversation-scroll'),items:views,selected:view,edge:state.edge,onSelect:id=>{
    history.pushState(null,'',`#chats/${r.id}/${id}`); showView(id);
  }});
  function showView(id) {
    picker.select(id); $('#view-label').textContent=views.find(v=>v.id===id).label;
    const body=$('#view-body'); $('#composer').hidden = id!=='talk';
    // Three stable grid rows: explicit zero footer on non-message views.
    if(id==='talk') {
      body.innerHTML = `<div class="messages">${state.messages[r.id].map(m=>`<div class="message ${m.mine?'mine':''}"><small>${m.mine?'Вы':'Команда'}</small>${esc(m.text)}</div>`).join('')||'<p class="empty">Здесь можно начать с одной мысли.</p>'}</div>`;
    } else if(id==='materials') {
      body.innerHTML='<div class="soft-card"><div class="eyebrow">Материалы разговора</div><h2>Всё важное — рядом</h2><p>Здесь будут документы и результаты, связанные с этим разговором.</p></div><p class="muted">В этой версии проверяем переключение представлений. Загрузка файлов появится после подключения данных.</p>';
    } else { body.innerHTML=taskMarkup(r.id);wireTasks(r.id); }
    $('#conversation-scroll').scrollTop=0;
  }
  const input=$('#message'); input.value=typeof state.drafts[r.id]==='string'?state.drafts[r.id]:'';
  $('#send').disabled=!input.value.trim();
  input.addEventListener('input',()=>{state.drafts[r.id]=input.value;save();$('#send').disabled=!input.value.trim();});
  $('#composer').addEventListener('submit',e=>{
    e.preventDefault(); const text=input.value.trim(); if(!text) return;
    state.messages[r.id].push({text,mine:true}); state.drafts[r.id]='';input.value='';$('#send').disabled=true;
    save(); showView('talk'); $('#conversation-scroll').scrollTop=$('#conversation-scroll').scrollHeight;
    input.focus({preventScroll:true});
  });
  // Enter remains native multiline input; no autosize, contenteditable or viewport scrolling.
  showView(view);
}
const bots=[
  {id:'editor',name:'Редактор',icon:'edit',text:'Помогает превратить мысль в понятный текст.',detail:'Будет работать с выбранным текстом: предложит правки и сохранит оригинал. Применение изменений — отдельное действие.'},
  {id:'organizer',name:'Организатор',icon:'tasks',text:'Помогает увидеть следующий шаг и собрать план.',detail:'Будет превращать выбранный контекст в предложение дел. Просмотр предложения не создаёт задачи без вашего действия.'}
];
function render(focus=true) {
  picker?.destroy();picker=null;
  document.documentElement.dataset.theme=state.theme;
  const {tab,room,view}=route();renderNav(tab);
  if(tab==='chats') room?conversation(room,view):chatList();
  if(tab==='tasks') { $('#workspace').innerHTML=shell('Шаг за шагом','Небольшие дела, из которых складывается результат.',taskMarkup(),'Дела');wireTasks(); }
  if(tab==='bots') {
    $('#workspace').innerHTML=shell('Помощники рядом','У каждого — понятная роль. Вы выбираете контекст.',`<div class="bot-grid">${bots.map(b=>`<article class="bot-card"><div class="bot-icon">${icon(b.icon)}</div><h2>${b.name}</h2><p>${b.text}</p><button data-bot="${b.id}">О помощнике</button></article>`).join('')}</div><p class="muted" style="margin-top:24px;font-size:13px">В прототипе доступны описания. Подключение ИИ — следующий этап.</p>`,'Боты');
    document.querySelectorAll('[data-bot]').forEach(b=>b.addEventListener('click',()=>{
      const bot=bots.find(x=>x.id===b.dataset.bot);$('#details-body').innerHTML=`<div class="eyebrow">Помощник</div><h2>${bot.name}</h2><p>${bot.detail}</p><p class="muted">Этот просмотр не запускает ИИ и не передаёт данные.</p>`;$('#details').showModal();
    }));
  }
  if(tab==='you') {
    $('#workspace').innerHTML=shell('На вашей стороне','Настройте пространство под себя.',`<div class="settings"><div><label for="profile-name">Как к вам обращаться</label><input id="profile-name" maxlength="60" value="${esc(state.name)}"></div><div><label for="theme">Оформление</label><select id="theme"><option value="light">Светлое</option><option value="dark">Тёмное</option></select></div><div><label for="edge">Переключатель представлений</label><select id="edge"><option value="right">Справа</option><option value="left">Слева</option></select></div><p class="muted">Изменения и примеры сохраняются в этом браузере. Ваше установленное приложение и его данные остаются в своём пространстве.</p></div>`,'Вы');
    $('#theme').value=state.theme;$('#edge').value=state.edge;
    $('#profile-name').addEventListener('input',e=>{state.name=e.target.value;save();});
    $('#theme').addEventListener('change',e=>{state.theme=e.target.value;document.documentElement.dataset.theme=state.theme;save();});
    $('#edge').addEventListener('change',e=>{state.edge=e.target.value;save();});
  }
  if(focus) $('#workspace').focus({preventScroll:true});
}
function fitViewport() {
  const v=window.visualViewport;
  // Ignore pinch zoom: preserve the user's zoom and native panning.
  if(v && Math.abs(v.scale-1)>.01) return;
  document.documentElement.style.setProperty('--visible-height',`${v?.height||innerHeight}px`);
  document.documentElement.style.setProperty('--visible-top',`${v?.offsetTop||0}px`);
}
window.visualViewport?.addEventListener('resize',fitViewport);
window.visualViewport?.addEventListener('scroll',fitViewport);
window.addEventListener('resize',fitViewport);
window.addEventListener('hashchange',()=>render());
fitViewport();render(false);
if(storageError) announce('Сохранённые примеры не удалось прочитать. Открыта новая демонстрация.');
