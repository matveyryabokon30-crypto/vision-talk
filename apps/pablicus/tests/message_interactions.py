"""Real built UI, IndexedDB and media decoder; explicit isolated mock backend.

WAV audio is generated here from a quiet sine wave. The one-second purple WebM
is an in-repository byte fixture. No personal file, live Supabase session,
microphone, external recipient or physical-device behavior is exercised.
"""
import argparse
import ast
import asyncio
import base64
import io
import json
import math
import mimetypes
import shutil
import struct
import tempfile
import traceback
import wave
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST, EVIDENCE = ROOT / 'dist', ROOT / 'evidence'
USER = '11111111-1111-4111-8111-111111111111'
SECOND_USER = '88888888-8888-4888-8888-888888888888'
MAIN_CHAT = '22222222-2222-4222-8222-222222222222'
PEER = '33333333-3333-4333-8333-333333333333'
OTHER_CHAT = '55555555-5555-4555-8555-555555555555'
TEXT_ID = '66666666-6666-4666-8666-666666666661'
RICH_ID = '66666666-6666-4666-8666-666666666662'
WEBM = base64.b64decode('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAP9EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggPn7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYhp34I+KV8FLZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgibCBYLqBQJqBAhJUw2dAgHNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PaY8CLY8WIad+CPilfBS1nyKVFo4dFTkNPREVSRIeYTGF2YzYwLjMxLjEwMiBsaWJ2cHgtdnA5Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMS4wMDAwMDAwMDAAH0O2dUI954EAo6iBAACAgkmDQgAF8AP2ADgkHBhKAAAwYAAAZz//9gZf////9kfDAaDoo5SBACgAhgBAkpwAUAAAAyAAAFj2AKOUgQBQAIYAQJKcAE7gAAMgAABY9gCjlIEAeACGAECSnABQAAADIAAAWPYAo5SBAKAAhgBAkpwATUAAAyAAAFj2AKOUgQDIAIYAQJKcAFAAAAMgAABY9gCjlIEA8ACGAECSnABO4AADIAAAWPYAo5SBARgAhgBAkpwAUAAAAyAAAFj2AKOUgQFAAIYAQJKcAEogAAMgAABY9gCjlIEBaACGAECSnABQAAADIAAAWPYAo5SBAZAAhgDAkpwASiAAAyAAAFj2AKOUgQG4AIYAQJKcAFAAAAMgAABY9gCjlIEB4ACGAECSnABNQAADIAAAWPYAo5SBAggAhgBAkpwAUAAAAyAAAFj2AKOUgQIwAIYAQJKcAE7gAAMgAABY9gCjlIECWACGAECSnABQAAADIAAAWPYAo5SBAoAAhgBAkpwASiAAAyAAAFj2AKOUgQKoAIYAQJKcAFAAAAMgAABY9gCjlIEC0ACGAECSnABO4AADIAAAWPYAo5SBAvgAhgBAkpwAUAAAAyAAAFj2AKOUgQMgAIYAwJKcAEogAAMgAABY9gCjlIEDSACGAECSnABQAAADIAAAWPYAo5SBA3AAhgBAkpwATuAAAyAAAFj2AKOUgQOYAIYAQJKcAFAAAAMgAABY9gCjlIEDwACGAECSnABKIAADIAAAWPYAHFO7a5G7j7OBALeK94EB8YIBpPCBAw==')


def playable_wav():
    output = io.BytesIO()
    with wave.open(output, 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16000)
        stream.writeframes(b''.join(struct.pack('<h', round(1000 * math.sin(i * math.tau * 220 / 16000))) for i in range(16000 * 8)))
    return output.getvalue()


def mocked_sdk():
    # Reuse the existing literal mock without importing its auto-running suite.
    module = ast.parse((ROOT / 'tests/integration.py').read_text())
    literal = next(node.value for node in module.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == 'MOCK' for target in node.targets))
    source = ast.literal_eval(literal)

    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, 'Fixture anchor changed: ' + old[:90]
        source = source.replace(old, new, 1)

    replace('const user={id:', 'let user={id:')
    replace('onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})', 'onAuthStateChange:callback=>{__mock.emitAuth=callback;return {data:{subscription:{unsubscribe(){}}}}}')

    wave_bytes, png = playable_wav(), (ROOT / 'assets/icon-192.png').read_bytes()
    assets = {'photo-a': ('image/png', png), 'photo-b': ('image/png', png),
              'video': ('video/webm', WEBM), 'voice-a': ('audio/wav', wave_bytes),
              'voice-b': ('audio/wav', wave_bytes)}
    blocks = [{'id': 'prose', 'type': 'text', 'text': 'Фотографии и видео рядом. Два отдельных голосовых ниже.'}]
    for key, (mime, data) in assets.items():
        kind = 'image' if mime.startswith('image/') else mime.split('/')[0]
        blocks.append({'id': key, 'type': kind, 'path': f'{MAIN_CHAT}/{PEER}/{RICH_ID}/{key}',
                       'name': key + ('.png' if kind == 'image' else '.webm' if kind == 'video' else '.wav'),
                       'mime': mime, 'size': len(data)})
    rows = [{'id': TEXT_ID, 'client_message_id': TEXT_ID, 'conversation_id': MAIN_CHAT,
             'server_seq': 1, 'sender_id': PEER, 'type': 'text', 'body': 'Сообщение для отдельного ответа',
             'attachment_path': None, 'attachment_metadata': None, 'created_at': '2026-09-08T10:00:00Z'},
            {'id': RICH_ID, 'client_message_id': RICH_ID, 'conversation_id': MAIN_CHAT,
             'server_seq': 2, 'sender_id': PEER, 'type': 'rich', 'body': blocks[0]['text'],
             'attachment_path': None, 'attachment_metadata': {'v': 1, 'blocks': blocks},
             'created_at': '2026-09-08T10:01:00Z'}]
    initialization = 'messages=' + json.dumps(rows, ensure_ascii=False) + ';seq=2;__mock.channels=[];__mock.richCalls=[];'
    for block in blocks[1:]:
        mime, data = assets[block['id']]
        initialization += '__mock.objects.set(' + json.dumps(block['path']) + ',new Blob([Uint8Array.from(atob(' + json.dumps(base64.b64encode(data).decode()) + '),c=>c.charCodeAt(0))],{type:' + json.dumps(mime) + '}));'
    initialization += r'''__mock.emitMessage=message=>{
      messages.push(message);
      for(const channel of [...__mock.channels])for(const [filter,callback]of channel.listeners){
        if(filter.table!=='messages'||filter.event!=='INSERT')continue;
        const match=filter.filter?.match(/^conversation_id=eq\.(.+)$/);
        if(!match||message.conversation_id===match[1])callback({eventType:'INSERT',new:message,old:{}});
      }
    };__mock.switchAccount=id=>{user={id};profile.id=id;profile.username='qa_second';profile.display_name='Second QA account';__mock.emitAuth('SIGNED_IN',{user,access_token:'MOCK_SECOND_ACCOUNT'});};'''
    replace('const result=(data,error=null)=>Promise.resolve({data,error});', initialization + '\nconst result=(data,error=null)=>Promise.resolve({data,error});')
    replace("if(name.startsWith('my_conversations'))return result([{id:chat,title:'@qa_peer',last_message:messages.at(-1)?.body||'',last_seq:seq,last_read_seq:2,unread_count:1,last_message_at:new Date().toISOString()}]);", "if(name.startsWith('my_conversations'))return result([chat,'" + OTHER_CHAT + "'].map(id=>({id,title:id===chat?'@qa_peer':'Соседний QA чат',last_message:messages.filter(m=>m.conversation_id===id).at(-1)?.body||'',last_seq:messages.filter(m=>m.conversation_id===id).at(-1)?.server_seq||0,last_read_seq:0,unread_count:0,last_message_at:new Date().toISOString()})));")
    replace("if(name==='send_message'||name==='send_attachment_message'||name==='send_rich_message'){", "if(name==='send_message'||name==='send_attachment_message'||name==='send_rich_message'){if(name==='send_rich_message')__mock.richCalls.push(structuredClone(args));")
    replace("id:'s'+(++seq),client_message_id:args.p_client_message_id", "id:crypto.randomUUID(),client_message_id:args.p_client_message_id")
    replace("server_seq:seq,sender_id:user.id,type", "server_seq:++seq,sender_id:user.id,type")
    replace("channel(){return{on(){return this},subscribe(cb){setTimeout(()=>cb?.('SUBSCRIBED'),10);return this}}},removeChannel:()=>Promise.resolve()", "channel(name){const channel={name,listeners:[],on(event,filter,callback){this.listeners.push([filter,callback]);return this},subscribe(cb){__mock.channels.push(this);setTimeout(()=>cb?.('SUBSCRIBED'),10);return this}};return channel},removeChannel:channel=>{__mock.channels=__mock.channels.filter(c=>c!==channel);return Promise.resolve()}")
    replace("return result({signedUrl:'data:text/plain,stored'})", 'return result({signedUrl:URL.createObjectURL(__mock.objects.get(path))})')
    return source


def incoming(number, *, chat=OTHER_CHAT, sender=PEER, text='Сообщение из соседнего чата', video=False):
    content = {'v': 1, 'blocks': [{'id': 'notice', 'type': 'text', 'text': text}]}
    if video:
        content['blocks'].append({'id': 'movie', 'type': 'video',
                                 'path': f'{MAIN_CHAT}/{PEER}/{RICH_ID}/video',
                                 'name': 'video.webm', 'mime': 'video/webm', 'size': len(WEBM)})
    return {'id': f'77777777-7777-4777-8777-{number:012d}', 'client_message_id': f'notice-{number}',
            'conversation_id': chat, 'server_seq': 100 + number, 'sender_id': sender,
            'type': 'rich', 'body': text, 'attachment_path': None, 'attachment_metadata': content,
            'created_at': '2026-09-08T11:00:00Z'}


async def one(name, engine):
    directory = tempfile.mkdtemp(prefix='pablicus-interactions-')
    context = await engine.launch_persistent_context(directory, headless=True,
        viewport={'width': 390, 'height': 844}, has_touch=True, service_workers='block', accept_downloads=True)
    source = mocked_sdk()
    unexpected, errors, checks = [], [], []

    async def route(request):
        url = request.request.url
        if url.startswith('blob:http://127.0.0.1:8765/'):
            return await request.continue_()
        parsed = urlparse(url)
        if parsed.netloc != '127.0.0.1:8765':
            unexpected.append(url)
            return await request.abort()
        path = parsed.path.lstrip('/') or 'index.html'
        if path == 'vendor/supabase.js':
            return await request.fulfill(status=200, content_type='application/javascript', body=source)
        file = DIST / path
        if not file.is_file():
            return await request.fulfill(status=404, body='not found')
        return await request.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=file.read_bytes())

    await context.route('**/*', route)
    page = await context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def open_main():
        await page.locator('.chatMain').first.click()
        await page.wait_for_function("PablicusChat?.scope?.chat==='" + MAIN_CHAT + "' && PablicusChat?.store && PablicusChat?.list && !document.getElementById('app').inert && document.getElementById('app').style.visibility!=='hidden'")

    try:
        EVIDENCE.mkdir(exist_ok=True)
        await page.goto('http://127.0.0.1:8765/', wait_until='domcontentloaded')
        await page.wait_for_selector('.chatMain')
        await open_main()
        row = page.locator(f'#canvas .row[data-id="{RICH_ID}"]')
        voice_a, voice_b = row.locator('[data-block-id="voice-a"]'), row.locator('[data-block-id="voice-b"]')
        await voice_a.locator('.richAudioPlay').click()
        await page.wait_for_function("document.querySelector('#canvas [data-block-id=\"voice-a\"] audio')?.currentTime > 0.15 && +document.querySelector('#canvas [data-block-id=\"voice-a\"] .richAudioSeek')?.value > 0")
        assert not await page.locator('#productDialog').evaluate('(node)=>node.open')
        assert await voice_a.locator('.richAudioSeek').input_value() != '0'
        await voice_a.locator('.richAudioPlay').click()
        assert await voice_a.locator('audio').evaluate('(audio)=>audio.paused')
        paused_at = await voice_a.locator('audio').evaluate('(audio)=>audio.currentTime')
        await page.wait_for_timeout(200)
        assert abs(await voice_a.locator('audio').evaluate('(audio)=>audio.currentTime') - paused_at) < .1
        await voice_a.locator('.richAudioPlay').click()
        await voice_b.locator('.richAudioPlay').click()
        await page.wait_for_function("document.querySelector('#canvas [data-block-id=\"voice-b\"] audio')?.currentTime > 0.1")
        assert await voice_a.locator('audio').evaluate('(audio)=>audio.paused')
        assert not await page.locator('#productDialog').evaluate('(node)=>node.open')
        await voice_b.locator('.richAudioPlay').click()
        checks.append('real WAV plays and pauses inside its message, updates progress, and only one voice plays at a time')

        gallery = row.locator('.richMediaGallery')
        await gallery.scroll_into_view_if_needed()
        assert await gallery.locator(':scope > .richMedia').count() == 3
        bounds = await gallery.locator(':scope > .richMedia').evaluate_all('(nodes)=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})')
        assert abs(bounds[0]['y'] - bounds[1]['y']) < 2 and bounds[1]['x'] > bounds[0]['x']
        assert await gallery.evaluate('(node)=>getComputedStyle(node).display') == 'grid'
        await page.screenshot(path=str(EVIDENCE / f'message-interactions-{name}-gallery.png'))
        checks.append('adjacent photo/video items share a compact real grid; prose and voice keep their message position')

        await gallery.locator('.richMedia-image').first.click()
        viewer = page.locator('dialog.pablicusMediaViewer')
        await viewer.wait_for(state='visible')
        dimensions = await viewer.evaluate('(node)=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight,border:s.borderTopWidth,radius:s.borderRadius,padding:s.padding}}')
        assert abs(dimensions['x']) < 1 and abs(dimensions['y']) < 1
        assert abs(dimensions['w'] - dimensions['vw']) < 2 and abs(dimensions['h'] - dimensions['vh']) < 2, dimensions
        assert dimensions['border'] == '0px' and dimensions['radius'] == '0px' and dimensions['padding'] == '0px', dimensions
        await viewer.locator('img.pmvMedia').wait_for()
        await page.screenshot(path=str(EVIDENCE / f'message-interactions-{name}-fullscreen.png'))
        async with page.expect_download() as download_info:
            await viewer.locator('.pmvDownload').click()
        downloaded = await download_info.value
        assert downloaded.suggested_filename == 'photo-a.png'
        await viewer.locator('.pmvNext').click()
        assert '2 из 3' in await viewer.locator('.pmvCounter').inner_text()
        await viewer.locator('.pmvNext').click()
        video = viewer.locator('video.pmvMedia')
        await video.wait_for()
        assert await video.evaluate('(node)=>node.controls && node.playsInline')
        await viewer.locator('.pmvClose').click()
        await viewer.wait_for(state='hidden')
        assert await page.locator('.pablicusMediaViewer video[src]').count() == 0
        checks.append('photo/video open at viewport size without dialog border; carousel, actual local download and close cleanup work')

        await page.locator('#vp').evaluate('(node)=>node.scrollTop=0')
        original = page.locator(f'#canvas .row[data-id="{TEXT_ID}"]')
        await original.locator('.messageActions').click()
        await page.locator('#productDialog').get_by_role('button', name='Ответить', exact=True).click()
        await page.locator('#replyDraft').wait_for(state='visible')
        await page.locator('#input').fill('Текст не должен потеряться при отмене ответа')
        await page.evaluate('PablicusChat.flush()')
        assert await page.evaluate('PablicusChat.store.read().then(d=>d.reply_to)') == {'message_id': TEXT_ID}
        await page.locator('#cancelReply').click()
        assert await page.locator('#input').input_value() == 'Текст не должен потеряться при отмене ответа'
        await page.evaluate('PablicusChat.flush()')
        assert not await page.evaluate('PablicusChat.store.read().then(d=>d?.reply_to)')
        checks.append('whole-message Reply is available and cancelling the target preserves the independent text draft')

        await voice_a.locator('.richAudioReply').click()
        await page.locator('#input').fill('Ответ именно на первое голосовое')
        await page.evaluate('PablicusChat.flush()')
        target = {'message_id': RICH_ID, 'block_id': 'voice-a'}
        assert await page.evaluate('PablicusChat.store.read().then(d=>d.reply_to)') == target
        await page.reload()
        await page.wait_for_selector('.chatMain')
        await open_main()
        await page.locator('#replyDraft').wait_for(state='visible')
        assert await page.locator('#input').input_value() == 'Ответ именно на первое голосовое'
        assert await page.evaluate('PablicusChat.store.read().then(d=>d.reply_to)') == target
        await page.evaluate('__mock.online=false')
        await page.locator('#send').click()
        await page.wait_for_function('PablicusChat.store.readQueue(false).then(rows=>rows.length===1&&rows[0].state==="error")')
        queue = await page.evaluate('PablicusChat.store.readQueue(false)')
        assert len(queue[0]['messages']) == 1 and queue[0]['messages'][0]['reply_to'] == target
        # Let the ordinary worker retry after its backoff. Calling store.retry
        # while an automatic retry acquires its lease would be a test race.
        await page.evaluate('__mock.online=true')
        await page.wait_for_function('__mock.sent.length===1', timeout=35000)
        await page.wait_for_function('PablicusChat.store.readQueue(false).then(rows=>rows.length===0)')
        assert await page.evaluate('__mock.sent[0].attachment_metadata.reply_to') == target
        assert await page.evaluate('__mock.richCalls.at(-1).p_content.reply_to') == target
        await page.locator('#canvas .row.mine .replyQuote').wait_for()
        assert not await page.evaluate('PablicusChat.store.read().then(d=>d?.reply_to)')
        assert not await page.locator('#replyDraft').is_visible()
        checks.append('an individual voice reply survives reload and offline queue, then arrives in one RPC payload and one quoted bubble')

        await page.locator(f'#canvas .row[data-id="{RICH_ID}"] [data-block-id="voice-b"] .richAudioReply').click()
        preserved_target = {'message_id': RICH_ID, 'block_id': 'voice-b'}
        await page.locator('#input').fill('Продолжаю основной разговор')
        await page.evaluate('(m)=>__mock.emitMessage(m)', incoming(1, text='Соседний чат\n' + '\n'.join(f'Строка {i}' for i in range(1, 30)), video=True))
        monitor = page.locator('#inboxMonitor')
        await monitor.wait_for(state='visible')
        assert await page.locator('#input').input_value() == 'Продолжаю основной разговор'
        assert await page.evaluate('PablicusDebug.current') == MAIN_CHAT
        box = await monitor.bounding_box()
        assert box['width'] < 340 and box['y'] > 35, box
        body = monitor.locator('.inboxMonitorBody')
        assert await body.evaluate('(node)=>node.scrollHeight>node.clientHeight && ["auto","scroll"].includes(getComputedStyle(node).overflowY)')
        await body.evaluate('(node)=>node.scrollTop=node.scrollHeight')
        assert await body.evaluate('(node)=>node.scrollTop') > 0
        movie = monitor.locator('.inboxMonitorVideo')
        await movie.wait_for()
        assert await movie.evaluate('(node)=>node.controls && node.muted && node.playsInline')
        await page.locator('#toast').wait_for(state='hidden')
        await page.screenshot(path=str(EVIDENCE / f'message-interactions-{name}-monitor.png'))
        movie_handle = await movie.element_handle()
        await monitor.locator('.inboxMonitorCollapse').click()
        await page.locator('.inboxMonitorBadge').wait_for(state='visible')
        assert await movie_handle.evaluate('(node)=>node.paused && !node.hasAttribute("src")')
        await page.locator('.inboxMonitorBadge').click()
        await body.wait_for(state='visible')
        await monitor.locator('.inboxMonitorClose').click()
        await monitor.wait_for(state='hidden')
        await page.evaluate('(m)=>__mock.emitMessage(m)', incoming(2, chat=MAIN_CHAT))
        await page.evaluate('(m)=>__mock.emitMessage(m)', incoming(3, sender=USER))
        await page.wait_for_timeout(250)
        assert not await monitor.is_visible()
        assert await page.locator('#input').input_value() == 'Продолжаю основной разговор'
        checks.append('another-chat monitor preserves the active draft, scrolls internally, offers muted video controls, releases collapsed media and ignores own/current-chat messages')

        await page.evaluate('(m)=>__mock.emitMessage(m)', incoming(4, text='Перейдите в соседний разговор'))
        await monitor.wait_for(state='visible')
        await monitor.locator('.inboxMonitorOpen').click()
        await page.wait_for_function("PablicusChat?.scope?.chat==='" + OTHER_CHAT + "' && !document.getElementById('app').inert && document.getElementById('app').style.visibility!=='hidden'")
        assert await page.locator('#input').input_value() == ''
        assert not await page.locator('#replyDraft').is_visible()
        assert not await page.evaluate('PablicusChat.store.read().then(d=>d?.reply_to)')
        await page.locator('#chatBack').click()
        await open_main()
        assert await page.locator('#input').input_value() == 'Продолжаю основной разговор'
        await page.locator('#replyDraft').wait_for(state='visible')
        assert await page.evaluate('PablicusChat.store.read().then(d=>d.reply_to)') == preserved_target
        checks.append('opening another chat from the monitor flushes the original text and voice reply target; returning restores both without crossing chat scopes')

        # Both mock accounts are members of the same conversation. Retain A's
        # queue object explicitly, then test B's background worker before B
        # opens any chat; scope.chat alone cannot establish account ownership.
        await page.evaluate('__mock.online=false;__mock.oldStore=PablicusChat.store')
        await page.locator('#send').click()
        await page.wait_for_function('__mock.oldStore.readQueue(false).then(rows=>rows.length===1&&rows[0].state==="error")')
        await page.evaluate('(id)=>__mock.switchAccount(id)', SECOND_USER)
        await page.wait_for_function("PablicusDebug.user==='" + SECOND_USER + "'")
        await page.locator('.chatMain').first.wait_for(state='visible')
        await page.evaluate('''async()=>{const [q]=await __mock.oldStore.readQueue(false);await __mock.oldStore.change(q.id,r=>{r.state='queued';r.lease=null;r.nextAttemptAt=0});__mock.online=true;await PablicusDebug.pump()}''')
        await page.wait_for_timeout(300)
        assert await page.evaluate('__mock.sent.length') == 1
        old_queue = await page.evaluate('__mock.oldStore.readQueue(false)')
        assert len(old_queue) == 1 and old_queue[0]['messages'][0]['reply_to'] == preserved_target
        await open_main()
        assert await page.locator('#input').input_value() == ''
        assert not await page.locator('#replyDraft').is_visible()
        assert await page.evaluate('PablicusChat.store.readQueue(false).then(rows=>rows.length)') == 0
        assert await page.evaluate('__mock.sent.length') == 1
        checks.append('switching accounts with the same conversation ID never lets B display or submit A\'s unsent voice reply')

        assert not errors, errors
        assert not unexpected, unexpected
        checks.append('no JavaScript errors or external network requests')
        EVIDENCE.mkdir(exist_ok=True)
        await page.locator('#toast').wait_for(state='hidden')
        await page.screenshot(path=str(EVIDENCE / f'message-interactions-{name}-pass.png'))
        return {'engine': name, 'pass': True, 'checks': checks, 'scope': 'real built app, IndexedDB and WAV decoder; explicit mock backend and fixture media only'}
    except Exception:
        EVIDENCE.mkdir(exist_ok=True)
        await page.screenshot(path=str(EVIDENCE / f'message-interactions-{name}-failure.png'))
        return {'engine': name, 'pass': False, 'checks': checks, 'error': traceback.format_exc(), 'js_errors': errors, 'unexpected_requests': unexpected}
    finally:
        await context.close()
        shutil.rmtree(directory, ignore_errors=True)


async def main(engines):
    async with async_playwright() as playwright:
        results = [await one(name, getattr(playwright, name)) for name in engines]
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / 'message-interactions.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert all(result['pass'] for result in results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engines', nargs='*', metavar='ENGINE')
    args = parser.parse_args()
    if any(name not in ('chromium', 'webkit') for name in args.engines):
        parser.error('engines must be chromium or webkit')
    asyncio.run(main(args.engines or ['chromium', 'webkit']))
