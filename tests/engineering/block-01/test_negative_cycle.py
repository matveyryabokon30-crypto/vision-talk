from pathlib import Path
import argparse, shutil, tempfile
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--source-root',type=Path,default=Path.cwd());ap.add_argument('--browser',default=shutil.which('chromium'));a=ap.parse_args();src=(a.source_root/'pablicus/chat-list-view.js').read_text();mut=src.replace("if(!changed)return{changed:false", "if(false)return{changed:false")
assert mut!=src
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=a.browser,headless=True,args=['--no-sandbox']);pg=b.new_page();pg.set_content('<div id="c"></div>');pg.add_script_tag(content=mut)
 d=pg.evaluate('''()=>{const c=document.querySelector('#c'),items=[0,1,2].map(i=>({id:'c'+i}));for(const x of items){let n=document.createElement('i');n.dataset.conversationId=x.id;c.append(n)}let callbacks=0,stopped=false;const o=new MutationObserver(()=>{callbacks++;if(callbacks>20){o.disconnect();stopped=true;return}PablicusChatListView.reconcile(c,items,new Set(['c1']))});o.observe(c,{childList:true});PablicusChatListView.reconcile(c,items,new Set(['c1']));return new Promise(r=>setTimeout(()=>r({callbacks,stopped}),300))}''');b.close()
assert d['callbacks']==0, f"controlled regression detected as expected: {d}"
