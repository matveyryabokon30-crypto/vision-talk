"""Browser + IndexedDB integration with EXPLICIT mocked Supabase.
Persistent profiles model ordinary browsing. Private/incognito Blob persistence
is not claimed; the earlier ephemeral-WebKit failure remains in CI evidence.
"""
import asyncio,json,mimetypes,traceback,tempfile,shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
R=Path(__file__).resolve().parents[1];D=R/'dist';E=R/'evidence';E.mkdir(exist_ok=True)
MOCK=r'''window.__mock={sent:[],read:0,online:true,objects:new Map()};window.supabase=(()=>{
const user={id:'11111111-1111-4111-8111-111111111111'},peer='33333333-3333-4333-8333-333333333333',chat='22222222-2222-4222-8222-222222222222';const profile={id:user.id,username:'qa_user',display_name:'QA account',is_approved:true};let seq=3;
let messages=[1,2,3].map(i=>({id:'m'+i,client_message_id:'base-'+i,conversation_id:chat,server_seq:i,sender_id:peer,type:'text',body:'Test '+i,attachment_path:null,attachment_metadata:null,created_at:new Date().toISOString()}));
const result=(data,error=null)=>Promise.resolve({data,error});
function chain(table){let filters=[],sort=null,lim=null;const q={select(){return q},eq(k,v){filters.push([k,'eq',v]);return q},neq(k,v){filters.push([k,'neq',v]);return q},gt(k,v){filters.push([k,'gt',v]);return q},lt(k,v){filters.push([k,'lt',v]);return q},order(k,o){sort=[k,o];return q},limit(n){lim=n;return q},single(){return result(profile)},maybeSingle(){return run(true)},then(a,b){return run(false).then(a,b)}};function run(single){let d=table==='messages'?messages.slice():table==='conversation_members'?[{conversation_id:chat,user_id:peer,last_read_seq:2}]:table==='profiles'?[profile]:[];for(const[k,op,v]of filters)d=d.filter(x=>op==='eq'?x[k]===v:op==='neq'?x[k]!==v:op==='gt'?x[k]>v:x[k]<v);if(sort)d.sort((a,b)=>(a[sort[0]]>b[sort[0]]?1:-1)*(sort[1]?.ascending===false?-1:1));if(lim)d=d.slice(0,lim);return result(single?(d[0]||null):d)}return q}
window.__mock.incoming=()=>messages.push({id:'m'+(++seq),client_message_id:'incoming-'+seq,conversation_id:chat,server_seq:seq,sender_id:peer,type:'text',body:'Live incoming fixture',attachment_path:null,attachment_metadata:null,created_at:new Date().toISOString()});
// All SDK clients talk to one backend. A request-only recovery client must not
// replace the incoming fixture's message store or inherit the app's session.
return{createClient(_url,_key,options={}){const requestOnly=options.auth?.persistSession===false;
return{auth:{getSession:()=>result({session:requestOnly?null:{user,access_token:'MOCK'}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithPassword:()=>result({session:{user}}),signOut:()=>result(null)},from:chain,
rpc:async(name,args)=>{if(name.startsWith('my_conversations'))return result([{id:chat,title:'@qa_peer',last_message:messages.at(-1)?.body||'',last_seq:seq,last_read_seq:2,unread_count:1,last_message_at:new Date().toISOString()}]);if(name==='mark_conversation_read'){window.__mock.read=args.p_last_read_seq;return result(args.p_last_read_seq)}if(name==='start_direct_conversation'||name==='start_saved_conversation')return result(chat);if(name==='send_message'||name==='send_attachment_message'||name==='send_rich_message'){if(!window.__mock.online)return result(null,{name:'TypeError',message:'network request failed'});const old=messages.find(m=>m.client_message_id===args.p_client_message_id);if(old)return result(old);const type=name==='send_rich_message'?'rich':name==='send_message'?'text':args.p_type;const m={id:'s'+(++seq),client_message_id:args.p_client_message_id,conversation_id:chat,server_seq:seq,sender_id:user.id,type,body:name==='send_rich_message'?args.p_content.blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n'):args.p_body||args.p_caption||null,attachment_path:args.p_attachment_path||null,attachment_metadata:name==='send_rich_message'?args.p_content:name==='send_attachment_message'?{name:args.p_attachment_name,mime_type:args.p_mime_type,size_bytes:args.p_size_bytes}:null,created_at:new Date().toISOString()};messages.push(m);window.__mock.sent.push(m);return result(m)}return result(null)},
channel(){return{on(){return this},subscribe(cb){setTimeout(()=>cb?.('SUBSCRIBED'),10);return this}}},removeChannel:()=>Promise.resolve(),storage:{from(){return{async upload(path,blob){if(!window.__mock.online)return result(null,{name:'TypeError',message:'network request failed'});window.__mock.objects.set(path,blob);window.__mock.uploadedSize=blob.size;return result({path})},async createSignedUrl(path){if(!window.__mock.objects.has(path))return result(null,{message:'missing'});return result({signedUrl:'data:text/plain,stored'})}}}}};}};})();'''
async def one(name,engine):
 directory=tempfile.mkdtemp(prefix='pablicus-browser-')
 ctx=await engine.launch_persistent_context(directory,headless=True,viewport={'width':440,'height':766},has_touch=True,service_workers='block')
 async def route(route):
  path=urlparse(route.request.url).path.lstrip('/') or 'index.html'
  if path=='vendor/supabase.js':return await route.fulfill(status=200,content_type='application/javascript',body=MOCK)
  f=D/path
  if not f.is_file():return await route.fulfill(status=404,body='not found')
  return await route.fulfill(status=200,content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream',body=f.read_bytes())
 await ctx.route('http://127.0.0.1:8765/**',route)
 page=await ctx.new_page();page.set_default_timeout(12000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));checks=[]
 try:
  await page.goto('http://127.0.0.1:8765/',wait_until='domcontentloaded');await page.wait_for_selector('.chatMain')
  assert await page.locator('#mainNav button').count()==4;checks.append('four tabs')
  await page.locator('.chatMain').click();await page.wait_for_function('window.PablicusChat?.store && window.PablicusChat.list');await page.wait_for_timeout(350)
  assert await page.evaluate('PablicusDebug.messageCount')==3;checks.append('backend fixture replaces synthetic gate dataset')
  await page.locator('#input').fill('Durable draft RC2 🙂');await page.wait_for_timeout(800);await page.reload();await page.wait_for_selector('.chatMain');await page.locator('.chatMain').click();await page.wait_for_timeout(800)
  assert await page.locator('#input').input_value()=='Durable draft RC2 🙂';checks.append('draft survives navigation')
  await page.locator('#send').click();await page.wait_for_function('__mock.sent.length===1');await page.wait_for_function('PablicusChat.store.readQueue(false).then(x=>x.length===0)');checks.append('ACK retires outbox')
  await page.evaluate('PablicusDebug.pump()');await page.wait_for_timeout(150);assert await page.evaluate('__mock.sent.length')==1;checks.append('repeated pump does not duplicate')
  await page.evaluate('__mock.incoming()');await page.get_by_text('Live incoming fixture',exact=True).wait_for();checks.append('retained polling displays incoming without reopening')
  await page.evaluate('__mock.online=false');await page.locator('#input').fill('Recover after network');await page.wait_for_timeout(800);await page.locator('#send').click();await page.wait_for_timeout(600);assert await page.evaluate('PablicusChat.store.readQueue(false).then(x=>x.length)')==1;checks.append('failed send persists')
  await page.reload();await page.wait_for_selector('.chatMain');await page.locator('.chatMain').click();await page.wait_for_function('__mock.sent.length===1',timeout=35000);await page.wait_for_function('PablicusChat.store.readQueue(false).then(x=>x.length===0)');checks.append('reopen resumes one send')
  await page.evaluate("PablicusChat.addFiles([new File(['document bytes'],'test.txt',{type:'text/plain'})])");await page.wait_for_timeout(700);await page.locator('#send').click();await page.wait_for_function('__mock.sent.length===2');assert await page.evaluate('__mock.uploadedSize')==14;checks.append('original document bytes reach upload adapter')
  await page.locator('#input').fill('строка\n'*25);await page.locator('#expand').click();assert await page.evaluate('PablicusChat.draft.expanded');await page.locator('#input').press('End');await page.locator('#input').press_sequentially(' продолжение');assert await page.evaluate('PablicusChat.draft.expanded');checks.append('fullscreen persists during typing')
  await page.locator('#expand').click();await page.locator('#chatBack').click();await page.locator('#mainNav [data-page="profile"]').click();await page.locator('.profileCard select').select_option('dark');await page.wait_for_timeout(150);checks.append('profile and dark theme')
  assert not errors,errors;checks.append('no JS errors')
  await page.screenshot(path=str(E/f'{name}-pass.png'))
  return {'engine':name,'pass':True,'checks':checks,'profile_mode':'persistent ordinary profile','scope':'browser + IndexedDB + mocked Supabase; NOT live backend or physical iPhone'}
 except Exception:
  await page.screenshot(path=str(E/f'{name}-failure.png'));(E/f'{name}-failure.txt').write_text(traceback.format_exc()+'\nJS errors: '+str(errors));return {'engine':name,'pass':False,'checks':checks,'error':traceback.format_exc(),'js_errors':errors}
 finally:await ctx.close();shutil.rmtree(directory,ignore_errors=True)
async def main():
 async with async_playwright() as p:out=[await one(n,getattr(p,n)) for n in ('chromium','webkit')]
 (E/'integration.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out,ensure_ascii=False));assert all(r['pass'] for r in out)
asyncio.run(main())
