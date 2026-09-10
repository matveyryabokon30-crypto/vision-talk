import {AppError,assert,uuid,object,identifier} from '../core/errors.mjs';
import {templates} from '../core/templates.mjs';
import {issueChatKey} from './auth.mjs';
const MAX_BODY=70000;
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
async function body(request){
  assert((request.headers.get('content-type')||'').split(';')[0]==='application/json','CONTENT_TYPE','Нужен application/json.',415);
  assert(Number(request.headers.get('content-length')||0)<=MAX_BODY,'TOO_LARGE','Запрос слишком большой.',413);
  const reader=request.body?.getReader();let total=0;const chunks=[];
  if(reader)try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BODY){await reader.cancel();throw new AppError('TOO_LARGE','Запрос слишком большой.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const data=new Uint8Array(total);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw new AppError('INVALID_JSON','Некорректный JSON.');}
  assert(object(parsed),'INVALID_INPUT','Нужен JSON-объект.');return parsed;
}
export function createHandler({service,authenticate,allowedOrigins=[],basePath='',logger=console}){
  const origins=new Set(allowedOrigins);
  return async request=>{
    const id=uuid(),headers={...HEADERS,'X-Request-ID':id};
    const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    try{
      const u=new URL(request.url),origin=request.headers.get('origin');
      if(origin){assert(origin===u.origin||origins.has(origin),'ORIGIN_FORBIDDEN','Этот источник запросов не разрешён.',403);headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
      if(request.method==='OPTIONS'){
        headers['Access-Control-Allow-Methods']='GET, POST, PATCH, DELETE, OPTIONS';
        headers['Access-Control-Allow-Headers']='Authorization, Content-Type, apikey, x-client-info';
        headers['Access-Control-Max-Age']='600';return new Response(null,{status:204,headers});
      }
      let path=u.pathname;if(basePath){assert(path.startsWith(basePath+'/')||path===basePath,'NOT_FOUND','Маршрут не найден.',404);path=path.slice(basePath.length)||'/';}
      const parts=path.split('/').filter(Boolean).map(s=>decodeURIComponent(s));
      if(path==='/health'&&request.method==='GET')return send({status:'ok',version:'0.1.1'});
      const p=await authenticate(request);
      await service.store.quota(`api:${p.id}`,60,240);
      assert(parts[0]==='v1','NOT_FOUND','Маршрут не найден.',404);
      const method=request.method,segment=parts[1];
      let data,status=200;
      if(segment==='me'&&parts.length===2&&method==='GET')data={id:p.id,scope:p.scope,bot_id:p.bot_id??null};
      else if(segment==='templates'&&parts.length===2&&method==='GET')data={templates};
      else if(segment==='catalog'&&parts.length===2&&method==='GET')data={bots:await service.catalog(p)};
      else if(segment==='bots'&&parts.length===2&&method==='GET')data={bots:await service.list(p)};
      else if(segment==='bots'&&parts.length===2&&method==='POST'){data=await service.create(p,await body(request));status=201;}
      else if(segment==='bots'&&parts.length===3&&method==='GET'){service.manage(p);data=await service.bot(p,parts[2],true);}
      else if(segment==='bots'&&parts.length===3&&method==='PATCH')data=await service.update(p,parts[2],await body(request));
      else if(segment==='bots'&&parts[3]==='chats'&&parts.length===4&&method==='POST'){data=await service.createChat(p,parts[2],await body(request));status=201;}
      else if(segment==='bots'&&parts[3]==='chats'&&parts.length===4&&method==='GET')data={chats:await service.chats(p,parts[2])};
      else if(segment==='bots'&&parts[3]==='records'&&parts.length===4&&method==='GET'){const r=await service.records(p,parts[2],Number(u.searchParams.get('after')||0));data={records:r,next_after:r.at(-1)?.seq??Number(u.searchParams.get('after')||0),has_more:r.length===100};}
      else if(segment==='chats'&&parts.length===3&&method==='GET')data=await service.history(p,parts[2],Number(u.searchParams.get('after')||0));
      else if(segment==='chats'&&parts.length===3&&method==='DELETE')data=await service.deleteChat(p,parts[2]);
      else if(segment==='chats'&&parts[3]==='messages'&&parts.length===4&&method==='POST')data=await service.turn(p,parts[2],await body(request));
      else if(segment==='keys'&&parts.length===2&&method==='POST'){data=await issueChatKey(service,p,await body(request));status=201;}
      else if(segment==='keys'&&parts.length===2&&method==='GET'){service.manage(p);data={keys:await service.store.listKeys(p.id)};}
      else if(segment==='keys'&&parts.length===3&&method==='DELETE'){service.manage(p);identifier(parts[2]);assert(await service.store.revokeKey(parts[2],p.id),'NOT_FOUND','Ключ не найден.',404);data={revoked:true};}
      else throw new AppError('NOT_FOUND','Маршрут не найден.',404);
      return send(data,status);
    }catch(error){
      const known=error instanceof AppError;
      if(!known)logger.error?.(JSON.stringify({event:'request_failed',request_id:id,error_type:error?.name||'Error'}));
      if(error?.status===429)headers['Retry-After']='60';
      return send({error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'Внутренняя ошибка. Сохраните идентификатор запроса.'},request_id:id},known?error.status:500);
    }
  };
}
