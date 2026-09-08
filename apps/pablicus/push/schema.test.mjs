import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../chat-workspace/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',C='10000000-0000-4000-8000-000000000003',D='10000000-0000-4000-8000-000000000004';
const chat='20000000-0000-4000-8000-000000000001';
const sub=(uid,tag)=>({user_id:uid,endpoint:'https://web.push.apple.com/'+tag,p256dh:'B'.repeat(87),auth:'a'.repeat(22)});
test('isolated PostgreSQL: push ownership, queue authorization and retry contracts',async t=>{
 const db=new PGlite();await db.exec(await readFile(new URL('../chat-workspace/schema-fixture.sql',import.meta.url),'utf8'));
 await db.exec(`CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
 ALTER TABLE public.messages ADD COLUMN deleted_at timestamptz;
 CREATE SCHEMA extensions; CREATE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS $$SELECT decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex')$$;
 CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
 GRANT USAGE ON SCHEMA extensions TO service_role;
 CREATE SCHEMA net; CREATE TABLE net.calls(id bigint GENERATED ALWAYS AS IDENTITY,url text,body jsonb,headers jsonb);
 CREATE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$DECLARE v bigint;BEGIN INSERT INTO net.calls(url,body,headers) VALUES(url,body,headers) RETURNING id INTO v;RETURN v;END$$;
 `);
 await db.exec(await readFile(new URL('./SCHEMA_PROPOSAL.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./WORKER_CAPABILITIES.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./NET_HARDENING.sql',import.meta.url),'utf8'));
 const rpc=async(action,input={},role='service_role')=>{await db.exec('SET ROLE '+role);try{return (await db.query('select public.pablicus_push_rpc($1,$2::jsonb) as value',[action,JSON.stringify(input)])).rows[0].value;}finally{await db.exec('RESET ROLE');}};
 const msg=async(seq,sender=A)=>{return(await db.query("insert into public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body) values(gen_random_uuid(),$1,$2,$3,'text','Private content not in push') returning id",[chat,seq,sender])).rows[0].id;};
 await t.test('private schema/RPC inaccessible to all browser roles',async()=>{
  for(const role of ['anon','authenticated']){await assert.rejects(rpc('config',{},role),{code:'42501'});await db.exec('SET ROLE '+role);try{await assert.rejects(db.query('select * from pablicus_push_private.config'),{code:'42501'});}finally{await db.exec('RESET ROLE');}}
  const functions=(await db.query("select n.nspname,p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pablicus_push_private' or p.proname='pablicus_push_rpc'")).rows;
  assert.equal(functions.find(x=>x.proname==='pablicus_push_rpc').prosecdef,false);assert.equal(functions.find(x=>x.proname==='rpc').prosecdef,false);
  for(const role of ['anon','authenticated']){
   const [net]=(await db.query("select has_schema_privilege($1,'net','USAGE') usage,has_function_privilege($1,'net.http_post(text,jsonb,jsonb,integer)','EXECUTE') execute",[role])).rows;
   assert.equal(net.usage,false);assert.equal(net.execute,false);
  }
 });
 await t.test('subscription rejects suspended user, spoofed endpoint and limits devices',async()=>{
  await assert.rejects(rpc('subscribe',sub(D,'suspended')),{code:'42501'});await assert.rejects(rpc('subscribe',{...sub(B,'b'),endpoint:'https://localhost/a'}),{code:'22023'});
  await rpc('subscribe',sub(A,'a'));await rpc('subscribe',sub(B,'b'));await rpc('subscribe',sub(C,'c'));
  for(let i=0;i<9;i++)await rpc('subscribe',sub(C,'c'+i));
  await assert.rejects(rpc('subscribe',sub(C,'eleventh')),{code:'22023'});
 });
 await t.test('message insertion creates one recipient delivery, excludes sender/nonmembers; payload generic',async()=>{
  const id=await msg(1);const queue=(await db.query('select * from pablicus_push_private.outbox')).rows;assert.equal(queue.length,1);assert.equal(queue[0].recipient_id,B);
  const jobs=await rpc('claim');assert.equal(jobs.length,1);assert.equal(jobs[0].payload.message_id,id);assert.equal(jobs[0].payload.recipient_id,B);assert.equal(jobs[0].payload.body,'Новое сообщение');assert.equal(JSON.stringify(jobs).includes('Private content'),false);
  assert.equal((await rpc('claim')).length,0);
  await rpc('finish',{id:jobs[0].id,lease:'00000000-0000-0000-0000-000000000000',status:201});
  assert.equal((await db.query('select state from pablicus_push_private.outbox')).rows[0].state,'sending');
  await rpc('finish',{id:jobs[0].id,lease:jobs[0].lease,status:201});assert.equal((await db.query('select state from pablicus_push_private.outbox')).rows[0].state,'sent');
 });
 await t.test('provider failure retries durably; permanent endpoint expiry cleans subscription',async()=>{
  await msg(2);const [job]=await rpc('claim');await rpc('finish',{id:job.id,lease:job.lease,status:503});
  assert.equal((await rpc('claim')).length,0);await db.query("update pablicus_push_private.outbox set due_at=now()-interval '1 second' where id=$1",[job.id]);
  const [retry]=await rpc('claim');assert.notEqual(retry.lease,job.lease);await rpc('finish',{id:retry.id,lease:retry.lease,status:410});
  assert.equal((await db.query('select count(*)::int n from pablicus_push_private.subscriptions where user_id=$1',[B])).rows[0].n,0);
 });
 await t.test('removed membership, read, deleted and suspended sender each suppress dispatch',async()=>{
  await rpc('subscribe',sub(B,'b2'));await msg(3);await db.query('update public.conversation_members set last_read_seq=3 where user_id=$1 and conversation_id=$2',[B,chat]);assert.equal((await rpc('claim')).length,0);
  const deleted=await msg(4);await db.query('update public.messages set deleted_at=now() where id=$1',[deleted]);assert.equal((await rpc('claim')).length,0);
  await msg(5);await db.query('update public.profiles set is_approved=false where id=$1',[A]);assert.equal((await rpc('claim')).length,0);await db.query('update public.profiles set is_approved=true where id=$1',[A]);
  await msg(6);await db.query('delete from public.conversation_members where user_id=$1 and conversation_id=$2',[B,chat]);assert.equal((await rpc('claim')).length,0);await db.query('insert into public.conversation_members(conversation_id,user_id) values($1,$2)',[chat,B]);
 });
 await t.test('account rebind clears old queued messages; other owner cannot unsubscribe',async()=>{
  await rpc('unsubscribe',{user_id:C,endpoint:sub(C,'c8').endpoint});
  await msg(7);await rpc('subscribe',sub(C,'b2'));assert.equal((await rpc('claim')).length,0);
  await rpc('unsubscribe',{user_id:B,endpoint:sub(C,'b2').endpoint});assert.equal((await db.query('select user_id from pablicus_push_private.subscriptions where endpoint=$1',[sub(C,'b2').endpoint])).rows[0].user_id,C);
  await rpc('unsubscribe',{user_id:C,endpoint:sub(C,'b2').endpoint});assert.equal((await db.query('select count(*)::int n from pablicus_push_private.subscriptions where endpoint=$1',[sub(C,'b2').endpoint])).rows[0].n,0);
 });
 await t.test('failed network queue never blocks message commit',async()=>{
  await rpc('subscribe',sub(B,'b3'));
  await db.exec("CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'simulated queue outage';END$$");
  const id=await msg(8);assert.ok(id);assert.equal((await db.query('select count(*)::int n from pablicus_push_private.outbox where message_id=$1',[id])).rows[0].n,1);
 });
 await t.test('bad worker credentials rejected and key init is race-safe and non-rotating',async()=>{
  await assert.rejects(rpc('worker_auth',{token:'0'.repeat(64)}),{code:'42501'});
  const token=(await db.query("select headers->>'X-Pablicus-Worker' token from net.calls order by id desc limit 1")).rows[0].token;
  await rpc('worker_auth',{token});await assert.rejects(rpc('worker_auth',{token}),{code:'42501'});
  const expired='e'.repeat(64);await db.query("insert into pablicus_push_private.worker_requests(token_hash,created_at) values(extensions.digest($1,'sha256'),now()-interval '3 minutes')",[expired]);
  await assert.rejects(rpc('worker_auth',{token:expired}),{code:'42501'});
  const legacy=(await db.query('select dispatch_token from pablicus_push_private.config')).rows[0].dispatch_token;await assert.rejects(rpc('worker_auth',{token:legacy}),{code:'42501'});
  const columns=(await db.query("select column_name from information_schema.columns where table_schema='pablicus_push_private' and table_name='worker_requests' order by ordinal_position")).rows.map(x=>x.column_name);assert.deepEqual(columns,['token_hash','created_at']);
  const key={publicKey:'B'.repeat(87),privateJwk:{kty:'EC',crv:'P-256',d:'a'.repeat(43)}};
  assert.equal((await rpc('init',key)).publicKey,key.publicKey);assert.equal((await rpc('init',{...key,publicKey:'C'.repeat(87)})).publicKey,key.publicKey);
 });
 await db.close();
});
