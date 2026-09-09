"""Built aggregate task inbox with isolated, strict shared-state RPC fixtures.

Every account, task and response is synthetic. Browser checks use the actual
application DOM and navigation; SQL membership and keyset authorization have a
separate database suite. No production session or recipient is contacted.
"""
import argparse
import asyncio
import json
import mimetypes
import os
import shutil
import tempfile
import traceback
from urllib.parse import urlparse

from playwright.async_api import async_playwright

from chat_canvas import canvas_sdk
from message_interactions import DIST, EVIDENCE, MAIN_CHAT, OTHER_CHAT, PEER, SECOND_USER, USER


def task_id(number):
    return f'99999999-9999-4999-8999-{number:012d}'


def tasks_sdk():
    source = canvas_sdk()

    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, 'Fixture anchor changed: ' + old[:100]
        source = source.replace(old, new, 1)

    setup = r'''
    __mock.taskListCalls=[];__mock.taskListUnknown=[];__mock.taskListPending=[];
    __mock.holdNextTaskList=false;__mock.taskListDenied=false;__mock.failNextTaskList=false;
    __mock.loseToggleResponse=false;__mock.taskUpdateCalls=[];
    __mock.releaseTaskLists=()=>{const pending=__mock.taskListPending.splice(0);pending.forEach(job=>job());};
    const localDate=new Date(),localDay=new Date(localDate.getFullYear(),localDate.getMonth(),localDate.getDate());
    const dayString=date=>String(date.getFullYear())+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
    __mock.taskToday=dayString(localDay);
    const relativeDay=days=>{const date=new Date(localDay);date.setDate(date.getDate()+days);return dayString(date);};
    const taskId=n=>'99999999-9999-4999-8999-'+String(n).padStart(12,'0');
    const taskTitles={59:'Свежий план съёмки',58:'Старый план студии',57:'Встреча у фотографа',56:'Задача с длинным названием '+('подготовить материалы для совместной съёмки ').repeat(5)};
    for(const state of Object.values(__mock.canvasState))state.tasks=[];
    for(let n=1;n<=60;n++){
      const conversationId=n%2?chat:'__OTHER_CHAT__',assignee=n%3===0?user.id:n%3===1?peer:null;
      const created='2026-09-08T10:'+String(Math.floor(n/4)).padStart(2,'0')+':00.123456+00:00';
      __mock.canvasState[conversationId].tasks.push({id:taskId(n),title:taskTitles[n]||('Материал '+String(n).padStart(2,'0')),
        assignee_id:assignee,due_date:n%4===0?null:relativeDay(n%4===1?-1:n%4===2?0:1),due_at:null,due_timezone:'UTC',reminder_minutes:null,followup_minutes:null,archived_at:null,completed:n%5===0,
        revision:1,source_message_id:null,source_block_id:null,created_at:created,created_by:peer,updated_at:created,updated_by:peer});
    }
    const timedSample=__mock.canvasState[chat].tasks.find(task=>task.id===taskId(59));
    Object.assign(timedSample,{due_at:relativeDay(1)+'T09:00:00.000Z',due_timezone:'UTC',reminder_minutes:60,followup_minutes:180,
      content:{v:1,blocks:[{id:'task-title',type:'text',text:timedSample.title},
        {id:'task-brief',type:'document',path:chat+'/'+peer+'/99999999-9999-4999-8999-000000000059/task-brief/brief.pdf',name:'brief.pdf',mime:'application/pdf',size:1234}]}});
    __mock.seedTaskActor=user.id;
    __mock.allTasks=()=>Object.values(__mock.canvasState).flatMap(state=>state.tasks.map(task=>({...structuredClone(task),
      conversation_id:state.conversation_id,conversation_title:state.conversation_id===chat?'@qa_peer':'Соседний QA чат',
      assignee_name:task.assignee_id===__mock.seedTaskActor?'Матвей QA':task.assignee_id===peer?'Катя QA':null})))
      .sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
    const taskListError=(code,message)=>({data:null,error:{code,message}});
    // Aggregate-home completion intentionally uses the supported metadata-only v2
    // API. Keep this fixture independent from canvas's rich-content v3 editor API.
    const updateTaskV2=args=>{
      const expected=['p_conversation_id','p_task_id','p_expected_revision','p_title','p_assignee_id','p_due_date','p_completed','p_schedule','p_archived'].sort();
      if(JSON.stringify(Object.keys(args).sort())!==JSON.stringify(expected)||!Number.isInteger(args.p_expected_revision)
        ||args.p_expected_revision<0||typeof args.p_completed!=='boolean'||typeof args.p_title!=='string'){
        __mock.taskListUnknown.push({args,reason:'unexpected legacy metadata update contract'});
        return taskListError('22023','Unexpected task update arguments');
      }
      const state=__mock.canvasState[args.p_conversation_id];
      if(!state||__mock.canvasDenied||!state.participants.some(p=>p.id===user.id))return taskListError('42501','canvas_access_denied');
      const task=state.tasks.find(t=>t.id===args.p_task_id);
      if(!task)return taskListError('42501','task not in conversation');
      const schedule=scheduleFields(args.p_schedule);
      const archive=args.p_archived==null?task.archived_at:args.p_archived?(task.archived_at||canvasNow()):null;
      const unchanged=task.title===args.p_title.trim()&&task.assignee_id===args.p_assignee_id&&task.due_date===args.p_due_date
        &&task.completed===args.p_completed&&task.archived_at===archive&&Object.entries(schedule).every(([key,value])=>task[key]===value);
      if(unchanged)return {data:structuredClone(state),error:null};
      if(task.revision!==args.p_expected_revision)return taskListError('40001','task_revision_conflict');
      if(task.content&&task.title!==args.p_title.trim())return taskListError('22023','workspace_content_requires_v3');
      if(args.p_assignee_id&&!state.participants.some(p=>p.id===args.p_assignee_id))return taskListError('22023','assignee not in conversation');
      Object.assign(task,{title:args.p_title.trim(),assignee_id:args.p_assignee_id,due_date:args.p_due_date,
        completed:args.p_completed,...schedule,archived_at:archive,revision:task.revision+1,updated_at:canvasNow(),updated_by:user.id});
      state.revision++;
      return {data:structuredClone(state),error:null};
    };
    const listTasks=args=>{
      const expected=['p_view','p_query','p_today','p_cursor','p_limit','p_timezone'].sort();
      const actual=Object.keys(args).sort();
      if(JSON.stringify(expected)!==JSON.stringify(actual)||!['open','mine','overdue','completed','archived','today'].includes(args.p_view)
        ||args.p_timezone!==Intl.DateTimeFormat().resolvedOptions().timeZone||typeof args.p_query!=='string'||args.p_query.length>200||args.p_today!==__mock.taskToday||args.p_limit!==40
        ||(args.p_cursor!==null&&(Object.keys(args.p_cursor).sort().join(',')!=='created_at,id'
          ||typeof args.p_cursor.created_at!=='string'||typeof args.p_cursor.id!=='string'))){
        __mock.taskListUnknown.push({args,reason:'unexpected task list contract'});
        return taskListError('22023','Unexpected task list arguments');
      }
      __mock.taskListCalls.push({args:structuredClone(args),actor:user.id});
      if(__mock.taskListDenied)return taskListError('42501','tasks_access_denied');
      if(__mock.failNextTaskList){__mock.failNextTaskList=false;return taskListError('NETWORK_ERROR','Task refresh unavailable');}
      const query=args.p_query.trim().toLocaleLowerCase();
      let rows=__mock.allTasks().filter(task=>args.p_view==='archived'?!!task.archived_at:!task.archived_at&&(args.p_view==='completed'?task.completed:!task.completed));
      if(args.p_view==='today')rows=rows.filter(task=>(!task.assignee_id||task.assignee_id===user.id)&&(task.due_at?new Intl.DateTimeFormat('en-CA',{timeZone:args.p_timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(task.due_at)):task.due_date)===args.p_today);
      if(args.p_view==='mine')rows=rows.filter(task=>task.assignee_id===user.id);
      if(args.p_view==='overdue')rows=rows.filter(task=>task.due_at?new Date(task.due_at)<new Date():task.due_date&&task.due_date<args.p_today);
      if(query)rows=rows.filter(task=>task.title.toLocaleLowerCase().includes(query));
      const total=rows.length;
      if(args.p_cursor)rows=rows.filter(task=>task.created_at<args.p_cursor.created_at
        ||task.created_at===args.p_cursor.created_at&&task.id<args.p_cursor.id);
      const page=rows.slice(0,args.p_limit),last=page.at(-1);
      const response={data:{tasks:page,total_count:total,next_cursor:rows.length>page.length?{created_at:last.created_at,id:last.id}:null},error:null};
      if(__mock.holdNextTaskList){__mock.holdNextTaskList=false;
        return new Promise(resolve=>__mock.taskListPending.push(()=>resolve(response)));}
      return response;
    };
    '''.replace('__OTHER_CHAT__', OTHER_CHAT)
    replace('const result=(data,error=null)=>Promise.resolve({data,error});', setup + '\nconst result=(data,error=null)=>Promise.resolve({data,error});')
    replace('if(canvasKeys[name])return canvasRpc(name,args);', r'''
      if(name==='pablicus_list_tasks_v2')return listTasks(args);
      if(name==='pablicus_update_canvas_task_v2'){
        __mock.taskUpdateCalls.push({args:structuredClone(args),actor:user.id});
        const response=updateTaskV2(args);
        if(!response.error&&__mock.loseToggleResponse){__mock.loseToggleResponse=false;
          return {data:null,error:{code:'NETWORK_ERROR',message:'Response lost after task update committed'}};}
        return response;
      }
      if(canvasKeys[name])return canvasRpc(name,args);
    ''')
    return source


async def one(name, engine):
    directory = tempfile.mkdtemp(prefix='pablicus-tasks-home-')
    context = await engine.launch_persistent_context(directory, headless=True,
        viewport={'width': 390, 'height': 844}, has_touch=True,
        service_workers='block', accept_downloads=True,
        **({'executable_path': os.environ['PABLICUS_WEBKIT_EXECUTABLE']} if name == 'webkit' and os.environ.get('PABLICUS_WEBKIT_EXECUTABLE') else {}))
    source = tasks_sdk()
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
    page = await context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    panel = page.locator('.pablicusTasksHome')

    def card(number):
        return panel.locator(f'.pthTask[data-task-id="{task_id(number)}"]')

    async def visible_ids():
        return await panel.locator('.pthTask').evaluate_all('(nodes)=>nodes.map(node=>node.dataset.taskId)')

    async def expected_ids(view='open', query=''):
        # Compare whole IDs/order to fixture data independently of its RPC path.
        tasks = await page.evaluate('__mock.allTasks()')
        today, actor, now = await page.evaluate('[__mock.taskToday,PablicusDebug.user,new Date().toISOString()]')
        return [task['id'] for task in tasks
                if (bool(task['archived_at']) if view == 'archived' else not task['archived_at'] and task['completed'] == (view == 'completed'))
                and (view != 'mine' or task['assignee_id'] == actor)
                and (view != 'overdue' or (task['due_at'] < now if task['due_at'] else task['due_date'] is not None and task['due_date'] < today))
                and query.lower() in task['title'].lower()]

    async def wait_ids(ids):
        await page.wait_for_function('expected=>JSON.stringify([...document.querySelectorAll(".pablicusTasksHome .pthTask")].map(node=>node.dataset.taskId))===JSON.stringify(expected)', arg=ids)

    async def choose(view):
        await panel.locator(f'.pthTab[data-view="{view}"]').click()
        await wait_ids((await expected_ids(view, await panel.locator('.pthSearchInput').input_value()))[:40])

    async def open_tasks():
        await page.locator('#mainNav [data-page="tasks"]').click()
        await panel.wait_for()

    async def update_calls():
        return await page.evaluate('__mock.taskUpdateCalls')

    try:
        EVIDENCE.mkdir(exist_ok=True)
        await page.goto('http://127.0.0.1:8765/', wait_until='domcontentloaded')
        await page.wait_for_selector('.chatMain')
        await page.evaluate('__mock.taskListDenied=true')
        await open_tasks()
        await panel.locator('.pthRetry').wait_for()
        assert await panel.locator('.pthTask').count() == 0
        assert 'Нет задач' not in await panel.inner_text()
        await page.evaluate('__mock.taskListDenied=false')
        await panel.locator('.pthRetry').click()
        initial = await expected_ids()
        await wait_ids(initial[:40])
        assert len(initial) == 48
        calls = await page.evaluate('__mock.taskListCalls')
        assert calls[-1]['args']['p_cursor'] is None
        assert calls[-1]['args']['p_view'] == 'open'
        assert '@qa_peer' in await panel.inner_text() and 'Соседний QA чат' in await panel.inner_text()
        await page.screenshot(path=str(EVIDENCE / f'tasks-home-{name}-first-page.png'))
        checks.append('Дела loads actual task rows from both conversations; denied initial data offers Retry without fabricating an empty successful list')

        await panel.locator('.pthMore').click()
        await wait_ids(initial)
        assert len(await visible_ids()) == len(set(await visible_ids()))
        calls = await page.evaluate('__mock.taskListCalls')
        all_rows = await page.evaluate('__mock.allTasks().filter(task=>!task.completed)')
        assert calls[-1]['args']['p_cursor'] == {key: all_rows[39][key] for key in ['created_at', 'id']}
        assert await panel.locator('.pthMore').is_hidden()
        checks.append('keyset pagination sends the exact last created_at/id pair, including timestamp ties, and appends all 48 tasks once in stable order')

        for view in ['mine', 'overdue', 'completed', 'archived']:
            await choose(view)
            assert await visible_ids() == await expected_ids(view)
            last = await page.evaluate('__mock.taskListCalls.at(-1).args')
            assert last['p_view'] == view and last['p_cursor'] is None
        await choose('open')
        await panel.locator('.pthSearchInput').fill('Материал 1')
        await wait_ids(await expected_ids('open', 'Материал 1'))
        assert await page.evaluate('__mock.taskListCalls.at(-1).args.p_query') == 'Материал 1'
        await panel.locator('.pthSearchInput').fill('Такой задачи здесь нет')
        await page.wait_for_function('__mock.taskListCalls.at(-1)?.args.p_query==="Такой задачи здесь нет"')
        await panel.locator('.pthMore').wait_for(state='hidden')
        await wait_ids([])
        await panel.locator('.pthSearchInput').fill('')
        await wait_ids(initial[:40])
        checks.append('Все/Мне/Просрочено/Готово/Архив and text search issue the corresponding server filters, reset pagination and render the filtered or genuinely empty result')

        before = len(await update_calls())
        original_content = await page.evaluate('id=>__mock.allTasks().find(task=>task.id===id).content', task_id(59))
        await card(59).locator('.pthToggle').click()
        await page.wait_for_function('id=>__mock.allTasks().find(task=>task.id===id).completed', arg=task_id(59))
        await wait_ids((await expected_ids())[:40])
        assert not await card(59).count()
        calls = await update_calls()
        assert len(calls) == before + 1
        assert calls[-1]['args']['p_conversation_id'] == MAIN_CHAT
        assert calls[-1]['args']['p_expected_revision'] == 1
        assert calls[-1]['args']['p_completed'] is True
        assert calls[-1]['args']['p_title'] == 'Свежий план съёмки'
        assert calls[-1]['args']['p_schedule'] is None and calls[-1]['args']['p_archived'] is None
        completed = await page.evaluate('id=>__mock.allTasks().find(task=>task.id===id)', task_id(59))
        assert completed['due_at'] and completed['reminder_minutes'] == 60 and completed['followup_minutes'] == 180
        assert completed['content'] == original_content, 'Metadata toggle must preserve the full project/task content and attachments'
        await choose('completed')
        assert await card(59).locator('.pthToggle').get_attribute('aria-checked') == 'true'
        await card(59).locator('.pthToggle').click()
        await wait_ids(await expected_ids('completed'))
        await choose('open')
        assert await card(59).locator('.pthToggle').get_attribute('aria-checked') == 'false'
        checks.append('complete and reopen persist one revisioned mutation in the correct conversation, then reload the list; no optimistic or inverted completion is shown')

        await page.evaluate('([chat,id])=>{const task=__mock.canvasState[chat].tasks.find(task=>task.id===id);task.title="Катя уже уточнила задачу";task.revision++;}', [OTHER_CHAT, task_id(58)])
        before = len(await update_calls())
        await card(58).locator('.pthToggle').click()
        await panel.locator('.pthNotice').wait_for()
        await page.wait_for_function('id=>document.querySelector(".pthTask[data-task-id=\\""+id+"\\"]")?.textContent.includes("Катя уже уточнила задачу")', arg=task_id(58))
        row = next(task for task in await page.evaluate('__mock.allTasks()') if task['id'] == task_id(58))
        assert not row['completed'] and row['revision'] == 2
        calls = await update_calls()
        assert len(calls) == before + 1 and calls[-1]['args']['p_expected_revision'] == 1
        assert calls[-1]['args']['p_title'] == 'Старый план студии'
        assert not await card(58).locator('.pthToggle').is_disabled()
        checks.append('a peer edit causes a revision conflict; the attempted old title/revision never overwrites it, fresh data replaces the card and no mutation is automatically retried')

        await page.evaluate('__mock.loseToggleResponse=true;__mock.failNextTaskList=true')
        before = len(await update_calls())
        await card(57).locator('.pthToggle').click()
        await panel.locator('.pthRetry').wait_for()
        assert len(await update_calls()) == before + 1
        assert await page.evaluate('id=>__mock.allTasks().find(task=>task.id===id).completed', task_id(57))
        if await card(57).count():
            assert await card(57).locator('.pthToggle').is_disabled()
        await panel.locator('.pthRetry').click()
        await wait_ids((await expected_ids())[:40])
        assert len(await update_calls()) == before + 1
        assert not await card(57).count()
        await choose('completed')
        assert await card(57).locator('.pthToggle').get_attribute('aria-checked') == 'true'
        await choose('open')
        checks.append('a committed toggle with a lost response and failed refresh cannot be resent or inverted; Retry only reloads and reveals the authoritative completed state')

        await card(58).locator('.pthOpen').click()
        await page.wait_for_function('id=>PablicusChat?.scope?.chat===id && !document.getElementById("app").inert', arg=OTHER_CHAT)
        await page.locator('#chatCanvasPanel .pablicusChatCanvas[data-state="ready"]').wait_for()
        assert await page.locator('#canvasTab').get_attribute('aria-selected') == 'true'
        assert 'Катя уже уточнила задачу' in await page.locator('#chatCanvasPanel').inner_text()
        await page.locator('.pccTaskCancel').click()
        await page.locator('#chatBack').click()
        await panel.wait_for()
        await wait_ids((await expected_ids())[:40])
        checks.append('opening a task navigates to its own conversation canvas and Back returns to the aggregate Дела section')

        await card(58).locator('.pthOpen').click()
        task_form = page.locator(f'.pccTaskForm[data-task-id="{task_id(58)}"]')
        await task_form.wait_for()
        await task_form.locator('.pccTaskMoreToggle').click()
        await task_form.locator('.pccTaskArchive').click()
        await task_form.wait_for(state='hidden')
        await page.locator('#chatBack').click()
        await wait_ids((await expected_ids())[:40])
        assert not await card(58).count()
        await choose('archived')
        assert await visible_ids() == [task_id(58)]
        await card(58).locator('.pthOpen').click()
        await task_form.wait_for()
        await task_form.locator('.pccTaskMoreToggle').click()
        await task_form.locator('.pccTaskRestore').click()
        await task_form.wait_for(state='hidden')
        await page.locator('#chatBack').click()
        await panel.wait_for()
        await choose('open')
        await card(58).wait_for()
        checks.append('archiving a task from its canvas removes it from aggregate active work, keeps it in Архив, and restoring it through that archive returns the same unfinished task to active work')

        await page.evaluate('__mock.holdNextTaskList=true')
        await panel.locator('.pthSearchInput').fill('Катя')
        await page.wait_for_function('__mock.taskListPending.length===1')
        await panel.locator('.pthSearchInput').fill('Свежий')
        await wait_ids(await expected_ids('open', 'Свежий'))
        await page.evaluate('__mock.releaseTaskLists()')
        await page.wait_for_timeout(100)
        assert await visible_ids() == await expected_ids('open', 'Свежий')
        assert await panel.locator('.pthSearchInput').input_value() == 'Свежий'
        checks.append('an older search response arriving after a newer query cannot replace its results or enable stale-query task actions')

        await panel.locator('.pthSearchInput').fill('')
        await wait_ids((await expected_ids())[:40])
        await page.evaluate('__mock.holdNextTaskList=true')
        await panel.locator('.pthRefresh').click()
        await page.wait_for_function('__mock.taskListPending.length===1')
        await page.locator('#mainNav [data-page="chats"]').click()
        await page.locator('.chatMain').first.wait_for()
        await page.evaluate('__mock.releaseTaskLists()')
        await page.wait_for_timeout(100)
        assert await panel.count() == 0 or await panel.is_hidden()
        assert await page.locator('.chatMain').count() == 2
        await open_tasks()
        await wait_ids((await expected_ids())[:40])
        checks.append('leaving Дела invalidates its pending refresh, so a late response cannot redraw over the chat list')

        await choose('mine')
        assert len(await visible_ids()) > 0
        await page.evaluate('__mock.holdNextTaskList=true')
        await panel.locator('.pthRefresh').click()
        await page.wait_for_function('__mock.taskListPending.length===1')
        await page.evaluate('__mock.signOut()')
        await page.wait_for_function('!PablicusDebug.user')
        await page.evaluate('(id)=>__mock.switchAccount(id)', SECOND_USER)
        await page.wait_for_function('id=>PablicusDebug.user===id', arg=SECOND_USER)
        await page.evaluate('__mock.releaseTaskLists()')
        await open_tasks()
        await choose('mine')
        await wait_ids([])
        assert await visible_ids() == await expected_ids('mine')
        assert await page.evaluate('__mock.taskListCalls.at(-1).actor') == SECOND_USER
        checks.append('account changes clear the old inbox and pending reads; Мне uses the next account identity and exposes no previous-account assignments')

        await page.evaluate('''()=>{const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const day=date=>date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');for(const state of Object.values(__mock.canvasState))for(const task of state.tasks)if(!task.completed){task.due_at=null;task.due_date=task.id==='99999999-9999-4999-8999-000000000059'?__mock.taskToday:day(yesterday);}}''')
        await choose('overdue')
        assert not await card(59).count()
        assert len(await expected_ids('overdue')) > 40
        next_day = await page.evaluate('''()=>{const date=new Date();date.setDate(date.getDate()+1);date.setHours(12,0,0,0);return {instant:date.toISOString(),day:date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')};}''')
        await page.clock.set_fixed_time(next_day['instant'])
        await page.evaluate('day=>__mock.taskToday=day', next_day['day'])
        await panel.locator('.pthMore').click()
        await wait_ids((await expected_ids('overdue'))[:40])
        rollover = await page.evaluate('__mock.taskListCalls.at(-1).args')
        assert rollover['p_today'] == next_day['day'] and rollover['p_cursor'] is None
        await card(59).wait_for()
        checks.append('crossing local midnight before More discards the previous-date cursor and reloads the new overdue first page, including a newly overdue task above the old cursor')

        await choose('open')
        await card(56).wait_for()
        dimensions = await panel.evaluate('(node)=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}}')
        assert dimensions['left'] >= -1 and dimensions['right'] <= dimensions['viewport'] + 1 and not dimensions['overflow'], dimensions
        colors = await panel.evaluate('''root=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{willReadFrequently:true});return [...root.querySelectorAll('.pthTab,.pthToggle,.pthTask,.pthSearchInput')].flatMap(node=>{const style=getComputedStyle(node);return ['color','backgroundColor'].map(property=>{context.clearRect(0,0,1,1);context.fillStyle=style[property];context.fillRect(0,0,1,1);return {property,color:style[property],rgba:[...context.getImageData(0,0,1,1).data]};});});}''')
        assert colors
        for color in colors:
            red, green, blue, alpha = color['rgba']
            if alpha > 30:
                assert max(red, green, blue) - min(red, green, blue) <= 12, color
        await page.screenshot(path=str(EVIDENCE / f'tasks-home-{name}-mobile.png'))
        assert not errors, errors
        assert not unexpected, unexpected
        diagnostics = await page.evaluate('[...__mock.taskListUnknown,...__mock.canvasUnknown]')
        assert not diagnostics, diagnostics
        checks.append('390px mobile list with long titles stays within the viewport and uses neutral surfaces; strict RPC contracts, no JavaScript errors or real external requests')
        return {'engine': name, 'pass': True, 'checks': checks,
                'scope': 'built app, DOM and navigation with synthetic shared state; no live account or physical iPhone test'}
    except Exception:
        EVIDENCE.mkdir(exist_ok=True)
        await page.screenshot(path=str(EVIDENCE / f'tasks-home-{name}-failure.png'))
        return {'engine': name, 'pass': False, 'checks': checks,
                'error': traceback.format_exc(), 'js_errors': errors, 'unexpected_requests': unexpected,
                'rpc_diagnostics': await page.evaluate('[...(window.__mock?.taskListUnknown||[]),...(window.__mock?.canvasUnknown||[])]')}
    finally:
        await context.close()
        shutil.rmtree(directory, ignore_errors=True)


async def main(engines):
    async with async_playwright() as playwright:
        results = [await one(name, getattr(playwright, name)) for name in engines]
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / 'tasks-home.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert all(result['pass'] for result in results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engines', nargs='*', metavar='ENGINE')
    args = parser.parse_args()
    if any(name not in ('chromium', 'webkit') for name in args.engines):
        parser.error('engines must be chromium or webkit')
    asyncio.run(main(args.engines or ['chromium', 'webkit']))
