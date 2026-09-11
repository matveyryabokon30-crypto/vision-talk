"""Read-only independent, bounded probes of pinned Pablicus 1B source.
The actual app caller/function bodies are extracted unchanged. Dependencies and
DOM are synthetic. This is not full-app, production, Auth-server or iPhone QA.
Usage: python review_probes.py --source-root DIR --output results.json
DIR contains app-controller.js and app.js (or a pablicus/ subdirectory).
Each case is isolated in a child process with a 12-second wall-clock deadline.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess,sys,platform
from playwright.sync_api import sync_playwright

P=argparse.ArgumentParser();P.add_argument('--source-root',type=Path,required=True);P.add_argument('--output',type=Path,default=Path('review-results.json'));P.add_argument('--case');a=P.parse_args()
root=a.source_root
if (root/'pablicus').is_dir(): root=root/'pablicus'
ctl=root/'app-controller.js';app=root/'app.js'
def blob(b): return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
expected={'app-controller.js':'26dafda6de517cb611cd3d01c3475287b25471e6','app.js':'fdc44388d3e75a9d964e42410ad5e149bcaeff8d'}
for p in [ctl,app]:
 if blob(p.read_bytes())!=expected[p.name]: raise SystemExit('Pinned source mismatch: '+p.name)
PRE="""const C=PablicusController;const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};"""
CASES={
'R1_LATEST_WINS':PRE+"""
 const disposing=deferred(),release=deferred(),mounts=[];
 C.register('X',async()=>async()=>{disposing.resolve();await release.promise});
 for(const name of ['A','B','C'])C.register(name,async()=>{mounts.push(name);return()=>{}});
 await C.navigate({screen:'X'});const aa=C.navigate({screen:'A'});await disposing.promise;
 const bb=C.navigate({screen:'B'}),cc=C.navigate({screen:'C'});release.resolve();await Promise.all([aa,bb,cc]);
 return{pass:C.state().screen==='C'&&JSON.stringify(mounts)==='["C"]',actual:C.state().screen,mounts,expected:'C only'};
""",
'R2_LATE_CLEANUP':PRE+"""
 const started=deferred(),release=deferred();let f=0,b=0;
 C.register('A',async()=>{started.resolve();await release.promise;return()=>{f++}});
 C.register('B',async({onCleanup})=>{b++;onCleanup(()=>b--)});
 const pa=C.navigate({screen:'A'});await started.promise;await C.navigate({screen:'B'});release.resolve();await pa;
 const s=deferred(),r=deferred(),obj={calls:0,correctThis:false,dispose(){this.calls++;this.correctThis=this===obj}};
 C.register('D',async()=>{s.resolve();await r.promise;return obj});const pd=C.navigate({screen:'D'});await s.promise;await C.navigate({screen:'B'});r.resolve();await pd;
 return{pass:f===1&&b===1&&obj.calls===1&&obj.correctThis&&C.state().screen==='B',functionCleanup:f,objectCleanup:obj.calls,correctThis:obj.correctThis,newResources:b,screen:C.state().screen};
""",
'R3_LATE_REJECTION':PRE+"""
 const started=deferred(),old=deferred(),errors=[],unhandled=[];let oldResources=0,newResources=0,cleanupCount=0;
 window.addEventListener('unhandledrejection',e=>{unhandled.push(String(e.reason));e.preventDefault()});
 C.setServices({reportError:e=>errors.push(e.message)});
 C.register('old',async({onCleanup})=>{oldResources++;onCleanup(()=>{oldResources--;cleanupCount++});started.resolve();await old.promise});
 C.register('new',async({onCleanup})=>{newResources++;onCleanup(()=>newResources--)});
 const pending=C.navigate({screen:'old'});await started.promise;await C.navigate({screen:'new'});old.reject(Error('late-old-rejection'));const ret=await pending;
 await new Promise(r=>setTimeout(r,20));
 return{pass:ret===false&&C.state().screen==='new'&&newResources===1&&oldResources===0&&cleanupCount===1&&errors.length===1&&errors[0]==='late-old-rejection'&&unhandled.length===0,screen:C.state().screen,newResources,oldResources,cleanupCount,errors,unhandled,oldReturn:ret};
"""
}
# All source ranges are exact, pinned app.js lines. No production function is
# reimplemented to match the expected answer. Synthetic dependencies are explicit.
lines=app.read_text(encoding='utf-8').splitlines()
fragments='\n'.join(lines[114:128]+[lines[134]]+lines[534:536])
CASES['R4_UNSAVED_CANVAS_CANCEL']=PRE+"""
 const $=id=>document.getElementById(id);let canvasVisible=true,canvasSwitch=0,canvasEpoch=0,opening=false;
 const current={id:'c1'},user={id:'u1'},dialogs=[],workspaceUploadState=new Map();let prompts=0,closed=0,unsavedChecks=0;
 window.confirm=()=>{prompts++;return false};
 const chatCanvas={element:{dataset:{state:'ready'}},hasUnsavedChanges:()=>{unsavedChecks++;return true},close:()=>{closed++},reset:()=>{},open:async()=>{}};
 const PablicusChat={list:{refreshFont:()=>{}},collapseEditor:()=>{},persistDraft:async()=>{}};
 const mediaViewer={close:()=>{}},chatLibrary={reset:()=>{}},messageTools={dismiss:()=>{}};
 const canvasContext=()=>({userId:'u1',conversationId:'c1'}),canvasCurrent=()=>true;
 const problem=e=>{throw e};const openConversation=async()=>{throw Error('unexpected cross-conversation operation')};
"""+fragments+"""
 await C.navigate({section:'chats',screen:'canvas',conversationId:'c1'});paintConversationView();
 const before={screen:C.state().screen,canvas:C.state().canvas,visible:canvasVisible};
 await $('conversationTab').onclick();
 return{pass:prompts===1&&closed===0&&C.state().screen==='canvas'&&C.state().canvas&&canvasVisible,before,after:{screen:C.state().screen,canvas:C.state().canvas,visible:canvasVisible},prompts,unsavedChecks,closed,expected:'declined navigation keeps canvas; no close; confirmation once',sourceLines:['115-128','135','535-536']};
"""
if a.case:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);context=browser.new_context();context.route('**/*',lambda route:route.abort())
  page=context.new_page();page.set_default_timeout(3000);page.set_content(''.join('<div id="'+x+'"></div>' for x in ['mainNav','brandTitle','sectionTitle','app','chatCanvasPanel','vp','composer','conversationTab','canvasTab']))
  page.add_script_tag(path=str(ctl));r=page.evaluate('(async()=>{'+CASES[a.case]+'})()');print(json.dumps(r,ensure_ascii=False));context.close();browser.close()
 sys.exit(0)
results={'source_head':'3d291271ebd0152a6122076e2b33940afc50eb05','code_and_ci_sha':'e8f267446fa35e7b83b6a9767e33dea2e6a48bff','source_blobs':expected,'python':platform.python_version(),'scope':'isolated pinned controller and exact app function/caller bodies; synthetic DOM/dependencies; network blocked; no full application or device acceptance','cases':{}}
for case in CASES:
 try:
  r=subprocess.run([sys.executable,__file__,'--source-root',str(a.source_root),'--case',case],capture_output=True,text=True,timeout=12)
  if r.returncode: results['cases'][case]={'status':'ERROR','stderr':r.stderr,'stdout':r.stdout,'returncode':r.returncode}
  else:
   d=json.loads(r.stdout);results['cases'][case]={'status':'PASS' if d['pass'] else 'FAIL','detail':d}
 except subprocess.TimeoutExpired: results['cases'][case]={'status':'TIMEOUT','deadline_seconds':12}
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
sys.exit(1 if any(v['status']!='PASS' for v in results['cases'].values()) else 0)
