import {assert,object,text,identifier,integer,notFound,conflict,digest,uuid,now} from './errors.mjs';
import {validateFlow,advance} from './flow.mjs';
import {getTemplate} from './templates.mjs';

export class BotService {
  constructor(store) { this.store = store; }
  principal(p) { assert(p && typeof p.id === 'string' && p.id.length <= 200,'UNAUTHORIZED','Нужен вход.',401); }
  manage(p) { this.principal(p); assert(p.scope === 'manage','FORBIDDEN','Ключ не разрешает управление.',403); }
  async bot(p,id,owner=false) {
    this.principal(p); identifier(id);
    const bot = await this.store.getBot(id);
    if (!bot || (owner && bot.owner_id !== p.id)) throw notFound();
    if (p.bot_id && p.bot_id !== id) throw notFound();
    if (!owner && bot.owner_id !== p.id && bot.visibility !== 'public') throw notFound();
    return bot;
  }
  async create(p,input) {
    this.manage(p); assert(object(input),'INVALID_INPUT','Нужен объект настроек.');
    const template = getTemplate(input.template);
    const flow = validateFlow(input.flow ?? template?.flow);
    const visibility = input.visibility ?? 'private';
    assert(['private','public'].includes(visibility),'INVALID_INPUT','Неверная видимость.');
    const bot = {id:uuid(),owner_id:p.id,name:text(input.name,'Название',80),description:text(input.description ?? template?.description ?? '','Описание',500,0),visibility,status:'active',revision:1,flow,created_at:now(),updated_at:now()};
    await this.store.createBot(bot); return bot;
  }
  async list(p) { this.manage(p); return this.store.listBots(p.id); }
  async catalog(p) { this.principal(p); const list = await this.store.catalog(p.id); return list.filter(b => !p.bot_id || b.id === p.bot_id).map(({flow,owner_id,...b}) => b); }
  async update(p,id,input) {
    this.manage(p); const bot = await this.bot(p,id,true);
    assert(object(input),'INVALID_INPUT','Нужен объект настроек.');
    const expected = integer(input.revision,'Версия',1);
    if (bot.revision !== expected) throw conflict();
    const next = {...bot,revision:bot.revision+1,updated_at:now()};
    if (input.flow !== undefined) next.flow = validateFlow(input.flow);
    if (input.name !== undefined) next.name = text(input.name,'Название',80);
    if (input.description !== undefined) next.description = text(input.description,'Описание',500,0);
    if (input.status !== undefined) {assert(['active','stopped'].includes(input.status),'INVALID_INPUT','Неверный статус.');next.status=input.status;}
    if (input.visibility !== undefined) {assert(['private','public'].includes(input.visibility),'INVALID_INPUT','Неверная видимость.');next.visibility=input.visibility;}
    return this.store.updateBot(next,expected);
  }
  async createChat(p,id,input={}) {
    const bot = await this.bot(p,id);
    assert(bot.status === 'active','BOT_STOPPED','Бот остановлен.',409);
    // A client-generated UUID makes chat creation safe to retry after network loss.
    const chatId = input.id ? identifier(input.id,'Идентификатор диалога') : uuid();
    assert(/^[a-f0-9-]{36}$/i.test(chatId),'INVALID_INPUT','Для диалога нужен UUID.');
    const session={id:chatId,bot_id:id,actor_id:p.id,revision:0,flow:bot.flow,flow_revision:bot.revision,state:null,created_at:now(),updated_at:now()};
    const stored = await this.store.createSession(session);
    return this.publicSession(stored);
  }
  publicSession(s) {return {id:s.id,bot_id:s.bot_id,revision:s.revision,flow_revision:s.flow_revision,done:s.state?.done??false,created_at:s.created_at,updated_at:s.updated_at};}
  async session(p,id) {
    this.principal(p); identifier(id);
    const s = await this.store.getSession(id);
    if (!s || s.actor_id !== p.id || (p.bot_id && p.bot_id !== s.bot_id)) throw notFound();
    await this.bot(p,s.bot_id); return s;
  }
  async history(p,id,after=0) {
    const session = await this.session(p,id);
    const events = await this.store.history(id,integer(after,'Курсор'));
    return {session:this.publicSession(session),events,next_after:events.length ? events.at(-1).revision : after,has_more:events.length === 100};
  }
  async chats(p,botId) { await this.bot(p,botId); return (await this.store.listSessions(p.id,botId)).map(s=>this.publicSession(s)); }
  async turn(p,id,input) {
    assert(object(input),'INVALID_INPUT','Нужен объект сообщения.');
    const eventId=identifier(input.id,'Идентификатор сообщения'), value=text(input.text,'Сообщение',2000);
    const revision=integer(input.revision,'Версия диалога');
    const s=await this.session(p,id), fingerprint=await digest(JSON.stringify({text:value,revision}));
    const existing=await this.store.getEvent(id,eventId);
    if (existing) {
      assert(existing.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Этот идентификатор уже использован для другого сообщения.',409);
      return existing.response;
    }
    const bot=await this.bot(p,s.bot_id);
    assert(bot.status==='active','BOT_STOPPED','Бот остановлен.',409);
    if (s.revision!==revision) throw conflict();
    await this.store.quota(`turn:${p.id}`,60,120);
    const result=advance(s.flow,s.state,{text:value});
    const timestamp=now();
    const response={id:eventId,chat_id:id,revision:revision+1,done:result.state.done,replies:result.replies.map(r=>({...r,id:uuid()})),saved_records:result.records.length,created_at:timestamp};
    return this.store.commit({session_id:id,bot_id:s.bot_id,actor_id:p.id,event_id:eventId,fingerprint,expected_revision:revision,state:result.state,response,input:{text:value},records:result.records.map((r,i)=>({...r,id:uuid(),index:i,created_at:timestamp})),timestamp});
  }
  async records(p,id,after=0) {this.manage(p);await this.bot(p,id,true);return this.store.records(id,integer(after,'Курсор'));}
  async deleteChat(p,id) {const s=await this.session(p,id);await this.store.deleteSession(s.id,p.id);return {deleted:true};}
}
