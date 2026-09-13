"""2A real-entrypoint observations. Synthetic boundary reused from accepted 1C.

This probe records the baseline before migration. A failed assertion is retained;
startup errors and missing measurements never qualify a negative control.
"""
from __future__ import annotations
import argparse, asyncio, functools, hashlib, http.server, json, os, platform
import sys, threading, traceback
from pathlib import Path
from playwright.async_api import async_playwright

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'block-01/integration_1c'))
from network import Boundary, A, C1
from collector import BrowserCollector, utc_now

FLAGS=['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
       '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']

class Server(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

async def probe(browser,root,origin,out,width,height,mutation=False):
    out.mkdir(parents=True,exist_ok=True)
    result={'status':'RUNNING','checks':[],'start_time_utc':utc_now(),
            'viewport':{'width':width,'height':height},'mutation':mutation,
            'keyboard_scope':'Viewport reduction with focused input; not physical iOS keyboard qualification'}
    boundary=Boundary(origin); ctx=await browser.new_context(service_workers='block',viewport=result['viewport'])
    await ctx.add_init_script('''{
      const native=window.visualViewport;
      window.__shellKeyboard={height:null,top:0};
      if(native)Object.defineProperty(window,'visualViewport',{configurable:true,value:new Proxy(native,{get(target,key){
        if(key==='height'&&__shellKeyboard.height!==null)return __shellKeyboard.height;
        if((key==='offsetTop'||key==='pageTop')&&__shellKeyboard.height!==null)return __shellKeyboard.top;
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }})});
      window.__shellWrites=[];
      const descriptor=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');
      Object.defineProperty(Node.prototype,'textContent',{...descriptor,set(value){
        if(this.id==='brandTitle'||this.id==='sectionTitle')__shellWrites.push({id:this.id,value,stack:new Error().stack});
        return descriptor.set.call(this,value);
      }});
    }''')
    await ctx.route('**/*',boundary.handle)
    await ctx.route_web_socket('**/*',boundary.websocket)
    page=await ctx.new_page();page.set_default_timeout(8000)
    await boundary.attach_page(page);collector=BrowserCollector(page,boundary,out)
    def check(name,ok,actual):
        result['checks'].append({'name':name,'status':'PASS' if ok else 'FAIL','actual':actual})
        write(out/'result.json',result)
    try:
        response=await page.goto(origin+'/pablicus/',wait_until='load',timeout=15000)
        check('HTTP-200',response.status==200,response.status)
        await page.locator('#email').fill('a@fixture.invalid')
        await page.locator('#password').fill('fixture-only-password')
        await page.locator('#loginSubmit').click()
        await page.wait_for_function('PablicusDebug.user==="'+A+'" && document.querySelectorAll(".chatCard").length>0')
        await page.wait_for_function("[...document.scripts].some(s=>s.src.endsWith('/bot-scenario-bridge.js'))")
        await page.locator('#toast').wait_for(state='hidden',timeout=7000)
        await page.evaluate('''() => {
          const controller=PablicusController, native=controller.navigate;
          window.__shellNavigationCalls=[];
          controller.navigate=function(...args){__shellNavigationCalls.push(structuredClone(args[0]));return native.apply(controller,args)};
        }''')
        if mutation:
            await page.evaluate('''() => document.getElementById('mainNav').addEventListener('click',event=>{
              const button=event.target.closest('button[data-page]');
              if(button)void PablicusController.navigate({section:button.dataset.page,screen:'home'});
            })''')
        tabs=await page.locator('#mainNav > button').evaluate_all('(nodes)=>nodes.map(n=>({section:n.dataset.page,label:n.innerText}))')
        check('2A-ROOT-TABS', [x['section'] for x in tabs]==['chats','tasks','bots','agent','profile'], tabs)
        visits=[]
        for section in ['tasks','profile','chats']:
            await page.evaluate('__shellNavigationCalls.length=0')
            await page.locator('#mainNav [data-page="'+section+'"]').click()
            await page.wait_for_function('(s)=>PablicusController.state().section===s && PablicusController.state().screen==="home"',arg=section)
            observation=await page.evaluate('''()=>({route:PablicusController.state(),calls:__shellNavigationCalls,
                selected:[...document.querySelectorAll('#mainNav .selected')].map(n=>n.dataset.page),
                home:!document.getElementById('home').hidden,app:!document.getElementById('app').hidden,
                heading:document.getElementById('brandTitle').textContent})''')
            visits.append(observation)
            check('2A-SINGLE-NAVIGATION-DISPATCH-'+section,len(observation['calls'])==1,observation)
            check('2A-ROUTE-VISIBLE-'+section,observation['selected']==[section] and observation['home'] and not observation['app'],observation)
        result['root_visits']=visits
        result['shell_writes']=await page.evaluate('__shellWrites')
        await page.locator('#mainNav [data-page=chats]').focus()
        await page.keyboard.press('Tab')
        focus=await page.evaluate('''()=>({tag:document.activeElement.tagName,text:document.activeElement.innerText,
          visibleFocus:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineWidth})''')
        check('2A-KEYBOARD-FOCUS',focus['tag']=='BUTTON' and focus['visibleFocus'] and float(focus['outline'].replace('px',''))>0,focus)
        if await page.evaluate('!!window.PablicusUI'):
            registry=await page.evaluate('''()=>({roots:PablicusUI.roots,components:PablicusUI.components,
              composer:PablicusUI.composer,ia:PablicusUI.informationArchitecture,calls:PablicusUI.calls,
              tokens:Object.fromEntries(Object.entries(PablicusUI.tokenGroups).map(([group,names])=>[group,Object.fromEntries(names.map(n=>[n,getComputedStyle(document.documentElement).getPropertyValue(n).trim()]))])),
              shellWrites:__shellWrites})''')
            result['registry']=registry
            check('2A-SINGLE-HEADER-WRITER',all('/app-shell.js:' in x['stack'] for x in registry['shellWrites']),registry['shellWrites'])
            check('2A-TOKENS-RESOLVED',len(registry['tokens'])==14 and all(all(values.values()) for values in registry['tokens'].values()),registry['tokens'])
            def luminance(value):
                value=value.lstrip('#');value=''.join(c*2 for c in value) if len(value)==3 else value
                channels=[int(value[i:i+2],16)/255 for i in (0,2,4)]
                linear=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in channels]
                return sum(v*w for v,w in zip(linear,[.2126,.7152,.0722]))
            result['contrast']={}
            for scheme in ['light','dark']:
                await page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                colors=await page.evaluate("()=>Object.fromEntries(['--text','--muted','--bg','--surface','--motion-duration'].map(n=>[n,getComputedStyle(document.documentElement).getPropertyValue(n).trim()]))")
                ratios={}
                for fg in ['--text','--muted']:
                    for bg in ['--bg','--surface']:
                        a,b=sorted([luminance(colors[fg]),luminance(colors[bg])]);ratios[fg+'/'+bg]=(b+.05)/(a+.05)
                result['contrast'][scheme]={'colors':colors,'ratios':ratios,'scope':'Opaque text/background token pairs only; not all rendered controls or WCAG compliance'}
                check('2A-TOKEN-TEXT-CONTRAST-'+scheme,all(v>=4.5 for v in ratios.values()),result['contrast'][scheme])
                check('2A-REDUCED-MOTION-TOKEN-'+scheme,colors['--motion-duration']=='0ms',colors['--motion-duration'])
            await page.emulate_media(color_scheme='light',reduced_motion='no-preference')
            await page.locator('#openBots').click()
            await page.wait_for_function('!!document.querySelector(".botCard")')
            nested=await page.evaluate('''()=>({route:PablicusController.state(),selected:[...document.querySelectorAll('#mainNav .selected')].map(n=>n.dataset.page),heading:document.getElementById('brandTitle').textContent})''')
            check('OWNER-20260913-BOTS-ROOT',nested['route']['screen']=='bots' and nested['selected']==['bots'] and nested['heading']=='Боты',nested)
            await page.locator('#mainNav [data-page=chats]').click()
            await page.wait_for_function('document.querySelectorAll(".chatCard").length>0')
        await page.screenshot(path=str(out/'home.png'),full_page=True)
        await page.locator('[data-conversation-id="'+C1+'"] .chatMain').click()
        await page.wait_for_function('PablicusDebug.current==="'+C1+'" && !!PablicusChat.list && !!window.vault?.ready && !document.getElementById("app").inert')
        if result.get('registry'):
            operations=await page.evaluate('()=>Object.fromEntries(PablicusUI.composer.existingOperations.map(name=>[name,typeof PablicusChat.rich[name]]))')
            check('2A-LIVE-COMPOSER-ADAPTER',all(v=='function' for v in operations.values()),operations)
        result['geometry']=[]
        for name,h in [('conversation',height),('keyboard-viewport',max(360,height-330)),('safe-area-and-long-title',max(360,height-330)),('large-text',max(360,height-330))]:
            await page.locator('#input').focus()
            await page.evaluate('''({height,reduced,safe,large})=>{
              if(large){document.documentElement.style.setProperty('--text-size','34px');document.getElementById('input').style.fontSize='33px';document.getElementById('chatTitle').style.setProperty('font-size','31px','important');}
              __shellKeyboard.height=reduced?height:null;__shellKeyboard.top=0;
              visualViewport.dispatchEvent(new Event('resize'));
              if(safe){document.documentElement.style.setProperty('--safe-area-top','47px');document.documentElement.style.setProperty('--safe-area-bottom','34px');
                window.PablicusShell?.conversationTitle('Очень длинный заголовок разговора — проверка переполнения '.repeat(4));}
            }''',{'height':h,'reduced':name!='conversation','safe':name=='safe-area-and-long-title','large':name=='large-text'})
            if name=='large-text':await page.locator('#input').fill('Large text draft — visible editing baseline')
            await page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            observation=await page.evaluate('''()=>{
              const ids=['app','chatBack','chatTitle','chatLibraryOpen','reportBtn','composer','input','attach','send'];
              return {viewport:{width:innerWidth,height:innerHeight},elements:Object.fromEntries(ids.map(id=>{
                const n=document.getElementById(id),r=n.getBoundingClientRect(),s=getComputedStyle(n);
                return [id,{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,
                  visible:r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none',
                  clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,pointerEvents:s.pointerEvents,label:n.getAttribute('aria-label'),fontSize:s.fontSize,
                  hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}]
              })),overflow:document.documentElement.scrollWidth>innerWidth,
                safeArea:getComputedStyle(document.getElementById('composer')).paddingBottom,
                keyboardOpen:document.getElementById('app').classList.contains('keyboard-open'),
                visualHeight:visualViewport.height,route:PablicusController.state(),styles:[...document.styleSheets].map(s=>s.href)}
            }''')
            critical=[observation['elements'][id] for id in ['input','attach','send']]
            check('2A-CONTROLS-VISIBLE-'+name,all(x['visible'] and x['x']>=-1 and x['y']>=-1 and x['right']<=width+1 and x['bottom']<=h+1 and x['pointerEvents']!='none' for x in critical),observation)
            if name!='conversation':check('2A-KEYBOARD-STATE-'+name,observation['keyboardOpen'] and observation['visualHeight']==h,observation)
            if result.get('registry'):
                if name=='large-text':check('2A-LARGE-TEXT-EDITABLE-LINE',observation['elements']['input']['clientHeight']>=float(observation['elements']['input']['fontSize'].replace('px','')),observation['elements']['input'])
                title=observation['elements']['chatTitle']; back=observation['elements']['chatBack']; search=observation['elements']['chatLibraryOpen']
                check('2A-HEADER-TITLE-BOUNDS-'+name,title['width']>=44 and title['height']>=44 and title['x']>=back['right'] and title['right']<=search['x'] and title['hit'],observation['elements'])
                check('2A-NO-HORIZONTAL-OVERFLOW-'+name,not observation['overflow'],observation['overflow'])
                check('2A-CONTROL-TARGET-SIZE-'+name,all(observation['elements'][id]['width']>=44 and observation['elements'][id]['height']>=44 for id in ['attach','send']),observation['elements'])
                check('2A-ICON-CONTROLS-ACCESSIBLE-'+name,all(observation['elements'][id]['label'] and observation['elements'][id]['hit'] for id in ['attach','send','chatBack','chatLibraryOpen','reportBtn']),observation['elements'])
            result['geometry'].append({'mode':name,**observation})
            await page.screenshot(path=str(out/(name+'.png')),full_page=True)
        check('2A-NO-STARTUP-ERROR',not collector.events['page_errors'],collector.events['page_errors'])
        check('2A-NETWORK-QUALIFIED',not boundary.unknown and not boundary.blocked,boundary.summary())
        result['status']='FAIL' if any(x['status']=='FAIL' for x in result['checks']) else 'PASS'
    except BaseException as exc:
        result.update(status='ERROR',reason=str(exc),traceback=traceback.format_exc())
    finally:
        result.update(await collector.capture());collector.enforce_result(result)
        await ctx.close();await boundary.drain()
        result['context_closed']=True;result['network_after_cleanup']=boundary.summary()
        result['end_time_utc']=utc_now();write(out/'result.json',result)
    return result

async def main(args):
    root=args.source_root.resolve();out=args.output.resolve()
    if out.exists() and any(out.iterdir()):raise RuntimeError('Output must be empty; no stale evidence')
    out.mkdir(parents=True,exist_ok=True)
    summary={'status':'RUNNING','tested_sha':os.environ.get('GITHUB_SHA'),'source_root':str(root),
        'environment':{'python':platform.python_version(),'platform':platform.platform(),'flags':FLAGS,'service_workers':'block'},
        'sources':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'pablicus').rglob('*') if p.is_file()},'variants':{}}
    write(out/'summary.json',summary)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Server,directory=str(root)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(headless=True,args=FLAGS,timeout=20000)
            summary['environment']['browser']=browser.version
            for name,width,height in [('mobile',390,844),('tablet',768,1024),('desktop',1280,900)]:
                summary['variants'][name]=await asyncio.wait_for(probe(browser,root,'http://127.0.0.1:'+str(server.server_port),out/name,width,height),90)
                write(out/'summary.json',summary)
                if summary['variants'][name]['status']=='ERROR':break
            if summary['variants'].get('mobile',{}).get('status')!='ERROR':
                summary['variants']['duplicate-navigation']=await asyncio.wait_for(probe(browser,root,'http://127.0.0.1:'+str(server.server_port),out/'duplicate-navigation',390,844,True),90)
            await browser.close();summary['browser_closed']=True
            positives=[summary['variants'].get(name,{}).get('status') for name in ['mobile','tablet','desktop']]
            negative=summary['variants'].get('duplicate-navigation',{})
            summary['negative_control_detected']=negative.get('status')=='FAIL' and any(c['name'].startswith('2A-SINGLE-NAVIGATION-DISPATCH-') and c['status']=='FAIL' and len(c['actual']['calls'])==2 for c in negative.get('checks',[]))
            summary['negative_control_qualified']=positives==['PASS']*3 and summary['negative_control_detected'] and all(c['status']=='PASS' or c['name'].startswith('2A-SINGLE-NAVIGATION-DISPATCH-') for c in negative.get('checks',[]))
            summary['status']='ERROR' if 'ERROR' in positives or negative.get('status')=='ERROR' else ('PASS' if positives==['PASS']*3 and summary['negative_control_qualified'] else 'FAIL')
    except BaseException as exc:summary.update(status='ERROR',reason=str(exc),traceback=traceback.format_exc())
    finally:
        server.shutdown();server.server_close();thread.join(2)
        summary['server_closed']=not thread.is_alive();write(out/'summary.json',summary)
    print(json.dumps({'status':summary['status'],'variants':{k:v['status'] for k,v in summary['variants'].items()}}))
    return 0 if summary['status']=='PASS' else 1

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    raise SystemExit(asyncio.run(main(p.parse_args())))
