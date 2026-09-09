import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002';
const C='10000000-0000-4000-8000-000000000003', D='10000000-0000-4000-8000-000000000004';
const CHAT='20000000-0000-4000-8000-000000000001', OTHER='20000000-0000-4000-8000-000000000003';

test('exact canvas SQL: sharing, authorization, source validation, concurrency and replay',async t=>{
 const db=new PGlite();
 try {
  for(const file of ['schema-fixture.sql','SCHEMA_PROPOSAL.sql','REPLY_SCHEMA_PROPOSAL.sql','ACTIONS_SCHEMA_PROPOSAL.sql'])
   await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  await db.exec('ALTER TABLE public.profiles ADD COLUMN display_name text');
  await db.exec(await readFile(new URL('CANVAS_SCHEMA_PROPOSAL.sql',import.meta.url),'utf8'));
  const as=async(uid,sql,args=[],role='authenticated')=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
   await db.exec(`SET ROLE ${role}`);
   try{return(await db.query(sql,args)).rows;}finally{await db.exec('RESET ROLE');}
  };
  const call=async(name,args,{uid=A,role='authenticated'}={})=>(await as(uid,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args,role))[0].data;
  const get=(opts={})=>call('pablicus_get_canvas',[opts.chat||CHAT],opts);
  const plan=(body,revision=0,opts={})=>call('pablicus_save_canvas_plan',[opts.chat||CHAT,revision,body],opts);
  const create=(title,{id=randomUUID(),assignee=null,due=null,source=null,block=null,...opts}={})=>call('pablicus_create_canvas_task',[opts.chat||CHAT,id,title,assignee,due,source,block],opts);
  const update=(task,{revision=task.revision,title=task.title,assignee=task.assignee_id,due=task.due_date,completed=task.completed,...opts}={})=>
   call('pablicus_update_canvas_task',[opts.chat||CHAT,task.id,revision,title,assignee,due,completed],opts);
  const remove=(task,opts={})=>call('pablicus_delete_canvas_task',[opts.chat||CHAT,task.id,opts.revision??task.revision],opts);
  const taskOf=(state,id)=>state.tasks.find(x=>x.id===id);
  const insert=async(chat,type,body,metadata=null)=>(await db.query(`insert into public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_metadata)
   values(gen_random_uuid(),$1,(select coalesce(max(server_seq),0)+1 from public.messages where conversation_id=$1),$2,$3,$4,$5::jsonb) returning id`,[chat,A,type,body,JSON.stringify(metadata)])).rows[0].id;
  const source=await insert(CHAT,'text','An agreed plan');
  const rich=await insert(CHAT,'rich','Photo and text',{v:1,blocks:[{id:'text_1',type:'text',text:'Discuss this'},
   {id:'voice_1',type:'audio',path:`${CHAT}/${A}/voice.webm`,name:'voice.webm',mime:'audio/webm',size:30,duration:3}]});
  const foreign=await insert(OTHER,'text','Private other source');
  let created,edited;

  await t.test('read gives an empty shared canvas and only approved participants without creating rows',async()=>{
   const state=await get();
   assert.equal(state.conversation_id,CHAT);assert.equal(state.revision,0);
   assert.deepEqual(state.canvas,{body:'',revision:0,updated_at:null,updated_by:null});assert.deepEqual(state.tasks,[]);
   assert.deepEqual(state.participants.map(p=>p.id),[A,B]);
   assert.equal((await db.query('select count(*) from pablicus_chat_private.conversation_canvases')).rows[0].count,0);
  });
  await t.test('both participants share a plan and competing stale edits do not overwrite',async()=>{
   const a=await plan('Studio plan\nMeet at 15:00');assert.equal(a.canvas.revision,1);assert.equal(a.canvas.updated_by,A);
   assert.deepEqual((await get({uid:B})).canvas,a.canvas);
   await assert.rejects(plan('B stale',0,{uid:B}),{code:'40001',message:'canvas_revision_conflict'});
   const b=await plan('Studio plan\nMeet at 16:00',1,{uid:B});assert.equal(b.canvas.updated_by,B);assert.equal(b.canvas.revision,2);
   assert.deepEqual((await plan(b.canvas.body,1)).canvas,b.canvas);
   assert.equal((await get()).revision,2);
  });
  await t.test('null/oversized plans and negative revisions are rejected; clearing is supported',async()=>{
   for(const body of [null,'x'.repeat(20001)])await assert.rejects(plan(body,2),{code:'22023'});
   await assert.rejects(plan('valid',-1),{code:'22023'});
   assert.equal((await plan('',2)).canvas.revision,3);
  });
  await t.test('task creation exposes no replay internals and does not modify plan revision',async()=>{
   const state=await create('  Book studio  ',{assignee:B,due:'2026-10-01',source});created=state.tasks.at(-1);
   assert.equal(created.title,'Book studio');assert.equal(created.assignee_id,B);assert.equal(created.due_date,'2026-10-01');
   assert.equal(created.source_message_id,source);assert.equal(created.completed,false);assert.equal(created.revision,0);
   assert.equal(state.canvas.revision,3);assert.equal(state.revision,4);
   assert.ok(!('create_payload'in created));assert.ok(!('deleted_at'in created));
   assert.deepEqual(taskOf(await get({uid:B}),created.id),created);
  });
  await t.test('source rich text and voice blocks are accepted, with same-chat existence checks',async()=>{
   for(const block of ['text_1','voice_1']){
    const state=await create('From '+block,{source:rich,block});assert.equal(state.tasks.at(-1).source_block_id,block);
   }
   await assert.rejects(create('bad',{source:foreign}),{code:'42501'});
   await assert.rejects(create('bad',{source:randomUUID()}),{code:'42501'});
   for(const opts of [{block:'text_1'},{source:rich,block:'missing'},{source:rich,block:'<bad>'},{source,block:'text_1'}])
    await assert.rejects(create('bad',opts),{code:'22023'});
  });
  await t.test('new tasks reject blank/oversized titles, outsiders, suspended assignees and invalid dates',async()=>{
   for(const title of [null,'','   ','x'.repeat(501),'🙂'.repeat(500)+' '])await assert.rejects(create(title),{code:'22023'});
   for(const assignee of [C,D,randomUUID()])await assert.rejects(create('bad assignee',{assignee}),{code:'22023'});
   for(const due of ['1899-12-31','10000-01-01','infinity','-infinity'])await assert.rejects(create('bad date',{due}),{code:'22023'});
  });
  await t.test('a peer can edit, assign, complete and reopen a shared task',async()=>{
   edited=taskOf(await update(created,{title:'Book larger studio',completed:true,assignee:A,due:null,uid:B}),created.id);
   assert.equal(edited.revision,1);assert.equal(edited.updated_by,B);assert.equal(edited.completed,true);
   edited=taskOf(await update(edited,{completed:false}),created.id);
   assert.equal(edited.revision,2);assert.equal(edited.completed,false);assert.equal(edited.assignee_id,A);
   assert.equal(edited.source_message_id,source);
  });
  await t.test('stale competing updates/deletes fail and same-value retry is a no-op',async()=>{
   await assert.rejects(update(created,{title:'stale change'}),{code:'40001',message:'task_revision_conflict'});
   await assert.rejects(remove(created),{code:'40001',message:'task_revision_conflict'});
   const before=await get();const after=await update(edited,{revision:0});assert.deepEqual(after,before);
   await assert.rejects(update(edited,{title:null}),{code:'22023'});
   await assert.rejects(update(edited,{completed:null}),{code:'22023'});
  });
  await t.test('creation replay after peer edits returns current task without overwriting or duplicating',async()=>{
   const before=await get();
   const after=await create('  Book studio  ',{id:created.id,assignee:B,due:'2026-10-01',source});
   assert.deepEqual(after,before);assert.equal(taskOf(after,created.id).title,'Book larger studio');
   for(const opts of [{id:created.id},{id:created.id,assignee:B,due:'2026-10-01',source,uid:B},
    {id:created.id,assignee:B,due:'2026-10-01',source,chat:OTHER}])
    await assert.rejects(create('  Book studio  ',opts),{code:'23505'});
  });
  await t.test('delete hides task, replay cannot resurrect it, update cannot resurrect it',async()=>{
   const deleted=await remove(edited,{uid:B});assert.equal(taskOf(deleted,created.id),undefined);
   assert.deepEqual(await remove(edited),deleted);
   assert.deepEqual(await create('  Book studio  ',{id:created.id,assignee:B,due:'2026-10-01',source}),deleted);
   await assert.rejects(update(edited,{title:'resurrect'}),{code:'22023'});
  });
  await t.test('deleting a source blocks new references but preserves original creation replay',async()=>{
   const s=await insert(CHAT,'text','Temporary source');const id=randomUUID();
   await create('Saved task',{id,source:s});await as(A,'select public.delete_message($1,$2,0)',[CHAT,s]);
   await assert.rejects(create('New stale source',{source:s}),{code:'22023'});
   assert.equal(taskOf(await create('Saved task',{id,source:s}),id).title,'Saved task');
  });
  await t.test('every endpoint rejects outsiders, suspended accounts, missing identity and anon',async()=>{
   const sqls=[['pablicus_get_canvas',[CHAT]],['pablicus_save_canvas_plan',[CHAT,0,'x']],
    ['pablicus_create_canvas_task',[CHAT,randomUUID(),'x',null,null,null,null]],
    ['pablicus_update_canvas_task',[CHAT,created.id,0,'x',null,null,false]],['pablicus_delete_canvas_task',[CHAT,created.id,0]]];
   for(const [name,args]of sqls)for(const opts of [{uid:C},{uid:D},{uid:null},{uid:null,role:'anon'}])
    await assert.rejects(call(name,args,opts),{code:'42501'});
  });
  await t.test('cross-chat task updates and deletes are denied even to a member of both chats',async()=>{
   await assert.rejects(update(edited,{chat:OTHER}),{code:'42501'});await assert.rejects(remove(edited,{chat:OTHER}),{code:'42501'});
   const isolated=await get({chat:OTHER});assert.deepEqual(isolated.tasks,[]);assert.equal(isolated.canvas.body,'');
  });
  await t.test('removing membership immediately rejects all operations including saved replay',async()=>{
   const id=randomUUID();const task=taskOf(await create('Retry owner B',{id,uid:B}),id);
   await db.query('delete from public.conversation_members where conversation_id=$1 and user_id=$2',[CHAT,B]);
   for(const run of [()=>get({uid:B}),()=>plan('x',3,{uid:B}),()=>create('Retry owner B',{id,uid:B}),
    ()=>update(task,{uid:B}),()=>remove(task,{uid:B})])await assert.rejects(run(),{code:'42501'});
   await assert.rejects(create('assign removed',{assignee:B}),{code:'22023'});
   assert.deepEqual((await get()).participants.map(p=>p.id),[A]);
   await db.query('insert into public.conversation_members(conversation_id,user_id) values($1,$2)',[CHAT,B]);
   assert.equal(taskOf(await create('Retry owner B',{id,uid:B}),id).title,'Retry owner B');
  });
  await t.test('revoking approval immediately rejects identical retries for existing members',async()=>{
   const id=randomUUID();const task=taskOf(await create('Approval retry',{id,uid:B}),id);
   await db.query('update public.profiles set is_approved=false where id=$1',[B]);
   for(const run of [()=>get({uid:B}),()=>plan('',0,{uid:B}),()=>create('Approval retry',{id,uid:B}),
    ()=>update(task,{uid:B}),()=>remove(task,{uid:B})])await assert.rejects(run(),{code:'42501'});
   await db.query('update public.profiles set is_approved=true where id=$1',[B]);
  });
  await t.test('private tables/helpers cannot be called directly; invokers and guard paths are pinned',async()=>{
   for(const table of ['conversation_canvases','canvas_tasks'])
    await assert.rejects(as(A,`select * from pablicus_chat_private.${table}`),{code:'42501'});
   for(const query of ['select pablicus_chat_private.canvas_snapshot($1)','select pablicus_chat_private.lock_canvas($1)',
    "select pablicus_chat_private.validate_canvas_task($1,'title',null,null)"])
    await assert.rejects(as(A,query,[CHAT]),{code:'42501'});
   const defs=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('pablicus_get_canvas','pablicus_save_canvas_plan','pablicus_create_canvas_task','pablicus_update_canvas_task','pablicus_delete_canvas_task','get_canvas','save_canvas_plan','create_canvas_task','update_canvas_task','delete_canvas_task')")).rows;
   assert.equal(defs.length,10);for(const def of defs){assert.equal(def.prosecdef,def.nspname==='pablicus_chat_private');assert.ok(def.proconfig.includes('search_path=""'));}
   // A callable guarded private endpoint must enforce the same boundary.
   await assert.rejects(as(C,'select pablicus_chat_private.get_canvas($1)',[CHAT]),{code:'42501'});
  });
  await t.test('200-task bound never truncates data; deletion frees capacity, completed tasks count',async()=>{
   const chat=OTHER;
   await db.query(`insert into pablicus_chat_private.canvas_tasks(id,conversation_id,title,completed,created_by,updated_by,create_payload)
    select gen_random_uuid(),$1,'Task '||n,n%2=0,$2,$2,'{}'::jsonb from generate_series(1,199)n`,[chat,A]);
   const id=randomUUID();const full=await create('Last allowed',{chat,id});assert.equal(full.tasks.length,200);
   await assert.rejects(create('Too many',{chat}),{code:'22023',message:'canvas_task_limit'});
   assert.deepEqual(await create('Last allowed',{chat,id}),full);
   await remove(taskOf(full,id),{chat});assert.equal((await create('Room after delete',{chat})).tasks.length,200);
   assert.equal(taskOf(await create('Last allowed',{chat,id}),id),undefined);
  });
  await t.test('an update to one task does not conflict with another task or plan',async()=>{
   const first=(await get()).tasks[0],second=(await get()).tasks[1],before=await get();
   await update(first,{title:'Independent 1'});await update(second,{title:'Independent 2',uid:B});
   const after=await plan('Plan independent from tasks',before.canvas.revision,{uid:B});
   assert.equal(taskOf(after,first.id).title,'Independent 1');assert.equal(taskOf(after,second.id).title,'Independent 2');
   assert.equal(after.revision,before.revision+3);
  });
 }finally{await db.close();}
});
