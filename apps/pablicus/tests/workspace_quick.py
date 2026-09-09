"""Built Today/Projects shortcuts against isolated, paginated account fixtures.

All names, tasks, projects and sessions are synthetic. No push subscription,
notification, live account or external service is contacted.
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

from chat_canvas import OTHER_PLAN
from rich_message_integration import MOCK_MIC
from message_interactions import DIST, EVIDENCE, MAIN_CHAT, OTHER_CHAT, PEER, SECOND_USER, USER
from tasks_home import tasks_sdk, task_id


def workspace_sdk():
    source = tasks_sdk()

    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, 'Fixture anchor changed: ' + old[:90]
        source = source.replace(old, new, 1)

    setup = r'''
    __mock.projectCalls=[];__mock.projectUnknown=[];__mock.projectPending=[];
    __mock.holdNextProjects=false;__mock.failNextProjects=false;
    __mock.releaseProjects=()=>{const jobs=__mock.projectPending.splice(0);jobs.forEach(job=>job());};
    for(const state of Object.values(__mock.canvasState))for(const task of state.tasks){
      task.completed=false;task.archived_at=null;task.assignee_id=user.id;task.due_date=__mock.taskToday;
    }
    const qaTask=n=>Object.values(__mock.canvasState).flatMap(state=>state.tasks).find(task=>task.id===taskId(n));
    qaTask(60).completed=true;qaTask(59).assignee_id=peer;qaTask(58).archived_at=new Date().toISOString();
    qaTask(57).due_date=relativeDay(1);qaTask(56).assignee_id=null;
    // 22:00 UTC falls on the NEXT local day in the Moscow browser, even when
    // the legacy date column still contains today.
    qaTask(55).due_at=__mock.taskToday+'T22:00:00.000Z';qaTask(55).due_timezone='Europe/Moscow';
    qaTask(54).due_at=__mock.taskToday+'T06:30:00.000Z';qaTask(54).due_timezone='Europe/Moscow';
    for(let n=1;n<=43;n++){
      const id='66666666-1111-4111-8111-'+String(n).padStart(12,'0');
      const state=seedCanvas(id,'Проект QA '+String(n).padStart(2,'0')+'\nСинтетическое описание проекта');
      state.participants=state.participants.filter(person=>person.id!== '__SECOND_USER__');
      __mock.canvasState[id]=state;
    }
    const baseAllTasks=__mock.allTasks;
    __mock.allTasks=()=>baseAllTasks().filter(task=>__mock.canvasState[task.conversation_id].participants.some(person=>person.id===user.id));
    __mock.todayTasks=()=>__mock.allTasks().filter(task=>!task.completed&&!task.archived_at&&(!task.assignee_id||task.assignee_id===user.id)
      &&(task.due_at?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(task.due_at)):task.due_date)===__mock.taskToday);
    __mock.allProjects=()=>Object.values(__mock.canvasState).filter(state=>state.participants.some(person=>person.id===user.id)&&state.canvas.body.trim())
      .map(state=>({conversation_id:state.conversation_id,title:state.canvas.body.split('\n')[0],
        conversation_title:state.conversation_id===chat?'@qa_peer':state.conversation_id==='__OTHER_CHAT__'?'Соседний QA чат':'QA разговор',
        body_preview:state.canvas.body.slice(0,200),updated_at:state.canvas.updated_at,revision:state.canvas.revision}))
      .sort((a,b)=>a.conversation_id.localeCompare(b.conversation_id));
    const listProjects=args=>{
      if(JSON.stringify(Object.keys(args).sort())!==JSON.stringify(['p_query','p_cursor','p_limit'].sort())
        ||args.p_query!==''||args.p_limit!==40||(args.p_cursor!==null&&(Object.keys(args.p_cursor).join(',')!=='conversation_id'||typeof args.p_cursor.conversation_id!=='string'))){
        __mock.projectUnknown.push(structuredClone(args));return {data:null,error:{code:'22023',message:'Unexpected project list contract'}};
      }
      __mock.projectCalls.push({args:structuredClone(args),actor:user.id});
      if(__mock.failNextProjects){__mock.failNextProjects=false;return {data:null,error:{code:'NETWORK_ERROR',message:'Synthetic project page failure'}};}
      const all=__mock.allProjects(),rows=all.filter(item=>!args.p_cursor||item.conversation_id>args.p_cursor.conversation_id),page=rows.slice(0,args.p_limit);
      const response={data:{projects:page,total_count:all.length,next_cursor:rows.length>page.length?{conversation_id:page.at(-1).conversation_id}:null},error:null};
      if(__mock.holdNextProjects){__mock.holdNextProjects=false;return new Promise(resolve=>__mock.projectPending.push(()=>resolve(response)));}
      return response;
    };
    '''.replace('__SECOND_USER__', SECOND_USER).replace('__OTHER_CHAT__', OTHER_CHAT)
    replace('const result=(data,error=null)=>Promise.resolve({data,error});', setup + '\nconst result=(data,error=null)=>Promise.resolve({data,error});')
    replace("if(name==='pablicus_list_tasks_v2')return listTasks(args);", "if(name==='pablicus_list_projects')return listProjects(args);\n      if(name==='pablicus_list_tasks_v2')return listTasks(args);")
    return source


async def one(name, engine):
    directory = tempfile.mkdtemp(prefix='pablicus-workspace-quick-')
    context = await engine.launch_persistent_context(directory, headless=True,
        viewport={'width': 390, 'height': 844}, timezone_id='Europe/Moscow', has_touch=True,
        service_workers='block', accept_downloads=True)
    source = workspace_sdk()
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
            unexpected.append('missing built asset: ' + path)
            return await request.fulfill(status=404, body='not found')
        return await request.fulfill(status=200,
            content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',
            body=file.read_bytes())

    await context.route('**/*', route)
    await context.add_init_script(MOCK_MIC)
    page = await context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    popover = page.locator('.pwqPopover')

    def chip(kind):
        return page.locator(f'.pwqChip[data-kind="{kind}"]')

    async def open_chat(chat_id):
        await page.locator('.chatMain').filter(has_text='@qa_peer' if chat_id == MAIN_CHAT else 'Соседний QA чат').click()
        await page.wait_for_function('id=>PablicusChat?.scope?.chat===id && !document.getElementById("app").inert && document.getElementById("app").style.visibility!=="hidden"', arg=chat_id)

    async def wait_count(kind, total):
        await page.wait_for_function('([kind,total])=>document.querySelector(".pwqChip[data-kind="+kind+"] .pwqChipLabel")?.textContent===(kind==="projects"?"Проекты "+total:"Сегодня "+total)', arg=[kind, total])
        description = await chip(kind).get_attribute('aria-label')
        assert str(total) in description, description
        assert ('Сегодня' if kind == 'tasks' else 'Все проекты') in description, description

    async def assert_composer_layout(width, state='normal'):
        await page.set_viewport_size({'width': width, 'height': 844})
        await page.wait_for_timeout(70)
        geometry = await page.locator('#composer').evaluate("""footer=>{
          const box=footer.querySelector('#composeBox'),quick=footer.querySelector('#workspaceQuick');
          const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,center:r.top+r.height/2};};
          return {inside:quick.parentElement===box,box:rect(box),quick:rect(quick),footer:rect(footer),
            chips:[...quick.querySelectorAll('.pwqChip')].map(rect),
            labels:[...quick.querySelectorAll('.pwqChipLabel')].map(node=>({text:node.textContent,width:node.clientWidth,content:node.scrollWidth})),
            tools:['attach','richVoice','send'].map(id=>document.getElementById(id)).filter(node=>node?.getClientRects().length).map(rect),
            padding:parseFloat(getComputedStyle(footer).paddingBottom)||0,
            viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};
        }""")
        assert geometry['inside'], geometry
        assert all(label['content'] <= label['width'] for label in geometry['labels']), geometry
        assert not geometry['overflow'] and geometry['box']['left'] >= -1 and geometry['box']['right'] <= width + 1, geometry
        for rect in [geometry['quick'], *geometry['chips'], *geometry['tools']]:
            assert rect['left'] >= geometry['box']['left'] - 1 and rect['right'] <= geometry['box']['right'] + 1, geometry
            assert rect['top'] >= geometry['box']['top'] - 1 and rect['bottom'] <= geometry['box']['bottom'] + 1, geometry
        centers = [rect['center'] for rect in [*geometry['chips'], *geometry['tools']]]
        assert max(centers) - min(centers) <= 3, geometry
        if state != 'fullscreen':
            assert geometry['footer']['bottom'] - geometry['box']['bottom'] <= geometry['padding'] + 2, geometry
            assert geometry['box']['height'] <= 112, geometry
        await page.screenshot(path=str(EVIDENCE / f'workspace-quick-{name}-composer-{state}-{width}.png'))

    async def row_ids():
        return await popover.locator('.pwqRow').evaluate_all('(nodes)=>nodes.map(node=>node.dataset.key)')

    async def wait_rows(ids):
        await page.wait_for_function('expected=>JSON.stringify([...document.querySelectorAll(".pwqPopover .pwqRow")].map(node=>node.dataset.key))===JSON.stringify(expected)', arg=ids)

    try:
        EVIDENCE.mkdir(exist_ok=True)
        await page.goto('http://127.0.0.1:8765/', wait_until='domcontentloaded')
        await page.wait_for_selector('.chatMain')
        await page.evaluate('__mock.taskListDenied=true')
        await open_chat(MAIN_CHAT)
        await chip('tasks').click()
        await popover.locator('.pwqRetry').wait_for()
        assert await popover.locator('.pwqRow').count() == 0
        assert 'нет дел' not in await chip('tasks').inner_text()
        await page.evaluate('__mock.taskListDenied=false')
        await popover.locator('.pwqRetry').click()
        today = await page.evaluate('__mock.todayTasks().map(task=>task.id)')
        assert len(today) == 55, today
        await wait_count('tasks', 55)
        await wait_rows(today[:40])
        assert task_id(55) not in today and task_id(54) in today and task_id(56) in today
        assert task_id(59) not in today and task_id(60) not in today and task_id(58) not in today
        assert '09:30' in await popover.locator(f'.pwqRow[data-task-id="{task_id(54)}"]').inner_text()
        calls = await page.evaluate('__mock.taskListCalls')
        assert calls[-1]['args']['p_view'] == 'today' and calls[-1]['args']['p_timezone'] == 'Europe/Moscow'
        checks.append('Today recovers from a denied read without claiming zero; its total is 55 across both chats, excluding completed/archived/other-assignee/future work and using local day for UTC-timed tasks')

        await popover.locator('.pwqMore').click()
        await wait_rows(today)
        assert len(await row_ids()) == len(set(await row_ids()))
        calls = await page.evaluate('__mock.taskListCalls')
        fixture = await page.evaluate('__mock.todayTasks()')
        assert calls[-1]['args']['p_cursor'] == {key: fixture[39][key] for key in ['created_at', 'id']}
        assert await popover.locator('.pwqMore').is_hidden()
        await wait_count('tasks', 55)
        checks.append('Today pagination appends all 55 once with the exact timestamp/id cursor while the chip count remains the whole result, not the first 40 rows')

        await popover.locator('.pwqClose').click()
        await assert_composer_layout(390)
        await assert_composer_layout(320)
        await page.locator('#expand').click()
        await page.wait_for_function('document.getElementById("app").classList.contains("composer-fullscreen")')
        await assert_composer_layout(320, 'fullscreen')
        await page.locator('#expand').click()
        await page.wait_for_function('!document.getElementById("app").classList.contains("composer-fullscreen")')
        await page.evaluate('document.getElementById("app").classList.add("keyboard-open")')
        await assert_composer_layout(320, 'keyboard-class')
        await page.evaluate('document.getElementById("app").classList.remove("keyboard-open")')
        await page.set_viewport_size({'width': 390, 'height': 844})
        checks.append('Today/Projects are inside the actual composer toolbar beside plus, microphone and send at 390/320px and fullscreen; no shortcut row or allocated gap remains underneath, including simulated keyboard CSS state')

        await page.locator('#input').fill('Черновик QA до перехода между проектами')
        await page.locator('#richVoice').click()
        await page.wait_for_function('PablicusChat.rich.recording')
        await chip('tasks').click()
        await popover.wait_for()
        assert await page.evaluate('PablicusChat.rich.recording && __mockMic.stops===0')
        await popover.locator('.pwqClose').click()
        await page.locator('#richVoice').click()
        await page.wait_for_function('!PablicusChat.rich.recording && PablicusChat.rich.capture().files.length===1')
        await page.locator('#editor .richMedia-audio [aria-label="Убрать вложение"]').click()
        assert await page.locator('#input').input_value() == 'Черновик QA до перехода между проектами'
        checks.append('opening and closing shortcuts inside the toolbar preserves composed text and ongoing mocked voice capture; only pressing stop ends the recording')

        # Same-conversation navigation cannot rely on reopening the chat to reset
        # the expanded composer: selecting the destination must collapse it.
        await page.locator('#expand').click()
        await page.wait_for_function('document.getElementById("app").classList.contains("composer-fullscreen")')
        await chip('projects').click()
        await popover.locator(f'.pwqRow[data-conversation-id="{MAIN_CHAT}"]').click()
        await page.locator('#chatCanvasPanel .pablicusChatCanvas[data-state="ready"]').wait_for()
        assert not await page.evaluate('document.getElementById("app").classList.contains("composer-fullscreen")')
        assert await page.locator('.pccPlanBody').is_visible()
        assert await page.locator('#canvasTab').get_attribute('aria-selected') == 'true'
        assert await page.locator('#input').input_value() == 'Черновик QA до перехода между проектами'
        await page.locator('#conversationTab').click()
        await page.locator('#expand').click()
        await page.wait_for_function('document.getElementById("app").classList.contains("composer-fullscreen")')
        await chip('tasks').click()
        await popover.locator(f'.pwqRow[data-task-id="{task_id(53)}"]').click()
        await page.locator(f'.pccTaskForm[data-task-id="{task_id(53)}"]').wait_for()
        assert await page.locator('.pccTaskSheet').is_visible()
        assert not await page.evaluate('document.getElementById("app").classList.contains("composer-fullscreen")')
        assert await page.locator('#canvasTab').get_attribute('aria-selected') == 'true'
        assert await page.locator('#input').input_value() == 'Черновик QA до перехода между проектами'
        checks.append('selecting either a project or an exact task from fullscreen collapses the editor and visibly opens the same-chat canvas/calendar sheet without losing the message draft')

        # Close and reopen in one event turn, before native history.back() has
        # delivered popstate; that old event must not dismiss the new task.
        await page.evaluate('''id=>{
          window.__quickSheetBackEvents=0;
          window.addEventListener('popstate',()=>window.__quickSheetBackEvents++,{once:true});
          document.querySelector('.pccTaskCancel').click();
          document.querySelector('.pccTask[data-task-id="'+id+'"] .pccTaskEdit').click();
        }''', task_id(51))
        await page.wait_for_function('window.__quickSheetBackEvents===1')
        await page.locator(f'.pccTaskForm[data-task-id="{task_id(51)}"]').wait_for()
        assert await page.locator('.pccTaskSheet').is_visible()
        await page.go_back()
        await page.locator('.pccTaskSheet').wait_for(state='hidden')
        assert await page.evaluate('PablicusChat.scope.chat') == MAIN_CHAT
        await page.locator('#conversationTab').click()
        assert await page.locator('#input').input_value() == 'Черновик QA до перехода между проектами'
        checks.append('rapidly closing one calendar and opening another survives the pending history traversal; the next browser Back closes only that new sheet and retains the chat/draft')

        await chip('projects').click()
        projects = await page.evaluate('__mock.allProjects().map(project=>project.conversation_id)')
        assert len(projects) == 45
        await wait_count('projects', 45)
        await wait_rows(projects[:40])
        await page.evaluate('__mock.failNextProjects=true')
        await popover.locator('.pwqMore').click()
        await popover.locator('.pwqRetry').wait_for()
        assert await row_ids() == projects[:40]
        await popover.locator('.pwqRetry').click()
        await wait_rows(projects)
        calls = await page.evaluate('__mock.projectCalls')
        assert calls[-1]['args']['p_cursor'] == {'conversation_id': projects[39]}
        assert calls[-1]['args'] == calls[-2]['args']
        assert len(await row_ids()) == len(set(await row_ids()))
        assert await page.locator('#input').input_value() == 'Черновик QA до перехода между проектами'
        dimensions = await popover.evaluate('node=>{const r=node.getBoundingClientRect(),composer=document.getElementById("composeBox").getBoundingClientRect(),scroll=node.querySelector(".pwqScroll");return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,composerTop:composer.top,width:innerWidth,height:innerHeight,scrollable:scroll.scrollHeight>scroll.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth}}')
        assert dimensions['left'] >= 0 and dimensions['right'] <= dimensions['width'] and dimensions['top'] >= 0 and not dimensions['overflow'], dimensions
        assert dimensions['bottom'] <= dimensions['composerTop'] + 1 and dimensions['scrollable'], dimensions
        await page.screenshot(path=str(EVIDENCE / f'workspace-quick-{name}-projects.png'))
        checks.append('Projects shows all 45 authorized canvases, preserves prior rows during a failed next page, retries that same cursor, and scrolls inside a compact popover above the composer')

        await popover.locator(f'.pwqRow[data-conversation-id="{OTHER_CHAT}"]').click()
        await page.wait_for_function('id=>PablicusChat?.scope?.chat===id', arg=OTHER_CHAT)
        await page.locator('#chatCanvasPanel .pablicusChatCanvas[data-state="ready"]').wait_for()
        assert await page.locator('#canvasTab').get_attribute('aria-selected') == 'true'
        assert await page.locator('.pccPlanBody').input_value() == OTHER_PLAN
        await page.locator('#chatBack').click()
        await open_chat(MAIN_CHAT)
        assert await page.locator('#input').input_value() == 'Черновик QA до перехода между проектами'
        await chip('tasks').click()
        await popover.locator(f'.pwqRow[data-task-id="{task_id(56)}"]').click()
        await page.wait_for_function('id=>PablicusChat?.scope?.chat===id', arg=OTHER_CHAT)
        await page.locator(f'#chatCanvasPanel .pccTask[data-task-id="{task_id(56)}"]').wait_for()
        assert await page.locator('#canvasTab').get_attribute('aria-selected') == 'true'
        await page.locator(f'.pccTaskForm[data-task-id="{task_id(56)}"]').wait_for()
        await page.locator('.pccTaskCancel').click()
        await chip('tasks').click()
        await popover.locator(f'.pwqRow[data-task-id="{task_id(54)}"]').click()
        await page.locator(f'.pccTaskForm[data-task-id="{task_id(54)}"]').wait_for()
        assert await page.locator('.pccTaskTime').input_value() == '09:30'
        await page.evaluate('([chat,id])=>{const state=__mock.canvasState[chat];__mock.removedQuickTask=state.tasks.find(task=>task.id===id);state.tasks=state.tasks.filter(task=>task.id!==id);state.revision++;}', [OTHER_CHAT, task_id(54)])
        await page.locator('.pccTaskCancel').click()
        await chip('tasks').click()
        await popover.locator(f'.pwqRow[data-task-id="{task_id(54)}"]').click()
        await page.wait_for_function('()=>document.querySelector("#chatCanvasPanel .pccStatus")?.textContent.includes("удалено")')
        assert 'недоступно' in await page.locator('#chatCanvasPanel .pccStatus').inner_text()
        assert not await page.locator('.pccTaskForm').is_visible()
        await page.evaluate('chat=>{__mock.canvasState[chat].tasks.push(__mock.removedQuickTask);__mock.canvasState[chat].revision++;}', OTHER_CHAT)
        checks.append('selecting tasks opens each exact calendar sheet; closing it returns to the toolbar and a stale shortcut to a deleted task opens no editor and leaves a visible unavailable notice')
        await page.locator('#chatBack').click()
        await open_chat(MAIN_CHAT)
        assert await page.locator('#input').input_value() == 'Черновик QA до перехода между проектами'
        checks.append('a project opens its own participant canvas; a Today task opens its exact conversation/task; returning to the original chat restores the composed text')

        await wait_count('tasks', 55)
        await page.evaluate('__mock.holdNextTaskList=true;__mock.holdNextProjects=true;document.dispatchEvent(new Event("visibilitychange"))')
        await page.wait_for_function('__mock.taskListPending.length===1&&__mock.projectPending.length===1')
        await page.evaluate('__mock.signOut()')
        await page.wait_for_function('!PablicusDebug.user')
        assert await popover.is_hidden()
        await page.evaluate('(id)=>__mock.switchAccount(id)', SECOND_USER)
        await page.wait_for_function('id=>PablicusDebug.user===id', arg=SECOND_USER)
        await page.locator('.chatMain').first.wait_for()
        await open_chat(MAIN_CHAT)
        await page.evaluate('__mock.releaseTaskLists();__mock.releaseProjects()')
        await wait_count('tasks', 1)
        await wait_count('projects', 2)
        await chip('projects').click()
        await wait_rows([MAIN_CHAT, OTHER_CHAT])
        assert not any(identifier.startswith('66666666-1111') for identifier in await row_ids())
        await popover.locator('.pwqClose').click()
        await chip('tasks').click()
        await wait_rows([task_id(56)])
        assert await page.locator('#input').input_value() == ''
        checks.append('logout invalidates pending task/project pages; the next account sees only its one unassigned shared task and two authorized canvases, with no first-account private projects or draft')

        assert not errors, errors
        assert not unexpected, unexpected
        diagnostics = await page.evaluate('[...__mock.canvasUnknown,...__mock.taskListUnknown,...__mock.projectUnknown]')
        assert not diagnostics, diagnostics
        checks.append('strict RPC contracts, no unexpected external request, JavaScript error, live account write or real notification')
        return {'engine': name, 'pass': True, 'checks': checks, 'scope': 'built app and synthetic paginated fixtures, not live users or physical iPhone'}
    except Exception:
        EVIDENCE.mkdir(exist_ok=True)
        await page.screenshot(path=str(EVIDENCE / f'workspace-quick-{name}-failure.png'))
        return {'engine': name, 'pass': False, 'checks': checks, 'error': traceback.format_exc(),
                'js_errors': errors, 'unexpected_requests': unexpected,
                'rpc_diagnostics': await page.evaluate('[...(window.__mock?.canvasUnknown||[]),...(window.__mock?.taskListUnknown||[]),...(window.__mock?.projectUnknown||[])]')}
    finally:
        await context.close()
        shutil.rmtree(directory, ignore_errors=True)


async def main(engines):
    async with async_playwright() as playwright:
        results = [await one(name, getattr(playwright, name)) for name in engines]
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / 'workspace-quick.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert all(result['pass'] for result in results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engines', nargs='*', metavar='ENGINE')
    args = parser.parse_args()
    if any(name not in ('chromium', 'webkit') for name in args.engines):
        parser.error('engines must be chromium or webkit')
    asyncio.run(main(args.engines or ['chromium', 'webkit']))
