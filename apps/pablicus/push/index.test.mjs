import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateVapid} from './webpush.mjs';

test('Edge boundary verifies user independently; never exposes worker/VAPID secrets',async t=>{
 const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
 let handler,calls=[];const config=await generateVapid();
 const uid='10000000-0000-4000-8000-000000000001',token='a'.repeat(80),workerToken='b'.repeat(64);
 globalThis.Deno={env:{get:n=>n==='SUPABASE_URL'?'https://project.supabase.co':'fake-private-service-key'},serve:fn=>{handler=fn;}};
 globalThis.fetch=async(url,init)=>{
  if(url==='https://project.supabase.co/auth/v1/user')return new Response(JSON.stringify(init.headers.Authorization==='Bearer '+token?{id:uid}:{}),{status:init.headers.Authorization==='Bearer '+token?200:401});
  assert.equal(url,'https://project.supabase.co/rest/v1/rpc/pablicus_push_rpc');assert.equal(init.headers.apikey,'fake-private-service-key');
  const {p_action:action,p_input:input}=JSON.parse(init.body);calls.push({action,input});
  if(action==='worker_auth'&&input.token!==workerToken)return new Response('{}',{status:403});
  return new Response(JSON.stringify(action==='config'?config:action==='claim'?[]:{ok:true}));
 };
 try{
  await import('./index.ts');
  const request=(path='',init={})=>new Request('https://project.supabase.co/functions/v1/pablicus-push'+path,init);
  const auth={Authorization:'Bearer '+token,Origin:'https://matveyryabokon30-crypto.github.io','Content-Type':'application/json'};
  await t.test('anonymous and invalid Auth tokens cannot access config or database operations',async()=>{
   calls=[];assert.equal((await handler(request())).status,401);assert.equal((await handler(request('',{headers:{Authorization:'Bearer '+'x'.repeat(80)}}))).status,401);assert.equal(calls.length,0);
  });
  await t.test('authenticated config returns public key only',async()=>{
   const res=await handler(request('',{headers:auth}));assert.equal(res.status,200);assert.deepEqual(await res.json(),{publicKey:config.publicKey});assert.ok(calls.some(c=>c.action==='user_check'&&c.input.user_id===uid));
  });
  await t.test('request-supplied identity is ignored; unsubscribe is tied to Auth verified user',async()=>{
   calls=[];const res=await handler(request('',{method:'POST',headers:auth,body:JSON.stringify({action:'unsubscribe',endpoint:'https://web.push.apple.com/owned',user_id:'attacker-choice'})}));assert.equal(res.status,200);
   assert.deepEqual(calls.find(c=>c.action==='unsubscribe').input,{user_id:uid,endpoint:'https://web.push.apple.com/owned'});
  });
  await t.test('foreign origin and malformed/oversized bodies are rejected',async()=>{
   assert.equal((await handler(request('',{headers:{...auth,Origin:'https://evil.example'}}))).status,403);
   for(const body of ['null','[]','no JSON','a'.repeat(8193)])assert.equal((await handler(request('',{method:'POST',headers:auth,body}))).status,400);
  });
  await t.test('dispatch requires separate secret, cannot be invoked with a user token',async()=>{
   calls=[];assert.equal((await handler(request('/dispatch',{method:'POST',headers:auth,body:'{}'}))).status,401);assert.equal(calls.length,0);
   assert.equal((await handler(request('/dispatch',{method:'POST',headers:{'X-Pablicus-Worker':'c'.repeat(64)},body:'{}'}))).status,401);
   const res=await handler(request('/dispatch',{method:'POST',headers:{'X-Pablicus-Worker':workerToken},body:'{}'}));assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,claimed:0,sent:0});
  });
 } finally {globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;}
});
