/* Public Bots UI. All untrusted text is rendered as text, not HTML. */
(function(root){'use strict';
 const {BotClient,PendingStore,BotError}=root.PublicBotTransport;
 const element=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const button=(label,fn,cls='')=>{const b=element('button',cls,label);b.type='button';b.onclick=fn;return b;};
 const date=s=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';};
 function create({auth,getContext,baseUrl,apiKey,cssUrl='bots-panel.css',beforeOpen=async()=>{},notify=()=>{},fetcher=fetch,pendingStore=new PendingStore()}){
  const api=new BotClient({auth,getContext,baseUrl,apiKey,fetcher});
  const dialog=element('dialog');dialog.id='publicBotsDialog';dialog.setAttribute('aria-label','Боты Public');
  dialog.style.cssText='padding:0;border:0;border-radius:22px;width:min(1050px,calc(100vw - 16px));max-width:none;height:calc(100dvh - 24px);max-height:none;overflow:hidden;background:transparent;';
  const mount=element('div');mount.style.height='100%';dialog.append(mount);const shadow=mount.attachShadow({mode:'open'}),style=element('link');style.rel='stylesheet';style.href=cssUrl;shadow.append(style);
  function syncTheme(){const theme=document.documentElement.dataset.theme;mount.dataset.theme=theme==='dark'||theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}syncTheme();new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});matchMedia('(prefers-color-scheme:dark)').addEventListener('change',syncTheme);
  const shell=element('section','shell'),head=element('header','head'),title=element('div','head-title'),back=button('‹ К чатам',()=>close(),'back'),closeB=button('Закрыть',()=>close(),'quiet');closeB.setAttribute('aria-label','Закрыть раздел ботов');
  title.append(element('span','eyebrow','PUBLIC / БОТЫ'),element('h1','','Мои боты'));head.append(back,title,closeB);
  const alert=element('p','notice');alert.setAttribute('role','status');alert.setAttribute('aria-live','polite');alert.hidden=true;
  const body=element('main','body');shell.append(head,alert,body);shadow.append(shell);document.body.append(dialog);
  let owner=null,epoch=0,busy=false,view='list',bot=null,chat=null,pending=null,templates=[],myBots=[],listed=[],catalog=false,events=[],dirty=false,draft='',drafts=new Map(),controlRefs={},returnFocus=null;
  let createAttempt=null; // A lost create response is not retried automatically (server creates UUID).
  const current=e=>dialog.open&&owner&&getContext()?.id===owner&&getContext()?.approved&&epoch===e;
  const guard=e=>{if(!current(e))throw new BotError('ACCOUNT_CHANGED','Аккаунт изменился.');};
  function say(message,bad=false){alert.hidden=!message;alert.textContent=message||'';alert.className=bad?'notice bad':'notice';}
  function heading(name,backText,go){title.querySelector('h1').textContent=name;back.textContent=backText;back.onclick=go;}
  function sync(){
   for(const b of body.querySelectorAll('button,input,textarea,select'))b.disabled=busy||b.dataset.locked==='true';
   const stopped=bot?.status==='stopped';
   if(controlRefs.message){controlRefs.message.disabled=busy||!!pending||stopped;controlRefs.send.disabled=busy||stopped;controlRefs.send.textContent=pending?'Повторить':'Отправить';}
   for(const b of body.querySelectorAll('.choices button'))b.disabled=busy||!!pending||stopped;
   shell.setAttribute('aria-busy',String(busy));
  }
  async function job(work){if(busy)return;const e=epoch;busy=true;sync();say('');try{await work(e);}catch(error){if(current(e)){
    if(error.code==='ACCOUNT_CHANGED'){reset();notify('Аккаунт изменился.');}
    else if(error.code==='SESSION_REQUIRED'){say(error.message,true);const go=button('Закрыть и проверить вход',()=>close(),'quiet');alert.append(document.createTextNode(' '),go);}
    else say(error.message||'Не удалось выполнить действие. Повторите проверку.',true);
   }}finally{if(epoch===e){busy=false;sync();}}}
  function saveDraft(){if(chat&&controlRefs.message){draft=controlRefs.message.value;drafts.set(owner+'/'+chat.id,draft);}}
  function navigable(){saveDraft();return !dirty||confirm('В настройках есть несохранённые изменения. Выйти без сохранения?');}
  function reset(){epoch++;api.reset();owner=null;busy=false;dirty=false;bot=chat=pending=null;events=[];controlRefs={};myBots=[];listed=[];templates=[];drafts.clear();body.replaceChildren();say('');if(dialog.open)dialog.close();}
  function close(){if(!navigable())return;saveDraft();epoch++;api.reset();busy=false;dirty=false;body.replaceChildren();controlRefs={};if(dialog.open)dialog.close();returnFocus?.focus?.();}
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  function prepare(name,backText='‹ Боты',go=()=>showList()){view=name;controlRefs={};body.replaceChildren();heading(name==='chat'?bot.name:name==='edit'?'Настройки бота':name==='create'?'Создать бота':name==='records'?'Заявки':'Мои боты',backText,go);}
  async function open(){
   if(dialog.open)return;if(!getContext()?.approved){notify('Сначала войдите в Public.');return;}
   await beforeOpen();if(!getContext()?.approved)return;
   returnFocus=document.activeElement;owner=getContext().id;epoch++;api.reset();dialog.showModal();prepare('list','‹ К чатам',()=>close());
   await job(async e=>{await api.me();guard(e);await listData(e);guard(e);renderList();});
  }
  async function listData(e){const [mine,t]=await Promise.all([api.bots(),api.templates()]);guard(e);myBots=mine.bots||[];templates=t.templates||[];listed=catalog?(await api.catalog()).bots||[]:myBots;guard(e);}
  function renderList(){
   prepare('list','‹ К чатам',()=>close());const toolbar=element('div','toolbar'),tabs=element('div','tabs');
   tabs.append(button('Мои боты',()=>switchCatalog(false),catalog?'':'selected'),button('Каталог',()=>switchCatalog(true),catalog?'selected':''));
   const create=button('+ Создать бота',()=>edit(null),'primary');create.id='botCreate';toolbar.append(tabs,create);body.append(toolbar,element('p','caption',catalog?'Общедоступные боты для пользователей Public. Ваши личные диалоги не становятся общими.':'Боты работают по заданным сценариям. ИИ, календарь и внешние рассылки здесь не подключены.'));
   const grid=element('div','cards');
   if(!listed.length)grid.append(element('div','empty',catalog?'В каталоге пока нет активных ботов.':'Пока нет ботов. Создайте первого — он появится здесь.'));
   for(const item of listed){
    const card=element('article','card'),avatar=element('span','bot-avatar','◈'),name=button(item.name,()=>openBot(item),'card-name'),top=element('div','card-top');top.append(avatar,name);card.append(top);
    card.append(element('p','description',item.description||'Сценарный помощник'),element('span','badge',item.status==='active'?'Работает':'Остановлен'),element('span','caption',' · '+(item.visibility==='public'?'В каталоге':'Только владелец')));
    const actions=element('div','actions');actions.append(button('Открыть чат',()=>openBot(item),'primary soft'));
    if(myBots.some(b=>b.id===item.id))actions.append(button('Настроить',()=>edit(item),'quiet'),button('Заявки',()=>records(item),'quiet'));
    card.append(actions);grid.append(card);
   }
   body.append(grid,button('Обновить список',()=>showList(),'quiet'));if(createAttempt)body.append(button('Разрешить новую попытку создания',()=>{if(confirm('Проверьте список: предыдущий бот мог сохраниться. Всё равно начать новую попытку?')){createAttempt=null;edit(null);}},'quiet'));sync();
  }
  async function switchCatalog(value){if(busy)return;catalog=value;await showList();}
  async function showList(){if(busy||!navigable())return;saveDraft();dirty=false;await job(async e=>{await listData(e);guard(e);bot=chat=pending=null;renderList();});}
  function field(parent,label,value,{multiline=false,max=500,required=false}={}){const l=element('label','field',label),input=element(multiline?'textarea':'input');input.value=value||'';input.maxLength=max;input.required=required;if(!multiline)input.type='text';l.append(input);parent.append(l);input.oninput=()=>{dirty=true;};return input;}
  async function edit(item){if(busy||!navigable())return;saveDraft();await job(async e=>{bot=item?await api.get(item.id):null;guard(e);renderEdit();});}
  function renderEdit(){
   prepare(bot?'edit':'create');dirty=false;const form=element('form','editor');form.id='botSettings';
   const name=field(form,'Название',bot?.name,{max:80,required:true}),description=field(form,'Описание',bot?.description,{multiline:true,max:500});
   name.id='botName';description.id='botDescription';
   let select=null,visibility=null,textFields=[];
   if(!bot){
    const l=element('label','field','Сценарий');select=element('select');select.id='botTemplate';
    for(const t of templates){const o=element('option','',t.name);o.value=t.id;select.append(o);}select.onchange=()=>{dirty=true;};l.append(select);form.append(l);
    form.append(element('p','caption','Новый бот создаётся закрытым. После создания можно изменить тексты и включить его в каталог.'));
   }else{
    const l=element('label','field','Доступ');visibility=element('select');visibility.id='botVisibility';
    for(const [value,label]of [['private','Только я'],['public','В каталоге Public']]){const o=element('option','',label);o.value=value;visibility.append(o);}visibility.value=bot.visibility;visibility.onchange=()=>{dirty=true;};l.append(visibility);form.append(l);
    form.append(element('p','caption','Каталог открывает бота другим вошедшим пользователям, но не даёт им право управлять им или читать ваши заявки.'));
    const texts=element('details','scenario');texts.append(element('summary','','Тексты и кнопки сценария'));
    for(const [id,n]of Object.entries(bot.flow?.nodes||{})){
     if(typeof n.text!=='string')continue;
     const section=element('section','step');section.append(element('h3','',({ask:'Вопрос',choice:'Выбор ответа',say:'Сообщение',end:'Завершение'})[n.type]+' · '+id));
     const input=field(section,'Текст',n.text,{multiline:true,max:4000,required:true});textFields.push({id,input});
     for(let j=0;j<(n.options||[]).length;j++){const option=field(section,'Кнопка '+(j+1),n.options[j].label,{max:120,required:true});textFields.push({id,index:j,input:option});}texts.append(section);
    }
    texts.append(element('p','caption','Подстановки вида {{name}} оставляйте без изменения. Сохранённые изменения сценария действуют в новых диалогах; прежние продолжают свой вариант.'));form.append(texts);
   }
   const submit=element('button','primary',bot?'Сохранить настройки':'Создать бота');submit.type='submit';submit.id='botSave';form.append(submit);
   if(bot){const controls=element('div','actions');controls.append(button(bot.status==='active'?'Остановить бота':'Включить бота',()=>toggle(),'quiet'),button('Открыть чат',()=>openBot(bot),'quiet'));form.append(controls);}
   form.onsubmit=event=>{event.preventDefault();if(busy||!form.reportValidity())return;const original=bot;
    if(visibility?.value==='public'&&original.visibility!=='public'&&!confirm('Добавить бота в каталог? Им смогут пользоваться другие вошедшие пользователи Public.'))return;
    return job(async e=>{
     const input={name:name.value.trim(),description:description.value.trim()};
     if(original){input.revision=original.revision;input.visibility=visibility.value;input.flow=structuredClone(original.flow);for(const f of textFields){if(f.index===undefined)input.flow.nodes[f.id].text=f.input.value;else input.flow.nodes[f.id].options[f.index].label=f.input.value;}}
     else{input.template=select.value;input.visibility='private';}
     if(createAttempt&&!original)throw new BotError('CREATE_UNCONFIRMED','Предыдущая попытка создания не подтверждена. Обновите список: бот мог уже появиться.');
     let saved;
     try{if(!original)createAttempt={...input};saved=original?await api.update(original.id,input):await api.create(input);createAttempt=null;}
     catch(err){if(err.status&&err.status<500&&err.status!==429)createAttempt=null;throw err;}
     guard(e);dirty=false;bot=saved;catalog=false;await listData(e);guard(e);renderList();say(original?'Настройки сохранены. Для нового сценария начните новый диалог.':'Бот создан. Нажмите «Открыть чат».');
    });};body.append(form);sync();name.focus();
  }
  async function toggle(){if(busy||dirty&& !confirm('Несохранённые тексты будут оставлены без изменения. Продолжить?'))return;await job(async e=>{const result=await api.update(bot.id,{revision:bot.revision,status:bot.status==='active'?'stopped':'active'});guard(e);bot=result;dirty=false;renderEdit();say(bot.status==='active'?'Бот включён.':'Бот остановлен. История и заявки сохранены.');});}
  async function openBot(item,newChat=false){
   if(busy||!navigable())return;saveDraft();dirty=false;
   await job(async e=>{
    const own=myBots.some(b=>b.id===item.id);bot=own?await api.get(item.id):item;guard(e);
    let list=await api.chats(item.id);guard(e);
    let next=newChat?null:list.chats[0];
    if(!next){if(bot.status!=='active')throw new BotError('BOT_STOPPED','Бот остановлен. Для нового диалога включите его в настройках.',409);
     // Keep this creation ID until an acknowledged response. Retrying the view
     // re-lists sessions first; no duplicate dialog is created after a lost reply.
     next=await api.createChat(item.id,crypto.randomUUID());guard(e);}
    chat=next;pending=await pendingStore.read(owner,chat.id);guard(e);draft=drafts.get(owner+'/'+chat.id)||'';
    await loadHistory(e);guard(e);renderChat();
   });
  }
  async function loadHistory(e){let after=0,all=[],result;const target=chat.id;
   do{result=await api.history(target,after);guard(e);if(result.session?.id!==target||!Array.isArray(result.events))throw new Error('История не подтверждена.');all.push(...result.events);const next=result.next_after;if(result.has_more&&(!Number.isSafeInteger(next)||next<=after))throw new Error('Некорректный курсор истории.');after=next;}while(result.has_more&&all.length<=10000);
   if(result.has_more)throw new Error('Слишком длинная история для этого просмотра.');chat=result.session;events=all;
   if(pending){const delivered=all.find(x=>x.id===pending.id);if(delivered){if(delivered.input?.text!==pending.text)throw new BotError('IDEMPOTENCY_CONFLICT','Исходящее не совпало с историей. Автоматическая отправка отключена.');await pendingStore.drop(owner,target,pending.id);guard(e);pending=null;}}
  }
  function renderChat(){
   prepare('chat');const meta=element('div','chat-meta');meta.append(element('span','badge','Сценарный бот'),element('span','caption',bot.status==='active'?'Работает':'Остановлен'));
   const acts=element('div','actions');acts.append(button('Новый диалог',()=>{if(pending){say('Сначала подтвердите неподтверждённую отправку.',true);return;}openBot(bot,true);},'quiet'),button('Обновить историю',()=>refreshChat(),'quiet'));
   if(myBots.some(b=>b.id===bot.id))acts.append(button('Настройки',()=>edit(bot),'quiet'),button('Заявки',()=>records(bot),'quiet'));meta.append(acts);body.append(meta);
   const thread=element('div','thread');thread.id='botThread';thread.setAttribute('role','log');thread.setAttribute('aria-label','Переписка с ботом');
   let choices=[];for(const ev of events){const label=choices.find(c=>c.id===ev.input?.text)?.label||ev.input?.text||'';thread.append(element('div','bubble me',label));
    for(const r of ev.response?.replies||[])thread.append(element('div','bubble other',r.text));choices=(ev.response?.replies||[]).at(-1)?.buttons||[];}
   if(!events.length)thread.append(element('div','empty','Нажмите «Начать», чтобы бот запустил свой сценарий.'));
   if(pending)thread.append(element('div','bubble pending','Не подтверждено: '+pending.text));body.append(thread);
   const choiceBar=element('div','choices');if(!events.length)choiceBar.append(button('Начать',()=>send('/start'),'primary'));
   else if(chat.done)choiceBar.append(button('Начать заново',()=>send('/start'),'quiet'));
   else for(const c of choices)choiceBar.append(button(c.label,()=>send(c.id),'quiet'));
   body.append(choiceBar);
   const form=element('form','composer'),input=element('textarea');input.id='botInput';input.rows=1;input.maxLength=2000;input.placeholder=bot.status==='stopped'?'Бот остановлен':'Сообщение боту…';input.setAttribute('aria-label','Сообщение боту');input.value=pending?'':draft;
   input.oninput=()=>{draft=input.value;drafts.set(owner+'/'+chat.id,draft);};
   const sendB=element('button','primary',pending?'Повторить':'Отправить');sendB.type='submit';sendB.id='botSend';form.append(input,sendB);form.onsubmit=e=>{e.preventDefault();send(pending?.text||input.value);};controlRefs={message:input,send:sendB};body.append(form);
   body.append(element('p','caption',pending?'Отправка сохранена на этом устройстве. «Повторить» использует тот же идентификатор и не создаёт новую заявку.':'Ответы сохраняются в облаке. Не отправляйте секреты. Бот не является человеком.'));
   sync();requestAnimationFrame(()=>{thread.scrollTop=thread.scrollHeight;});
  }
  async function refreshChat(){if(busy||!chat)return;saveDraft();await job(async e=>{if(myBots.some(b=>b.id===bot.id)){bot=await api.get(bot.id);guard(e);}pending=await pendingStore.read(owner,chat.id);guard(e);await loadHistory(e);guard(e);renderChat();});}
  async function send(value){if(busy||!chat||bot.status!=='active')return;const text=String(value||'').trim();if(!text&&!pending)return;
   const e=epoch;const target={owner,chat:chat.id,bot:bot.id};
   await job(async e=>{
    if(!pending){const p={...target,id:crypto.randomUUID(),text,revision:chat.revision,createdAt:new Date().toISOString()};await pendingStore.put(p);guard(e);pending=p;}
    const p=pending;renderChat();
    try{const result=await api.send(p);guard(e);if(result.id!==p.id||result.chat_id!==p.chat||result.revision!==p.revision+1)throw new BotError('INVALID_RESPONSE','Подтверждение не совпало с отправкой. Обновите историю.');
     await pendingStore.drop(p.owner,p.chat,p.id);guard(e);pending=null;draft='';drafts.delete(owner+'/'+p.chat);await loadHistory(e);guard(e);renderChat();say(result.saved_records?'Заявка сохранена.':'Ответ сохранён.');
    }catch(err){guard(e);
     if(['REVISION_CONFLICT','BOT_STOPPED','INVALID_INPUT','NOT_FOUND'].includes(err.code)){
      // The server explicitly rejected this new event. Retain its text as an
      // unsent draft; do not silently apply it to a newer scenario revision.
      await pendingStore.drop(p.owner,p.chat,p.id);guard(e);pending=null;draft=p.text;drafts.set(owner+'/'+p.chat,draft);
      if(err.code==='BOT_STOPPED')bot.status='stopped';
      try{await loadHistory(e);guard(e);}catch{}
     }
     renderChat();throw err;
    }
   });
  }
  async function records(item){if(busy||!navigable())return;saveDraft();await job(async e=>{
   bot=await api.get(item.id);guard(e);let all=[],after=0,r;
   do{r=await api.records(bot.id,after);guard(e);all.push(...r.records);const next=r.next_after;if(r.has_more&&(!Number.isSafeInteger(next)||next<=after))throw new Error('Не удалось прочитать следующую страницу заявок.');after=next;}while(r.has_more&&all.length<10000);
   prepare('records');body.append(element('p','caption',bot.name+' · '+all.length+' заявок. Здесь только результаты, отправленные сценарием владельцу.'));
   const grid=element('div','cards');if(!all.length)grid.append(element('div','empty','Заявок пока нет. Пройдите сценарий бота и подтвердите отправку.'));
   for(const record of all){const c=element('article','card');c.append(element('h3','',date(record.created_at)||'Заявка'));for(const[k,v]of Object.entries(record.data||{})){const row=element('p','record-row');row.append(element('span','caption',({name:'Имя',contact:'Контакт',period:'Время',consent:'Подтверждение'})[k]||k),element('strong','',({morning:'Утром',evening:'Вечером',yes:'Да',no:'Нет'})[v]||String(v)));c.append(row);}grid.append(c);}body.append(grid);
   body.append(button('Сохранить заявки в JSON',()=>{const blob=new Blob([JSON.stringify(all,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download='Public-bot-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'quiet'));sync();
  });}
  // Clear account-bound screens synchronously on host logout. Same-account
  // TOKEN_REFRESHED does not reset UI or pin an obsolete token.
  function checkAccount(){if(dialog.open&&owner&&(getContext()?.id!==owner||!getContext()?.approved)){reset();notify('Раздел ботов закрыт после смены аккаунта.');}}
  window.addEventListener('focus',checkAccount);document.addEventListener('visibilitychange',checkAccount);
  window.addEventListener('beforeunload',e=>{if(dialog.open&&(dirty||controlRefs.message?.value)){e.preventDefault();e.returnValue='';}});
  return Object.freeze({open,reset,close,checkAccount,get isOpen(){return dialog.open;}});
 }
 root.PublicBotsPanel=Object.freeze({create});
})(globalThis);
