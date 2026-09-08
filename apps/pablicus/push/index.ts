import {generateVapid,sendPush,validateSubscription} from './webpush.mjs';

const projectUrl=Deno.env.get('SUPABASE_URL')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const appOrigin='https://matveyryabokon30-crypto.github.io';
const cors={'Access-Control-Allow-Origin':appOrigin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});

async function rpc(action:string,input:unknown={}) {
 const res=await fetch(projectUrl+'/rest/v1/rpc/pablicus_push_rpc',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_input:input}),signal:AbortSignal.timeout(10000)});
 if(!res.ok){await res.body?.cancel();throw new Error('Push service unavailable');}
 return await res.json();
}
async function ensureConfig() {
 let config=await rpc('config');
 if(!config.publicKey)config=await rpc('init',await generateVapid());
 return config;
}
async function verifiedUser(req:Request) {
 const authorization=req.headers.get('Authorization')||'';
 if(!/^Bearer [A-Za-z0-9._-]{30,10000}$/.test(authorization))return null;
 const res=await fetch(projectUrl+'/auth/v1/user',{headers:{Authorization:authorization,apikey:serviceKey},signal:AbortSignal.timeout(8000)});
 if(!res.ok){await res.body?.cancel();return null;}
 const user=await res.json();
 if(typeof user.id!=='string'||!/^[0-9a-f-]{36}$/.test(user.id))return null;
 await rpc('user_check',{user_id:user.id});return user.id;
}
async function boundedJson(req:Request) {
 if(Number(req.headers.get('content-length')||0)>8192)throw new Error('Request too large');
 const reader=req.body?.getReader();if(!reader)return {};
 let size=0,all='';const decoder=new TextDecoder();
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new Error('Request too large');}all+=decoder.decode(value,{stream:true});}
 all+=decoder.decode();return JSON.parse(all||'{}');
}
async function dispatch(req:Request) {
 const token=req.headers.get('X-Pablicus-Worker')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return response({error:'Unauthorized'},401);
 try{await rpc('worker_auth',{token});}catch{return response({error:'Unauthorized'},401);}
 const config=await ensureConfig();
 const jobs=await rpc('claim');
 let sent=0;
 // Five concurrent network requests, at most 25 rows per invocation.
 for(let offset=0;offset<jobs.length;offset+=5){
  await Promise.all(jobs.slice(offset,offset+5).map(async(job:any)=>{
   let status=0;
   try{status=await sendPush(job.subscription,job.payload,config);}catch{/* retry through durable outbox */}
   await rpc('finish',{id:job.id,lease:job.lease,status});
   if(status>=200&&status<300)sent++;
  }));
 }
 return response({ok:true,claimed:jobs.length,sent});
}
Deno.serve(async(req:Request)=>{
 try {
  const url=new URL(req.url);
  if(url.pathname.endsWith('/dispatch'))return req.method==='POST'?await dispatch(req):response({error:'Method not allowed'},405);
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==appOrigin)return response({error:'Origin not allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(!['GET','POST'].includes(req.method))return response({error:'Method not allowed'},405);
  const userId=await verifiedUser(req);if(!userId)return response({error:'Unauthorized'},401);
  if(req.method==='GET'){const config=await ensureConfig();return response({publicKey:config.publicKey});}
  let data;
  try{data=await boundedJson(req);}catch{return response({error:'Invalid request'},400);}
  if(!data||typeof data!=='object'||Array.isArray(data))return response({error:'Invalid request'},400);
  if(data.action==='subscribe'){
   let sub;
   try{sub=await validateSubscription(data.subscription);}catch{return response({error:'Invalid push subscription'},400);}
   await ensureConfig();
   return response(await rpc('subscribe',{user_id:userId,endpoint:sub.endpoint,p256dh:sub.keys.p256dh,auth:sub.keys.auth}));
  }
  if(data.action==='unsubscribe'){
   if(typeof data.endpoint!=='string'||data.endpoint.length>2048)return response({error:'Invalid endpoint'},400);
   return response(await rpc('unsubscribe',{user_id:userId,endpoint:data.endpoint}));
  }
  return response({error:'Unknown action'},400);
 } catch {return response({error:'Push service temporarily unavailable'},503);}
});
