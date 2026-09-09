import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../chat-workspace/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',C='10000000-0000-4000-8000-000000000003';
const CHAT='20000000-0000-4000-8000-000000000001',FOREIGN='20000000-0000-4000-8000-000000000002';
const sub=(user_id,tag)=>({user_id,endpoint:'https://web.push.apple.com/'+tag,p256dh:'B'.repeat(87),auth:'a'.repeat(22)});
test('durable task reminders: exact SQL scheduler and existing push worker',async t=>{
 const db=new PGlite();
 try{
  for(const f of ['schema-fixture.sql','SCHEMA_PROPOSAL.sql','REPLY_SCHEMA_PROPOSAL.sql','ACTIONS_SCHEMA_PROPOSAL.sql'])await db.exec(await readFile(new URL('../chat-workspace/'+f,import.meta.url),'utf8'));
  await db.exec('ALTER TABLE profiles ADD COLUMN display_name text;ALTER TABLE profiles ADD COLUMN email text');
  for(const f of ['CANVAS_SCHEMA_PROPOSAL.sql','TASKS_SCHEMA_PROPOSAL.sql','TASK_LIFECYCLE_SCHEMA_PROPOSAL.sql'])await db.exec(await readFile(new URL('../chat-workspace/'+f,import.meta.url),'utf8'));
  await db.exec(`CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
   CREATE SCHEMA extensions; CREATE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS $$SELECT decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex')$$;
   CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
   GRANT USAGE ON SCHEMA extensions TO service_role;
   CREATE SCHEMA net; CREATE TABLE net.calls(id bigint GENERATED ALWAYS AS IDENTITY,url text,body jsonb,headers jsonb);
   CREATE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$DECLARE v bigint;BEGIN INSERT INTO net.calls(url,body,headers) VALUES(url,body,headers) RETURNING id INTO v;RETURN v;END$$;
  `);
  for(const f of ['SCHEMA_PROPOSAL.sql','WORKER_CAPABILITIES.sql','NET_HARDENING.sql','TASK_REMINDERS_SCHEMA_PROPOSAL.sql'])await db.exec(await readFile(new URL(f,import.meta.url),'utf8'));
  const rpc=async(action,input={},role='service_role')=>{await db.exec('SET ROLE '+role);try{return(await db.query('select public.pablicus_push_rpc($1,$2::jsonb) as value',[action,JSON.stringify(input)])).rows[0].value;}finally{await db.exec('RESET ROLE');}};
  const reset=async()=>{await db.exec('DELETE FROM pablicus_chat_private.canvas_tasks;DELETE FROM pablicus_push_private.outbox;DELETE FROM pablicus_push_private.subscriptions;DELETE FROM net.calls;');await rpc('subscribe',sub(A,'a'));await rpc('subscribe',sub(B,'b'));await rpc('subscribe',sub(C,'c'));};
  const task=async({assignee=B,offset=59,reminder=60,followup=180,chat=CHAT,title='Синтетическое тестовое дело'}={})=>(await db.query(`INSERT INTO pablicus_chat_private.canvas_tasks(id,conversation_id,title,assignee_id,due_date,due_at,due_timezone,reminder_minutes,followup_minutes,create_payload)
   VALUES(gen_random_uuid(),$1,$2,$3,((now()+make_interval(mins=>$4)) AT TIME ZONE 'Europe/Moscow')::date,now()+make_interval(mins=>$4),'Europe/Moscow',$5,$6,'{}') RETURNING *`,[chat,title,assignee,offset,reminder,followup])).rows[0];
  const finish=async(job,status=201)=>rpc('finish',{id:job.id,lease:job.lease,status});
  const events=async()=>(await db.query('SELECT * FROM pablicus_push_private.task_events ORDER BY kind,recipient_id')).rows;
  await t.test('browser roles cannot access events, deliveries or invoke privileged scheduler/claims',async()=>{
   for(const role of ['anon','authenticated']){
    await assert.rejects(rpc('claim',{},role),{code:'42501'});
    await db.exec('SET ROLE '+role);
    try{for(const sql of ['select * from pablicus_push_private.task_events','select * from pablicus_push_private.task_deliveries','select pablicus_push_private.claim_tasks(25)','select pablicus_push_private.maintenance()'])await assert.rejects(db.query(sql),{code:'42501'});}finally{await db.exec('RESET ROLE');}
   }
   const defs=(await db.query(`select p.proname,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pablicus_push_private' and p.proname in ('schedule_task','prepare_task_deliveries','claim_tasks','finish_task','task_event_valid','claim_messages','maintenance')`)).rows;
   assert.equal(defs.length,7);for(const d of defs){assert.equal(d.anon,false);assert.equal(d.authenticated,false);assert.ok(d.proconfig.includes('search_path=""'));}
  });
  await t.test('UTC instants schedule one hour before and three hours after; no early dispatch',async()=>{
   await reset();const row=await task({offset:120});const es=await events();assert.equal(es.length,2);assert.ok(es.every(x=>x.recipient_id===B));
   assert.equal(+es.find(x=>x.kind==='task_reminder').run_at,+row.due_at-60*60*1000);
   assert.equal(+es.find(x=>x.kind==='task_followup').run_at,+row.due_at+180*60*1000);
   assert.deepEqual(await rpc('claim'),[]);await db.exec('select pablicus_push_private.maintenance()');assert.equal((await db.query('select count(*)::int n from net.calls')).rows[0].n,0);
  });
  await t.test('due reminder selects responsible member only, latest title, private encrypted-payload fields and stable identity',async()=>{
   await reset();const row=await task();await db.query("UPDATE pablicus_chat_private.canvas_tasks SET title='Обновлённое тестовое название' WHERE id=$1",[row.id]);
   const [job]=await rpc('claim');assert.equal(job.payload.kind,'task_reminder');assert.equal(job.payload.task_id,row.id);assert.equal(job.payload.conversation_id,CHAT);assert.equal(job.payload.recipient_id,B);assert.match(job.payload.body,/Обновлённое тестовое название/);assert.match(job.payload.body,/\d\d\.\d\d в \d\d:\d\d/);assert.ok(job.payload.expires_at);assert.equal(job.subscription.endpoint,sub(B,'b').endpoint);assert.equal(JSON.stringify(job).includes('privateJwk'),false);
   assert.deepEqual(await rpc('claim'),[]);await finish({...job,lease:'00000000-0000-0000-0000-000000000000'});assert.equal((await db.query('select state from pablicus_push_private.task_deliveries')).rows[0].state,'sending');
   await finish(job,503);assert.deepEqual(await rpc('claim'),[]);await db.query("update pablicus_push_private.task_deliveries set due_at=now()-interval '1 second' where id=$1",[job.id]);
   const [retry]=await rpc('claim');assert.notEqual(retry.lease,job.lease);assert.equal(retry.payload.notification_id,job.payload.notification_id);await finish(retry);assert.deepEqual(await rpc('claim'),[]);
  });
  await t.test('unassigned task notifies approved participants on each subscribed device, never outsiders',async()=>{
   await reset();await rpc('subscribe',sub(A,'a2'));await task({assignee:null});const jobs=await rpc('claim');assert.equal(jobs.length,3);assert.deepEqual([...new Set(jobs.map(x=>x.payload.recipient_id))].sort(),[A,B]);assert.equal(new Set(jobs.filter(x=>x.payload.recipient_id===A).map(x=>x.payload.notification_id)).size,1);assert.deepEqual(await rpc('claim'),[]);
  });
  await t.test('three-hour followup asks status once without automatically changing or archiving task',async()=>{
   await reset();const row=await task({offset:-181});const jobs=await rpc('claim');assert.equal(jobs.length,1);const [job]=jobs;assert.equal(job.payload.kind,'task_followup');assert.equal(job.payload.title,'Удалось завершить дело?');assert.match(job.payload.body,/Отметьте выполнение или перенесите срок/);await finish(job);await db.exec('select pablicus_push_private.maintenance()');assert.deepEqual(await rpc('claim'),[]);
   const saved=(await db.query('select completed,archived_at from pablicus_chat_private.canvas_tasks where id=$1',[row.id])).rows[0];assert.equal(saved.completed,false);assert.equal(saved.archived_at,null);
  });
  await t.test('reschedule cancels pending and leased reminders; late old finish cannot resurrect them',async()=>{
   await reset();const row=await task();const [job]=await rpc('claim');await db.query("update pablicus_chat_private.canvas_tasks set due_at=due_at+interval '1 day' where id=$1",[row.id]);await finish(job,503);assert.deepEqual(await rpc('claim'),[]);
   assert.equal((await db.query('select state from pablicus_push_private.task_deliveries where id=$1',[job.id])).rows[0].state,'dead');
   const es=await events();assert.equal(es.filter(x=>x.state==='cancelled').length,2);assert.equal(es.filter(x=>x.state==='pending').length,2);assert.ok(es.filter(x=>x.state==='pending').every(x=>Number(x.schedule_version)===Number(row.schedule_version)+1));
  });
  await t.test('completion, archive, permanent removal and reminders-off each prevent later dispatch',async()=>{
   for(const update of ["completed=true","archived_at=now()","deleted_at=now()","reminder_minutes=null,followup_minutes=null"]){await reset();const row=await task();await db.query(`update pablicus_chat_private.canvas_tasks set ${update} where id=$1`,[row.id]);assert.deepEqual(await rpc('claim'),[]);assert.ok((await events()).every(x=>x.state==='cancelled'));}
   await reset();const row=await task();await db.query('delete from pablicus_chat_private.canvas_tasks where id=$1',[row.id]);assert.equal((await events()).length,0);assert.deepEqual(await rpc('claim'),[]);
  });
  await t.test('membership removal and approval revocation are rechecked when worker claims',async()=>{
   for(const mode of ['membership','approval']){await reset();await task();await db.exec('select pablicus_push_private.prepare_task_deliveries()');
    if(mode==='membership')await db.query('delete from conversation_members where conversation_id=$1 and user_id=$2',[CHAT,B]);else await db.query('update profiles set is_approved=false where id=$1',[B]);
    assert.deepEqual(await rpc('claim'),[]);assert.ok((await events()).every(x=>x.state==='cancelled'));
    if(mode==='membership')await db.query('insert into conversation_members(conversation_id,user_id) values($1,$2)',[CHAT,B]);else await db.query('update profiles set is_approved=true where id=$1',[B]);
   }
  });
  await t.test('subscription account rebind never delivers old recipient task to new account',async()=>{
   await reset();await task();await db.exec('select pablicus_push_private.prepare_task_deliveries()');await rpc('subscribe',sub(C,'b'));assert.deepEqual(await rpc('claim'),[]);assert.equal((await db.query('select state from pablicus_push_private.task_deliveries')).rows[0].state,'dead');
  });
  await t.test('reminder expiry stops retries; old schedules never produce stale notifications',async()=>{
   await reset();await task({offset:-2,followup:null});assert.equal((await events()).length,0);await task({offset:-1621,reminder:null});assert.equal((await events()).length,0);assert.deepEqual(await rpc('claim'),[]);
   const row=await task();const [job]=await rpc('claim');await finish(job,503);await db.query("update pablicus_push_private.task_events set expires_at=now()-interval '1 second' where id=$1",[job.payload.notification_id]);await db.query("update pablicus_push_private.task_deliveries set due_at=now()-interval '1 second' where id=$1",[job.id]);assert.deepEqual(await rpc('claim'),[]);
  });
  await t.test('late device subscribe can receive a due but unexpired event once; expired endpoint is removed',async()=>{
   await reset();await rpc('unsubscribe',{user_id:B,endpoint:sub(B,'b').endpoint});await task();assert.deepEqual(await rpc('claim'),[]);await rpc('subscribe',sub(B,'new'));const [job]=await rpc('claim');assert.ok(job);await finish(job,410);assert.equal((await db.query('select count(*)::int n from pablicus_push_private.subscriptions where user_id=$1',[B])).rows[0].n,0);assert.deepEqual(await rpc('claim'),[]);
  });
  await t.test('unsubscribed pending events cannot starve a later subscribed recipient',async()=>{
   await reset();await rpc('unsubscribe',{user_id:B,endpoint:sub(B,'b').endpoint});
   for(let n=0;n<100;n++)await task({offset:10,assignee:B});
   const mine=await task({offset:59,assignee:A});const jobs=await rpc('claim');assert.equal(jobs.length,1);assert.equal(jobs[0].payload.task_id,mine.id);assert.equal(jobs[0].payload.recipient_id,A);
   assert.equal((await db.query("select count(*)::int n from pablicus_push_private.task_events where recipient_id=$1 and kind='task_reminder' and state='pending'",[B])).rows[0].n,100);
  });
  await t.test('existing minute maintenance kicks same one-time worker capability and deduplicates deliveries',async()=>{
   await reset();await task();await db.exec('select pablicus_push_private.maintenance();select pablicus_push_private.maintenance()');const calls=(await db.query('select * from net.calls')).rows;assert.equal(calls.length,2);assert.ok(calls.every(x=>x.url.endsWith('/pablicus-push/dispatch')));const token=calls[0].headers['X-Pablicus-Worker'];assert.match(token,/^[a-f0-9]{64}$/);assert.equal((await rpc('worker_auth',{token})).ok,true);await assert.rejects(rpc('worker_auth',{token}),{code:'42501'});assert.equal((await db.query('select count(*)::int n from pablicus_push_private.task_deliveries')).rows[0].n,1);
  });
  await t.test('message burst still reserves task capacity; combined batch stays 25, message body remains generic',async()=>{
   await reset();for(let n=0;n<8;n++)await task();for(let n=1;n<=30;n++)await db.query("insert into messages(client_message_id,conversation_id,server_seq,sender_id,body) values(gen_random_uuid(),$1,$2,$3,'private message')",[CHAT,n,A]);
   const jobs=await rpc('claim');assert.equal(jobs.length,25);assert.equal(jobs.filter(x=>x.payload.kind==='task_reminder').length,5);assert.equal(jobs.filter(x=>x.payload.message_id).length,20);assert.ok(jobs.filter(x=>x.payload.message_id).every(x=>x.payload.body==='Новое сообщение'));
   for(const job of jobs)await finish(job);const second=await rpc('claim');assert.equal(second.length,13);assert.equal(second.filter(x=>x.payload.kind==='task_reminder').length,3);
  });
 }finally{await db.close();}
});
