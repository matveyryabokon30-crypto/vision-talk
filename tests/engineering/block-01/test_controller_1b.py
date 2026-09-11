from pathlib import Path
import argparse, json, shutil, subprocess, sys
from playwright.sync_api import sync_playwright

ap=argparse.ArgumentParser()
ap.add_argument('--source-root',type=Path,default=Path.cwd())
ap.add_argument('--controller-path',type=Path,default=None)
ap.add_argument('--app-path',type=Path,default=None)
ap.add_argument('--browser',default=shutil.which('chromium'))
ap.add_argument('--output',type=Path,default=Path('block01-results/controller-1b.json'))
ap.add_argument('--only',default='')
a=ap.parse_args();root=a.source_root.resolve();controller=(a.controller_path or root/'pablicus/app-controller.js').resolve();app_path=(a.app_path or root/'pablicus/app.js').resolve();a.output.parent.mkdir(parents=True,exist_ok=True)
selected={x.strip() for x in a.only.split(',') if x.strip()};results={}
FIX='''<!doctype html><body><div id="home"><header><span id="brandTitle">Чаты</span><span id="sectionTitle"></span></header><nav id="mainNav"><button data-page="chats"></button><button data-page="feed"></button><button data-page="tasks"></button><button data-page="bots"></button><button data-page="profile"></button></nav></div></body>'''
def wanted(tid):return not selected or tid in selected
def record(tid,ok,detail):
 if wanted(tid):results[tid]={'status':'PASS' if ok else 'FAIL','detail':detail}
def page(browser):
 p=browser.new_page();p.set_content(FIX);p.add_script_tag(path=str(controller));return p
def ae(p,body):return p.evaluate('(async()=>{'+body+'})()')

with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=a.browser,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 if wanted('1B-T01'):
  p=page(b);d=ae(p,"""
   const wait=()=>new Promise(r=>setTimeout(r,0));let releaseX,enteredX=false,mounts=[];
   PablicusController.register('X',async()=>async()=>{enteredX=true;await new Promise(r=>releaseX=r)});
   for(const name of ['A','B','C'])PablicusController.register(name,async()=>{mounts.push(name);return()=>{}});
   await PablicusController.navigate({section:'chats',screen:'X'});const pa=PablicusController.navigate({section:'chats',screen:'A'});while(!enteredX)await wait();const pb=PablicusController.navigate({section:'chats',screen:'B'});releaseX();await Promise.all([pa,pb]);const first={screen:PablicusController.state().screen,mounts:[...mounts]};
   let releaseX2,enteredX2=false;PablicusController.register('X2',async()=>async()=>{enteredX2=true;await new Promise(r=>releaseX2=r)});await PablicusController.navigate({screen:'X2'});mounts=[];const aa=PablicusController.navigate({screen:'A'});while(!enteredX2)await wait();const bb=PablicusController.navigate({screen:'B'}),cc=PablicusController.navigate({screen:'C'});releaseX2();await Promise.all([aa,bb,cc]);return{first,second:{screen:PablicusController.state().screen,mounts}};
  """);ok=d['first']['screen']=='B' and d['first']['mounts']==['B'] and d['second']['screen']=='C' and d['second']['mounts']==['C'];record('1B-T01',ok,d);p.close()
 if wanted('1B-T02'):
  p=page(b);d=ae(p,"""
   const wait=()=>new Promise(r=>setTimeout(r,0));let releaseA,startedA=false,funcClean=0,objClean=0,bResources=0;
   PablicusController.register('A',async()=>{startedA=true;await new Promise(r=>releaseA=r);return()=>{funcClean++}});PablicusController.register('B',async({onCleanup})=>{bResources++;onCleanup?.(()=>bResources--);return()=>{}});
   const pa=PablicusController.navigate({screen:'A',resourceId:'a'});while(!startedA)await wait();await PablicusController.navigate({screen:'B',resourceId:'b'});releaseA();await pa;const afterFunction={funcClean,bResources,screen:PablicusController.state().screen};
   let releaseD,startedD=false;const obj={count:0,async dispose(){if(this!==obj)throw Error('lost this');this.count++;objClean++}};PablicusController.register('D',async()=>{startedD=true;await new Promise(r=>releaseD=r);return obj});const pd=PablicusController.navigate({screen:'D',resourceId:'d'});while(!startedD)await wait();await PablicusController.navigate({screen:'B',resourceId:'b2'});releaseD();await pd;await PablicusController.navigate({screen:'B',resourceId:'b3'});return{afterFunction,funcClean,objClean,objCount:obj.count,bResources,screen:PablicusController.state().screen};
  """);ok=d['afterFunction']=={'funcClean':1,'bResources':1,'screen':'B'} and d['funcClean']==1 and d['objClean']==1 and d['objCount']==1 and d['bResources']==1 and d['screen']=='B';record('1B-T02',ok,d);p.close()
 if wanted('1B-T03'):
  p=page(b);d=ae(p,"""
   let sessionUser='user-1',cleaned=0,release,started=false,mounted=[];
   PablicusController.setServices({getSession:async()=>({data:{session:sessionUser?{user:{id:sessionUser}}:null}})});await PablicusController.sessionChanged();
   PablicusController.register('stable',async()=>{mounted.push('stable');return()=>{cleaned++}});await PablicusController.navigate({screen:'stable'});const before=PablicusController.state();await PablicusController.sessionChanged();const refresh={before:before.sessionGeneration,after:PablicusController.state().sessionGeneration,cleaned};
   PablicusController.register('slow',async({isCurrent})=>{started=true;await new Promise(r=>release=r);if(isCurrent())mounted.push('slow');return()=>{cleaned++}});const slow=PablicusController.navigate({screen:'slow'});while(!started)await new Promise(r=>setTimeout(r,0));sessionUser=null;const logout=PablicusController.sessionChanged();release();await Promise.all([slow,logout]);const afterLogout={mounted:[...mounted],cleaned,state:PablicusController.state()};sessionUser='user-2';await PablicusController.sessionChanged();return{refresh,afterLogout,final:PablicusController.state()};
  """);app=app_path.read_text(encoding='utf-8');contract='sb.auth.onAuthStateChange' in app and 'PablicusController?.sessionChanged();' in app and 'getSession:()=>sb.auth.getSession()' in app;ok=d['refresh']['before']==d['refresh']['after'] and d['refresh']['cleaned']==0 and 'slow' not in d['afterLogout']['mounted'] and d['afterLogout']['cleaned']>=1 and d['final'].get('sessionUserId')=='user-2' and contract;record('1B-T03',ok,{'runtime':d,'auth_contract':contract});p.close()
 if wanted('1B-T04'):
  p=page(b);d=ae(p,"""
   const seen=[];for(const name of ['conversation','canvas'])PablicusController.register(name,async({state})=>{seen.push({screen:state.screen,conversationId:state.conversationId,canvas:state.canvas,resourceId:state.resourceId});return()=>{}});await PablicusController.navigate({section:'chats',screen:'conversation',conversationId:'c1',resourceId:'bot-old'});const a=PablicusController.state();await PablicusController.navigate({section:'chats',screen:'canvas',conversationId:'c1',resourceId:'bot-old'});const mid=PablicusController.state();await PablicusController.navigate({section:'chats',screen:'conversation',conversationId:'c1'});return{seen,a,mid,c:PablicusController.state()};
  """);app=app_path.read_text(encoding='utf-8');contract="screen:'conversation',conversationId:current?.id" in app and "screen:'canvas',conversationId:current?.id" in app and 'canvasNavigationAllowed()' in app;ok=not d['a']['canvas'] and d['a']['resourceId'] is None and d['mid']['screen']=='canvas' and d['mid']['canvas'] and d['mid']['conversationId']=='c1' and d['mid']['resourceId'] is None and d['c']['screen']=='conversation' and not d['c']['canvas'] and contract;record('1B-T04',ok,{'runtime':d,'caller_contract':contract});p.close()
 if wanted('1B-T05'):
  p=page(b);d=ae(p,"""
   const errors=[];PablicusController.setServices({reportError:e=>errors.push(e?.message||String(e))});PablicusController.register('badMount',async()=>{throw Error('mount-fail')});let mountRejected=false;try{await PablicusController.navigate({screen:'badMount'})}catch(e){mountRejected=e.message==='mount-fail'}let good=0,active=0;PablicusController.register('badCleanup',async()=>()=>{throw Error('cleanup-fail')});PablicusController.register('good',async({onCleanup})=>{good++;active++;onCleanup(()=>active--);return()=>{}});await PablicusController.navigate({screen:'badCleanup'});await PablicusController.navigate({screen:'good'});for(let i=0;i<10;i++)await PablicusController.navigate({screen:'good',resourceId:'r'+i});return{mountRejected,good,active,errors,state:PablicusController.state()};
  """);ok=d['mountRejected'] and d['good']==11 and d['active']==1 and 'cleanup-fail' in d['errors'] and d['state']['screen']=='good';record('1B-T05',ok,d);p.close()
 b.close()

if wanted('1B-T06'):
 paths=[controller,app_path,root/'pablicus/bots-nav.js',root/'pablicus/bot-scenario-bridge.js'];syntax=[]
 for path in paths:
  r=subprocess.run(['node','--check',str(path)],capture_output=True,text=True);syntax.append({'path':str(path.relative_to(root)) if path.is_relative_to(root) else str(path),'code':r.returncode,'stderr':r.stderr})
 app=app_path.read_text(encoding='utf-8');bots=(root/'pablicus/bots-nav.js').read_text(encoding='utf-8');bridge=(root/'pablicus/bot-scenario-bridge.js').read_text(encoding='utf-8');ctl=controller.read_text(encoding='utf-8')
 contract={'auth_user_identity':'PablicusController?.sessionChanged();' in app and 'getSession:()=>sb.auth.getSession()' in app,'conversation_screen':"screen:'conversation',conversationId:current?.id" in app,'canvas_screen':"screen:'canvas',conversationId:current?.id" in app,'controller_signal':'signal:transition.abort.signal' in ctl,'scope_cleanup':'onCleanup:transition.scope.add' in ctl,'bots_scope':'onCleanup' in bots,'scenario_signal':'signal' in bridge and 'onCleanup' in bridge}
 record('1B-T06',all(x['code']==0 for x in syntax) and all(contract.values()),{'syntax':syntax,'contract':contract})

a.output.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(results,ensure_ascii=False,indent=2));sys.exit(1 if any(v['status']!='PASS' for v in results.values()) else 0)
