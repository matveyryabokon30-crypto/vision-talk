import {BotClient} from './sdk.mjs';
const PROJECT_URL='https://ctcoqgsztdtsazdiwcmd.supabase.co';
const PUBLIC_KEY='sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw';
const AUTH_STORAGE='sb-ctcoqgsztdtsazdiwcmd-auth-token';
const $=id=>document.getElementById(id);
let token=null,epoch=0,busy=false,bot=null,chat=null,pending=null;
function readToken(){
 try{
  if(JSON.parse(localStorage.getItem('pablicus:passkey-unvalidated')||'false')===true)return null;
  const v=JSON.parse(localStorage.getItem(AUTH_STORAGE)||'null');
  return v?.access_token||v?.currentSession?.access_token||v?.session?.access_token||null;
 }catch{return null;}
}
const client=new BotClient({baseUrl:window.PUBLIC_BOT_CORE_CONFIG?.apiUrl||`${PROJECT_URL}/functions/v1/public-bot-core`,apiKey:PUBLIC_KEY,getToken:async()=>{if(!token||readToken()!==token)throw Error('Сессия изменилась. Нажмите «Обновить».');return token;}});
function status(message,error=false){$('status').textContent=message;$('status').className=error?'error':'muted';}
function current(e){return e===epoch&&!!token&&readToken()===token;}
function controls(){
 $('create').querySelector('button').disabled=busy||!token;
 $('send').querySelector('button').disabled=busy||!chat||!token||bot?.status==='stopped';
 $('message').disabled=busy||!chat||!!pending||bot?.status==='stopped';
 for(const id of ['restart','toggle','records'])$(id).disabled=busy||!bot||!token||!!pending;
 $('send').querySelector('button').textContent=pending?'Повторить':'Отправить';
}
function reset(){++epoch;token=null;bot=null;chat=null;pending=null;busy=false;$('bots').replaceChildren();$('messages').replaceChildren();$('chat').hidden=true;$('identity').textContent='Нет подтверждённой сессии';controls();}
function append(who,text){const n=document.createElement('div');n.className='msg '+who;n.textContent=text;$('messages').append(n);return n;}
function renderEvent(event){
 for(const row of event.replies||[]){
  const n=append('bot',row.text);
  for(const item of row.buttons||[]){const b=document.createElement('button');b.type='button';b.textContent=item.label;const e=epoch,c=chat?.id;b.onclick=()=>{if(current(e)&&chat?.id===c&&!busy&&!pending)sendText(item.id);};n.append(document.createElement('br'),b);}
 }
 $('messages').scrollTop=$('messages').scrollHeight;
}
async function renderHistory(e){
 let after=0,events=[];
 do{const result=await client.history(chat.id,after);if(!current(e))return;chat=result.session;events.push(...result.events);after=result.next_after;if(!result.has_more)break;}while(true);
 if(!current(e))return;$('messages').replaceChildren();for(const item of events){append('me',item.input.text);renderEvent(item.response);}
 if(!events.length)append('bot','Отправьте /start, чтобы начать.');
}
function renderBots(items){
 $('bots').replaceChildren();if(!items.length){const p=document.createElement('p');p.textContent='Ботов пока нет.';$('bots').append(p);}
 for(const item of items){const b=document.createElement('button');b.type='button';b.className='bot';const name=document.createElement('strong'),s=document.createElement('small');name.textContent=item.name;s.textContent=item.status==='active'?'Работает':'Остановлен';b.append(name,s);b.onclick=()=>{if(!busy&&!pending)openBot(item);};$('bots').append(b);}
}
async function load(){
 reset();token=readToken();if(!token){status('Сначала войдите в основной Public в этом браузере.',true);return;}
 const e=epoch;busy=true;controls();
 try{const me=await client.me();const [result,ts]=await Promise.all([client.bots(),client.templates()]);if(!current(e))return;$('identity').textContent='Вход подтверждён · '+me.id;renderBots(result.bots);$('template').replaceChildren();for(const t of ts.templates){const o=document.createElement('option');o.value=t.id;o.textContent=t.name;$('template').append(o);}status('Облачное ядро подключено. Это отдельный тестовый раздел, не основная переписка.');}
 catch(error){if(e===epoch){token=null;status(error.message,true);}}finally{if(e===epoch){busy=false;controls();}}
}
async function openBot(item,newChat=false){
 const e=epoch;busy=true;bot=item;chat=null;pending=null;$('chat').hidden=false;$('chatTitle').textContent=item.name;$('messages').replaceChildren();$('toggle').textContent=item.status==='active'?'Остановить':'Включить';controls();
 try{
  if(!newChat){const list=await client.chats(item.id);if(!current(e))return;chat=list.chats[0]||null;}
  if(!chat){chat=await client.createChat(item.id);if(!current(e))return;}
  await renderHistory(e);
 }catch(error){if(current(e))status(error.message,true);}finally{if(e===epoch){busy=false;controls();}}
}
async function sendText(text){
 if(busy||!chat||!token)return;
 const value=text.trim();if(!value&&!pending)return;
 const e=epoch;
 if(!pending)pending={id:crypto.randomUUID(),chat:chat.id,text:value,revision:chat.revision};
 const p=pending;busy=true;controls();
 try{
  const result=await client.send(p.chat,p.text,p.revision,p.id);if(!current(e)||chat?.id!==p.chat)return;
  pending=null;chat.revision=result.revision;$('message').value='';await renderHistory(e);status(result.saved_records?'Заявка сохранена в облаке.':'Ответ получен.');
 }catch(error){
  if(!current(e))return;
  if(error.status===409){pending=null;await renderHistory(e);status('Состояние обновилось. Проверьте историю перед новой отправкой.',true);}
  else if(error.status&&error.status<500&&error.status!==429){pending=null;status(error.message,true);}
  else status('Ответ не подтверждён. Нажмите «Повторить»: будет использован тот же идентификатор сообщения.',true);
 }finally{if(e===epoch){busy=false;controls();}}
}
$('create').onsubmit=async event=>{
 event.preventDefault();if(busy||!token||pending)return;const e=epoch;busy=true;controls();
 try{const item=await client.createBot({name:$('name').value.trim(),template:$('template').value,visibility:'private'});if(!current(e))return;$('name').value='';const result=await client.bots();if(!current(e))return;renderBots(result.bots);status('Бот создан в облаке.');await openBot(item);}
 catch(error){if(current(e))status(error.message,true);}finally{if(e===epoch){busy=false;controls();}}
};
$('send').onsubmit=event=>{event.preventDefault();sendText(pending?.text||$('message').value);};
$('restart').onclick=()=>{if(bot&&!busy&&!pending)openBot(bot,true);};
$('toggle').onclick=async()=>{
 if(!bot||busy||pending)return;const e=epoch;busy=true;controls();
 try{const item=await client.updateBot(bot.id,{revision:bot.revision,status:bot.status==='active'?'stopped':'active'});if(!current(e))return;bot=item;$('toggle').textContent=item.status==='active'?'Остановить':'Включить';const list=await client.bots();if(current(e))renderBots(list.bots);status(item.status==='active'?'Бот включён.':'Бот остановлен.');}catch(error){if(current(e))status(error.message,true);}finally{if(e===epoch){busy=false;controls();}}
};
$('records').onclick=async()=>{
 if(!bot||busy||pending)return;const e=epoch;busy=true;controls();
 try{let after=0,records=[];do{const r=await client.records(bot.id,after);if(!current(e))return;records.push(...r.records);after=r.next_after;if(!r.has_more)break;}while(true);append('bot',records.length?JSON.stringify(records,null,2):'Сохранённых заявок пока нет.');}catch(error){if(current(e))status(error.message,true);}finally{if(e===epoch){busy=false;controls();}}
};
$('reload').onclick=()=>{if(!busy&&!pending)load();else status('Сначала завершите или повторите текущую отправку.',true);};
function checkSession(){if(token&&readToken()!==token){reset();status('Сессия изменилась. Обновите раздел после входа.',true);}}
window.addEventListener('storage',checkSession);window.addEventListener('focus',checkSession);setInterval(checkSession,2000);
load();
