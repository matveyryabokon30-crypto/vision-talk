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
import shutil
import tempfile
import traceback
from urllib.parse import urlparse

from playwright.async_api import async_playwright

from message_interactions import (DIST, EVIDENCE, MAIN_CHAT, OTHER_CHAT, PEER,
                                  SECOND_USER, TEXT_ID, USER, incoming, mocked_sdk)
from rich_message_integration import MOCK_MIC

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
      assignee_id:peer,due_date:'2026-09-11',completed:false,revision:1,
      source_message_id:null,source_block_id:null,
      created_at:canvasNow(),created_by:peer,updated_at:canvasNow(),updated_by:peer});
    __mock.peerPlan=body=>{const state=__mock.canvasState[chat];
      state.canvas={body,revision:state.canvas.revision+1,updated_at:canvasNow(),updated_by:peer};state.revision++;};
    __mock.peerTask=(id,title)=>{const state=__mock.canvasState[chat],task=state.tasks.find(t=>t.id===id);
      if(!task)throw Error('Unknown synthetic peer task');
      task.title=title;task.updated_by=peer;task.updated_at=canvasNow();task.revision++;state.revision++;};
    const canvasKeys={
      pablicus_get_canvas:['p_conversation_id'],
      pablicus_save_canvas_plan:['p_conversation_id','p_expected_revision','p_body'],
      pablicus_create_canvas_task:['p_conversation_id','p_task_id','p_title','p_assignee_id','p_due_date','p_source_message_id','p_source_block_id'],
      pablicus_update_canvas_task:['p_conversation_id','p_task_id','p_expected_revision','p_title','p_assignee_id','p_due_date','p_completed'],
      pablicus_delete_canvas_task:['p_conversation_id','p_task_id','p_expected_revision']
    };
    const canvasError=(code,message)=>({data:null,error:{code,message}});
    const canvasRpc=(name,args)=>{
      const expected=canvasKeys[name],actual=Object.keys(args).sort();
      if(JSON.stringify(actual)!==JSON.stringify([...expected].sort())){
        __mock.canvasUnknown.push({name,args,reason:'unexpected argument shape'});
        return canvasError('22023','Unexpected canvas arguments');
      }
      __mock.canvasCalls.push({name,args:structuredClone(args),actor:user.id});
      const state=__mock.canvasState[args.p_conversation_id];
      if(!state||__mock.canvasDenied||!state.participants.some(p=>p.id===user.id))
        return canvasError('42501','canvas_access_denied');
      if(name==='pablicus_get_canvas'){
        const response={data:structuredClone(state),error:null};
        if(__mock.holdNextCanvasRead){__mock.holdNextCanvasRead=false;
          return new Promise(resolve=>__mock.canvasPending.push(()=>resolve(response)));}
        return response;
      }
      if(name==='pablicus_save_canvas_plan'){
        if(args.p_expected_revision!==state.canvas.revision)return canvasError('40001','canvas_revision_conflict');
        state.canvas={body:args.p_body,revision:state.canvas.revision+1,updated_at:canvasNow(),updated_by:user.id};
      }else if(name==='pablicus_create_canvas_task'){
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
        state.tasks.push({id:args.p_task_id,title:args.p_title,assignee_id:args.p_assignee_id,
          due_date:args.p_due_date,completed:false,revision:1,
          source_message_id:args.p_source_message_id,source_block_id:args.p_source_block_id,
          created_at:canvasNow(),created_by:user.id,updated_at:canvasNow(),updated_by:user.id});
      }else{
        const task=state.tasks.find(t=>t.id===args.p_task_id);
        if(!task||task.revision!==args.p_expected_revision)return canvasError('40001','task_revision_conflict');
        if(name==='pablicus_delete_canvas_task')state.tasks=state.tasks.filter(t=>t.id!==task.id);
        else Object.assign(task,{title:args.p_title,assignee_id:args.p_assignee_id,due_date:args.p_due_date,
          completed:args.p_completed,revision:task.revision+1,updated_at:canvasNow(),updated_by:user.id});
      }
      state.revision++;
      if(name==='pablicus_create_canvas_task'&&__mock.loseCreateResponse){__mock.loseCreateResponse=false;
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
        'start_direct_conversation','start_saved_conversation','send_message',
        'send_attachment_message','send_rich_message'].includes(name)){
        __mock.canvasUnknown.push({name,args,reason:'unexpected RPC'});
        return result(null,{code:'PGRST202',message:'Unexpected RPC '+name});
      }
    ''')
    return source


async def one(name, engine):
    directory = tempfile.mkdtemp(prefix='pablicus-chat-canvas-')
    context = await engine.launch_persistent_context(directory, headless=True,
        viewport={'width': 390, 'height': 844}, has_touch=True,
        service_workers='block', accept_downloads=True)
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
    form = pane.locator('.pccTaskForm')

    async def open_chat(chat_id):
        await page.locator('.chatMain').filter(has_text='@qa_peer' if chat_id == MAIN_CHAT else 'Соседний QA чат').click()
        await page.wait_for_function("id=>PablicusChat?.scope?.chat===id && PablicusChat?.store && PablicusChat?.list && !document.getElementById('app').inert && document.getElementById('app').style.visibility!=='hidden'", arg=chat_id)

    async def open_canvas():
        await page.locator('#canvasTab').click()
        await pane.locator('.pablicusChatCanvas[data-state="ready"]').wait_for()

    async def server_tasks():
        return await page.evaluate('id=>structuredClone(__mock.canvasState[id].tasks)', MAIN_CHAT)

    async def saved_plan(value):
        await page.wait_for_function('([id,value])=>__mock.canvasState[id].canvas.body===value', arg=[MAIN_CHAT, value])
        await pane.locator('.pccPlanNotice[data-state="saved"]').wait_for()

    def card(task_id):
        return pane.locator(f'.pccTask[data-task-id="{task_id}"]')

    try:
        EVIDENCE.mkdir(exist_ok=True)
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
        await body.fill('Общий план: съёмка в пятницу')
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
        await form.locator('.pccTaskTitle').fill('Забронировать студию')
        options = await form.locator('.pccTaskAssignee option').evaluate_all('(nodes)=>nodes.map(n=>({value:n.value,text:n.textContent}))')
        assert any(option['value'] == PEER and 'Катя' in option['text'] for option in options), options
        await form.locator('.pccTaskAssignee').select_option(PEER)
        await form.locator('.pccTaskDate').fill('2026-09-11')
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        task = next(task for task in await server_tasks() if task['title'] == 'Забронировать студию')
        assert task['assignee_id'] == PEER and task['due_date'] == '2026-09-11'
        assert task['created_by'] == USER and not task['completed']
        await card(task['id']).locator('.pccTaskToggle').click()
        await page.wait_for_function('([id,taskId])=>__mock.canvasState[id].tasks.find(t=>t.id===taskId)?.completed', arg=[MAIN_CHAT, task['id']])
        assert await card(task['id']).locator('.pccTaskToggle').get_attribute('aria-pressed') == 'true'
        await card(task['id']).locator('.pccTaskToggle').click()
        await page.wait_for_function('([id,taskId])=>!__mock.canvasState[id].tasks.find(t=>t.id===taskId)?.completed', arg=[MAIN_CHAT, task['id']])
        await card(task['id']).locator('.pccTaskEdit').click()
        await form.locator('.pccTaskTitle').fill('Студия «Свет» забронирована')
        await form.locator('.pccTaskAssignee').select_option('')
        await form.locator('.pccTaskDate').fill('')
        await form.locator('.pccTaskSave').click()
        await form.wait_for(state='hidden')
        updated = next(item for item in await server_tasks() if item['id'] == task['id'])
        assert updated['title'] == 'Студия «Свет» забронирована' and updated['assignee_id'] is None and updated['due_date'] is None
        await card(task['id']).locator('.pccTaskEdit').click()
        await form.locator('.pccTaskDelete').click()
        assert any(item['id'] == task['id'] for item in await server_tasks())
        await form.locator('.pccTaskDeleteConfirm').click()
        await card(task['id']).wait_for(state='hidden')
        assert not any(item['id'] == task['id'] for item in await server_tasks())
        checks.append('tasks can be created with participant/date, completed, reopened, edited including clearing optional fields, and removed only after explicit confirmation')

        await body.fill(LOCAL_PLAN)
        await page.evaluate('(text)=>__mock.peerPlan(text)', PEER_PLAN)
        await pane.locator('.pccPlanSave').click()
        await pane.locator('.pccPlanConflict').wait_for()
        assert await body.input_value() == LOCAL_PLAN
        assert PEER_PLAN in await pane.locator('.pccPlanServerBody').inner_text()
        assert await page.evaluate('id=>__mock.canvasState[id].canvas.body', MAIN_CHAT) == PEER_PLAN
        await page.screenshot(path=str(EVIDENCE / f'chat-canvas-{name}-plan-conflict.png'))
        await pane.locator('.pccPlanReplace').click()
        await saved_plan(LOCAL_PLAN)
        plan_calls = await page.evaluate('__mock.canvasCalls.filter(call=>call.name==="pablicus_save_canvas_plan")')
        assert plan_calls[-1]['args']['p_expected_revision'] > plan_calls[-2]['args']['p_expected_revision']
        checks.append('a peer plan commit causes a revision conflict; the local text survives, fresh server text is shown and only explicit replacement writes the new revision')

        await card(TASK_ID).locator('.pccTaskEdit').click()
        await form.locator('.pccTaskTitle').fill('Мой вариант задачи')
        await page.evaluate('([id,text])=>__mock.peerTask(id,text)', [TASK_ID, 'Катя уже изменила задачу'])
        await form.locator('.pccTaskSave').click()
        await form.locator('.pccTaskReplace').wait_for()
        assert await form.locator('.pccTaskTitle').input_value() == 'Мой вариант задачи'
        assert next(item for item in await server_tasks() if item['id'] == TASK_ID)['title'] == 'Катя уже изменила задачу'
        await form.locator('.pccTaskReplace').click()
        await form.wait_for(state='hidden')
        assert next(item for item in await server_tasks() if item['id'] == TASK_ID)['title'] == 'Мой вариант задачи'
        checks.append('editing a stale task never silently overwrites the other participant; explicit conflict resolution preserves and then saves the local form')

        await page.evaluate('__mock.loseCreateResponse=true')
        await pane.locator('.pccTaskAdd').click()
        await form.locator('.pccTaskTitle').fill('Создать ровно один раз')
        await form.locator('.pccTaskSave').click()
        await page.wait_for_function('id=>__mock.canvasState[id].tasks.some(t=>t.title==="Создать ровно один раз")', arg=MAIN_CHAT)
        await page.wait_for_function("()=>!document.querySelector('.pccTaskSave')?.disabled")
        assert await form.is_visible()
        retry_task = next(item for item in await server_tasks() if item['title'] == 'Создать ровно один раз')
        await form.locator('.pccTaskTitle').fill('Уточнить задачу после потери ответа')
        await form.locator('.pccTaskSave').click()
        await pane.locator(f'.pccTaskForm[data-task-id="{retry_task["id"]}"]').wait_for()
        assert await form.locator('.pccTaskTitle').input_value() == 'Уточнить задачу после потери ответа'
        assert len([item for item in await server_tasks() if item['title'] == 'Создать ровно один раз']) == 1
        create_calls = await page.evaluate('__mock.canvasCalls.filter(call=>call.name==="pablicus_create_canvas_task"&&call.args.p_title==="Создать ровно один раз")')
        assert len(create_calls) == 2 and create_calls[0]['args'] == create_calls[1]['args'], create_calls
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
        await page.locator('#vp').evaluate('(node)=>node.scrollTop=node.scrollHeight')
        await page.evaluate('PablicusDebug.syncMessages()')
        await page.wait_for_function('seq=>__mock.readCalls.some(call=>call.p_last_read_seq>=seq)', arg=incoming_message['server_seq'])
        checks.append('incoming text is not marked read while the conversation canvas hides the message timeline; returning to the conversation allows the normal read marker')

        await page.locator('#chatBack').click()
        await page.evaluate('__mock.expandHistory()')
        await open_chat(MAIN_CHAT)
        assert not await page.locator(f'#canvas .row[data-id="{OLD_ID}"]').count()
        await open_canvas()
        await body.fill('Не терять этот план при поиске в давней переписке')
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
        await body.fill(LOCAL_PLAN)
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
        await body.fill('Личный несохранённый черновик первого аккаунта')
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

        dimensions = await pane.evaluate('(node)=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}}')
        assert dimensions['left'] >= -1 and dimensions['right'] <= dimensions['viewport'] + 1 and not dimensions['overflow'], dimensions
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
