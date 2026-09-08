"""Full built app with explicit MOCK Supabase and deterministic MOCK microphone.

Exercises real DOM, IndexedDB, rich composer/store/worker and viewer rendering.
No live backend request, real upload, real microphone, media decoding, physical
phone, or delivery to another person is claimed by this test.
"""
import argparse
import ast
import asyncio
import hashlib
import json
import mimetypes
import shutil
import tempfile
import traceback
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST, EVIDENCE = ROOT / 'dist', ROOT / 'evidence'
MAIN_CHAT = '22222222-2222-4222-8222-222222222222'
SAVED_CHAT = '44444444-4444-4444-8444-444444444444'
# A checked-in product icon is an explicitly local photo fixture, never a
# fabricated photograph of a user or an external image request.
PNG = (ROOT / 'assets/icon-192.png').read_bytes()
VIDEO = b'MOCK_VIDEO_ORIGINAL_BYTES_NOT_PLAYABLE'
DOCUMENT = b'MOCK_PDF_ORIGINAL_BYTES_NOT_PLAYABLE'
DURING = b'DOCUMENT_ADDED_WHILE_RECORDING'
VOICE = b'MOCK_MIC_DETERMINISTIC_CHUNK'


def mocked_sdk():
    """Read only the literal fixture; importing integration.py runs its full suite."""
    module = ast.parse((ROOT / 'tests/integration.py').read_text())
    value = next(node.value for node in module.body if isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == 'MOCK' for target in node.targets))
    source = ast.literal_eval(value)

    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, 'Mock harness anchor changed: ' + old[:90]
        source = source.replace(old, new, 1)

    replace('online:true,objects:new Map()', 'online:true,objects:new Map(),richCalls:0,dropRichAckOnce:false,corruptRichAck:false')
    replace('onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})', "onAuthStateChange:callback=>{window.__mock.emitAuth=(event,session)=>callback(event,session);return {data:{subscription:{unsubscribe(){}}}}}")
    replace('return result(single?(d[0]||null):d)', "if(single&&d[0]?.type==='rich'&&window.__mock.corruptRichAck)return result({...d[0],attachment_metadata:{v:1,blocks:[{id:'wrong',type:'text',text:'CONFLICTING_SERVER_PAYLOAD'}]}});return result(single?(d[0]||null):d)")
    replace("if(name==='start_direct_conversation'||name==='start_saved_conversation')", "if(name==='start_saved_conversation')return result('" + SAVED_CHAT + "');if(name==='start_direct_conversation')")
    replace("if(name==='send_message'||name==='send_attachment_message'||name==='send_rich_message'){", r"""if(name==='send_rich_message'){
      window.__mock.richCalls++;
      if(!window.__mock.online)return result(null,{name:'TypeError',message:'MOCK network request failed'});
      const old=messages.find(m=>m.client_message_id===args.p_client_message_id);
      if(old)return result(old);
      for(const block of args.p_content.blocks)if(block.type!=='text'&&!window.__mock.objects.has(block.path))return result(null,{message:'MOCK object is missing'});
      const m={id:'s'+(++seq),client_message_id:args.p_client_message_id,conversation_id:args.p_conversation_id,server_seq:seq,sender_id:user.id,type:'rich',body:args.p_content.blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n'),attachment_path:null,attachment_metadata:structuredClone(args.p_content),created_at:new Date().toISOString()};
      messages.push(m);window.__mock.sent.push(m);
      if(window.__mock.dropRichAckOnce){window.__mock.dropRichAckOnce=false;return result(null,{name:'TypeError',message:'MOCK ACK lost after commit'})}
      return result(m);
    }if(name==='send_message'||name==='send_attachment_message'){""")
    replace("return result({signedUrl:'data:text/plain,stored'})", "return result({signedUrl:URL.createObjectURL(window.__mock.objects.get(path))})")
    return source


MOCK_MIC = r"""(() => {
  window.__mockMic={starts:0,stops:0,requests:0};
  class Track extends EventTarget {stop(){__mockMic.stops++}}
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(){__mockMic.requests++;const track=new Track();return {getTracks:()=>[track],getAudioTracks:()=>[track]}}}});
  class Recorder extends EventTarget {
    static isTypeSupported(type){return type==='audio/mp4'}
    constructor(stream,options){super();this.stream=stream;this.mimeType=options?.mimeType||'audio/mp4';this.state='inactive'}
    start(){this.state='recording';__mockMic.starts++}
    stop(){if(this.state==='inactive')return;this.state='inactive';queueMicrotask(()=>{const data=new Event('dataavailable');data.data=new Blob(['MOCK_MIC_DETERMINISTIC_CHUNK'],{type:this.mimeType});this.dispatchEvent(data);this.dispatchEvent(new Event('stop'))})}
  }
  Object.defineProperty(window,'MediaRecorder',{configurable:true,value:Recorder});
})();"""


async def snapshot(page):
    return await page.evaluate("""async()=>{const c=PablicusChat.rich.capture();return {text:c.text,blocks:c.blocks,recording:PablicusChat.rich.recording,files:await Promise.all(c.files.map(async f=>({id:f.id,name:f.name,type:f.type,size:f.size,sha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('')})))}}""")


async def one(name, engine):
    directory = tempfile.mkdtemp(prefix='pablicus-rich-integration-')
    context = await engine.launch_persistent_context(directory, headless=True,
        viewport={'width': 440, 'height': 766}, has_touch=True, service_workers='block')
    await context.add_init_script(MOCK_MIC)
    source = mocked_sdk()
    unexpected = []

    async def route(request):
        parsed = urlparse(request.request.url)
        # WebKit routes same-origin object URLs through Playwright too. These
        # are the original in-memory preview Blobs, not external HTTP traffic.
        if request.request.url.startswith('blob:http://127.0.0.1:8765/'):
            return await request.continue_()
        if parsed.netloc != '127.0.0.1:8765':
            unexpected.append(request.request.url)
            return await request.abort()
        path = parsed.path.lstrip('/') or 'index.html'
        if path == 'vendor/supabase.js':
            return await request.fulfill(status=200, content_type='application/javascript', body=source)
        file = DIST / path
        if not file.is_file():
            return await request.fulfill(status=404, body='not found')
        return await request.fulfill(status=200,
            content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=file.read_bytes())

    await context.route('**/*', route)
    page = await context.new_page()
    page.set_default_timeout(15000)
    errors, checks = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def open_main():
        await page.locator('.chatMain').first.click()
        await page.wait_for_function('PablicusChat?.rich && PablicusChat?.store && PablicusChat?.list')
        await page.wait_for_function("PablicusChat.scope.chat==='" + MAIN_CHAT + "'")

    async def end_text(value):
        last = page.locator('#editor textarea').last
        await last.fill(value)
        await last.press('End')

    async def add_file(name, mime, data, selector='#galleryInput'):
        await page.locator(selector).set_input_files({'name': name, 'mimeType': mime, 'buffer': data})
        await page.wait_for_function('(name)=>PablicusChat.rich.capture().files.some(f=>f.name===name)', arg=name)

    try:
        await page.goto('http://127.0.0.1:8765/', wait_until='domcontentloaded')
        await page.wait_for_selector('.chatMain')
        await open_main()
        await page.locator('#input').fill('До фотографии')
        await page.locator('#input').press('End')
        await add_file('photo.png', 'image/png', PNG)
        await end_text('После фотографии')
        await add_file('video.mp4', 'video/mp4', VIDEO)
        await add_file('plan.pdf', 'application/pdf', DOCUMENT, '#documentInput')
        await page.evaluate('PablicusChat.flush()')
        before = await snapshot(page)
        await page.reload()
        await page.wait_for_selector('.chatMain')
        await open_main()
        await page.wait_for_function('PablicusChat.rich.capture().files.length===3')
        restored = await snapshot(page)
        assert restored['blocks'] == before['blocks']
        assert restored['text'] == before['text']
        assert restored['files'] == before['files']
        assert {file['sha'] for file in restored['files']} == {hashlib.sha256(data).hexdigest() for data in (PNG, VIDEO, DOCUMENT)}
        checks.append('rich draft reload retains block order, text and every original Blob byte')

        await page.locator('#editor textarea').last.click()
        await page.locator('#richVoice').click()
        await page.wait_for_function('PablicusChat.rich.recording')
        await page.locator('#attach').click()
        await page.wait_for_selector('#pop', state='visible')
        await page.keyboard.press('Escape')
        await add_file('during.txt', 'text/plain', DURING, '#documentInput')
        await end_text('Текст во время записи')
        assert await page.evaluate('PablicusChat.rich.recording')
        assert await page.locator('#richVoice').get_attribute('aria-pressed') == 'true'
        await page.locator('#richVoice').click()
        await page.wait_for_function('!PablicusChat.rich.recording && PablicusChat.rich.capture().files.length===5')
        composed = await snapshot(page)
        assert any(file['sha'] == hashlib.sha256(VOICE).hexdigest() for file in composed['files'])
        checks.append('explicit mock recording stays active while plus menu, file input and text editing remain usable')
        EVIDENCE.mkdir(exist_ok=True)
        await page.locator('#toast').wait_for(state='hidden')
        await page.locator('#expand').click()
        await page.locator('#editor').evaluate('(node)=>node.scrollTop=0')
        await page.screenshot(path=str(EVIDENCE / f'rich-integration-{name}-composed-top.png'))
        await page.locator('#editor').evaluate('(node)=>node.scrollTop=node.scrollHeight')
        await page.screenshot(path=str(EVIDENCE / f'rich-integration-{name}-composed-bottom.png'))
        await page.locator('#expand').click()

        expected = [block['type'] for block in composed['blocks'] if block['type'] != 'text' or block['text'].strip()]
        assert expected == ['text', 'image', 'text', 'video', 'document', 'audio', 'document', 'text'], expected
        await page.evaluate('__mock.dropRichAckOnce=true')
        await page.locator('#send').click()
        await page.wait_for_function('__mock.sent.length===1')
        await page.wait_for_function('PablicusChat.store.readQueue(false).then(rows=>rows.length===1 && rows[0].state==="error")')
        sent = await page.evaluate('__mock.sent[0]')
        assert sent['type'] == 'rich'
        assert [block['type'] for block in sent['attachment_metadata']['blocks']] == expected
        assert await page.evaluate('__mock.objects.size') == 5
        uploaded = await page.evaluate("""async()=>Promise.all([...__mock.objects.values()].map(async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('')))""")
        assert set(uploaded) == {file['sha'] for file in composed['files']}
        # Reopening while a rich row is still pending must also satisfy the
        # inherited virtual-list geometry audit; a missing legacy .text node
        # must not throw and send the user back to the conversation list.
        await page.evaluate('''async()=>{const [q]=await PablicusChat.store.readQueue(false);await PablicusChat.store.change(q.id,r=>{r.nextAttemptAt=Date.now()+60000})}''')
        await page.locator('#chatBack').click()
        await open_main()
        await page.wait_for_selector('#send', state='visible')
        await page.evaluate('''async()=>{__mock.corruptRichAck=true;const [q]=await PablicusChat.store.readQueue(false);await PablicusChat.store.retry(q.id);await PablicusDebug.pump()}''')
        await page.wait_for_function('PablicusChat.store.readQueue(false).then(rows=>rows.length===1 && rows[0].state==="error" && rows[0].retryable===false)')
        retained = await page.evaluate("""async()=>{const [q]=await PablicusChat.store.readQueue();return {error:q.error.message,hashes:await Promise.all(q.files.map(async f=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('')))}}""")
        assert 'другое содержимое' in retained['error']
        assert set(retained['hashes']) == {file['sha'] for file in composed['files']}
        checks.append('conflicting ACK content does not retire queue or delete any attachment bytes')
        await page.evaluate('__mock.corruptRichAck=false')
        await page.evaluate('''async()=>{const [q]=await PablicusChat.store.readQueue(false);await PablicusChat.store.retry(q.id);await PablicusDebug.pump()}''')
        await page.wait_for_function('PablicusChat.store.readQueue(false).then(rows=>rows.length===0)')
        await page.wait_for_selector('#canvas .richMessage')
        assert await page.locator('#canvas .richMessage').count() == 1
        assert await page.evaluate('__mock.sent.length') == 1
        assert await page.evaluate('__mock.richCalls') == 1
        # Gallery wrappers compact neighboring photo/video blocks without
        # changing their semantic order inside the one message body.
        assert await page.locator('#canvas .richMessage .richText, #canvas .richMessage .richMedia').evaluate_all('(nodes)=>nodes.map(n=>n.classList.contains("richText")?"text":n.className.match(/richMedia-(image|video|audio|document)/)[1])') == expected
        checks.append('one send stores one ordered server row and one bubble; lost ACK retries without duplicate upload or message')
        await page.locator('#toast').wait_for(state='hidden')
        await page.set_viewport_size({'width': 440, 'height': 1100})
        await page.evaluate('PablicusChat.list.bottom()')
        await page.screenshot(path=str(EVIDENCE / f'rich-integration-{name}-sent-bubble.png'))
        await page.set_viewport_size({'width': 440, 'height': 766})

        await page.locator('#input').fill('x' * 5001)
        await page.locator('#send').click()
        assert await page.locator('#input').input_value() == 'x' * 5001
        assert await page.evaluate('__mock.sent.length') == 1
        assert await page.evaluate('PablicusChat.store.readQueue(false).then(rows=>rows.length)') == 0
        checks.append('oversized text validation keeps draft intact and does not send')
        await page.evaluate('PablicusChat.rich.clear()')
        await page.locator('#richVoice').click()
        await page.wait_for_function('PablicusChat.rich.recording')
        await end_text('Черновик первого разговора')
        await add_file('scoped.txt', 'text/plain', b'FIRST_CHAT_ONLY', '#documentInput')
        await page.locator('#chatBack').click()
        await page.wait_for_selector('.savedConversation')
        await page.locator('.savedConversation').click()
        await page.wait_for_function("PablicusChat.scope.chat==='" + SAVED_CHAT + "'")
        in_saved = await snapshot(page)
        assert not in_saved['recording'] and not in_saved['files'] and not in_saved['text'].strip()
        assert await page.evaluate('__mockMic.stops') >= 2
        await page.locator('#chatBack').click()
        await open_main()
        await page.wait_for_function('PablicusChat.rich.capture().files.length===2')
        back = await snapshot(page)
        assert not back['recording'] and 'Черновик первого разговора' in back['text']
        assert any(file['sha'] == hashlib.sha256(b'FIRST_CHAT_ONLY').hexdigest() for file in back['files'])
        checks.append('leaving stops microphone and saves completed voice; saved conversation opens without another chat assets')

        # Seed the persisted pre-rich queue shape directly, as it exists after an
        # upgrade. The ordinary worker must still deliver it without touching
        # the independently saved rich draft in this conversation.
        await page.evaluate('''async()=>{
          const id=crypto.randomUUID();
          const item={id,client_message_id:id,source_revision:1,first_sequence:100,
            messages:[{id:id+':0',sequence:100,kind:'text',text:'LEGACY_QUEUE_FIXTURE'}],
            files:[],state:'queued',retries:0,createdAt:new Date().toISOString(),
            server_ack:null,error:null,version:1};
          await PablicusChat.store.transaction(['outbox'],'readwrite',(tx,done)=>{
            tx.objectStore('outbox').add(item);done(item);
          });
          await PablicusDebug.pump();
        }''')
        await page.wait_for_function('__mock.sent.some(m=>m.type==="text" && m.body==="LEGACY_QUEUE_FIXTURE")')
        await page.wait_for_function('PablicusChat.store.readQueue(false).then(rows=>rows.length===0)')
        after_legacy = await snapshot(page)
        assert after_legacy['blocks'] == back['blocks'] and after_legacy['files'] == back['files']
        checks.append('existing plain-text queue still delivers while the rich draft and original bytes remain unchanged')

        await page.evaluate('PablicusChat.rich.clear()')
        await page.locator('#input').fill('До прерванной записи')
        await page.locator('#input').press('End')
        await add_file('interrupted-photo.png', 'image/png', PNG)
        await page.locator('#richVoice').click()
        await page.wait_for_function('PablicusChat.rich.recording')
        # Write the active recording marker, then simulate a document/process
        # reload without invoking PablicusChat.flush() (which intentionally
        # finishes a recording). Only already acquired bytes are durable.
        await page.evaluate('''async()=>{vault.changed();await vault.flush()}''')
        assert await page.evaluate('PablicusChat.store.read().then(d=>!!d.recording&&d.blocks.some(b=>b.pending))')
        await page.reload()
        await page.wait_for_selector('.chatMain')
        await open_main()
        await page.wait_for_function('!PablicusChat.rich.recording && PablicusChat.rich.capture().files.length===1')
        recovered = await snapshot(page)
        assert 'До прерванной записи' in recovered['text']
        assert recovered['files'][0]['sha'] == hashlib.sha256(PNG).hexdigest()
        await page.wait_for_function('PablicusChat.store.read().then(d=>!d.recording && !d.blocks.some(b=>b.pending))')
        # This is deliberately the first edit/send action after recovery.
        await page.locator('#send').click()
        await page.wait_for_function('__mock.sent.length===1')
        await page.wait_for_function('PablicusChat.store.readQueue(false).then(rows=>rows.length===0)')
        assert await page.evaluate('__mock.sent[0].attachment_metadata.blocks.map(b=>b.type)') == ['text', 'image']
        checks.append('reload during mock recording removes unfinished voice marker and sends recovered text/photo without another edit')

        await page.locator('#input').fill('Сохранить при выходе из аккаунта')
        await page.locator('#input').press('End')
        await add_file('signed-out.txt', 'text/plain', b'SIGN_OUT_ORIGINAL_DOCUMENT', '#documentInput')
        await page.locator('#richVoice').click()
        await page.wait_for_function('PablicusChat.rich.recording')
        stops_before = await page.evaluate('__mockMic.stops')
        await page.evaluate("__mock.emitAuth('SIGNED_OUT',null)")
        await page.wait_for_selector('#loginPane', state='visible')
        await page.wait_for_function('!PablicusChat.rich.recording')
        await page.wait_for_function('PablicusChat.store.read().then(d=>d.files.length===2 && !d.recording && !d.blocks.some(b=>b.pending))')
        signed_out = await snapshot(page)
        assert 'Сохранить при выходе из аккаунта' in signed_out['text']
        assert any(file['sha'] == hashlib.sha256(b'SIGN_OUT_ORIGINAL_DOCUMENT').hexdigest() for file in signed_out['files'])
        assert any(file['sha'] == hashlib.sha256(VOICE).hexdigest() for file in signed_out['files'])
        assert await page.evaluate('__mockMic.stops') > stops_before
        await page.evaluate('PablicusDebug.pump()')
        assert await page.evaluate('__mock.sent.length') == 1
        assert await page.evaluate('PablicusChat.store.readQueue(false).then(rows=>rows.length)') == 0
        checks.append('mock SDK cross-tab SIGNED_OUT event stops microphone, preserves prior account draft bytes and prevents submission')

        assert not errors, errors
        assert not unexpected, unexpected
        checks.append('no JavaScript errors or external network requests')
        EVIDENCE.mkdir(exist_ok=True)
        await page.screenshot(path=str(EVIDENCE / f'rich-integration-{name}-pass.png'))
        return {'engine': name, 'pass': True, 'checks': checks,
                'scope': 'real app + IndexedDB, EXPLICIT mocked Supabase transport and mocked microphone; no live delivery or device claim'}
    except Exception:
        EVIDENCE.mkdir(exist_ok=True)
        await page.screenshot(path=str(EVIDENCE / f'rich-integration-{name}-failure.png'))
        return {'engine': name, 'pass': False, 'checks': checks, 'error': traceback.format_exc(), 'js_errors': errors, 'unexpected_requests': unexpected}
    finally:
        await context.close()
        shutil.rmtree(directory, ignore_errors=True)


async def main(engines):
    async with async_playwright() as playwright:
        results = [await one(name, getattr(playwright, name)) for name in engines]
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / 'rich-message-integration.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert all(result['pass'] for result in results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engines', nargs='*', metavar='ENGINE')
    args = parser.parse_args()
    if any(name not in ('chromium', 'webkit') for name in args.engines):
        parser.error('engines must be chromium or webkit')
    asyncio.run(main(args.engines or ['chromium', 'webkit']))
