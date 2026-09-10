import {AppError,assert} from '../core/errors.mjs';
const MESSAGES={
 NOT_FOUND:[404,'Объект не найден или недоступен.'],REVISION_CONFLICT:[409,'Данные изменились. Обновите состояние.'],
 IDEMPOTENCY_CONFLICT:[409,'Идентификатор уже использован с другими данными.'],BOT_STOPPED:[409,'Бот остановлен.'],
 RATE_LIMIT:[429,'Слишком много запросов. Повторите через минуту.'],BOT_LIMIT:[429,'Лимит: 50 ботов.'],CHAT_LIMIT:[429,'Лимит: 500 диалогов.'],KEY_LIMIT:[429,'Лимит активных ключей: 100.'],EVENT_LIMIT:[429,'Лимит событий в диалоге.']
};
/** Server-only store. One RPC commits state, event and saved records in one DB transaction. */
export class SupabaseStore {
  constructor({url,serviceKey,fetcher=fetch}){
    this.url=new URL('/rest/v1/rpc/public_bot_store_v1',url).href;
    assert(new URL(this.url).protocol==='https:','CONFIG','Supabase требует HTTPS.',500);
    assert(typeof serviceKey==='string'&&serviceKey.length>10,'CONFIG','Не задан серверный ключ Supabase.',500);
    this.serviceKey=serviceKey;this.fetcher=fetcher;
  }
  async call(op,data={}){
    let r;try{r=await this.fetcher(this.url,{method:'POST',headers:{'Content-Type':'application/json',apikey:this.serviceKey,...(this.serviceKey.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${this.serviceKey}`})},body:JSON.stringify({payload:{op,...data}}),signal:AbortSignal.timeout(12000)});}catch{throw new AppError('STORE_UNAVAILABLE','Хранилище временно недоступно. Повторите запрос с тем же идентификатором.',503);}
    const out=await r.json();if(!r.ok){const match=MESSAGES[out?.message];if(match)throw new AppError(out.message,match[1],match[0]);throw new AppError('STORE_UNAVAILABLE','Ошибка серверного хранилища.',503);}return out;
  }
  createBot(bot){return this.call('createBot',{bot});}
  getBot(id){return this.call('getBot',{id});}
  listBots(owner){return this.call('listBots',{owner});}
  catalog(actor){return this.call('catalog',{actor});}
  updateBot(bot,expected){return this.call('updateBot',{bot,expected});}
  createSession(session){return this.call('createSession',{session});}
  getSession(id){return this.call('getSession',{id});}
  listSessions(actor,bot){return this.call('listSessions',{actor,bot});}
  getEvent(session,event){return this.call('getEvent',{session,event});}
  history(session,after){return this.call('history',{session,after});}
  commit(turn){return this.call('commit',{turn});}
  records(bot,after){return this.call('records',{bot,after});}
  deleteSession(id,actor){return this.call('deleteSession',{id,actor});}
  quota(key,seconds,limit){return this.call('quota',{key,seconds,limit});}
  createKey(key){return this.call('createKey',{key});}
  lookupKey(hash){return this.call('lookupKey',{hash});}
  listKeys(owner){return this.call('listKeys',{owner});}
  revokeKey(id,owner){return this.call('revokeKey',{id,owner});}
}
