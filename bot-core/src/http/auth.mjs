import {AppError,assert,digest,uuid,randomKey,now,text,integer,object} from '../core/errors.mjs';

/** Verify with the auth server, then require the existing approved Public profile. */
export function supabaseIdentity({url,publicKey,fetcher=fetch}) {
  const base=new URL(url);assert(base.protocol==='https:','CONFIG','Supabase требует HTTPS.',500);
  return async token=>{
    const headers={apikey:publicKey,Authorization:`Bearer ${token}`};
    let userResponse;
    try{userResponse=await fetcher(new URL('/auth/v1/user',base),{headers,signal:AbortSignal.timeout(8000)});}
    catch{throw new AppError('AUTH_UNAVAILABLE','Сервис входа временно недоступен.',503);}
    if(!userResponse.ok){
      if(userResponse.status>=500)throw new AppError('AUTH_UNAVAILABLE','Сервис входа временно недоступен.',503);
      throw new AppError('UNAUTHORIZED','Сессия недействительна. Войдите снова.',401);
    }
    const u=await userResponse.json();
    assert(typeof u.id==='string'&&/^[a-f0-9-]{36}$/i.test(u.id),'UNAUTHORIZED','Некорректный пользователь.',401);
    let r;
    try{r=await fetcher(new URL(`/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}&select=id,is_approved`,base),{headers,signal:AbortSignal.timeout(8000)});}
    catch{throw new AppError('AUTH_UNAVAILABLE','Не удалось проверить доступ.',503);}
    assert(r.ok,'AUTH_UNAVAILABLE','Не удалось проверить доступ.',503);
    const rows=await r.json();
    assert(Array.isArray(rows)&&rows.some(p=>p.id===u.id&&p.is_approved===true),'FORBIDDEN','Аккаунт не одобрен для приложения.',403);
    return {id:u.id,scope:'manage',issuer:'supabase'};
  };
}
export function authenticator(store,verifyExternal=null){
  return async request=>{
    const header=request.headers.get('authorization')||'';
    assert(/^Bearer [^\s]{1,8192}$/.test(header),'UNAUTHORIZED','Нужен ключ или действующая сессия.',401);
    const token=header.slice(7);
    if(token.startsWith('pbc_')){
      const p=await store.lookupKey(await digest(token));
      assert(p,'UNAUTHORIZED','Ключ недействителен, отозван или истёк.',401);return p;
    }
    assert(verifyExternal,'UNAUTHORIZED','Неизвестный способ входа.',401);
    return verifyExternal(token);
  };
}
export async function issueLocalOwnerKey(store,id,label='Локальный владелец'){
  const raw=randomKey(),key={id:uuid(),hash:await digest(raw),owner_id:id,actor_id:id,scope:'manage',bot_id:null,label,expires_at:Date.now()+30*86400_000,created_at:now()};
  await store.createKey(key);return {token:raw,key_id:key.id,principal_id:id,expires_at:key.expires_at};
}
export async function issueChatKey(service,p,input){
  service.manage(p);assert(object(input),'INVALID_INPUT','Нужен объект настроек.');
  const b=await service.bot(p,input.bot_id,true);
  assert(b.visibility==='public','KEY_VISIBILITY','Сначала разрешите доступ к боту авторизованным пользователям.',409);
  const days=integer(input.days??7,'Срок ключа',1,30),raw=randomKey(),id=uuid();
  const key={id,hash:await digest(raw),owner_id:p.id,actor_id:`key:${id}`,scope:'chat',bot_id:b.id,label:text(input.label??'Интеграция','Название ключа',80),expires_at:Date.now()+days*86400_000,created_at:now()};
  await service.store.createKey(key);
  return {id,token:raw,expires_at:key.expires_at,scope:key.scope,bot_id:b.id};
}
