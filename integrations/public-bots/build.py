#!/usr/bin/env python3
"""Build an unpublished Public candidate. Fails closed on host-source changes.
No network, database operation, git write or publication is performed.
"""
from pathlib import Path
import hashlib, json, shutil, re, difflib, argparse
ROOT=Path(__file__).resolve().parents[2]
ASSETS=Path(__file__).resolve().parent/'assets'
BASE_COMMIT='daa313cf2c490bde210beb871e1845768522b044'
EXPECTED={'app.js':'39299177f3bb3823be2e0dbb78355f4b27d90158','index.html':'a280a132b34f4abd07823f34c507f591b57d7308','sw.js':'0fa96f084cc0893af6b61614dcdc80a13c465355','auth-config.js':'7ccfcf259df91186805d8598acbd307a7a21f7b1','auth-local.js':'960430eb79662887dfc61cbb09cc5480573e52ca','public-passkey.js':'38b8f4ebc023bde94dba83d3b88419e597bb12ba','passkey-login.js':'f3c578536d85d065676a0e8c7ca5490ede64f1d6','vendor/supabase.js':'7752e4b53d9af4a96cade40b046944ec3a06d1a1'}
def sha(data):return hashlib.sha256(data).hexdigest()
def blob(data):return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def once(text,old,new):
    if text.count(old)!=1:raise RuntimeError('Host integration anchor missing or ambiguous: '+old[:80])
    return text.replace(old,new,1)
def build(source,out):
    source=source.resolve();out=out.resolve()
    if source==out or source in out.parents or out in source.parents:raise RuntimeError('Source and output must be separate trees')
    for name,expected in EXPECTED.items():
        if blob((source/name).read_bytes())!=expected:raise RuntimeError('Host changed: '+name+'; inspect current source before integrating')
    if out.exists():raise RuntimeError('Output already exists; choose a new output directory')
    shutil.copytree(source,out)
    for file in ASSETS.iterdir():
        if file.is_file():shutil.copy2(file,out/file.name)
    app=(source/'app.js').read_text()
    integration=""" // Bot UI reuses this exact Auth client. Same-account token refresh keeps the view.
 const publicBots=PublicBotsPanel.create({auth:sb.auth,baseUrl:URL+'/functions/v1/public-bot-core',apiKey:KEY,
  getContext:()=>({id:user?.id,approved:profile?.is_approved===true&&!passkeyUnvalidated}),
  cssUrl:new window.URL('bots-panel.css',document.baseURI).href,
  beforeOpen:async()=>{if(worker)throw Error('Дождитесь завершения отправки.');await PablicusChat.flush();},notify:toast});
"""
    app=once(app,' const replyCache=new Map();',integration+' const replyCache=new Map();')
    app=once(app,'function clearSessionView(){','function clearSessionView(){publicBots.reset();')
    app=once(app,'sb.auth.onAuthStateChange((_event,session)=>{',"sb.auth.onAuthStateChange((_event,session)=>{\n  if(_event==='SIGNED_OUT'||user&&session?.user.id!==user.id)publicBots.reset();")
    app=once(app,'c.append(saved);\n   const focused=',"""c.append(saved);
   const botsEntry=el('button','savedConversation','Боты');botsEntry.id='openPublicBots';botsEntry.type='button';botsEntry.append(el('span','muted','Создать помощника или открыть переписку'));botsEntry.onclick=()=>publicBots.open().catch(problem);c.append(botsEntry);
   const focused=""")
    app=once(app,'p.append(share,copyLink);',"p.append(share,copyLink);\n   const botsSettings=el('button','setting','Мои боты');botsSettings.id='profilePublicBots';botsSettings.onclick=()=>publicBots.open().catch(problem);p.append(botsSettings);")
    (out/'app.js').write_text(app)
    html=once((source/'index.html').read_text(),'<script src="app.js"></script>','<script src="bots-client.js"></script><script src="bots-panel.js"></script><script src="app.js"></script>')
    (out/'index.html').write_text(html)
    sw=once((source/'sw.js').read_text(),"'app.js','auth-local.js'","'app.js','bots-client.js','bots-panel.js','bots-panel.css','auth-local.js'")
    cache=sha(b''.join((out/n).read_bytes() for n in ['index.html','app.js','bots-client.js','bots-panel.js','bots-panel.css']))[:16]
    sw,n=re.subn(r"const VERSION='[^']+';","const VERSION='pablicus-shell-bots-"+cache+"';",sw,count=1)
    if n!=1:raise RuntimeError('Cache anchor missing')
    (out/'sw.js').write_text(sw)
    hashes={str(p.relative_to(out)):sha(p.read_bytes()) for p in sorted(out.rglob('*')) if p.is_file() and p.name!='ASSET_MANIFEST.json'}
    (out/'ASSET_MANIFEST.json').write_text(json.dumps(hashes,ensure_ascii=False,indent=2)+'\n')
    changes=[];patch=[]
    for p in sorted(out.rglob('*')):
        if not p.is_file():continue
        name=str(p.relative_to(out));old=source/name
        if old.exists() and old.read_bytes()==p.read_bytes():continue
        changes.append({'path':'pablicus/'+name,'kind':'modified' if old.exists() else 'added','sha256':sha(p.read_bytes())})
        if p.suffix in ['.js','.css','.html','.json']:
            patch.extend(difflib.unified_diff(old.read_text().splitlines(True) if old.exists() else [],p.read_text().splitlines(True),fromfile='a/pablicus/'+name if old.exists() else '/dev/null',tofile='b/pablicus/'+name))
    (out.parent/'public-bots.patch').write_text(''.join(patch))
    (out.parent/'BUILD.json').write_text(json.dumps({'base_commit':BASE_COMMIT,'published':False,'expected_host_blobs':EXPECTED,'changes':changes,'requires_owner_release_confirmation':True},indent=2)+'\n')
    return changes
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=ROOT/'pablicus');p.add_argument('--out',type=Path,default=ROOT/'candidate-public'/'pablicus');a=p.parse_args()
    print(json.dumps(build(a.source,a.out),ensure_ascii=False,indent=2))
