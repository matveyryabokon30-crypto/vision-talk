"""Built mobile UI against a scoped, deliberately delayed mock backend.

The server fixture contains more history than the initial chat window and owns
all media bytes. Browser requests never contact Supabase or mutate release dist.
"""
import argparse
import asyncio
import json
import mimetypes
import shutil
import tempfile
import traceback
from urllib.parse import urlparse

from playwright.async_api import async_playwright

from message_interactions import (DIST, EVIDENCE, MAIN_CHAT, OTHER_CHAT, PEER,
                                  RICH_ID, SECOND_USER, TEXT_ID, USER, mocked_sdk)

OLD_TEXT = 'Давнее сообщение вне первой страницы'
LATE_TEXT = 'Поздний ответ только первого разговора'
SEARCH_PREFIX = 'Архивный маяк'
FILE_PREFIX = 'Смета-здание'
SEARCH_COUNT = 47
FILE_COUNT = 47


def library_sdk():
    source = mocked_sdk()

    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, 'Fixture anchor changed: ' + old[:100]
        source = source.replace(old, new, 1)

    setup = r'''
    __mock.libraryCalls=[];__mock.messageReads=[];__mock.signedCalls=[];
    __mock.pendingLibrary=[];__mock.holdQuery=null;__mock.storageUnavailable=false;
    __mock.storage={total_bytes:7340032,own_bytes:2097152,object_count:52,
      own_object_count:9,unknown_size_count:0,measured_at:'2026-09-09T12:00:00Z'};
    __mock.releaseLibrary=()=>{const jobs=__mock.pendingLibrary.splice(0);jobs.forEach(job=>job());};
    __mock.signOut=()=>__mock.emitAuth('SIGNED_OUT',null);
    const oldMessage=messages.find(m=>m.id==='__TEXT_ID__');
    oldMessage.body='Первоначальный текст до правки';oldMessage.edited_body='__OLD_TEXT__';
    oldMessage.message_revision=1;oldMessage.edited_at='2026-09-09T09:00:00Z';
    const makeMessage=(number,body,extra={})=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(number).padStart(12,'0'),
      client_message_id:'library-'+number,conversation_id:chat,server_seq:number,sender_id:peer,
      type:'text',body,attachment_path:null,attachment_metadata:null,created_at:'2026-09-08T12:00:00Z',...extra});
    for(let i=0;i<__SEARCH_COUNT__;i++)messages.push(makeMessage(10+i,'__SEARCH_PREFIX__ '+String(i).padStart(2,'0')));
    const documents=[];
    for(let i=0;i<__FILE_COUNT__;i++){
      const block={id:'document-'+i,type:'document',path:chat+'/'+peer+'/document-'+i,
        name:'__FILE_PREFIX__-'+String(i).padStart(2,'0')+'.pdf',mime:'application/pdf',size:2048+i};
      documents.push(block);__mock.objects.set(block.path,new Blob(['%PDF-1.4\nmock fixture\n'],{type:'application/pdf'}));
    }
    messages.push(makeMessage(80,'',{type:'rich',attachment_metadata:{v:1,blocks:documents}}));
    messages.push(makeMessage(65,'Подробности: https://example.test/archive?q=history'));
    messages.push(makeMessage(66,'__LATE_TEXT__'));
    for(let i=200;i<=380;i++)messages.push(makeMessage(i,'Обычное недавнее сообщение '+i));
    messages.push(makeMessage(1,'Сообщение соседнего разговора',{id:'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      client_message_id:'other-1',conversation_id:'__OTHER_CHAT__'}));
    messages.sort((a,b)=>a.server_seq-b.server_seq);seq=380;
    __mock.fixtureMessages=messages;
    const visibleMessage=m=>!m.deleted_at;
    const bodyOf=m=>m.edited_body??m.body??'';
    const libraryResult=(args,data)=>{
      if(__mock.holdQuery!==null&&String(args.p_query||'')===__mock.holdQuery)
        return new Promise(resolve=>__mock.pendingLibrary.push(()=>resolve({data,error:null})));
      return Promise.resolve({data,error:null});
    };
    const materialRows=conversationId=>messages.filter(m=>m.conversation_id===conversationId&&visibleMessage(m)).flatMap(m=>{
      const common={message_id:m.id,server_seq:m.server_seq,sender_id:m.sender_id,created_at:m.created_at};
      const content=m.edited_content||m.attachment_metadata;
      const blocks=m.type==='rich'?(content?.blocks||[]):m.attachment_path?[{
        id:'attachment',type:m.type==='file'?'document':m.type,path:m.attachment_path,
        name:content?.name,mime:content?.mime_type,size:content?.size_bytes}]:[];
      const materials=blocks.flatMap((b,i)=>{
        if(b.type==='text')return [];
        const kind=['image','video'].includes(b.type)?'media':b.type==='audio'?'audio':'documents';
        return [{...common,block_id:b.id,block_index:i,kind,type:b.type,path:b.path,name:b.name||'',
          mime:b.mime||'',size:b.size||0,body:bodyOf(m),url:null,duration:b.duration||null}];
      });
      for(const [i,url] of [...bodyOf(m).matchAll(/https?:\/\/[^\s]+/g)].map((match,i)=>[i,match[0]]))
        materials.push({...common,block_id:'link-'+i,block_index:1000+i,kind:'links',type:'link',
          path:null,name:url,mime:'',size:0,body:bodyOf(m),url,duration:null});
      return materials;
    }).sort((a,b)=>b.server_seq-a.server_seq||a.block_index-b.block_index);
    '''
    replacements = {'__TEXT_ID__': TEXT_ID, '__OLD_TEXT__': OLD_TEXT, '__LATE_TEXT__': LATE_TEXT,
                    '__OTHER_CHAT__': OTHER_CHAT, '__SEARCH_PREFIX__': SEARCH_PREFIX,
                    '__FILE_PREFIX__': FILE_PREFIX, '__SEARCH_COUNT__': str(SEARCH_COUNT),
                    '__FILE_COUNT__': str(FILE_COUNT)}
    for old, new in replacements.items():
        setup = setup.replace(old, new)
    replace('const result=(data,error=null)=>Promise.resolve({data,error});', setup + '\nconst result=(data,error=null)=>Promise.resolve({data,error});')
    replace("lt(k,v){filters.push([k,'lt',v]);return q}", "lt(k,v){filters.push([k,'lt',v]);return q},gte(k,v){filters.push([k,'gte',v]);return q},lte(k,v){filters.push([k,'lte',v]);return q}")
    replace("op==='gt'?x[k]>v:x[k]<v", "op==='gt'?x[k]>v:op==='gte'?x[k]>=v:op==='lte'?x[k]<=v:x[k]<v")
    replace('function run(single){let d=', "function run(single){if(table==='messages')__mock.messageReads.push({filters:structuredClone(filters),sort,limit:lim});let d=")
    replace('async createSignedUrl(path){', 'async createSignedUrl(path){__mock.signedCalls.push(path);')
    replace('rpc:async(name,args)=>{', r'''rpc:async(name,args={})=>{
      if(name==='get_message_actions')return result(messages.filter(m=>(args.p_message_ids||[]).includes(m.id)).map(m=>({
        message_id:m.id,pinned:false,reactions:[],message_revision:m.message_revision||0,
        edited_body:m.edited_body??null,edited_content:m.edited_content??null,edited_at:m.edited_at??null,deleted_at:m.deleted_at??null})));
      if(name==='get_pinned_messages')return result([]);
      if(name==='pablicus_search_messages'){
        __mock.libraryCalls.push({name,args:structuredClone(args)});
        const query=String(args.p_query||'').toLocaleLowerCase();
        const found=messages.filter(m=>m.conversation_id===args.p_conversation_id&&visibleMessage(m)
          &&bodyOf(m).toLocaleLowerCase().includes(query)&&(args.p_before_seq==null||m.server_seq<args.p_before_seq))
          .sort((a,b)=>b.server_seq-a.server_seq).slice(0,args.p_limit||30)
          .map(m=>({message_id:m.id,server_seq:m.server_seq,sender_id:m.sender_id,
            created_at:m.created_at,snippet:bodyOf(m),message_revision:m.message_revision||0}));
        return libraryResult(args,found);
      }
      if(name==='pablicus_chat_materials'){
        __mock.libraryCalls.push({name,args:structuredClone(args)});
        const query=String(args.p_query||'').toLocaleLowerCase();
        const found=materialRows(args.p_conversation_id).filter(m=>m.kind===args.p_kind
          &&(!query||[m.name,m.body,m.url||''].some(text=>text.toLocaleLowerCase().includes(query)))
          &&(args.p_before_seq==null||m.server_seq<args.p_before_seq||m.server_seq===args.p_before_seq&&m.block_index>args.p_before_index))
          .slice(0,args.p_limit||40);
        return libraryResult(args,found);
      }
      if(name==='pablicus_storage_usage'){
        __mock.libraryCalls.push({name,args:structuredClone(args)});
        return __mock.storageUnavailable?result(null,{code:'PGRST202',message:'Сервис временно недоступен'}):result([structuredClone(__mock.storage)]);
      }
    ''')
    return source


async def one(name, engine):
    directory = tempfile.mkdtemp(prefix='pablicus-chat-library-')
    context = await engine.launch_persistent_context(directory, headless=True,
        viewport={'width': 390, 'height': 844}, has_touch=True,
        service_workers='block', accept_downloads=True)
    source = library_sdk()
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
        return await request.fulfill(status=200,
            content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',
            body=file.read_bytes())

    await context.route('**/*', route)
    page = await context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    panel = page.locator('dialog.pablicusChatLibrary')
    search = panel.locator('.pclSearchInput')

    async def ready_chat(chat_id):
        await page.wait_for_function("id=>PablicusChat?.scope?.chat===id && PablicusChat?.store && PablicusChat?.list && !document.getElementById('app').inert && document.getElementById('app').style.visibility!=='hidden'", arg=chat_id)

    async def open_chat(chat_id):
        await page.locator('.chatMain').filter(has_text='@qa_peer' if chat_id == MAIN_CHAT else 'Соседний QA чат').click()
        await ready_chat(chat_id)

    async def open_search():
        await page.locator('#chatLibraryOpen').click()
        await panel.wait_for(state='visible')
        await search.wait_for(state='visible')

    async def count(selector, expected):
        await page.wait_for_function('([selector,count])=>document.querySelectorAll(selector).length===count', arg=[selector, expected])

    async def complete_pages(selector, expected):
        await page.locator(selector).first.wait_for()
        initial = await page.locator(selector).count()
        assert 0 < initial < expected, (selector, initial, expected)
        await panel.locator('.pclMore').click()
        await count(selector, expected)
        assert not await panel.locator('.pclMore').is_visible()
        identifiers = await page.locator(selector).evaluate_all('(nodes)=>nodes.map(n=>n.dataset.messageId+":"+(n.dataset.blockId||""))')
        assert len(identifiers) == len(set(identifiers)), identifiers
        return initial

    try:
        EVIDENCE.mkdir(exist_ok=True)
        await page.goto('http://127.0.0.1:8765/', wait_until='domcontentloaded')
        await page.wait_for_selector('.chatMain')
        await open_chat(MAIN_CHAT)
        initial = await page.evaluate('PablicusChat.list.messages.map(m=>({id:m.id,number:m.number}))')
        assert len(initial) >= 120 and all(m['id'] != TEXT_ID for m in initial), initial
        assert all(m['id'] != RICH_ID for m in initial), initial
        await page.locator('#input').fill('Черновик остаётся при поиске')
        await page.evaluate('PablicusChat.flush()')
        await open_search()
        assert await panel.locator('.pclTab').count() == 5
        await search.fill(SEARCH_PREFIX)
        search_initial = await complete_pages('dialog.pablicusChatLibrary .pclResult', SEARCH_COUNT)
        calls = await page.evaluate('__mock.libraryCalls.filter(c=>c.name==="pablicus_search_messages")')
        assert any(c['args'].get('p_before_seq') is not None for c in calls), calls
        assert all(c['args']['p_conversation_id'] == MAIN_CHAT for c in calls), calls
        assert all(SEARCH_PREFIX in text for text in await panel.locator('.pclResult').all_inner_texts())
        checks.append(f'server text search finds {SEARCH_COUNT} historical matches in cursor pages ({search_initial} on the first page), with no duplicates or cross-chat RPCs')

        await search.fill(OLD_TEXT)
        await count('dialog.pablicusChatLibrary .pclResult', 1)
        result = panel.locator(f'.pclResult[data-message-id="{TEXT_ID}"]')
        await result.wait_for()
        assert OLD_TEXT in await result.inner_text()
        await page.screenshot(path=str(EVIDENCE / f'chat-library-{name}-search.png'))
        await result.locator('.pclLocate').click()
        await panel.wait_for(state='hidden')
        old = page.locator(f'#canvas .row[data-id="{TEXT_ID}"]')
        await old.wait_for(state='visible')
        assert OLD_TEXT in await old.inner_text()
        assert await page.locator('#input').input_value() == 'Черновик остаётся при поиске'
        reads = await page.evaluate('__mock.messageReads')
        assert any(['id', 'eq', TEXT_ID] in r['filters'] and ['conversation_id', 'eq', MAIN_CHAT] in r['filters'] for r in reads), reads
        assert any(any(f[0] == 'server_seq' and f[1] in ('gte', 'lte') for f in r['filters']) for r in reads), reads
        assert await page.evaluate('id=>PablicusChat.list.messages.filter(m=>m.id===id).length', TEXT_ID) == 1
        checks.append('an edited result beyond the initial history opens its real original through a fresh membership-scoped read and neighborhood fetch, preserving the draft')

        await page.locator('#chatTitle').click()
        await panel.wait_for(state='visible')
        await count('dialog.pablicusChatLibrary .pclMaterial', 3)
        media = panel.locator(f'.pclMaterial[data-message-id="{RICH_ID}"]')
        assert await media.count() == 3
        assert set(await media.evaluate_all('(nodes)=>nodes.map(n=>n.dataset.blockId)')) == {'photo-a', 'photo-b', 'video'}
        layout = await panel.evaluate('(node)=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}}')
        assert layout['x'] >= -1 and layout['right'] <= layout['width'] + 1 and layout['scrollWidth'] <= layout['width'], layout
        await page.screenshot(path=str(EVIDENCE / f'chat-library-{name}-media.png'))
        await media.first.locator('.pclMediaTile').click()
        viewer = page.locator('dialog.pablicusMediaViewer')
        await viewer.wait_for(state='visible')
        assert '1 из 3' in await viewer.locator('.pmvCounter').inner_text()
        await viewer.locator('.pmvNext').click()
        await viewer.locator('.pmvNext').click()
        assert await viewer.locator('video.pmvMedia').evaluate('(node)=>node.controls&&node.playsInline')
        await viewer.locator('.pmvClose').click()
        await viewer.wait_for(state='hidden')
        assert await panel.is_visible()
        checks.append('the title opens full-history media; three blocks keep one composite-message identity and launch the working photo/video carousel from a mobile-sized grid')

        await panel.locator('.pclTab[data-tab="documents"]').click()
        await search.fill(FILE_PREFIX)
        file_initial = await complete_pages('dialog.pablicusChatLibrary .pclMaterial', FILE_COUNT)
        names = await panel.locator('.pclMaterial').all_inner_texts()
        assert all(FILE_PREFIX in text and '.pdf' in text for text in names), names
        file_calls = await page.evaluate('__mock.libraryCalls.filter(c=>c.name==="pablicus_chat_materials"&&c.args.p_kind==="documents"&&c.args.p_query==="Смета-здание")')
        assert any(c['args'].get('p_before_seq') == 80 and c['args'].get('p_before_index') == file_initial - 1 for c in file_calls), file_calls
        async with page.expect_download() as download_info:
            await panel.locator('.pclFileDownload').first.click()
        downloaded = await download_info.value
        assert downloaded.suggested_filename == FILE_PREFIX + '-00.pdf'
        checks.append(f'filename filtering pages through all {FILE_COUNT} blocks in one old message ({file_initial} first); the block cursor prevents gaps or duplicates and a file downloads under its original name')

        await panel.locator('.pclTab[data-tab="links"]').click()
        await search.fill('')
        await count('dialog.pablicusChatLibrary .pclMaterial', 1)
        link = panel.locator('.pclMaterial a[href="https://example.test/archive?q=history"]')
        await link.wait_for()
        assert 'noopener' in (await link.get_attribute('rel') or '')
        checks.append('the link category exposes the historical URL as a safe separate link without opening external pages during the test')

        await panel.locator('.pclTab[data-tab="audio"]').click()
        await search.fill('')
        await count('dialog.pablicusChatLibrary .pclMaterial', 2)
        first_voice = panel.locator('.pclMaterial[data-block-id="voice-a"]')
        second_voice = panel.locator('.pclMaterial[data-block-id="voice-b"]')
        await first_voice.locator('.pclAudioPlay').click()
        await page.wait_for_function('document.querySelector(".pclMaterial[data-block-id=voice-a] audio")?.currentTime>0.12')
        assert not await page.locator('#productDialog').evaluate('(node)=>node.open')
        audio = await first_voice.locator('audio').element_handle()
        await second_voice.locator('.pclAudioPlay').click()
        await page.wait_for_function('document.querySelector(".pclMaterial[data-block-id=voice-b] audio")?.currentTime>0.12')
        assert await audio.evaluate('(node)=>node.paused')
        playing_audio = await second_voice.locator('audio').element_handle()
        await page.screenshot(path=str(EVIDENCE / f'chat-library-{name}-audio.png'))
        await panel.locator('.pclClose').click()
        await panel.wait_for(state='hidden')
        assert await playing_audio.evaluate('(node)=>node.paused&&!node.hasAttribute("src")')
        checks.append('real WAV plays inline in the audio category, switching voice pauses the previous block, and closing releases its media source')

        await open_search()
        await page.evaluate('q=>__mock.holdQuery=q', LATE_TEXT)
        await search.fill(LATE_TEXT)
        await page.wait_for_function('__mock.pendingLibrary.length===1')
        await panel.locator('.pclClose').click()
        await page.locator('#chatBack').click()
        await open_chat(OTHER_CHAT)
        await open_search()
        await search.fill('Сообщение соседнего')
        await count('dialog.pablicusChatLibrary .pclResult', 1)
        await page.evaluate('__mock.releaseLibrary()')
        await page.wait_for_timeout(150)
        assert LATE_TEXT not in await panel.inner_text()
        assert 'Сообщение соседнего' in await panel.inner_text()
        assert await panel.locator('.pclResult').count() == 1
        await panel.locator('.pclClose').click()
        checks.append('a held first-chat RPC completing after a chat switch cannot replace or append to the second-chat results')

        await page.locator('#chatBack').click()
        await page.locator('#mainNav [data-page="profile"]').click()
        await page.locator('#storageUsage[data-state="ready"]').wait_for()
        assert await page.locator('#storageTotal').inner_text() == '7 МБ'
        assert await page.locator('#storageOwn').inner_text() == '2 МБ'
        assert 'облаке' in await page.locator('#storageStatus').inner_text()
        assert not await page.locator('#storageUsage progress').count()
        await page.locator('#storageUsage').scroll_into_view_if_needed()
        await page.screenshot(path=str(EVIDENCE / f'chat-library-{name}-storage.png'))
        await page.evaluate('__mock.storageUnavailable=true')
        await page.locator('#storageRefresh').click()
        await page.locator('#storageUsage[data-state="unavailable"]').wait_for()
        assert await page.locator('#storageTotal').inner_text() == '—'
        assert await page.locator('#storageOwn').inner_text() == '—'
        assert 'Не удалось' in await page.locator('#storageStatus').inner_text()
        await page.evaluate('__mock.storageUnavailable=false;__mock.storage.unknown_size_count=2')
        await page.locator('#storageRefresh').click()
        await page.locator('#storageUsage[data-state="ready"]').wait_for()
        assert 'неизвестен' in await page.locator('#storageStatus').inner_text()
        assert '7 МБ' == await page.locator('#storageTotal').inner_text()
        checks.append('profile distinguishes total cloud bytes from own uploads, hides stale numbers on failure, labels unknown file sizes, and invents no capacity quota')

        await page.locator('#mainNav [data-page="chats"]').click()
        await open_chat(MAIN_CHAT)
        await open_search()
        await search.fill(LATE_TEXT)
        await page.wait_for_function('__mock.pendingLibrary.length===1')
        await page.evaluate('__mock.signOut()')
        await page.locator('#loginPane').wait_for(state='visible')
        await panel.wait_for(state='hidden')
        await page.evaluate('__mock.releaseLibrary()')
        await page.wait_for_timeout(150)
        assert not await panel.is_visible()
        assert LATE_TEXT not in await panel.inner_text()
        assert await page.locator('#workspace').is_hidden()
        await page.evaluate('id=>__mock.switchAccount(id)', SECOND_USER)
        await page.wait_for_function('id=>PablicusDebug.user===id', arg=SECOND_USER)
        await page.locator('.chatMain').first.wait_for()
        await open_chat(MAIN_CHAT)
        assert await page.locator('#input').input_value() == ''
        await open_search()
        assert LATE_TEXT not in await panel.inner_text()
        assert await search.input_value() == ''
        await panel.locator('.pclClose').click()
        checks.append('sign-out clears an open search and discards a late response; the next account starts with an empty query and its own draft')

        assert not errors, errors
        assert not unexpected, unexpected
        checks.append('no JavaScript errors, external requests, real recipients or release-asset mutations')
        await page.screenshot(path=str(EVIDENCE / f'chat-library-{name}-pass.png'))
        return {'engine': name, 'pass': True, 'checks': checks,
                'scope': 'built app, real DOM/IndexedDB/WAV playback; isolated full-history mock, not live database or physical iPhone'}
    except Exception:
        EVIDENCE.mkdir(exist_ok=True)
        await page.screenshot(path=str(EVIDENCE / f'chat-library-{name}-failure.png'))
        return {'engine': name, 'pass': False, 'checks': checks,
                'error': traceback.format_exc(), 'js_errors': errors, 'unexpected_requests': unexpected}
    finally:
        await context.close()
        shutil.rmtree(directory, ignore_errors=True)


async def main(engines):
    async with async_playwright() as playwright:
        results = [await one(name, getattr(playwright, name)) for name in engines]
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / 'chat-library.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert all(result['pass'] for result in results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engines', nargs='*', metavar='ENGINE')
    args = parser.parse_args()
    if any(name not in ('chromium', 'webkit') for name in args.engines):
        parser.error('engines must be chromium or webkit')
    asyncio.run(main(args.engines or ['chromium', 'webkit']))
