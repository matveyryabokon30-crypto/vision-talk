"""Isolated DOM fixture: no real accounts, network, or incoming messages."""
import asyncio
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright

SOURCE = Path(__file__).resolve().parents[1] / 'src'


async def check(engine):
    async with async_playwright() as playwright:
        browser = await getattr(playwright, engine).launch()
        page = await browser.new_page(viewport={'width': 390, 'height': 844})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.set_content('''<style>:root{--text:#19191d;--surface:#fff;--soft:#eee9ff;--line:#d9d4e3;--accent:#7540ed;--muted:#777}body{margin:0}#composer{position:fixed;bottom:0;height:120px;width:100%}</style><div id="app"><div id="composer"></div></div>''')
        await page.add_style_tag(content=(SOURCE / 'inbox-monitor.css').read_text())
        await page.add_script_tag(content=(SOURCE / 'inbox-monitor.js').read_text())
        result = await page.evaluate('''async () => {
          const checks=[];
          const check=(test,name)=>{if(!test) throw Error(name);checks.push(name)};
          const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          let pendingResolve=null, resolves=0, opened=[];
          window.monitor=PablicusInboxMonitor.create({openConversation:async id=>opened.push(id),resolveUrl:()=>{resolves++;return new Promise(resolve=>pendingResolve=resolve)}});
          monitor.setContext({userId:'me',conversationId:'current',active:true});
          const message=(id,chat='other',extra={})=>({id,conversation_id:chat,sender_id:'friend',type:'text',body:'Привет',...extra});
          check(!monitor.push({message:message('self','other',{sender_id:'me'})}),'own message suppressed');
          check(!monitor.push({message:message('current','current')}),'current chat suppressed');
          check(monitor.push({message:message('first','other',{body:'<img src=x onerror=alert(1)>\\n'+('Длинное сообщение. '.repeat(150))}),conversationTitle:'Катя'}),'other chat accepted');
          check(!monitor.push({message:message('first')}),'duplicate suppressed');
          await tick();
          const root=document.querySelector('#inboxMonitor'), body=root.querySelector('.inboxMonitorBody');
          check(!root.hidden&&root.querySelector('.inboxMonitorTitle').textContent==='Катя','visible correct title');
          check(!body.querySelector('img')&&body.textContent.includes('<img'),'untrusted body rendered as text');
          check(body.scrollHeight>body.clientHeight,'long text scrolls inside monitor');
          const rect=root.getBoundingClientRect(),composer=document.querySelector('#composer').getBoundingClientRect();
          check(rect.bottom<=composer.top-8&&rect.top>844/3,'lower dock stays above composer');
          root.querySelector('.inboxMonitorDrag').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
          check(root.getBoundingClientRect().left===10,'keyboard dock left');
          root.querySelector('.inboxMonitorCollapse').click();
          check(root.classList.contains('inboxMonitorCompact'),'collapse preserves notification');
          root.querySelector('.inboxMonitorBadge').click();
          for(let i=0;i<25;i++) monitor.push({message:message('queued-'+i,'chat-'+i),conversationTitle:'Чат '+i});
          check(root.querySelector('.inboxMonitorCount').textContent==='1 / 20','bounded queue');
          check(root.querySelector('.inboxMonitorTitle').textContent==='Катя','queue does not replace watched message');
          root.querySelector('.inboxMonitorOpen').click();await tick();
          check(opened[0]==='other','open goes to watched conversation after queue overflow');
          monitor.clear();
          check(root.hidden,'clear dismisses preview');
          const rich=message('video','other',{type:'rich',attachment_metadata:{v:1,blocks:[{id:'v',type:'video',path:'private/movie.mp4'}]}});
          monitor.push({message:rich,conversationTitle:'Видео'});await tick();await new Promise(r=>setTimeout(r,80));
          const video=root.querySelector('video');
          check(video&&video.controls&&video.muted&&video.playsInline,'video has controls, muted inline playback');
          check(resolves===1,'visible media resolves once');
          monitor.setContext({userId:'different',conversationId:'new',active:true});
          pendingResolve('https://fixture.invalid/private/movie.mp4');await tick();
          check(root.hidden&&!video.hasAttribute('src'),'account switch cancels stale media resolution');
          monitor.push({message:message('voice','other',{type:'rich',attachment_metadata:{v:1,blocks:[{id:'a',type:'audio',path:'private/audio.mp4'}]}})});await tick();
          check(root.querySelector('audio').controls&&!root.querySelector('audio').autoplay,'voice only plays on request');
          monitor.setContext({conversationId:'other'});
          check(root.hidden,'opening matching chat removes notification');
          monitor.destroy();check(!document.querySelector('#inboxMonitor'),'destroy removes all UI');
          return checks;
        }''')
        assert not errors, errors
        print(json.dumps({'engine': engine, 'checks': len(result), 'passed': result}, ensure_ascii=False))
        await browser.close()


asyncio.run(check(sys.argv[1] if len(sys.argv) > 1 else 'chromium'))
