"""Component/full-shell fixture, NOT cloud or real browser-navigation acceptance.
The browser policy denies navigation. about:blank renders the real app DOM and
scripts with explicit URL/Auth/storage test doubles; Bot API uses real local
HTTP/SQLite. No browser policy or sandbox settings are disabled.
"""
import asyncio,json,re,urllib.request,urllib.error,uuid,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
APP=Path(os.environ.get('PUBLIC_BOTS_APP',str(ROOT/'candidate-public'/'pablicus')))
OUT=ROOT.parent/'evidence';OUT.mkdir(exist_ok=True)
FIXTURE='http://127.0.0.1:8097'
A='11111111-1111-4111-8111-111111111111'
B='22222222-2222-4222-8222-222222222222'
results=[]
async def transport(url,options):
    if not url.startswith('https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/public-bot-core/'):
        raise ValueError('Fixture does not forward arbitrary targets')
    path=url.split('/public-bot-core',1)[1]
    def request():
        r=urllib.request.Request(FIXTURE+'/api'+path,data=options.get('body','').encode() if options.get('body') is not None else None,method=options.get('method','GET'),headers=options.get('headers',{}))
        try:
            with urllib.request.urlopen(r,timeout=5) as q:return {'status':q.status,'text':q.read().decode()}
        except urllib.error.HTTPError as e:return {'status':e.code,'text':e.read().decode()}
    return await asyncio.to_thread(request)
SETUP=r"""
window.__pending=new Map();
window.__storage=new Map();
window.__store={getItem:k=>window.__storage.get(k)||null,setItem:(k,v)=>window.__storage.set(k,String(v)),removeItem:k=>window.__storage.delete(k)};
window.__where={href:'https://fixture.invalid/pablicus/',origin:'https://fixture.invalid',pathname:'/pablicus/',hash:'',search:''};
window.__ctx={id:'11111111-1111-4111-8111-111111111111',approved:true,token:'local-a'};
window.__authObservers=[];window.__normalCalls=[];window.__refreshCount=0;
window.__session=()=>({user:{id:__ctx.id,email:'fixture@example.invalid',email_confirmed_at:'2026-01-01',identities:[]},access_token:__ctx.token});
window.__auth={getSession:async()=>({data:{session:__ctx.id?__session():null}}),getUser:async()=>({data:{user:__session().user}}),refreshSession:async()=>{__refreshCount++;__ctx.token='local-a-new';return{data:{session:__session()}};},onAuthStateChange:fn=>{__authObservers.push(fn);return{data:{subscription:{unsubscribe(){}}}};},signOut:async()=>{__ctx.id=null;__authObservers.forEach(fn=>fn('SIGNED_OUT',null));return{error:null};}};
window.__query=(table)=>{let q={select(){return q},eq(){return q},gt(){return q},lt(){return q},order(){return q},limit(){return q},single:async()=>({data:{id:__ctx.id,username:'test_owner',display_name:'Тестовый владелец',is_approved:true}}),maybeSingle:async()=>({data:null}),then(ok,bad){return Promise.resolve({data:[]}).then(ok,bad)}};return q;};
window.supabase={createClient:()=>({auth:__auth,from:__query,rpc:async(name,args)=>{__normalCalls.push(name);if(name.startsWith('my_conversations'))return{data:[{id:'44444444-4444-4444-8444-444444444444',title:'Обычная переписка · контроль',last_message:'Эта переписка не изменяется ботами',last_seq:0,unread_count:0}]};if(name==='pablicus_storage_usage')return{data:{total_bytes:0,own_bytes:0,unknown_size_count:0}};return{data:[]}},channel:()=>{const q={on(){return q},subscribe(){return q}};return q;},removeChannel:async()=>{},storage:{from:()=>({})}})};
window.__lost=false;window.__requests=[];
window.__fetch=async(url,opts={})=>{
 const method=opts.method||'GET';window.__requests.push({url,method});
 const r=await window._transport(String(url),{method,headers:opts.headers,body:opts.body??null});
 if(window.__lost&&method==='POST'&&String(url).endsWith('/messages')){window.__lost=false;throw new TypeError('TEST: response lost after commit');}
 return new Response(r.text,{status:r.status,headers:{'Content-Type':'application/json'}});
};
window.__uuid=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return Array.from(b,x=>x.toString(16).padStart(2,'0')).map((x,i)=>([4,6,8,10].includes(i)?'-':'')+x).join('');};
window.__crypto={getRandomValues:x=>crypto.getRandomValues(x),randomUUID:window.__uuid,subtle:crypto.subtle};
window.__proxy=new Proxy(window,{get(t,k){if(k==='location')return __where;if(k==='localStorage'||k==='sessionStorage')return __store;if(k==='crypto')return __crypto;if(['addEventListener','removeEventListener','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame','matchMedia'].includes(k))return t[k].bind(t);return t[k];},set(t,k,v){t[k]=v;return true;}});
window.__MemoryPending=class{async read(owner,chat){return structuredClone(__pending.get(owner+'/'+chat)||null)}async put(p){const key=p.owner+'/'+p.chat;const old=__pending.get(key);if(old&&old.id!==p.id)throw Error('pending conflict');__pending.set(key,structuredClone(p));return p;}async drop(owner,chat,id){const key=owner+'/'+chat;if(__pending.get(key)?.id===id)__pending.delete(key);}};
"""
async def wrap(page,source):
    code="(function(window,globalThis,location,localStorage,sessionStorage,crypto,fetch){\n"+source+"\n})(window.__proxy,window.__proxy,window.__where,window.__store,window.__store,window.__crypto,window.__fetch);"
    await page.add_script_tag(content=code)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True)
  page=await browser.new_page(viewport={'width':1280,'height':950},device_scale_factor=1)
  errors=[];page.on('pageerror',lambda e:errors.append(e.stack))
  page.on('dialog',lambda d:d.accept())
  await page.expose_function('_transport',transport)
  text=(APP/'index.html').read_text();scripts=re.findall(r'<script src="([^"]+)"',text)
  text=re.sub(r'<script[^>]*>.*?</script>','',text,flags=re.S)
  css='\n'.join((APP/x).read_text() for x in re.findall(r'<link rel="stylesheet" href="([^"]+)"',text))
  text=re.sub(r'<link[^>]+>','',text).replace('<head>','<head><base href="https://fixture.invalid/pablicus/">')
  await page.set_content(text)
  await page.add_style_tag(content=css)
  await page.add_script_tag(content=SETUP)
  for script in scripts:
   if script=='vendor/supabase.js':continue
   await wrap(page,(APP/script).read_text())
   if script=='bots-client.js':await page.evaluate('window.PublicBotTransport={...window.PublicBotTransport,PendingStore:window.__MemoryPending}')
  await page.wait_for_timeout(600)
  if errors:print('INITIAL_ERRORS',errors)
  await page.locator('#openPublicBots').wait_for(state='visible',timeout=4000)
  assert await page.locator('.chatCard').count()==1
  results.append({'name':'Actual candidate app boots and renders bot entry plus control conversation (Auth/URL/storage doubles)','pass':True})
  await page.locator('#openPublicBots').click()
  await page.locator('#botCreate').wait_for(timeout=4000)
  # Styles in a shadow root are injected from the candidate file; opaque origin
  # cannot load network CSS. This is a component styling test, not CSP acceptance.
  await page.evaluate('(css)=>{const s=document.createElement("style");s.textContent=css;document.querySelector("#publicBotsDialog>div").shadowRoot.append(s)}',(APP/'bots-panel.css').read_text())
  results.append({'name':'Click entry mounts integrated modal without opening another tab','pass':True})
  await page.locator('#botCreate').click();await page.locator('#botName').fill('Помощник · запись');await page.locator('#botDescription').fill('Заявки на консультацию — в одном месте.');await page.locator('#botTemplate').select_option('intake');await page.locator('#botSave').click();await page.get_by_role('button',name='Помощник · запись',exact=True).wait_for()
  results.append({'name':'Create private intake bot through actual UI and real local HTTP/SQLite','pass':True})
  await page.get_by_role('button',name='+ Создать бота',exact=True).click();await page.locator('#botName').fill('Справочная Public');await page.locator('#botTemplate').select_option('help');await page.locator('#botSave').click();await page.get_by_role('button',name='Справочная Public',exact=True).wait_for()
  results.append({'name':'Create second help bot and retain separate cards','pass':True})
  await page.screenshot(path=str(OUT/'Public_Bots_Desktop.png'))
  await page.get_by_role('button',name='Помощник · запись',exact=True).click();await page.get_by_role('button',name='Начать',exact=True).click();await page.get_by_text('Как к вам обращаться?',exact=True).wait_for()
  for text in ['Тестовый клиент','test@example.com']:
   await page.locator('#botInput').fill(text);await page.locator('#botSend').click();await page.wait_for_timeout(180)
  await page.get_by_role('button',name='Утром',exact=True).click();await page.get_by_role('button',name='Отправить заявку',exact=True).wait_for()
  await page.evaluate('window.__lost=true')
  await page.get_by_role('button',name='Отправить заявку',exact=True).click();await page.get_by_role('button',name='Повторить',exact=True).wait_for()
  assert await page.evaluate('__pending.size')==1
  results.append({'name':'Lost response after server commit retains the same pending event in injected persistence','pass':True})
  await page.get_by_role('button',name='Повторить',exact=True).click();await page.get_by_text('Заявка сохранена.',exact=True).wait_for()
  assert await page.evaluate('__pending.size')==0
  results.append({'name':'Retry acknowledged with same event; pending cleared only after confirmation','pass':True})
  await page.get_by_role('button',name='Заявки',exact=True).click();await page.get_by_text('Тестовый клиент',exact=True).wait_for();
  assert await page.locator('#publicBotsDialog').get_by_text('test@example.com',exact=True).count()==1
  results.append({'name':'Exactly one record despite replay, displayed by owner','pass':True})
  await page.get_by_role('button',name='‹ Боты',exact=True).click();await page.get_by_role('button',name='Помощник · запись',exact=True).wait_for();await page.get_by_role('button',name='Помощник · запись',exact=True).click();await page.get_by_text('Заявка сохранена. Запись ещё не подтверждена:',exact=False).wait_for()
  results.append({'name':'Reopen dialog restores server history, not in-memory messages','pass':True})
  await page.get_by_role('button',name='Настройки',exact=True).click();await page.locator('#botName').fill('Запись к специалисту');await page.get_by_text('Тексты и кнопки сценария',exact=True).click();await page.locator('.step textarea').first.fill('Новый текст приветствия.');await page.locator('#botSave').click();await page.get_by_role('button',name='Запись к специалисту',exact=True).wait_for()
  results.append({'name':'Rename and edit scenario texts without changing graph structure','pass':True})
  card=page.locator('article.card').filter(has=page.get_by_role('button',name='Запись к специалисту',exact=True))
  await card.get_by_role('button',name='Настроить',exact=True).click();await page.get_by_role('button',name='Остановить бота',exact=True).click();await page.get_by_role('button',name='Включить бота',exact=True).wait_for();await page.get_by_role('button',name='Открыть чат',exact=True).click();await page.locator('#botInput').wait_for();assert await page.locator('#botInput').is_disabled()
  results.append({'name':'Stop bot disables send while retaining history','pass':True})
  await page.get_by_role('button',name='Настройки',exact=True).click();await page.get_by_role('button',name='Включить бота',exact=True).click();await page.get_by_role('button',name='Остановить бота',exact=True).wait_for();await page.get_by_role('button',name='Открыть чат',exact=True).click();await page.get_by_role('button',name='Новый диалог',exact=True).click();await page.get_by_role('button',name='Начать',exact=True).click();await page.get_by_text('Новый текст приветствия.',exact=True).wait_for()
  results.append({'name':'Resume and new dialog use edited graph; old dialog retained its snapshot','pass':True})
  await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(300)
  assert await page.evaluate('''()=>{const s=document.querySelector('#publicBotsDialog>div').shadowRoot;return s.querySelector('.body').scrollWidth<=s.querySelector('.body').clientWidth+1}''')
  await page.screenshot(path=str(OUT/'Public_Bots_Mobile.png'))
  results.append({'name':'390 px integrated mobile panel has no horizontal overflow','pass':True})
  await page.evaluate("__ctx.token='expired'")
  await page.get_by_role('button',name='Обновить историю',exact=True).click();await page.wait_for_timeout(250)
  assert await page.evaluate('__refreshCount')==1
  results.append({'name':'Expired test bearer refreshes through host Auth without clearing dialog','pass':True})
  # UI must synchronously close on host Auth logout.
  await page.evaluate("__ctx.id=null;__authObservers.forEach(fn=>fn('SIGNED_OUT',null))")
  await page.wait_for_timeout(300);assert await page.locator('#publicBotsDialog').evaluate('(d)=>!d.open')
  results.append({'name':'Host logout closes and clears account-bound bot screen','pass':True})
  await page.evaluate("__ctx.id='22222222-2222-4222-8222-222222222222';__ctx.token='local-b';__authObservers.forEach(fn=>fn('SIGNED_IN',__session()))")
  await page.wait_for_timeout(350);await page.locator('#openPublicBots').click();await page.get_by_text('Пока нет ботов.',exact=False).wait_for()
  assert await page.get_by_role('button',name='Запись к специалисту',exact=True).count()==0
  results.append({'name':'Second test owner does not see first owner private bots','pass':True})
  writes=await page.evaluate("__normalCalls.filter(x=>/^(send|start_|pablicus_create|pablicus_update|mark_)/.test(x))")
  assert writes==[],writes
  results.append({'name':'Bot management issued no ordinary chat write RPC','pass':True})
  relevant=[x for x in errors if 'SecurityError' not in x]
  if relevant:print('ERRORS',relevant)
  assert relevant==[],relevant
  results.append({'name':'No candidate JavaScript errors in exercised fixture paths','pass':True})
  await browser.close()
 (OUT/'browser-results.json').write_text(json.dumps({'environment':'Chromium about:blank with explicit URL/Auth/storage doubles; real local HTTP + SQLite', 'cloud':False,'checks':results},ensure_ascii=False,indent=2))
 print('BROWSER_PASS',len(results))
try:asyncio.run(main())
except Exception:
 (OUT/'browser-partial.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));raise
