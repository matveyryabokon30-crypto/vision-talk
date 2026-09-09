"""Built conversation canvas against an isolated, revisioned backend fixture.

The fixture models two conversation participants, response loss after a commit,
and delayed replies. It never contacts Supabase or sends a real message. Browser
checks exercise the built app, DOM and IndexedDB; SQL authorization/concurrency
is covered independently by the canvas database suite.
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

from message_interactions import (DIST, EVIDENCE, MAIN_CHAT, OTHER_CHAT, PEER,
                                  SECOND_USER, TEXT_ID, USER, WEBM, incoming, mocked_sdk, playable_wav)
from rich_message_integration import MOCK_MIC, PNG

INITIAL_PLAN = 'План совместной съёмки'
OTHER_PLAN = 'План соседнего разговора'
PEER_PLAN = 'Катя добавила время встречи — 15:00'
LOCAL_PLAN = 'Мой несохранённый вариант плана'
TASK_ID = '99999999-9999-4999-8999-000000000001'
OLD_ID = '99999999-9999-4999-8999-000000000002'
OLD_TEXT = 'Архивное сообщение для проверки черновика полотна'


def canvas_sdk():
    source = mocked_sdk()

    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, 'Fixture anchor changed: ' + old[:100]
        source = source.replace(old, new, 1)

    initialization = r'''
    __mock.canvasCalls=[];__mock.canvasUnknown=[];__mock.readCalls=[];__mock.messageReads=[];
    __mock.canvasPending=[];__mock.holdNextCanvasRead=false;
    __mock.loseCreateResponse=false;__mock.canvasReceipts=new Map();
    __mock.canvasDenied=false;
    __mock.expandHistory=()=>{
      if(messages.some(message=>message.id==='__OLD_ID__'))return;
      messages.push({id:'__OLD_ID__',client_message_id:'canvas-old',conversation_id:chat,
        server_seq:3,sender_id:peer,type:'text',body:'__OLD_TEXT__',
        attachment_path:null,attachment_metadata:null,created_at:'2026-09-08T10:10:00Z'});
      for(let n=10;n<210;n++)if(!messages.some(message=>message.conversation_id===chat&&message.server_seq===n))messages.push({id:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0'),
        client_message_id:'canvas-history-'+n,conversation_id:chat,server_seq:n,sender_id:peer,
        type:'text',body:'Недавнее сообщение '+n,attachment_path:null,attachment_metadata:null,
        created_at:'2026-09-08T11:00:00Z'});
      messages.sort((a,b)=>a.server_seq-b.server_seq);seq=209;
    };
    __mock.historyRows=conversationId=>messages.filter(message=>message.conversation_id===conversationId)
      .sort((a,b)=>a.server_seq-b.server_seq).map(message=>({id:message.id,number:message.server_seq}));
    __mock.releaseCanvas=()=>{const jobs=__mock.canvasPending.splice(0);jobs.forEach(job=>job());};
    __mock.signOut=()=>__mock.emitAuth('SIGNED_OUT',null);
    const canvasNow=()=>new Date().toISOString();
    const workspaceText=content=>(content?.blocks||[]).filter(block=>block.type==='text').map(block=>block.text).join('\n').trim();
    const canvasParticipants=[
      {id:user.id,display_name:'Матвей QA',username:'qa_user'},
      {id:peer,display_name:'Катя QA',username:'qa_peer'},
      {id:'__SECOND_USER__',display_name:'Второй QA аккаунт',username:'qa_second'}
    ];
    const seedCanvas=(id,body)=>({conversation_id:id,revision:1,
      canvas:{body,revision:1,updated_at:canvasNow(),updated_by:peer},
      tasks:[],participants:structuredClone(canvasParticipants)});
    __mock.canvasState={
      [chat]:seedCanvas(chat,'__INITIAL_PLAN__'),
      ['__OTHER_CHAT__']:seedCanvas('__OTHER_CHAT__','__OTHER_PLAN__')
    };
    __mock.canvasState[chat].tasks.push({id:'__TASK_ID__',title:'Подготовить три идеи',
      assignee_id:peer,due_date:'2030-09-11',due_at:null,due_timezone:'UTC',reminder_minutes:null,followup_minutes:null,archived_at:null,completed:false,revision:1,
      source_message_id:null,source_block_id:null,
      created_at:canvasNow(),created_by:peer,updated_at:canvasNow(),updated_by:peer});
    __mock.peerPlan=body=>{const state=__mock.canvasState[chat];
      state.canvas={body,revision:state.canvas.revision+1,updated_at:canvasNow(),updated_by:peer};state.revision++;};
    __mock.peerTask=(id,title)=>{const state=__mock.canvasState[chat],task=state.tasks.find(t=>t.id===id);
      if(!task)throw Error('Unknown synthetic peer task');
      task.title=title;task.content={v:1,blocks:[{id:'peer-task-text',type:'text',text:title}]};task.updated_by=peer;task.updated_at=canvasNow();task.revision++;state.revision++;};
    const canvasKeys={
      pablicus_get_canvas:['p_conversation_id'],
      pablicus_save_canvas_plan_v2:['p_conversation_id','p_expected_revision','p_content'],
      pablicus_create_canvas_task_v3:['p_conversation_id','p_task_id','p_content','p_assignee_id','p_due_date','p_source_message_id','p_source_block_id','p_schedule'],
      pablicus_update_canvas_task_v3:['p_conversation_id','p_task_id','p_expected_revision','p_content','p_assignee_id','p_due_date','p_completed','p_schedule','p_archived'],
      pablicus_delete_canvas_task:['p_conversation_id','p_task_id','p_expected_revision']
    };
    const canvasError=(code,message)=>({data:null,error:{code,message}});
    const scheduleFields=schedule=>schedule==null?{}:schedule.due_at?{due_at:schedule.due_at,due_timezone:schedule.timezone,
      reminder_minutes:schedule.reminder_minutes,followup_minutes:schedule.followup_minutes}
      :{due_at:null,due_timezone:'UTC',reminder_minutes:null,followup_minutes:null};
    const canvasRpc=(name,args)=>{
      const expected=canvasKeys[name],actual=Object.keys(args).sort();
      if(JSON.stringify(actual)!==JSON.stringify([...expected].sort())){
        __mock.canvasUnknown.push({name,args,reason:'unexpected argument shape'});
        return canvasError('22023','Unexpected canvas arguments');
      }
      __mock.canvasCalls.push({name,args:structuredClone(args),actor:user.id});
      if(args.p_content&&(!Array.isArray(args.p_content.blocks)||args.p_content.blocks.some(block=>block.type==='text'&&!String(block.text||'').trim())))
        return canvasError('22023','invalid_workspace_content');
      const state=__mock.canvasState[args.p_conversation_id];
      if(!state||__mock.canvasDenied||!state.participants.some(p=>p.id===user.id))
        return canvasError('42501','canvas_access_denied');
      if(name==='pablicus_get_canvas'){
        const response={data:structuredClone(state),error:null};
        if(__mock.holdNextCanvasRead){__mock.holdNextCanvasRead=false;
          return new Promise(resolve=>__mock.canvasPending.push(()=>resolve(response)));}
        return response;
      }
      if(name==='pablicus_save_canvas_plan_v2'){
        if(args.p_expected_revision!==state.canvas.revision)return canvasError('40001','canvas_revision_conflict');
        state.canvas={body:workspaceText(args.p_content),content:structuredClone(args.p_content),revision:state.canvas.revision+1,updated_at:canvasNow(),updated_by:user.id};
      }else if(name==='pablicus_create_canvas_task_v3'){
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.p_task_id))
          return canvasError('22023','task_id_required');
        const receiptKey=user.id+':'+args.p_conversation_id+':'+args.p_task_id;
        const signature=JSON.stringify(args),receipt=__mock.canvasReceipts.get(receiptKey);
        if(receipt)return receipt===signature?{data:structuredClone(state),error:null}:canvasError('23505','task_id_conflict');
        if(args.p_assignee_id&&!state.participants.some(p=>p.id===args.p_assignee_id))
          return canvasError('22023','assignee_not_member');
        if(args.p_source_message_id&&!messages.some(m=>m.id===args.p_source_message_id&&m.conversation_id===state.conversation_id))
          return canvasError('22023','source_message_not_in_conversation');
        __mock.canvasReceipts.set(receiptKey,signature);
        state.tasks.push({id:args.p_task_id,title:workspaceText(args.p_content).slice(0,500)||'Вложения',content:structuredClone(args.p_content),assignee_id:args.p_assignee_id,
          due_date:args.p_due_date,...scheduleFields(args.p_schedule),archived_at:null,completed:false,revision:1,
          source_message_id:args.p_source_message_id,source_block_id:args.p_source_block_id,
          created_at:canvasNow(),created_by:user.id,updated_at:canvasNow(),updated_by:user.id});
      }else{
        const task=state.tasks.find(t=>t.id===args.p_task_id);
        if(!task||task.revision!==args.p_expected_revision)return canvasError('40001','task_revision_conflict');
        if(name==='pablicus_delete_canvas_task')state.tasks=state.tasks.filter(t=>t.id!==task.id);
        else Object.assign(task,{title:workspaceText(args.p_content).slice(0,500)||'Вложения',content:structuredClone(args.p_content),assignee_id:args.p_assignee_id,due_date:args.p_due_date,
          completed:args.p_completed,...scheduleFields(args.p_schedule),archived_at:args.p_archived==null?task.archived_at:args.p_archived?(task.archived_at||canvasNow()):null,revision:task.revision+1,updated_at:canvasNow(),updated_by:user.id});
      }
      state.revision++;
      if(name==='pablicus_create_canvas_task_v3'&&__mock.loseCreateResponse){__mock.loseCreateResponse=false;
        return canvasError('NETWORK_ERROR','network request failed after committed task');}
      return {data:structuredClone(state),error:null};
    };
    '''
    for old, new in {'__SECOND_USER__': SECOND_USER, '__INITIAL_PLAN__': INITIAL_PLAN,
                     '__OTHER_CHAT__': OTHER_CHAT, '__OTHER_PLAN__': OTHER_PLAN,
                     '__TASK_ID__': TASK_ID, '__OLD_ID__': OLD_ID,
                     '__OLD_TEXT__': OLD_TEXT}.items():
        initialization = initialization.replace(old, new)
    replace('const result=(data,error=null)=>Promise.resolve({data,error});', initialization + '\nconst result=(data,error=null)=>Promise.resolve({data,error});')
    replace("lt(k,v){filters.push([k,'lt',v]);return q}", "lt(k,v){filters.push([k,'lt',v]);return q},gte(k,v){filters.push([k,'gte',v]);return q},lte(k,v){filters.push([k,'lte',v]);return q}")
    replace("op==='gt'?x[k]>v:x[k]<v", "op==='gt'?x[k]>v:op==='gte'?x[k]>=v:op==='lte'?x[k]<=v:x[k]<v")
    replace('return result(single?(d[0]||null):d)', "if(table==='messages')__mock.messageReads.push({filters:structuredClone(filters),sort:structuredClone(sort),limit:lim,rows:d.map(message=>({id:message.id,number:message.server_seq}))});return result(single?(d[0]||null):d)")
    replace('rpc:async(name,args)=>{', r'''rpc:async(name,args={})=>{
      if(canvasKeys[name])return canvasRpc(name,args);
      if(name==='pablicus_search_messages'){
        const allowed=['p_conversation_id','p_query','p_before_seq','p_limit'];
        if(JSON.stringify(Object.keys(args).sort())!==JSON.stringify(allowed.sort())){
          __mock.canvasUnknown.push({name,args,reason:'unexpected search arguments'});
          return result(null,{code:'22023',message:'Unexpected search arguments'});
        }
        const query=String(args.p_query||'').toLowerCase();
        return result(messages.filter(m=>m.conversation_id===args.p_conversation_id&&String(m.body||'').toLowerCase().includes(query)
          &&(args.p_before_seq==null||m.server_seq<args.p_before_seq)).sort((a,b)=>b.server_seq-a.server_seq)
          .slice(0,args.p_limit).map(m=>({message_id:m.id,server_seq:m.server_seq,sender_id:m.sender_id,
            created_at:m.created_at,snippet:m.body,message_revision:0})));
      }
      if(name==='get_message_actions')return result((args.p_message_ids||[]).map(id=>({
        message_id:id,pinned:false,reactions:[],message_revision:0,
        edited_body:null,edited_content:null,edited_at:null,deleted_at:null})));
      if(name==='get_pinned_messages')return result([]);
      if(name==='mark_conversation_read')__mock.readCalls.push(structuredClone(args));
      if(!['my_conversations_v3','my_conversations_v2','mark_conversation_read',
        'pablicus_list_tasks_v2','pablicus_list_projects','start_direct_conversation','start_saved_conversation','send_message',
        'send_attachment_message','send_rich_message'].includes(name)){
        __mock.canvasUnknown.push({name,args,reason:'unexpected RPC'});
        return result(null,{code:'PGRST202',message:'Unexpected RPC '+name});
      }
    ''')
    return source


async def one(name, engine):
    directory = tempfile.mkdtemp(prefix='pablicus-chat-canvas-')
    launch_options = {}
    if name == 'webkit' and os.environ.get('PABLICUS_WEBKIT_EXECUTABLE'):
        launch_options['executable_path'] = os.environ['PABLICUS_WEBKIT_EXECUTABLE']
    context = await engine.launch_persistent_context(directory, headless=True,
        viewport={'width': 390, 'height': 844}, timezone_id='Europe/Moscow', has_touch=True,
        service_workers='block', accept_downloads=True, **launch_options)
    source = canvas_sdk()
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
    await context.add_init_script(MOCK_MIC)
    page = await context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    pane = page.locator('#chatCanvasPanel')
    body = pane.locator('.pccPlanBody')
    form = page.locator('.pccTaskForm')

    async def open_chat(chat_id):
        await page.locator('.chatMain').filter(has_text='@qa_peer' if chat_id == MAIN_CHAT else 'Соседний QA чат').click()
        await page.wait_for_function("id=>PablicusChat?.scope?.chat===id && PablicusChat?.store && PablicusChat?.list && !document.getElementById('app').inert && document.getElementById('app').style.visibility!=='hidden'", arg=chat_id)

    async def open_canvas():
        await page.locator('#canvasTab').click()
        await pane.locator('.pablicusChatCanvas[data-state="ready"]').wait_for()
        editing = await pane.get_attribute('data-editing') == 'true'
        # While a project/task editor is open its own composer owns the viewport;
        # the global chat composer is intentionally hidden to prevent accidental sends.
        assert await page.locator('#composer').is_visible() is not editing
        if editing:
            assert await page.locator('.workspaceEditor').is_visible()
        else:
            assert await page.locator('#composeBox #editor').is_hidden()
        assert await page.locator('#workspaceQuick').is_visible()

    async def fill_plan(value):
        if not await body.is_visible():
            project = pane.locator('.pccProjectCard')
            if await project.is_visible():
                if await project.get_attribute('aria-expanded') != 'true':
                    await project.click()
                await pane.locator('.pccPlanEdit').click()
            else:
                await pane.locator('.pccPlanNew').click()
        await body.fill(value)

    async def choose_date(value):
        # Exercise the visible calendar, never fill its hidden storage input.
        for _ in range(60):
            day = form.locator(f'.pccCalendarDay[data-date="{value}"]')
            if await day.count():
                await day.click()
                assert await form.locator('.pccTaskDate').input_value() == value
                return
            first = await form.locator('.pccCalendarDay[data-date]').first.get_attribute('data-date')
            direction = '.pccCalendarNext' if value > first else '.pccCalendarPrev'
            await form.locator(direction).click()
        raise AssertionError('Calendar did not reach ' + value)

    async def task_action(selector):
        details = form.locator('.pccTaskMore')
        if await details.get_attribute('open') is None:
            await form.locator('.pccTaskMoreToggle').click()
        await form.locator(selector).click()

    async def assert_simple_sheet(width):
        await page.set_viewport_size({'width': width, 'height': 844})
        await page.wait_for_timeout(70)
        sheet = page.locator('.pccTaskSheet')
        assert await sheet.is_visible()
        assert await form.locator('.pccCalendar').is_visible()
        assert await form.locator('.pccTaskTime').is_visible()
        assert await form.locator('.pccTaskReminder').is_visible()
        assert await form.locator('.pccTaskTitle').is_visible()
        assert await form.locator('.pccTaskSave').inner_text() == 'Добавить'
        assert not await form.locator('.pccTaskAssignee').count()
        assert not await form.locator('.pccTaskFollowup').count()
        assert not await form.locator('.pccTaskMore').count()
        assert not await form.locator('.pccTaskDone,.pccTaskArchive,.pccTaskDelete,.pccTaskPostpone').count()
        layout = await form.evaluate("""node=>{
          const rect=selector=>{const r=node.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
          const r=node.closest('.pccTaskSheet').getBoundingClientRect();
          return {calendar:rect('.pccCalendar'),time:rect('.pccTaskTime'),reminder:rect('.pccTaskReminder'),
            title:rect('.pccTaskTitle'),save:rect('.pccTaskSave'),left:r.left,right:r.right,top:r.top,bottom:r.bottom,
            viewport:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};
        }""")
        assert layout['left'] >= -1 and layout['right'] <= width + 1 and not layout['overflow'], layout
        assert layout['top'] >= -1 and layout['bottom'] <= layout['height'] + 1, layout
        assert layout['calendar']['bottom'] <= layout['time']['top'] + 1, layout
        assert layout['time']['bottom'] <= layout['reminder']['top'] + 1, layout
        assert layout['reminder']['bottom'] <= layout['title']['top'] + 1, layout
        assert layout['title']['bottom'] <= layout['save']['top'] + 1, layout
        await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-new-task-{width}.png'))

    async def server_tasks():
        return await page.evaluate('id=>structuredClone(__mock.canvasState[id].tasks)', MAIN_CHAT)

    async def saved_plan(value):
        await page.wait_for_function('([id,value])=>__mock.canvasState[id].canvas.body===value', arg=[MAIN_CHAT, value])
        await pane.locator('.pccPlanNotice[data-state="saved"]').wait_for()

    def card(task_id):
        return pane.locator(f'.pccTask[data-task-id="{task_id}"]')

    try:
        EVIDENCE.mkdir(exist_ok=True)
        await page.clock.set_fixed_time('2030-09-09T06:00:00.000Z')
        await page.goto('http://127.0.0.1:8765/', wait_until='domcontentloaded')
        await page.wait_for_selector('.chatMain')
        await open_chat(MAIN_CHAT)
        await page.locator('#input').fill('Продолжаю разговор — черновик не потерять')
        await page.evaluate('PablicusChat.flush()')
        await page.evaluate('__mock.canvasDenied=true')
        await page.locator('#canvasTab').click()
        await pane.locator('.pablicusChatCanvas[data-state="error"]').wait_for()
        assert not await pane.locator('.pccTaskAdd').is_visible()
        assert not await body.is_visible()
        await page.evaluate('__mock.canvasDenied=false')
        await pane.locator('.pccRetry').click()
        await pane.locator('.pablicusChatCanvas[data-state="ready"]').wait_for()
        checks.append('an unavailable/denied initial canvas displays a retry without fabricated empty data or enabled task writes; a successful retry loads the shared state')
        assert await body.input_value() == INITIAL_PLAN
        await card(TASK_ID).wait_for()
        assert await page.locator('#canvasTab').get_attribute('aria-selected') == 'true'
        await fill_plan('Общий план: съёмка в пятницу')
        assert await page.evaluate('id=>__mock.canvasState[id].canvas.body', MAIN_CHAT) == INITIAL_PLAN
        await page.locator('#conversationTab').click()
        await open_canvas()
        assert await body.input_value() == 'Общий план: съёмка в пятницу'
        assert await page.evaluate('id=>__mock.canvasState[id].canvas.body', MAIN_CHAT) == INITIAL_PLAN
        await pane.locator('.pccPlanSave').click()
        await saved_plan('Общий план: съёмка в пятницу')
        await page.locator('#conversationTab').click()
        assert await page.locator('#input').input_value() == 'Продолжаю разговор — черновик не потерять'
        await open_canvas()
        assert await body.input_value() == 'Общий план: съёмка в пятницу'
        checks.append('conversation/canvas tabs show shared server content; a plan writes only on Save and the existing message draft survives both transitions')

        await page.locator('#conversationTab').click()
        await page.locator('#richVoice').click()
        await page.wait_for_function('PablicusChat.rich.recording')
        await open_canvas()
        assert await page.evaluate('PablicusChat.rich.recording && __mockMic.stops===0')
        await page.locator('#conversationTab').click()
        assert await page.evaluate('PablicusChat.rich.recording && __mockMic.stops===0')
        await page.locator('#richVoice').click()
        await page.wait_for_function('!PablicusChat.rich.recording && PablicusChat.rich.capture().files.length===1')
        await page.locator('#editor .richMedia-audio [aria-label="Убрать вложение"]').click()
        await page.evaluate('PablicusChat.flush()')
        await open_canvas()
        checks.append('an explicitly mocked microphone keeps recording across both canvas tab transitions; only the user stop ends it and the message text remains intact')

        await pane.locator('.pccTaskAdd').click()
        await form.wait_for()
        assert await form.locator('.pccTaskDate').input_value() == '2030-09-09'
        assert await form.locator('.pccTaskTime').input_value() == '10:00'
        await assert_simple_sheet(390)
        await assert_simple_sheet(320)
        await page.set_viewport_size({'width': 390, 'height': 844})
        title_before = await form.locator('.pccTaskTitle').evaluate('node=>node.getBoundingClientRect().height')
        await form.locator('.pccTaskTitle').fill('Синтетический текст задачи\nВторая строка задачи\nТретья строка задачи\nЧетвёртая строка задачи')
        title_after = await form.locator('.pccTaskTitle').evaluate('node=>node.getBoundingClientRect().height')
        assert title_after > title_before, (title_before, title_after)
        await form.locator('.pccTaskTitle').fill('Забронировать студию')
        await form.locator('.pccCalendarNext').click()
        await choose_date('2030-10-02')
        assert await form.locator('.pccCalendarDay[data-date]').count() == 31
        await form.locator('.pccCalendarPrev').click()
        assert await form.locator('.pccTaskDate').input_value() == '2030-10-02'
        await choose_date('2030-09-11')
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        task = next(task for task in await server_tasks() if task['title'] == 'Забронировать студию')
        assert task['assignee_id'] == USER and task['due_date'] == '2030-09-11'
        assert task['created_by'] == USER and not task['completed']
        await card(task['id']).locator('.pccTaskToggle').click()
        await page.wait_for_function('([id,taskId])=>__mock.canvasState[id].tasks.find(t=>t.id===taskId)?.completed', arg=[MAIN_CHAT, task['id']])
        await card(task['id']).wait_for(state='hidden')
        await pane.locator('.pccTaskView[data-view="completed"]').click()
        assert await card(task['id']).locator('.pccTaskToggle').get_attribute('aria-pressed') == 'true'
        await card(task['id']).locator('.pccTaskToggle').click()
        await page.wait_for_function('([id,taskId])=>!__mock.canvasState[id].tasks.find(t=>t.id===taskId)?.completed', arg=[MAIN_CHAT, task['id']])
        await card(task['id']).wait_for(state='hidden')
        await pane.locator('.pccTaskView[data-view="open"]').click()
        await card(task['id']).locator('.pccTaskEdit').click()
        await form.locator('.pccTaskTitle').fill('Студия «Свет» забронирована')
        await choose_date('2030-09-12')
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        updated = next(item for item in await server_tasks() if item['id'] == task['id'])
        assert updated['title'] == 'Студия «Свет» забронирована' and updated['assignee_id'] == USER and updated['due_date'] == '2030-09-12'
        await card(task['id']).locator('.pccTaskEdit').click()
        await task_action('.pccTaskDelete')
        assert any(item['id'] == task['id'] for item in await server_tasks())
        await form.locator('.pccTaskDeleteConfirm').click()
        await card(task['id']).wait_for(state='hidden')
        assert not any(item['id'] == task['id'] for item in await server_tasks())
        checks.append('New task immediately opens one calendar sheet: date, time, reminder, expanding text and a single Add action at 390/320px; it creates for the caller, then supports completion/reopening/editing and explicit confirmed removal')

        # Exercise an actual non-UTC browser timezone and an absolute transport instant.
        await pane.locator('.pccTaskAdd').click()
        await form.locator('.pccTaskTitle').fill('Проверить свет в студии QA')
        await choose_date('2030-09-11')
        await form.locator('.pccTaskTime').fill('15:00')
        await form.locator('.pccTaskReminder').select_option('60')
        assert not await form.locator('.pccTaskFollowup').count()
        assert not any(item['title'] == 'Проверить свет в студии QA' for item in await server_tasks())
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        timed = next(item for item in await server_tasks() if item['title'] == 'Проверить свет в студии QA')
        assert timed['due_at'] == '2030-09-11T12:00:00.000Z' and timed['due_timezone'] == 'Europe/Moscow', timed
        assert timed['reminder_minutes'] == 60 and timed['followup_minutes'] == 180, timed
        assert '15:00' in await card(timed['id']).inner_text()
        count_text = await pane.locator('.pccTaskCount').inner_text()
        assert 'из' not in count_text and str(len(await server_tasks())) in count_text, count_text
        await card(timed['id']).locator('.pccTaskEdit').click()
        assert await form.locator('.pccTaskTime').input_value() == '15:00'
        assert await form.locator('.pccTaskReminder').input_value() == '60'
        assert not await form.locator('.pccTaskFollowup').count()
        await form.locator('.pccTaskTitle').fill('Проверить свет и камеру QA')
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        renamed = next(item for item in await server_tasks() if item['id'] == timed['id'])
        for field in ['due_at', 'due_timezone', 'reminder_minutes', 'followup_minutes']:
            assert renamed[field] == timed[field], (field, renamed, timed)
        checks.append('15:00 Moscow becomes 12:00 UTC with timezone, a one-hour reminder and default three-hour follow-up; title-only editing preserves that schedule and the counter reports a total')

        await card(timed['id']).locator('.pccTaskEdit').click()
        await task_action('.pccTaskPostpone')
        await choose_date('2030-09-08')
        await form.locator('.pccTaskTime').fill('10:00')
        previous_calls = await page.evaluate('__mock.canvasCalls.filter(call=>call.name!=="pablicus_get_canvas").length')
        await form.locator('.pccTaskSave').click()
        assert await form.is_visible()
        assert await page.evaluate('__mock.canvasCalls.filter(call=>call.name!=="pablicus_get_canvas").length') == previous_calls
        await choose_date('2030-09-12')
        await form.locator('.pccTaskTime').fill('16:30')
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        rescheduled = next(item for item in await server_tasks() if item['id'] == timed['id'])
        assert rescheduled['due_at'] == '2030-09-12T13:30:00.000Z' and not rescheduled['completed'], rescheduled
        assert rescheduled['reminder_minutes'] == 60 and rescheduled['followup_minutes'] == 180
        checks.append('rescheduling rejects a past instant before any write, accepts a future local date/time, and keeps the same task and reminder preferences')

        await card(timed['id']).locator('.pccTaskEdit').click()
        await task_action('.pccTaskDone')
        await form.wait_for(state='hidden')
        await card(timed['id']).wait_for(state='hidden')
        await pane.locator('.pccTaskView[data-view="completed"]').click()
        await card(timed['id']).locator('.pccTaskEdit').click()
        await task_action('.pccTaskArchive')
        await form.wait_for(state='hidden')
        await card(timed['id']).wait_for(state='hidden')
        await pane.locator('.pccTaskView[data-view="archived"]').click()
        await card(timed['id']).wait_for()
        archived = next(item for item in await server_tasks() if item['id'] == timed['id'])
        assert archived['completed'] and archived['archived_at'], archived
        await card(timed['id']).locator('.pccTaskEdit').click()
        await task_action('.pccTaskRestore')
        await form.wait_for(state='hidden')
        await card(timed['id']).wait_for(state='hidden')
        await pane.locator('.pccTaskView[data-view="completed"]').click()
        await card(timed['id']).locator('.pccTaskEdit').click()
        await task_action('.pccTaskArchive')
        await form.wait_for(state='hidden')
        await pane.locator('.pccTaskView[data-view="archived"]').click()
        await card(timed['id']).locator('.pccTaskEdit').click()
        await task_action('.pccTaskDelete')
        assert any(item['id'] == timed['id'] for item in await server_tasks())
        await form.locator('.pccTaskDeleteConfirm').click()
        await form.wait_for(state='hidden')
        for view in ['archived', 'completed', 'open']:
            await pane.locator(f'.pccTaskView[data-view="{view}"]').click()
            assert not await card(timed['id']).count()
        assert not any(item['id'] == timed['id'] for item in await server_tasks())
        checks.append('Done removes the active card; completed work can be archived and restored without losing completion, while confirmed deletion removes it from all three views')

        await fill_plan(LOCAL_PLAN)
        await page.evaluate('(text)=>__mock.peerPlan(text)', PEER_PLAN)
        await pane.locator('.pccPlanSave').click()
        await pane.locator('.pccPlanConflict').wait_for()
        assert await body.input_value() == LOCAL_PLAN
        assert PEER_PLAN in await pane.locator('.pccPlanServerBody').inner_text()
        assert await page.evaluate('id=>__mock.canvasState[id].canvas.body', MAIN_CHAT) == PEER_PLAN
        await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-plan-conflict.png'))
        await pane.locator('.pccPlanReplace').click()
        await saved_plan(LOCAL_PLAN)
        plan_calls = await page.evaluate('__mock.canvasCalls.filter(call=>call.name==="pablicus_save_canvas_plan_v2")')
        assert plan_calls[-1]['args']['p_expected_revision'] > plan_calls[-2]['args']['p_expected_revision']
        checks.append('a peer plan commit causes a revision conflict; the local text survives, fresh server text is shown and only explicit replacement writes the new revision')

        await card(TASK_ID).locator('.pccTaskEdit').click()
        await form.locator('.pccTaskTitle').fill('Мой вариант задачи')
        await choose_date('2030-09-15')
        await form.locator('.pccTaskTime').fill('11:20')
        await form.locator('.pccTaskReminder').select_option('30')
        await page.evaluate('([id,text])=>__mock.peerTask(id,text)', [TASK_ID, 'Катя уже изменила задачу'])
        await form.locator('.pccTaskSave').click()
        await form.locator('.pccTaskReplace').wait_for()
        assert await form.locator('.pccTaskTitle').input_value() == 'Мой вариант задачи'
        assert await form.locator('.pccTaskTime').input_value() == '11:20'
        assert await form.locator('.pccTaskReminder').input_value() == '30'
        assert next(item for item in await server_tasks() if item['id'] == TASK_ID)['title'] == 'Катя уже изменила задачу'
        await form.locator('.pccTaskReplace').click()
        await form.wait_for(state='hidden')
        shared_task = next(item for item in await server_tasks() if item['id'] == TASK_ID)
        assert shared_task['title'] == 'Мой вариант задачи' and shared_task['assignee_id'] == PEER
        checks.append('editing a stale task never silently overwrites the other participant; explicit conflict resolution preserves and then saves the local form')

        await page.evaluate('__mock.loseCreateResponse=true')
        await pane.locator('.pccTaskAdd').click()
        await form.locator('.pccTaskTitle').fill('Создать ровно один раз')
        await choose_date('2030-09-16')
        await form.locator('.pccTaskTime').fill('09:40')
        await form.locator('.pccTaskReminder').select_option('60')
        await form.locator('.pccTaskSave').click()
        await page.wait_for_function('id=>__mock.canvasState[id].tasks.some(t=>t.title==="Создать ровно один раз")', arg=MAIN_CHAT)
        await page.wait_for_function("()=>!document.querySelector('.pccTaskSave')?.disabled")
        assert await form.is_visible()
        assert await form.locator('.pccTaskTime').input_value() == '09:40'
        assert await form.locator('.pccTaskReminder').input_value() == '60'
        retry_task = next(item for item in await server_tasks() if item['title'] == 'Создать ровно один раз')
        await form.locator('.pccTaskTitle').fill('Уточнить задачу после потери ответа')
        await form.locator('.pccTaskSave').click()
        await page.locator(f'.pccTaskForm[data-task-id="{retry_task["id"]}"]').wait_for()
        assert await form.locator('.pccTaskTitle').input_value() == 'Уточнить задачу после потери ответа'
        assert len([item for item in await server_tasks() if item['title'] == 'Создать ровно один раз']) == 1
        create_calls = await page.evaluate('__mock.canvasCalls.filter(call=>call.name==="pablicus_create_canvas_task_v3"&&call.args.p_content.blocks.some(block=>block.type==="text"&&block.text==="Создать ровно один раз"))')
        assert len(create_calls) == 2 and create_calls[0]['args'] == create_calls[1]['args'], create_calls
        assert create_calls[0]['args']['p_schedule'] == {'due_at': '2030-09-16T06:40:00.000Z', 'timezone': 'Europe/Moscow', 'reminder_minutes': 60, 'followup_minutes': 180}, create_calls
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        assert len([item for item in await server_tasks() if item['id'] == retry_task['id']]) == 1
        assert next(item for item in await server_tasks() if item['id'] == retry_task['id'])['title'] == 'Уточнить задачу после потери ответа'
        checks.append('a lost create response retries the identical UUID/payload without duplication; later form edits remain visible and save as an explicit update to that same task')

        await page.locator('#conversationTab').click()
        original = page.locator(f'#canvas .row[data-id="{TEXT_ID}"]')
        await original.locator('.meta').click()
        await page.locator('.pablicusMessageMenu .pmmAction[data-action="task"]').click()
        await form.wait_for()
        assert 'Сообщение для отдельного ответа' in await form.locator('.pccTaskTitle').input_value()
        await form.locator('.pccTaskTitle').fill('Задача из сообщения')
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        sourced = next(item for item in await server_tasks() if item['title'] == 'Задача из сообщения')
        assert sourced['source_message_id'] == TEXT_ID and sourced['source_block_id'] is None
        await card(sourced['id']).locator('.pccTaskLocate').click()
        await original.wait_for(state='visible')
        assert await page.locator('#conversationTab').get_attribute('aria-selected') == 'true'
        assert await page.locator('#input').input_value() == 'Продолжаю разговор — черновик не потерять'
        checks.append('message menu creates a real linked task; locate returns to that source message without changing the existing composer draft')

        await open_canvas()
        incoming_message = incoming(71, chat=MAIN_CHAT, text='Пока вы смотрели полотно, пришло сообщение')
        await page.evaluate('(message)=>__mock.emitMessage(message)', incoming_message)
        await page.evaluate('PablicusDebug.syncMessages()')
        await page.wait_for_function('PablicusDebug.messageCount>=3')
        assert not await page.evaluate('seq=>__mock.readCalls.some(call=>call.p_last_read_seq>=seq)', incoming_message['server_seq'])
        await page.locator('#conversationTab').click()
        await page.locator(f'#canvas .row[data-id="{incoming_message["id"]}"]').wait_for(state='visible')
        # The tab's layout/refreshFont runs in an animation frame. Scroll the
        # visible, laid-out timeline as a person would, not its prior hidden size.
        await page.locator('#vp').evaluate('async node=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));node.scrollTop=node.scrollHeight;}')
        await page.evaluate('PablicusDebug.syncMessages()')
        await page.wait_for_function('seq=>__mock.readCalls.some(call=>call.p_last_read_seq>=seq)', arg=incoming_message['server_seq'])
        checks.append('incoming text is not marked read while the conversation canvas hides the message timeline; returning to the conversation allows the normal read marker')

        await page.locator('#chatBack').click()
        await page.evaluate('__mock.expandHistory()')
        await open_chat(MAIN_CHAT)
        assert not await page.locator(f'#canvas .row[data-id="{OLD_ID}"]').count()
        await open_canvas()
        await fill_plan('Не терять этот план при поиске в давней переписке')
        await page.locator('#conversationTab').click()
        await page.locator('#chatLibraryOpen').click()
        library = page.locator('dialog.pablicusChatLibrary')
        await library.locator('.pclSearchInput').fill(OLD_TEXT)
        await library.locator(f'.pclResult[data-message-id="{OLD_ID}"] .pclLocate').click()
        await library.wait_for(state='hidden')
        await page.locator(f'#canvas .row[data-id="{OLD_ID}"]').wait_for(state='visible')
        await page.evaluate('PablicusDebug.syncMessages()')
        await page.wait_for_function('id=>PablicusChat.list.messages.at(-1)?.number===__mock.historyRows(id).at(-1)?.number', arg=MAIN_CHAT)
        history = await page.evaluate('PablicusChat.list.messages.map(message=>({id:message.id,number:message.number}))')
        assert any(message['id'] == OLD_ID for message in history), history
        reads = await page.evaluate('__mock.messageReads')
        neighborhoods = [read for read in reads if read['limit'] == 61
                         and ['conversation_id', 'eq', MAIN_CHAT] in read['filters']
                         and ['server_seq', 'gte', 1] in read['filters']
                         and ['server_seq', 'lte', 33] in read['filters']]
        assert neighborhoods, reads
        assert all(len(read['rows']) <= 61 and any(message['id'] == OLD_ID for message in read['rows'])
                   and read['sort'] == ['server_seq', {'ascending': True}] for read in neighborhoods), neighborhoods
        # A normal live poll may append the later conversation messages before
        # this assertion. Verify the bounded locate request and the actual
        # continuous loaded range, rather than timing a transient array length.
        fixture = await page.evaluate('id=>__mock.historyRows(id)', MAIN_CHAT)
        expected = [message for message in fixture if history[0]['number'] <= message['number'] <= history[-1]['number']]
        assert history == expected, {'actual': history, 'expected': expected}
        await open_canvas()
        assert await body.input_value() == 'Не терять этот план при поиске в давней переписке'
        assert await page.evaluate('id=>__mock.canvasState[id].canvas.body', MAIN_CHAT) == LOCAL_PLAN
        await fill_plan(LOCAL_PLAN)
        checks.append('historical locate issues a bounded 61-row neighborhood request and retains a continuous timeline through live catch-up, while preserving the unsaved canvas plan')

        await open_canvas()
        await pane.locator('.pccTaskAdd').click()
        await form.locator('.pccTaskTitle').fill('Форма первого разговора')
        await form.locator('.pccTaskCancel').click()
        await page.evaluate('__mock.holdNextCanvasRead=true')
        await pane.locator('.pccRefresh').click()
        await page.wait_for_function('__mock.canvasPending.length===1')
        await page.locator('#chatBack').click()
        await open_chat(OTHER_CHAT)
        await open_canvas()
        assert await body.input_value() == OTHER_PLAN
        await page.evaluate('__mock.releaseCanvas()')
        await page.wait_for_timeout(120)
        assert await body.input_value() == OTHER_PLAN
        assert not await pane.locator('.pccTask').count()
        assert not await form.count() or not await form.is_visible()
        checks.append('a delayed first-conversation response and its task form cannot replace the second conversation canvas')

        await page.locator('#chatBack').click()
        await open_chat(MAIN_CHAT)
        await open_canvas()
        await fill_plan('Личный несохранённый черновик первого аккаунта')
        await page.evaluate('__mock.holdNextCanvasRead=true')
        await pane.locator('.pccRefresh').click()
        await page.wait_for_function('__mock.canvasPending.length===1')
        await page.evaluate('__mock.signOut()')
        await page.wait_for_function('!PablicusDebug.user')
        await page.evaluate('__mock.releaseCanvas()')
        assert await pane.is_hidden()
        await page.evaluate('(id)=>__mock.switchAccount(id)', SECOND_USER)
        await page.wait_for_function('id=>PablicusDebug.user===id', arg=SECOND_USER)
        await page.locator('.chatMain').first.wait_for()
        await open_chat(MAIN_CHAT)
        await open_canvas()
        assert await body.input_value() == LOCAL_PLAN
        assert 'Личный несохранённый черновик' not in await pane.inner_text()
        await page.locator('#conversationTab').click()
        assert await page.locator('#input').input_value() == ''
        await open_canvas()
        checks.append('logout/account switch clears local canvas/form state and late responses; the next approved participant sees shared saved data and its own empty message draft')

        # Use the same native picker and upload transport for every material kind.
        # Files are synthetic/local fixtures and the storage backend is isolated.
        materials = [
            {'name': 'project-photo.png', 'mimeType': 'image/png', 'buffer': PNG},
            {'name': 'project-video.webm', 'mimeType': 'video/webm', 'buffer': WEBM},
            {'name': 'project-audio.wav', 'mimeType': 'audio/wav', 'buffer': playable_wav()},
            {'name': 'project-notes.txt', 'mimeType': 'text/plain', 'buffer': b'WORKSPACE DOCUMENT ORIGINAL'},
        ]
        long_project = 'Съёмка сериала\n' + ('Подготовить материалы и обсудить сцену. ' * 35) + '\nhttps://example.com/brief'
        await fill_plan(long_project)
        plan_editor = pane.locator('.pccPlanEditor')
        await plan_editor.locator('input[type="file"]').set_input_files(materials)
        await plan_editor.locator('.richMedia').nth(3).wait_for()
        await page.evaluate('__mock.online=false')
        await pane.locator('.pccPlanSave').click()
        await pane.locator('.pccPlanNotice[data-state="error"]').wait_for()
        assert await plan_editor.locator('.richMedia').count() == 4
        assert 'Съёмка сериала' in await body.input_value()
        assert await page.evaluate('id=>__mock.canvasState[id].canvas.body', MAIN_CHAT) == LOCAL_PLAN
        await page.evaluate('__mock.online=true')
        await pane.locator('.pccPlanSave').click()
        await saved_plan(long_project)
        project_content = await page.evaluate('id=>__mock.canvasState[id].canvas.content', MAIN_CHAT)
        media = [block for block in project_content['blocks'] if block['type'] != 'text']
        assert {block['type'] for block in media} == {'image', 'video', 'audio', 'document'}, media
        assert all(block.get('path') and 'assetId' not in block for block in media), media
        assert all(block['size'] == len(next(file['buffer'] for file in materials if file['name'] == block['name'])) for block in media)
        assert await plan_editor.is_hidden()
        project_card = pane.locator('.pccProjectCard')
        assert await project_card.get_attribute('aria-expanded') == 'false'
        assert await project_card.evaluate('node=>node.getBoundingClientRect().height') <= 165
        project_summary = (await project_card.inner_text()).replace('\u00a0', ' ')
        assert 'Фото 1' in project_summary and 'Файлы 1' in project_summary
        await project_card.scroll_into_view_if_needed()
        await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-saved-project.png'))
        # Owner acceptance: the card itself unfolds; no duplicate preview or
        # separately scrolling detail surface may remain underneath it.
        await page.evaluate('window.__projectSurface=document.querySelector(".pccProject")')
        for width in (390, 320, 768):
            await page.set_viewport_size({'width': width, 'height': 844})
            await page.wait_for_timeout(200)
            await project_card.scroll_into_view_if_needed()
            before = await pane.locator('.pccProject').evaluate('node=>({height:node.offsetHeight,top:node.offsetTop})')
            assert before['height'] <= 165
            if width == 320:
                await project_card.focus()
                await project_card.press('Enter')
            else:
                await project_card.click()
            await pane.locator('.pccProjectViewContent a[href="https://example.com/brief"]').wait_for()
            assert await pane.locator('.pccProjectViewContent .richMessageNaturalMedia').count() == 1
            assert await pane.locator('.pccProjectViewContent .richMedia-video video').count() == 1
            await pane.locator('.pccPlanCopy').click()
            await pane.locator('.pccCopyStatus').wait_for()
            assert await project_card.get_attribute('aria-expanded') == 'true'
            assert await project_card.get_attribute('aria-label') == 'Свернуть проект'
            assert await project_card.inner_text() == ''
            for selector in ('.pccProjectTitle', '.pccProjectExcerpt', '.pccAttachmentSummary'):
                assert await project_card.locator(selector).is_hidden()
            surface = pane.locator('.pccProject')
            assert await surface.count() == 1
            assert await surface.locator('.pccProjectView').count() == 1
            assert await pane.locator('.pccPlan > .pccProjectView').count() == 0
            flow = await pane.locator('.pccProject').evaluate('''node=>{
                const project=node.getBoundingClientRect();
                const view=node.querySelector('.pccProjectView').getBoundingClientRect();
                const tasks=node.closest('.pccPlan').nextElementSibling.getBoundingClientRect();
                const media=[...node.querySelectorAll('.pccProjectViewContent .richMedia')].map(item=>{
                    const r=item.getBoundingClientRect(); return {top:r.top,bottom:r.bottom};
                });
                return {project:{top:project.top,bottom:project.bottom},
                    view:{top:view.top,bottom:view.bottom},tasks:{top:tasks.top},media};
            }''')
            assert flow['tasks']['top'] >= flow['project']['bottom'] - 1, flow
            assert all(item['top'] >= flow['view']['top'] - 1 and item['bottom'] <= flow['view']['bottom'] + 1 for item in flow['media']), flow
            assert (await surface.inner_text()).count('Съёмка сериала') == 1
            texts = await surface.locator('.pccProjectViewContent .richText').all_text_contents()
            assert texts == [block['text'] for block in project_content['blocks'] if block['type'] == 'text']
            assert await surface.locator('.pccProjectViewContent .richMedia').count() == 4
            assert await surface.evaluate('node=>node===window.__projectSurface')
            assert await project_card.evaluate('node=>document.getElementById(node.getAttribute("aria-controls"))===node.nextElementSibling')
            layout = await surface.evaluate('''node=>{
                const view=node.querySelector('.pccProjectView'), body=node.querySelector('.pccProjectViewContent');
                const r=node.getBoundingClientRect(), style=getComputedStyle(body);
                const edit=node.querySelector('.pccPlanEdit').getBoundingClientRect();
                return {height:node.offsetHeight,top:node.offsetTop,left:r.left,right:r.right,viewport:innerWidth,
                    maxHeight:style.maxHeight,overflowY:style.overflowY,bodyClient:body.clientHeight,bodyScroll:body.scrollHeight,
                    viewBackground:getComputedStyle(view).backgroundColor,editBottom:edit.bottom,cardBottom:r.bottom,
                    pageOverflow:document.documentElement.scrollWidth>innerWidth};
            }''')
            assert layout['top'] == before['top'], layout
            assert layout['height'] > 500 and layout['maxHeight'] == 'none', layout
            assert layout['overflowY'] == 'visible' and layout['bodyScroll'] <= layout['bodyClient'] + 1, layout
            assert layout['viewBackground'] == 'rgba(0, 0, 0, 0)', layout
            assert layout['editBottom'] <= layout['cardBottom'] + 1, layout
            assert layout['left'] >= 0 and layout['right'] <= width + 1 and not layout['pageOverflow'], layout
            await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-expanded-project-{width}.png'))
            await pane.locator('.pccPlanEdit').scroll_into_view_if_needed()
            assert await pane.evaluate('node=>node.scrollTop') > 0
            assert await pane.locator('.pccProjectViewContent').evaluate('node=>node.scrollTop') == 0
            # A same-revision refresh must not recreate or collapse the project.
            await page.evaluate('window.__projectRich=document.querySelector(".pccProjectViewContent").firstElementChild')
            await pane.locator('.pccRefresh').click()
            await pane.locator('.pablicusChatCanvas[data-state="ready"]').wait_for()
            assert await page.evaluate('__projectRich===document.querySelector(".pccProjectViewContent").firstElementChild')
            await project_card.scroll_into_view_if_needed()
            if width == 320:
                await project_card.focus()
                await project_card.press('Space')
            else:
                await project_card.click()
            assert await project_card.get_attribute('aria-expanded') == 'false'
            assert await surface.locator('.pccProjectView').is_hidden()
            assert not await surface.locator('.pccProjectViewContent > *').count()
            assert await surface.evaluate('node=>node.offsetHeight') <= 165
            assert await page.evaluate('id=>__mock.canvasState[id].canvas.content', MAIN_CHAT) == project_content
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_timeout(200)
        checks.append('one persistent project card unfolds in place at 320/390/768px; summary is hidden, exact full text appears once, all four attachments remain, body has no height cap or inner scroll, canvas scroll reaches Edit, keyboard disclosure and refresh retain state, collapse disposes rendered media without changing saved data')
        await page.locator('#conversationTab').click()
        await page.wait_for_function('''()=>!document.getElementById('app').classList.contains('canvas-active')
            && document.getElementById('chatCanvasPanel').hidden
            && document.getElementById('vp').getClientRects().length > 0
            && document.getElementById('composeBox').querySelector('#editor').getClientRects().length > 0''')
        assert await page.locator('#workspaceQuick').is_visible()
        await page.locator('#canvasTab').click()
        await pane.locator('.pablicusChatCanvas[data-state="ready"]').wait_for()
        checks.append('returning from the expanded canvas restores the conversation viewport and full message composer without a hidden or overlapping layer')
        await project_card.click()
        await pane.locator('.pccProjectViewContent a[href="https://example.com/brief"]').wait_for()
        await pane.locator('.pccPlanEdit').click()
        assert await plan_editor.locator('.richMedia').count() == 4
        await pane.locator('.pccPlanCancel').click()
        assert await plan_editor.is_hidden()
        assert await project_card.is_visible()
        assert await page.evaluate('id=>__mock.canvasState[id].canvas.content', MAIN_CHAT) == project_content
        checks.append('failed project upload keeps the full draft and four files; retry saves photo, playable video/audio and document plus clickable URL; saved card collapses below 165px and editing/cancel preserves server paths')

        await pane.locator('.pccTaskAdd').click()
        await form.locator('.pccTaskTitle').fill('Материалы для дела\nhttps://example.com/task')
        await form.locator('input[type="file"]').set_input_files(materials)
        await form.locator('.richMedia').nth(3).wait_for()
        await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-task-attachments.png'))
        await page.evaluate('__mock.loseCreateResponse=true')
        await form.locator('.pccTaskSave').click()
        await form.locator('.pccTaskNotice[data-state="error"]').wait_for()
        assert await form.locator('.richMedia').count() == 4
        material_task = next(item for item in await server_tasks() if item['title'].startswith('Материалы для дела'))
        objects_before = await page.evaluate('__mock.objects.size')
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        assert await page.evaluate('__mock.objects.size') == objects_before
        retry_calls = await page.evaluate('id=>__mock.canvasCalls.filter(call=>call.name==="pablicus_create_canvas_task_v3"&&call.args.p_task_id===id)', material_task['id'])
        assert len(retry_calls) == 2 and retry_calls[0]['args'] == retry_calls[1]['args']
        material_task = next(item for item in await server_tasks() if item['title'].startswith('Материалы для дела'))
        assert {block['type'] for block in material_task['content']['blocks'] if block['type'] != 'text'} == {'image', 'video', 'audio', 'document'}
        assert 'Фото 1' in (await card(material_task['id']).inner_text()).replace('\u00a0', ' ')
        assert await card(material_task['id']).evaluate('node=>node.getBoundingClientRect().height') < 180
        await card(material_task['id']).locator('.pccTaskToggle').click()
        await page.wait_for_function('([id,taskId])=>__mock.canvasState[id].tasks.find(task=>task.id===taskId).completed', arg=[MAIN_CHAT, material_task['id']])
        preserved = next(item for item in await server_tasks() if item['id'] == material_task['id'])
        assert preserved['content'] == material_task['content']
        assert await plan_editor.is_hidden()
        checks.append('calendar task saves every attachment type and URL; a lost response retries identical UUID/content without extra storage objects, the row stays compact, and completion preserves all rich blocks')

        dimensions = await pane.evaluate('(node)=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}}')
        assert dimensions['left'] >= -1 and dimensions['right'] <= dimensions['viewport'] + 1 and not dimensions['overflow'], dimensions
        await project_card.scroll_into_view_if_needed()
        await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-mobile.png'))
        assert not errors, errors
        assert not unexpected, unexpected
        assert not await page.evaluate('__mock.canvasUnknown'), await page.evaluate('__mock.canvasUnknown')
        checks.append('390px mobile canvas fits the viewport; no JavaScript errors, unexpected RPC contracts, external requests or real account writes')
        return {'engine': name, 'pass': True, 'checks': checks,
                'scope': 'built app, DOM and IndexedDB; synthetic shared state and peer commits, not live database or physical iPhone'}
    except Exception:
        EVIDENCE.mkdir(exist_ok=True)
        await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-failure.png'))
        return {'engine': name, 'pass': False, 'checks': checks,
                'error': traceback.format_exc(), 'js_errors': errors, 'unexpected_requests': unexpected,
                'rpc_diagnostics': await page.evaluate('window.__mock?.canvasUnknown||[]')}
    finally:
        await context.close()
        shutil.rmtree(directory, ignore_errors=True)


async def main(engines):
    async with async_playwright() as playwright:
        results = [await one(name, getattr(playwright, name)) for name in engines]
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / 'chat-canvas.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert all(result['pass'] for result in results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('engines', nargs='*', metavar='ENGINE')
    args = parser.parse_args()
    if any(name not in ('chromium', 'webkit') for name in args.engines):
        parser.error('engines must be chromium or webkit')
    asyncio.run(main(args.engines or ['chromium', 'webkit']))
