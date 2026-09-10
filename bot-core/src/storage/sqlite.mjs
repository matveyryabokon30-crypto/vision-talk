import {DatabaseSync,backup} from 'node:sqlite';
import {readFileSync,mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {assert,notFound,conflict} from '../core/errors.mjs';
const decode = row => row ? JSON.parse(row.doc) : null;

/** Synchronous short transactions; no network calls while a DB lock is held. */
export class SQLiteStore {
  constructor(path=':memory:') {
    this.path=path;
    if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path,{timeout:5000,enableForeignKeyConstraints:true});
    if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec(readFileSync(new URL('./sqlite-schema.sql',import.meta.url),'utf8'));
    assert(this.db.prepare('SELECT max(version) AS v FROM schema_version').get().v===1,'SCHEMA_VERSION','Неподдерживаемая версия хранилища.',500);
  }
  close(){this.db.close();}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  getBot(id){return decode(this.db.prepare('SELECT doc FROM bots WHERE id=?').get(id));}
  listBots(owner){return this.db.prepare('SELECT doc FROM bots WHERE owner_id=? ORDER BY rowid DESC LIMIT 100').all(owner).map(decode);}
  catalog(actor){return this.db.prepare("SELECT doc FROM bots WHERE (visibility='public' OR owner_id=?) AND status='active' ORDER BY rowid DESC LIMIT 100").all(actor).map(decode);}
  createBot(b){return this.transaction(()=>{
    const count=this.db.prepare('SELECT count(*) AS n FROM bots WHERE owner_id=?').get(b.owner_id).n;
    assert(count<50,'BOT_LIMIT','Лимит пилота: 50 ботов на владельца.',429);
    this.db.prepare('INSERT INTO bots VALUES (?,?,?,?,?,?)').run(b.id,b.owner_id,b.status,b.visibility,b.revision,JSON.stringify(b));return b;
  });}
  updateBot(b,expected){
    const r=this.db.prepare('UPDATE bots SET status=?,visibility=?,revision=?,doc=? WHERE id=? AND owner_id=? AND revision=?').run(b.status,b.visibility,b.revision,JSON.stringify(b),b.id,b.owner_id,expected);
    if(!r.changes)throw conflict();return b;
  }
  createSession(s){return this.transaction(()=>{
    const b=this.getBot(s.bot_id);if(!b)throw notFound();
    const old=this.getSession(s.id);
    if(old){if(old.actor_id!==s.actor_id||old.bot_id!==s.bot_id)throw notFound();return old;}
    assert(b.status==='active','BOT_STOPPED','Бот остановлен.',409);
    if(b.owner_id!==s.actor_id&&b.visibility!=='public')throw notFound();
    const count=this.db.prepare('SELECT count(*) AS n FROM sessions WHERE actor_id=?').get(s.actor_id).n;
    assert(count<500,'CHAT_LIMIT','Лимит пилота: 500 диалогов на пользователя.',429);
    // Capture the exact current graph under the same lock as bot status.
    s={...s,flow:b.flow,flow_revision:b.revision};
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(s.id,s.bot_id,s.actor_id,0,JSON.stringify(s));return s;
  });}
  getSession(id){return decode(this.db.prepare('SELECT doc FROM sessions WHERE id=?').get(id));}
  listSessions(actor,bot){return this.db.prepare('SELECT doc FROM sessions WHERE actor_id=? AND bot_id=? ORDER BY rowid DESC LIMIT 100').all(actor,bot).map(decode);}
  getEvent(session,event){const r=this.db.prepare('SELECT * FROM events WHERE session_id=? AND event_id=?').get(session,event);return r?{...r,response:JSON.parse(r.response),input:JSON.parse(r.input)}:null;}
  history(session,after){return this.db.prepare('SELECT revision,event_id,response,input FROM events WHERE session_id=? AND revision>? ORDER BY revision LIMIT 100').all(session,after).map(r=>({revision:r.revision,id:r.event_id,input:JSON.parse(r.input),response:JSON.parse(r.response)}));}
  commit(t){return this.transaction(()=>{
    const b=this.getBot(t.bot_id),s=this.getSession(t.session_id);
    if(!b||!s||s.actor_id!==t.actor_id||s.bot_id!==t.bot_id)throw notFound();
    if(b.owner_id!==t.actor_id&&b.visibility!=='public')throw notFound();
    const old=this.getEvent(t.session_id,t.event_id);
    if(old){assert(old.fingerprint===t.fingerprint,'IDEMPOTENCY_CONFLICT','Идентификатор использован повторно с другими данными.',409);return old.response;}
    assert(b.status==='active','BOT_STOPPED','Бот остановлен.',409);
    if(s.revision!==t.expected_revision)throw conflict();
    assert(s.revision<10000,'EVENT_LIMIT','Лимит пилота: 10 000 событий на диалог.',429);
    const updated={...s,state:t.state,revision:s.revision+1,updated_at:t.timestamp};
    this.db.prepare('UPDATE sessions SET revision=?,doc=? WHERE id=?').run(updated.revision,JSON.stringify(updated),s.id);
    this.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)').run(s.id,t.event_id,t.fingerprint,updated.revision,JSON.stringify(t.response),JSON.stringify(t.input));
    const insert=this.db.prepare('INSERT INTO records(id,bot_id,session_id,actor_id,event_id,item_index,doc) VALUES (?,?,?,?,?,?,?)');
    for(const r of t.records)insert.run(r.id,b.id,s.id,t.actor_id,t.event_id,r.index,JSON.stringify(r));
    return t.response;
  });}
  records(bot,after){return this.db.prepare('SELECT seq,session_id,actor_id,event_id,doc FROM records WHERE bot_id=? AND seq>? ORDER BY seq LIMIT 100').all(bot,after).map(r=>({...decode(r),seq:r.seq,chat_id:r.session_id,actor_id:r.actor_id,event_id:r.event_id}));}
  deleteSession(id,actor){this.db.prepare('DELETE FROM sessions WHERE id=? AND actor_id=?').run(id,actor);}
  quota(key,seconds,limit){return this.transaction(()=>{
    const time=Date.now();this.db.prepare('DELETE FROM quota_buckets WHERE reset_at<?').run(time);
    const old=this.db.prepare('SELECT * FROM quota_buckets WHERE key=?').get(key);
    if(old){assert(old.count<limit,'RATE_LIMIT','Слишком много запросов. Повторите через минуту.',429);this.db.prepare('UPDATE quota_buckets SET count=count+1 WHERE key=?').run(key);}
    else this.db.prepare('INSERT INTO quota_buckets VALUES (?,?,?)').run(key,1,time+seconds*1000);
  });}
  createKey(k){return this.transaction(()=>{
    assert(this.db.prepare('SELECT count(*) AS n FROM keys WHERE owner_id=? AND revoked_at IS NULL AND expires_at>?').get(k.owner_id,Date.now()).n<100,'KEY_LIMIT','Лимит активных ключей: 100.',429);
    this.db.prepare('INSERT INTO keys VALUES (?,?,?,?,?,?,?,?,?,?)').run(k.id,k.hash,k.owner_id,k.actor_id,k.scope,k.bot_id,k.label,k.expires_at,null,k.created_at);return k;
  });}
  lookupKey(hash){const k=this.db.prepare('SELECT * FROM keys WHERE hash=? AND revoked_at IS NULL AND expires_at>?').get(hash,Date.now());return k?{id:k.actor_id,scope:k.scope,bot_id:k.bot_id,key_id:k.id,owner_id:k.owner_id}:null;}
  listKeys(owner){return this.db.prepare('SELECT id,label,scope,bot_id,expires_at,revoked_at,created_at FROM keys WHERE owner_id=? ORDER BY created_at DESC LIMIT 100').all(owner);}
  revokeKey(id,owner){return Boolean(this.db.prepare('UPDATE keys SET revoked_at=? WHERE id=? AND owner_id=?').run(Date.now(),id,owner).changes);}
  async backup(path){await backup(this.db,path);chmodSync(path,0o600);}
}
