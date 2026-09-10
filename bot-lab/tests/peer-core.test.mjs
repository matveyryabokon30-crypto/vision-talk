import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTH_KEY, API, PROJECT, RELEASE, readAccessToken, validateCode, validateActor, createPeerTester } from '../peer-core.mjs';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const D='44444444-4444-4444-8444-444444444444';
const code={version:1,project:PROJECT,run_id:C,owner_id:B,bot_id:C,chat_id:D};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function fixture(override) {
  const calls=[]; let token='test-access';
  const tester=createPeerTester({getToken:()=>token,randomUUID:()=>D,fetcher:async(url,options)=>{
    calls.push({url,options});
    if(override){const custom=await override(url,options,calls);if(custom)return custom;}
    return url.endsWith('/v1/me')?json(200,{id:A,scope:'manage'}):json(404,{error:{code:'NOT_FOUND'}});
  }});
  return {tester,calls,setToken:t=>{token=t}};
}
test('reads token without mutating Auth storage',()=>{
  const accesses=[];const storage={getItem:k=>{accesses.push(k);return k===AUTH_KEY?JSON.stringify({access_token:'x',refresh_token:'must-not-be-used'}):'false'}};
  assert.equal(readAccessToken(storage),'x');assert.deepEqual(accesses,['pablicus:passkey-unvalidated',AUTH_KEY]);
});
test('rejects unvalidated passkey candidate',()=>assert.equal(readAccessToken({getItem:()=> 'true'}),null));
test('broken or inaccessible storage is not an authenticated session',()=>{
  assert.equal(readAccessToken({getItem:()=>'{'}),null);assert.equal(readAccessToken({getItem:()=>{throw Error('blocked')}}),null);
});
test('accepts legacy session shapes, not arbitrary objects',()=>{
  for(const v of [{currentSession:{access_token:'x'}},{session:{access_token:'x'}}])assert.equal(readAccessToken({getItem:k=>k===AUTH_KEY?JSON.stringify(v):null}),'x');
  assert.equal(readAccessToken({getItem:k=>k===AUTH_KEY?JSON.stringify({access_token:{id:'x'}}):null}),null);
});
test('validates and sanitizes copied code',()=>assert.deepEqual(validateCode({...code,password:'do-not-copy'}),code));
test('rejects URL, wrong project, absent UUIDs, and oversized pasted reports',()=>{
  for(const value of ['https://example.com',JSON.stringify({...code,project:'wrong'}),{...code,chat_id:'no'},' '.repeat(2049)])assert.throws(()=>validateCode(value));
});
test('validates expected checking account',()=>{assert.equal(validateActor(A),A);assert.equal(validateActor(null),null);assert.throws(()=>validateActor('no'));});
test('performs exactly four target probes bracketed by Auth pre/postflight',async()=>{
  const {tester,calls}=fixture();const result=await tester.run(code,{expectedActor:A});
  assert.equal(result.complete,true);assert.equal(result.kind,'peer_isolation_only');assert.equal(result.checks.length,4);assert.equal(calls.length,6);
  assert.equal(result.second_owner,A);assert.equal(result.first_owner,B);assert.equal(result.outcome,'passed');
  assert.equal(calls[0].url,API+'/v1/me');assert.equal(calls[5].url,API+'/v1/me');
  assert.deepEqual(calls.map(x=>x.options.method),['GET','GET','GET','GET','POST','GET']);
  assert.ok(!JSON.stringify(result).includes('test-access'));assert.ok(result.finished_at);
});
test('missing token blocks all HTTP requests',async()=>{
  const f=fixture();f.setToken(null);const r=await f.tester.run(code);assert.equal(r.complete,false);assert.equal(r.error.code,'SESSION_INVALID');assert.equal(f.calls.length,0);
});
test('401 preflight means no peer probes and no overwritten full report',async()=>{
  const {tester,calls}=fixture(()=>json(401,{error:{code:'UNAUTHORIZED'}}));const r=await tester.run(code);
  assert.equal(calls.length,1);assert.equal(r.auth_verified,false);assert.equal(r.complete,false);assert.deepEqual(r.checks,[]);assert.equal(r.outcome,'inconclusive');assert.equal(r.error.code,'SESSION_INVALID');
});
test('401 during first peer probe is incomplete, not a security failure',async()=>{
  const {tester,calls}=fixture(url=>!url.endsWith('/me')?json(401,{error:{code:'UNAUTHORIZED'}}):null);const r=await tester.run(code);
  assert.equal(calls.length,2);assert.equal(r.complete,false);assert.equal(r.checks[0].pass,null);assert.equal(r.outcome,'inconclusive');assert.equal(r.error.code,'SESSION_INVALID');
});
test('same account is blocked before touching target resources',async()=>{
  const {tester,calls}=fixture();const r=await tester.run({...code,owner_id:A});assert.equal(r.error.code,'SAME_ACCOUNT');assert.equal(calls.length,1);
});
test('wrong checking account fails server-confirmed expected identity',async()=>{
  const {tester,calls}=fixture();const r=await tester.run(code,{expectedActor:C});assert.equal(r.error.code,'WRONG_ACCOUNT');assert.equal(calls.length,1);
});
test('chat-scoped key cannot substitute for ordinary user sign-in',async()=>{
  const {tester,calls}=fixture(()=>json(200,{id:A,scope:'chat'}));const r=await tester.run(code);assert.equal(r.error.code,'IDENTITY_UNCONFIRMED');assert.equal(calls.length,1);
});
test('unexpected 200 is a failed check and body is never read',async()=>{
  let read=false,cancel=false;
  const {tester,calls}=fixture(url=>!url.endsWith('/me')?{status:200,body:{cancel:async()=>{cancel=true}},text:async()=>{read=true;return 'private contents'}}:null);
  const r=await tester.run(code);assert.equal(read,false);assert.equal(cancel,true);assert.equal(r.outcome,'failed');assert.equal(r.error.code,'UNEXPECTED_ACCESS');assert.equal(r.complete,false);assert.equal(calls.length,2);assert.ok(!JSON.stringify(r).includes('private contents'));
});
test('404 without NOT_FOUND, 403, 429 and 500 do not pass isolation',async()=>{
  for(const status of [404,403,429,500]){
    const {tester}=fixture(url=>!url.endsWith('/me')?json(status,{error:{code:status===404?'OTHER':'FORBIDDEN'}}):null);
    const r=await tester.run(code);assert.equal(r.complete,false);assert.equal(r.checks[0].pass,null);assert.equal(r.outcome,'inconclusive');
  }
});
test('auth loss at final check cannot turn four denials into complete acceptance',async()=>{
  const {tester}=fixture((_url,_options,calls)=>calls.length===6?json(401,{error:{code:'UNAUTHORIZED'}}):null);
  const r=await tester.run(code);assert.equal(r.checks.length,4);assert.equal(r.complete,false);assert.equal(r.error.code,'SESSION_INVALID');
});
test('token change stops run instead of silently switching accounts',async()=>{
  const f=fixture((_url,_options,calls)=>{if(calls.length===2)f.setToken('other-account-token')});
  const r=await f.tester.run(code);assert.equal(r.complete,false);assert.equal(r.error.code,'SESSION_CHANGED');assert.equal(f.calls.length,2);
});
test('network failure is inconclusive and error does not echo tokens',async()=>{
  const {tester}=fixture(()=>{throw Error('sensitive-token-string')});const r=await tester.run(code);
  assert.equal(r.complete,false);assert.equal(r.error.code,'NETWORK_ERROR');assert.ok(!JSON.stringify(r).includes('sensitive-token-string'));
});
test('target failure serializes only allowlisted error and request ID',async()=>{
  const {tester}=fixture(url=>!url.endsWith('/me')?json(401,{error:{code:'<secret>',message:'sensitive'},request_id:'secret'}):null);
  const r=await tester.run(code);assert.ok(!JSON.stringify(r).includes('sensitive'));assert.equal(r.error.request_id,null);
});
test('requests are fixed-origin, no cookies, no redirects, no-cache',async()=>{
  const f=fixture();await f.tester.run(code);for(const {url,options:o} of f.calls){assert.ok(url.startsWith(API+'/v1/'));assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');assert.equal(o.cache,'no-store');assert.equal(o.referrerPolicy,'no-referrer')}
});
test('progress output does not expose credentials and ends at complete',async()=>{
  const f=fixture(),progress=[];await f.tester.run(code,{onProgress:r=>progress.push(r)});
  assert.equal(progress.at(-1).complete,true);assert.ok(progress.slice(0,-1).every(x=>x.complete===false));assert.ok(!JSON.stringify(progress).includes('test-access'));
});
test('page never writes auth/legacy report storage or invokes token refresh',()=>{
  const source=readFileSync(new URL('../peer-page.mjs',import.meta.url),'utf8');
  assert.ok(!/localStorage\.(setItem|removeItem|clear)\(/.test(source));assert.ok(!/refreshSession|setSession|signOut|\/auth\/v1\/token|public-bot-lab:v1/.test(source));
});
test('HTML has visible local result button, no full-run trigger or external scripts',()=>{
  const source=readFileSync(new URL('../peer.html',import.meta.url),'utf8');
  assert.ok(source.includes('id="copyResult"'));assert.ok(!source.includes('id="run"'));assert.ok(source.includes(RELEASE));assert.ok(!/<script[^>]+src="https?:/.test(source));
});
