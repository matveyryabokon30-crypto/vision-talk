import {BotClient} from './sdk.mjs';

const PROJECT_URL='https://ctcoqgsztdtsazdiwcmd.supabase.co';
const PUBLIC_KEY='sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw';
const AUTH_STORAGE='sb-ctcoqgsztdtsazdiwcmd-auth-token';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function readStoredAccessToken(){
  try{
    const raw=localStorage.getItem(AUTH_STORAGE);if(!raw)return null;
    const parsed=JSON.parse(raw);
    return parsed?.access_token||parsed?.currentSession?.access_token||parsed?.session?.access_token||null;
  }catch{return null;}
}

const client=new BotClient({
  baseUrl:window.PUBLIC_BOT_CORE_CONFIG?.apiUrl||`${PROJECT_URL}/functions/v1/public-bot-core`,
  apiKey:PUBLIC_KEY,
  getToken:async()=>readStoredAccessToken()
});
let selected=null,chat=null,revision=0;

function status(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function renderBots(items=[]){
  const root=$('bots');root.replaceChildren();
  if(!items.length){root.innerHTML='<p class="muted">Ботов пока нет.</p>';return;}
  for(const bot of items){
    const b=document.createElement('button');b.className='bot';b.type='button';
    b.innerHTML=`<strong>${esc(bot.name||'Без имени')}</strong><small>${esc(bot.status||'')}</small>`;
    b.onclick=()=>openBot(bot);root.append(b);
  }
}
async function load(){
  const token=readStoredAccessToken();
  if(!token){status('Сначала войдите в основной Pablicus в этом браузере.',true);return;}
  try{
    const [me,bots]=await Promise.all([client.me(),client.bots()]);
    $('identity').textContent=me?.actor?.id?`Пользователь: ${me.actor.id}`:'Вход подтверждён';
    renderBots(bots?.bots||bots?.items||[]);status('Связь с Bot Core установлена.');
  }catch(e){status(`${e.message} Сервер Bot Core ещё может быть не развёрнут.`,true);}
}
async function createBot(event){
  event.preventDefault();
  const name=$('name').value.trim();if(!name)return;
  const template=$('template').value;
  try{
    const result=await client.createBot({name,template,visibility:'private'});
    $('name').value='';status('Бот создан.');await load();
    const bot=result?.bot||result;if(bot?.id)openBot(bot);
  }catch(e){status(e.message,true);}
}
async function openBot(bot){
  selected=bot;chat=null;revision=0;$('chatTitle').textContent=bot.name||'Бот';$('chat').hidden=false;$('messages').replaceChildren();
  try{
    const result=await client.createChat(bot.id);chat=result?.chat||result;
    revision=Number(chat?.revision||0);append('bot',chat?.response?.text||chat?.message||'Чат создан.');
  }catch(e){status(e.message,true);}
}
function append(who,text){const n=document.createElement('div');n.className=`msg ${who}`;n.textContent=text||'';$('messages').append(n);$('messages').scrollTop=$('messages').scrollHeight;}
async function send(event){
  event.preventDefault();const text=$('message').value.trim();if(!text||!chat?.id)return;
  append('me',text);$('message').value='';
  try{
    const result=await client.send(chat.id,text,revision);revision=Number(result?.revision??revision+1);
    append('bot',result?.text||result?.response?.text||'Готово.');
  }catch(e){append('bot',`Ошибка: ${e.message}`);}
}
$('create').addEventListener('submit',createBot);$('send').addEventListener('submit',send);$('reload').onclick=load;load();
