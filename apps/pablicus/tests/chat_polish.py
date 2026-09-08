"""Real mobile DOM with an isolated backend for message actions and discovery.

The fixture owns every profile/message and records mutations. It does not use
production accounts, send a real message or claim physical iPhone verification.
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

from message_interactions import ROOT, DIST, EVIDENCE, USER, PEER, MAIN_CHAT, OTHER_CHAT, TEXT_ID, RICH_ID, mocked_sdk

OWN_ID = '66666666-6666-4666-8666-666666666663'
KATYA_ID = '99999999-9999-4999-8999-999999999991'
KATYA_CHAT = '44444444-4444-4444-8444-444444444444'


def polish_sdk():
    source = mocked_sdk()

    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, 'Fixture anchor changed: ' + old[:100]
        source = source.replace(old, new, 1)

    own = {'id': OWN_ID, 'client_message_id': OWN_ID, 'conversation_id': MAIN_CHAT,
           'server_seq': 3, 'sender_id': USER, 'type': 'text', 'body': 'Мой текст для редактирования',
           'attachment_path': None, 'attachment_metadata': None, 'created_at': '2026-09-08T10:02:00Z'}
    setup = r'''__mock.actionCalls=[];__mock.directCalls=[];__mock.searchCalls=[];__mock.profileCards=[
      {id:'99999999-9999-4999-8999-999999999991',username:'katya_qa',display_name:'Катя',avatar_url:null},
      {id:'99999999-9999-4999-8999-999999999992',username:'katya_other',display_name:'Катя',avatar_url:null}
    ];__mock.directChats=new Map();__mock.messageActions=new Map();__mock.getMessage=id=>messages.find(m=>m.id===id);
    ''' + 'messages.push(' + json.dumps(own, ensure_ascii=False) + ');seq=3;'
    replace('const result=(data,error=null)=>Promise.resolve({data,error});', setup + '\nconst result=(data,error=null)=>Promise.resolve({data,error});')
    replace('rpc:async(name,args)=>{', r'''rpc:async(name,args)=>{
      if(name==='pablicus_search_people'){
        __mock.searchCalls.push(structuredClone(args));const q=String(args.p_query||'').toLowerCase().replace(/^@/,'');
        return result(__mock.profileCards.filter(p=>p.username.toLowerCase().includes(q)||p.display_name.toLowerCase().includes(q)));
      }
      if(name==='start_direct_conversation'){
        __mock.directCalls.push(structuredClone(args));const person=__mock.profileCards.find(p=>p.username===args.target_username);
        if(!person)return result(null,{message:'Пользователь не найден'});
        if(!__mock.directChats.has(person.username))__mock.directChats.set(person.username,'44444444-4444-4444-8444-444444444444');
        return result(__mock.directChats.get(person.username));
      }
      if(name==='get_message_actions')return result((args.p_message_ids||[]).map(id=>{
        const m=messages.find(m=>m.id===id),s=__mock.messageActions.get(id)||{};return m?{
          message_id:id,pinned:!!s.pinned,reactions:s.reactions||[],message_revision:m.message_revision||0,
          edited_body:m.edited_body??null,edited_content:m.edited_content??null,edited_at:m.edited_at??null,deleted_at:m.deleted_at??null
        }:null;
      }).filter(Boolean));
      if(name==='get_pinned_messages')return result(messages.filter(m=>m.conversation_id===args.p_conversation_id&&__mock.messageActions.get(m.id)?.pinned&&!m.deleted_at));
      if(['edit_message_text','delete_message','set_message_pin','set_message_reaction'].includes(name)){
        __mock.actionCalls.push({name,args:structuredClone(args)});
        const m=messages.find(m=>m.id===args.p_message_id&&m.conversation_id===args.p_conversation_id);
        if(!m)return result(null,{code:'42501',message:'Нет доступа к сообщению'});
        const s=__mock.messageActions.get(m.id)||{pinned:false,reactions:[]};
        if(name==='set_message_pin'){s.pinned=args.p_pinned;__mock.messageActions.set(m.id,s);return result(args.p_pinned);}
        if(name==='set_message_reaction'){s.reactions=args.p_active?[{emoji:args.p_emoji,count:1,mine:true}]:[];__mock.messageActions.set(m.id,s);return result(args.p_active);}
        if(m.sender_id!==user.id)return result(null,{code:'42501',message:'Изменять можно только своё сообщение'});
        if(args.p_expected_revision!==(m.message_revision||0))return result(null,{code:'40001',message:'Сообщение изменилось'});
        m.message_revision=(m.message_revision||0)+1;
        if(name==='delete_message')m.deleted_at=new Date().toISOString();
        else{m.edited_at=new Date().toISOString();if(m.type==='rich'){
          m.edited_content=structuredClone(m.edited_content||m.attachment_metadata);
          const block=m.edited_content.blocks.find(b=>b.id===args.p_block_id&&b.type==='text');
          if(!block)return result(null,{code:'22023',message:'Выберите текстовый блок'});
          block.text=args.p_text;m.edited_body=m.edited_content.blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
        }else m.edited_body=args.p_text;}
        return result(structuredClone(m));
      }
    ''')
    replace("[chat,'" + OTHER_CHAT + "'].map(id=>", "[chat,'" + OTHER_CHAT + "',...__mock.directChats.values()].map(id=>")
    replace("title:id===chat?'@qa_peer':'Соседний QA чат'", "title:id===chat?'Основной QA чат':id==='" + OTHER_CHAT + "'?'Соседний QA чат':'Катя'")
    return source


async def one(name, engine):
    directory = tempfile.mkdtemp(prefix='pablicus-chat-polish-')
    context = await engine.launch_persistent_context(directory, headless=True,
        viewport={'width': 390, 'height': 844}, has_touch=True, service_workers='block', accept_downloads=True)
    source = polish_sdk()
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
    await context.add_init_script("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedText=text}}})")
    page = await context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def ready_chat(chat_id):
        await page.wait_for_function("id=>PablicusChat?.scope?.chat===id && PablicusChat?.store && PablicusChat?.list && !document.getElementById('app').inert && document.getElementById('app').style.visibility!=='hidden'", arg=chat_id)

    async def open_main():
        await page.locator('.chatMain').filter(has_text='Основной QA чат').click()
        await ready_chat(MAIN_CHAT)

    async def assert_neutral_surfaces(selectors):
        # Read rendered colors, not stylesheet spelling: variables, color-mix,
        # inherited controls and both themes must resolve without color accents.
        colors = await page.evaluate("""selectors=>{
          const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
          const context=canvas.getContext('2d',{willReadFrequently:true});
          const result=[];
          for(const selector of selectors)for(const node of document.querySelectorAll(selector)){
            const style=getComputedStyle(node);
            for(const property of ['color','backgroundColor','borderTopColor']){
              if(property==='borderTopColor'&&parseFloat(style.borderTopWidth)===0)continue;
              context.clearRect(0,0,1,1);context.fillStyle=style[property];context.fillRect(0,0,1,1);
              result.push({selector,property,color:style[property],rgba:[...context.getImageData(0,0,1,1).data]});
            }
          }
          return result;
        }""", selectors)
        assert colors, selectors
        for color in colors:
            red, green, blue, alpha = color['rgba']
            if alpha > 30:
                assert max(red, green, blue) - min(red, green, blue) <= 12, color
        return colors

    try:
        EVIDENCE.mkdir(exist_ok=True)
        await page.goto('http://127.0.0.1:8765/', wait_until='domcontentloaded')
        await page.wait_for_selector('.chatMain')
        await page.locator('#toast').wait_for(state='hidden')
        assert await page.locator('#brandTitle').inner_text() == 'Чат'
        assert await page.locator('.wordmark').count() == 0
        home_title = await page.locator('#brandTitle').evaluate("""node=>{
          const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();
          return {weight:getComputedStyle(node).fontWeight,center:r.x+r.width/2,viewport:innerWidth};
        }""")
        assert home_title['weight'] == '400' and abs(home_title['center'] - home_title['viewport']/2) <= 2, home_title
        await assert_neutral_surfaces(['html', '#brandTitle', '#newChat', '#chatFilters button', '#mainNav button'])
        await page.screenshot(path=str(EVIDENCE / f'chat-polish-{name}-home.png'))
        await open_main()

        layout = await page.evaluate("()=>{const h=document.querySelector('#app>header').getBoundingClientRect(),s=document.querySelector('.stage').getBoundingClientRect();return {headerBottom:h.bottom,stageTop:s.top,width:document.documentElement.scrollWidth,viewport:innerWidth}}")
        assert abs(layout['headerBottom'] - layout['stageTop']) < 2, layout
        assert layout['width'] <= layout['viewport'], layout
        await page.locator('#vp').evaluate('(node)=>node.scrollTop=node.scrollHeight')
        own = page.locator(f'#canvas .row[data-id="{OWN_ID}"]')
        await own.wait_for(state='visible')
        assert await page.locator('.messageActions').count() == 0
        assert await page.locator('#chatHint').is_hidden()
        assert await page.locator('.chatSectionLabel').inner_text() == 'Чат'
        chat_title = await page.locator('#chatTitle').evaluate("""node=>{
          const r=node.getBoundingClientRect();return {weight:getComputedStyle(node).fontWeight,
            center:r.x+r.width/2,viewport:innerWidth};
        }""")
        assert chat_title['weight'] == '400' and abs(chat_title['center'] - chat_title['viewport']/2) <= 3, chat_title
        receipt = own.locator('.messageReceipt')
        assert await receipt.locator('svg').count() == 1
        assert (await receipt.inner_text()).strip() == ''
        assert await receipt.get_attribute('aria-label')
        visible_meta = await own.locator('.meta').inner_text()
        assert not any(word in visible_meta.casefold() for word in ['отправлено', 'доставлено', 'прочитано']), visible_meta
        colors = await assert_neutral_surfaces(['html', '#app>header', '.bubble', '#composeBox', '#send', '.richAudioPlay'])
        surface = next(color for color in colors if color['selector'] == 'html' and color['property'] == 'backgroundColor')
        assert min(surface['rgba'][:3]) >= 245 and surface['rgba'][3] == 255, surface
        await page.screenshot(path=str(EVIDENCE / f'chat-polish-{name}-chat-light.png'))
        checks.append('white neutral chat chrome has no purple controls or message dots; regular centered titles and accessible status glyphs replace visible delivery words')
        await own.locator('.text').click()
        menu = page.locator('.pablicusMessageMenu')
        await menu.wait_for(state='visible')
        box = await menu.bounding_box()
        anchor = await own.locator('.meta').bounding_box()
        assert box['width'] <= 280 and box['x'] >= 0 and box['x'] + box['width'] <= 391, box
        assert box['height'] < 550 and box['y'] >= 0 and box['y'] + box['height'] <= 845, box
        assert abs((box['y'] + box['height']) - anchor['y']) < 140 or abs(box['y'] - (anchor['y'] + anchor['height'])) < 140, (box, anchor)
        assert not await page.locator('#productDialog').evaluate('(node)=>node.open')
        for action in ('reply', 'copy', 'pin', 'forward', 'edit', 'delete', 'select'):
            assert await menu.locator(f'[data-action="{action}"]').count() == 1, action
        await assert_neutral_surfaces(['.pablicusMessageMenu', '.pmmAction:not(.pmmDanger)'])
        await page.screenshot(path=str(EVIDENCE / f'chat-polish-{name}-menu.png'))
        await menu.locator('[data-action="copy"]').click()
        assert await page.evaluate('__copiedText') == 'Мой текст для редактирования'
        await menu.wait_for(state='hidden')
        checks.append('the message menu is a compact anchored 220px popover with real contextual actions; copying invokes the exact message text')

        await page.locator('#vp').evaluate('(node)=>node.scrollTop=0')
        original = page.locator(f'#canvas .row[data-id="{TEXT_ID}"]')
        await original.locator('.meta').click()
        assert await menu.locator('[data-action="edit"]').count() == 0
        assert await menu.locator('[data-action="delete"]').count() == 0
        await menu.locator('[data-action="reply"]').click()
        await page.locator('#replyDraft').wait_for(state='visible')
        assert await page.evaluate('PablicusChat.reply') == {'message_id': TEXT_ID}
        await page.locator('#cancelReply').click()
        checks.append('another author\'s message offers Reply while edit/delete stay absent, and selecting Reply targets that message')

        await page.locator('#vp').evaluate('(node)=>node.scrollTop=node.scrollHeight')
        await own.locator('.meta').click()
        await menu.locator('[data-reaction-id="🔥"]').click()
        reaction = own.locator('.messageReactions [data-emoji="🔥"]')
        await reaction.wait_for()
        assert await reaction.get_attribute('aria-pressed') == 'true'
        assert await page.evaluate('__mock.actionCalls.at(-1).args.p_emoji') == '🔥'
        await reaction.click()
        await reaction.wait_for(state='hidden')
        assert await page.evaluate('__mock.actionCalls.at(-1).args.p_active') is False
        await own.locator('.meta').click()
        await menu.locator('[data-action="pin"]').click()
        await page.locator(f'#pinnedMessages [data-pinned-message-id="{OWN_ID}"]').wait_for()
        assert await page.evaluate(f'__mock.messageActions.get("{OWN_ID}").pinned') is True
        pin_layout = await page.evaluate("()=>{const h=document.querySelector('#app>header').getBoundingClientRect(),s=document.querySelector('.stage').getBoundingClientRect(),p=document.querySelector('#pinnedMessages').getBoundingClientRect();return {headerBottom:h.bottom,stageTop:s.top,pinBottom:p.bottom}}")
        assert pin_layout['pinBottom'] <= pin_layout['headerBottom'] + 1 and abs(pin_layout['stageTop'] - pin_layout['headerBottom']) < 2, pin_layout
        checks.append('reaction selection/toggle and shared pin call their backend operations and repaint the existing message immediately')

        await own.locator('.meta').click()
        await menu.locator('[data-action="edit"]').click()
        editor = page.locator('.chatActionEdit')
        await editor.locator('textarea[name="messageText"]').fill('Исправленный текст в том же сообщении')
        await editor.locator('button[type="submit"]').click()
        await own.get_by_text('Исправленный текст в том же сообщении', exact=True).wait_for()
        assert await page.evaluate(f'__mock.getMessage("{OWN_ID}").body') == 'Мой текст для редактирования'
        assert await page.evaluate(f'__mock.getMessage("{OWN_ID}").edited_body') == 'Исправленный текст в том же сообщении'
        assert await page.evaluate('__mock.actionCalls.filter(c=>c.name==="edit_message_text").at(-1).args.p_expected_revision') == 0
        assert await page.locator(f'#canvas .row[data-id="{OWN_ID}"]').count() == 1
        assert await own.locator('.messageEdited svg').count() == 1
        assert 'Изменено' not in await own.locator('.meta').inner_text()
        checks.append('editing updates the same visible message through a revision-checked RPC and retains its original delivery payload')

        await own.locator('.meta').click()
        await menu.locator('[data-action="select"]').click()
        selected = page.locator('#messageSelectionToolbar')
        await selected.wait_for(state='visible')
        await selected.locator('[data-selection-action="copy"]').click()
        assert 'Исправленный текст в том же сообщении' in await page.evaluate('__copiedText')
        if await selected.is_visible():
            await selected.locator('[data-selection-action="cancel"]').click()
        checks.append('message selection has an operational copy action that uses the edited text')

        await page.locator('#input').fill('Независимый черновик перед пересылкой')
        await page.evaluate('PablicusChat.flush()')
        # Typing grows the real composer; settle that relocation before checking
        # the next interaction and its independently positioned popover.
        await page.evaluate('''()=>new Promise((resolve,reject)=>{let last='',stable=0,frames=0;function frame(){
          const vp=document.getElementById('vp'),composer=document.getElementById('composer');
          const value=vp.scrollTop+':'+composer.getBoundingClientRect().height;
          stable=value===last?stable+1:0;last=value;if(stable>=4)resolve();else if(++frames>240)reject(Error('Composer layout did not settle'));else requestAnimationFrame(frame);
        }requestAnimationFrame(frame)})''')
        rich = page.locator(f'#canvas .row[data-id="{RICH_ID}"]')
        await rich.locator('.meta').click()
        await menu.locator('[data-action="forward"]').click()
        await page.locator(f'.chatForwardPicker [data-conversation-id="{OTHER_CHAT}"]').click()
        await ready_chat(OTHER_CHAT)
        await page.wait_for_function('PablicusChat.rich.capture().files.length===5')
        forwarded = await page.evaluate('PablicusChat.rich.capture().blocks.map(b=>({type:b.type,text:b.text||null}))')
        kinds = [block['type'] for block in forwarded]
        assert kinds.count('image') == 2 and kinds.count('video') == 1 and kinds.count('audio') == 2, forwarded
        assert any('Фотографии и видео рядом' in (block['text'] or '') for block in forwarded), forwarded
        byte_check = await page.evaluate('''async()=>{
          const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
          return {source:(await Promise.all([...__mock.objects.values()].map(digest))).sort(),
            draft:(await Promise.all(PablicusChat.rich.capture().files.map(f=>digest(f.file)))).sort()};
        }''')
        assert byte_check['draft'] == byte_check['source'], byte_check
        assert await page.evaluate('__mock.sent.length') == 0
        await page.locator('#chatBack').click()
        await open_main()
        assert await page.locator('#input').input_value() == 'Независимый черновик перед пересылкой'
        checks.append('forwarding a mixed message builds one destination draft with its text, two images, video and two voice files; it waits for Send and preserves the source draft')

        await page.locator('#vp').evaluate('(node)=>node.scrollTop=node.scrollHeight')
        await own.locator('.meta').click()
        await menu.locator('[data-action="delete"]').click()
        confirm = page.locator('.chatActionDelete [data-confirm-delete]')
        await confirm.wait_for()
        assert not await page.evaluate(f'__mock.getMessage("{OWN_ID}").deleted_at')
        await confirm.click()
        await own.get_by_text('Сообщение удалено', exact=True).wait_for()
        assert await page.evaluate(f'!!__mock.getMessage("{OWN_ID}").deleted_at')
        assert await page.evaluate(f'__mock.getMessage("{OWN_ID}").body') == 'Мой текст для редактирования'
        assert await page.evaluate('__mock.actionCalls.filter(c=>c.name==="delete_message").at(-1).args.p_expected_revision') == 1
        checks.append('own-message deletion requires explicit confirmation, checks its current revision and renders a tombstone')

        await page.evaluate("document.documentElement.dataset.theme='dark'")
        await assert_neutral_surfaces(['html', '#app>header', '.bubble', '#composeBox', '#send', '.richAudioPlay'])
        await page.screenshot(path=str(EVIDENCE / f'chat-polish-{name}-chat-dark.png'))
        await page.evaluate("document.documentElement.dataset.theme='light'")

        await page.locator('#input').fill('Этот черновик остаётся в основном чате')
        await page.locator('#chatBack').click()
        await page.locator('#newChat').click()
        picker = page.locator('#peoplePicker')
        await picker.wait_for(state='visible')
        await page.locator('#peopleQuery').fill('К')
        await page.wait_for_timeout(350)
        assert await page.evaluate('__mock.searchCalls.length') == 0
        await page.locator('#peopleQuery').fill('Катя')
        await picker.locator('.peoplePerson').first.wait_for()
        assert await picker.locator('.peoplePerson').count() == 2
        assert '@katya_qa' in await picker.inner_text() and '@katya_other' in await picker.inner_text()
        await page.screenshot(path=str(EVIDENCE / f'chat-polish-{name}-people.png'))
        await picker.locator('.peoplePerson[data-username="katya_qa"]').click()
        await ready_chat(KATYA_CHAT)
        assert await page.locator('#input').input_value() == ''
        assert await page.evaluate('__mock.directCalls.at(-1).target_username') == 'katya_qa'
        checks.append('name search requires two characters, distinguishes same-name profiles by handles, and explicitly opens the chosen peer')

        await page.locator('#chatBack').click()
        await page.locator('#newChat').click()
        await page.locator('#peopleQuery').fill('@katya_qa')
        await picker.locator('.peoplePerson[data-username="katya_qa"]').click()
        await ready_chat(KATYA_CHAT)
        assert await page.evaluate('__mock.directChats.size') == 1
        assert await page.evaluate('__mock.directCalls.length') == 2
        await page.locator('#chatBack').click()
        await open_main()
        assert await page.locator('#input').input_value() == 'Этот черновик остаётся в основном чате'
        checks.append('choosing the same person reuses one direct conversation and the previous chat keeps its independent draft')

        await page.goto('http://127.0.0.1:8765/?person=katya_qa', wait_until='domcontentloaded')
        await picker.wait_for(state='visible')
        await picker.locator('.peoplePerson[data-username="katya_qa"]').wait_for()
        assert await page.evaluate('__mock.directCalls.length') == 0
        assert await page.locator('#peopleQuery').input_value() == 'katya_qa'
        await picker.locator('.peoplePerson[data-username="katya_qa"]').click()
        await ready_chat(KATYA_CHAT)
        checks.append('a profile link resolves that handle and waits for explicit recipient selection before creating or opening a chat')

        assert not errors, errors
        assert not unexpected, unexpected
        checks.append('no JavaScript errors or external network requests')
        return {'engine': name, 'pass': True, 'checks': checks,
                'scope': 'built mobile UI and real IndexedDB; isolated profiles/messages/RPC fixture, no real recipients'}
    except Exception:
        EVIDENCE.mkdir(exist_ok=True)
        await page.screenshot(path=str(EVIDENCE / f'chat-polish-{name}-failure.png'))
        return {'engine': name, 'pass': False, 'checks': checks, 'error': traceback.format_exc(),
                'js_errors': errors, 'unexpected_requests': unexpected}
    finally:
        await context.close()
        shutil.rmtree(directory, ignore_errors=True)


async def main(engines):
    async with async_playwright() as playwright:
        results = [await one(name, getattr(playwright, name)) for name in engines]
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / 'chat-polish.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert all(result['pass'] for result in results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engines', nargs='*', metavar='ENGINE')
    args = parser.parse_args()
    if any(name not in ('chromium', 'webkit') for name in args.engines):
        parser.error('engines must be chromium or webkit')
    asyncio.run(main(args.engines or ['chromium', 'webkit']))
