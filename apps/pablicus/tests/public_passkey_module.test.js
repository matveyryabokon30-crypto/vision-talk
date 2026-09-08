'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const api=require('../src/public-passkey.js'),oauth=require('../src/oauth-login.js');
const PROJECT='https://public-passkey-fixture.invalid',REDIRECT='https://pablicus-fixture.invalid/pablicus/';
function fixture(){
 const values=new Map(),navigated=[],calls=[];
 const runtime={URL,URLSearchParams,Headers,Request,Response,AbortController,TextEncoder,TextDecoder,crypto:webcrypto,btoa,atob,console,WebSocket,setTimeout,clearTimeout,setInterval,clearInterval,location:PROJECT+'/vendor/supabase.js',importScripts(){throw Error('Unexpected import')},fetch(url){calls.push(String(url));throw Error('Unexpected network')}};
 runtime.self=runtime;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../vendor/supabase.js'),'utf8'),runtime);
 const client=runtime.supabase.createClient(PROJECT,'PUBLIC_FIXTURE_KEY',{auth:{flowType:'pkce',storageKey:'public-passkey-test',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}},global:{fetch:runtime.fetch}});
 const flow=api.create({client,projectUrl:PROJECT,redirectTo:REDIRECT,config:{enabled:true},validateAuthorizeUrl:oauth.validateAuthorizeUrl,onNavigate:url=>navigated.push(url)});
 return {flow,values,navigated,calls};
}
test('real SDK starts one public-key OAuth flow with stored S256 and no contact/password',async()=>{
 const f=fixture();assert.equal(await f.flow.start(),true);assert.equal(await f.flow.start(),false);
 assert.equal(f.navigated.length,1);
 const url=new URL(f.navigated[0]);assert.equal(url.origin,PROJECT);assert.equal(url.pathname,'/auth/v1/authorize');
 assert.equal(url.searchParams.get('provider'),api.provider);assert.equal(url.searchParams.get('redirect_to'),REDIRECT);
 const verifier=JSON.parse(f.values.get('public-passkey-test-code-verifier'));
 assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(verifier).digest('base64url'));
 for(const key of ['email','password','phone','client_secret'])assert.equal(url.searchParams.has(key),false);
 assert.deepEqual(f.calls,[]);f.flow.resume();assert.equal(await f.flow.start(),true);
});
test('disabled public signup never calls Auth',async()=>{
 let calls=0;
 for(const config of [{},{enabled:false},{enabled:'true'}]){
  const flow=api.create({client:{auth:{signInWithOAuth(){calls++;throw Error('unexpected')}}},config});
  assert.equal(await flow.start(),false);
 }
 assert.equal(calls,0);
});
test('malicious or implicit authorize destination cannot be followed',async()=>{
 for(const url of ['https://evil.example/','https://public-passkey-fixture.invalid/auth/v1/authorize?provider=custom:pablicus-passkey']){
  let navigation=0;
  const flow=api.create({client:{auth:{async signInWithOAuth(){return {data:{provider:api.provider,url}}}}},config:{enabled:true},projectUrl:PROJECT,redirectTo:REDIRECT,validateAuthorizeUrl:oauth.validateAuthorizeUrl,onNavigate(){navigation++}});
  assert.equal(await flow.start(),false);assert.equal(navigation,0);assert.equal(flow.snapshot().busy,false);
 }
});
test('native bridge must return the original UID; unverified contact metadata cannot link it',()=>{
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 const user=(id,sub)=>({id,identities:[{provider:api.provider,identity_data:{sub}}]});
 assert.equal(api.identityValid(user(a,'native:'+a)),true);
 assert.equal(api.identityValid(user(b,'native:'+a)),false);
 assert.equal(api.identityValid(user(a,'native:not-a-uuid')),false);
 assert.equal(api.identityValid(user(a,b)),true);
 assert.equal(api.identityValid({id:a,identities:[{provider:api.provider,id:'native:'+a,identity_id:b}]}),true);
 assert.equal(api.identityValid(user(a,'')),false);
 assert.equal(api.identityValid({id:a,user_metadata:{sub:'native:'+b}}),true);
 assert.equal(api.ownsPublicKey({id:a,user_metadata:{provider:api.provider}}),false);
});
