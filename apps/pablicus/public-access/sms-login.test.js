'use strict';
// Real bundled Auth client with strictly mocked HTTP. No SMS is sent.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
// The browser UMD bundle needs its normal worker globals to load in Node.
// Execute the exact checked-in SDK bytes; no Auth methods are replaced.
const runtime={module:{exports:{}},exports:{},URL,URLSearchParams,Headers,Request,Response,AbortController,TextEncoder,TextDecoder,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,setInterval,clearInterval,location:'https://sms-fixture.invalid/vendor/supabase.js',importScripts(){throw Error('Unexpected script import')},fetch(){throw Error('Unexpected real network request')}};
runtime.self=runtime;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../vendor/supabase.js'),'utf8'),runtime,{filename:'supabase-browser-bundle',timeout:3000});
const {createClient}=runtime.module.exports;
const {create}=require('./sms-login.js');
const PHONE='+15555550123',OTHER='+15555550456',OTP='246810';
const ID='11111111-1111-4111-8111-111111111111';
function fixture(options={}){
 const calls=[],state={...options},entered=[];
 const base={id:ID,phone:PHONE.slice(1),phone_confirmed_at:'2026-09-08T00:00:00Z',aud:'authenticated',role:'authenticated',app_metadata:{provider:'phone',providers:['phone']},user_metadata:{}};
 const jwt=[{alg:'HS256',typ:'JWT'},{sub:ID,exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.FIXTURE_NOT_A_SIGNATURE';
 const session={access_token:jwt,refresh_token:'FIXTURE_NOT_A_REAL_REFRESH_TOKEN',expires_in:3600,token_type:'bearer',user:base};
 const fetch=async (url,init={})=>{
  const u=new URL(url);assert.equal(u.origin,'https://sms-fixture.invalid');
  const body=init.body?JSON.parse(init.body):{};calls.push({path:u.pathname,body});
  let status=200,result={};
  if(u.pathname==='/auth/v1/otp'){
   assert.equal(body.channel,'sms');assert.equal(body.create_user,true);assert.equal(body.phone,PHONE);
   assert.ok(!('password' in body)&&!('email' in body));
   if(state.rejected){status=429;result={code:'over_sms_send_rate_limit',msg:'Too many requests'}}
  }else if(u.pathname==='/auth/v1/verify'){
   assert.deepEqual({phone:body.phone,token:body.token,type:body.type},{phone:PHONE,token:OTP,type:'sms'});
   if(state.expired){status=403;result={code:'otp_expired',msg:'Expired'}}else result=session;
  }else if(u.pathname==='/auth/v1/user')result={...base,...(state.wrongPhone?{phone:OTHER.slice(1)}:{}),...(state.unconfirmed?{phone_confirmed_at:null}:{})};
  else if(u.pathname==='/auth/v1/logout')result={};
  else assert.fail('Unexpected endpoint '+u.pathname);
  return new Response(JSON.stringify(result),{status,headers:{'content-type':'application/json'}});
 };
 const client=createClient('https://sms-fixture.invalid','PUBLIC_FIXTURE_KEY',{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},global:{fetch}});
 let now=0;
 const flow=create({client,enabled:options.enabled!==false,clock:()=>now,authenticate:async s=>{if(state.denied)throw Error('not_approved');entered.push(s.user.id)}});
 return {flow,calls,state,entered,advance:()=>{now+=61000}};
}
test('request, verify and enter: actual SDK sends phone/SMS only',async()=>{
 const f=fixture();assert.equal(await f.flow.request('+1 (555) 555-0123'),true);
 assert.equal(f.entered.length,0);assert.equal(f.flow.snapshot().phase,'code');
 assert.equal(await f.flow.request(PHONE),false);assert.equal(f.calls.length,1);
 assert.equal(await f.flow.verify(OTP),true);assert.deepEqual(f.entered,[ID]);
 assert.equal(f.flow.snapshot().phone,'');assert.equal(f.flow.snapshot().phase,'signed_in');
 assert.ok(!JSON.stringify(f.flow.snapshot()).includes(OTP));
});
test('disabled service and malformed numbers do not transmit',async()=>{
 const disabled=fixture({enabled:false});await disabled.flow.request(PHONE);assert.equal(disabled.calls.length,0);
 const f=fixture();for(const s of ['5555550123','a@example.com','+0 1234','+15555550123<script>'])assert.equal(await f.flow.request(s),false);
 assert.equal(f.calls.length,0);assert.equal(await f.flow.verify(OTP),false);
});
test('SMS rejection does not expose code form or claim success',async()=>{
 const f=fixture({rejected:true});assert.equal(await f.flow.request(PHONE),false);assert.equal(f.flow.snapshot().phase,'phone');assert.equal(f.entered.length,0);
});
test('expired code fails, number changes invalidate pending verification',async()=>{
 const f=fixture({expired:true});await f.flow.request(PHONE);assert.equal(await f.flow.verify(OTP),false);assert.equal(f.entered.length,0);
 f.flow.changeNumber();const before=f.calls.length;assert.equal(await f.flow.verify(OTP),false);assert.equal(f.calls.length,before);
 f.advance();f.state.expired=false;await f.flow.request(PHONE);assert.equal(await f.flow.verify(OTP),true);
});
test('different or unconfirmed server identity never enters app',async()=>{
 for(const state of [{wrongPhone:true},{unconfirmed:true}]){
  const f=fixture(state);await f.flow.request(PHONE);assert.equal(await f.flow.verify(OTP),false);assert.equal(f.entered.length,0);
  assert.ok(f.calls.some(c=>c.path==='/auth/v1/logout'));assert.equal(f.flow.snapshot().phase,'phone');
 }
});
test('host approval rejection is not reported as successful app login',async()=>{
 const f=fixture({denied:true});await f.flow.request(PHONE);assert.equal(await f.flow.verify(OTP),false);assert.equal(f.entered.length,0);assert.notEqual(f.flow.snapshot().phase,'signed_in');
});
