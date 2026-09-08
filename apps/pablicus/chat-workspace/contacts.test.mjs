import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const C='10000000-0000-4000-8000-000000000003',D='10000000-0000-4000-8000-000000000004';

test('people discovery and direct conversations use reviewed PostgreSQL contract',async t=>{
 const db=new PGlite();
 await db.exec(await readFile(new URL('./schema-fixture.sql',import.meta.url),'utf8'));
 await db.exec("ALTER TABLE public.profiles ADD COLUMN display_name text,ADD COLUMN avatar_url text; UPDATE public.profiles SET display_name='Катя Смоки' WHERE id='"+B+"'; UPDATE public.profiles SET display_name='Hidden Катя' WHERE id='"+D+"';");
 const proposal=await readFile(new URL('./CONTACTS_SCHEMA_PROPOSAL.sql',import.meta.url),'utf8');
 await db.exec(proposal);
 const as=async(uid,sql,args=[],role='authenticated')=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await db.exec(`SET ROLE ${role}`);
  try{return await db.query(sql,args)}finally{await db.exec('RESET ROLE')}
 };
 const search=async(q,uid=A,role='authenticated')=>(await as(uid,'select * from public.pablicus_search_people($1)',[q],role)).rows;
 const start=async(username,uid=A,role='authenticated')=>(await as(uid,'select public.start_direct_conversation($1) as id',[username],role)).rows[0].id;
 await t.test('search denies anonymous, missing uid and suspended profiles',async()=>{
  await assert.rejects(search('Катя',null,'anon'),{code:'42501'});
  await assert.rejects(search('Катя',null),{code:'42501'});
  await assert.rejects(search('Катя',D),{code:'42501'});
 });
 await t.test('Cyrillic name and exact handle match only permitted public fields',async()=>{
  const rows=await search('КАТЯ');assert.equal(rows.length,1);assert.equal(rows[0].id,B);
  assert.deepEqual(Object.keys(rows[0]),['id','username','display_name','avatar_url']);
  assert.equal((await search(' @MEMBER_B '))[0].id,B);
  assert.equal((await search('member_a')).length,0);
  for(const q of ['','К','%','%%','__','x'.repeat(81)])assert.equal((await search(q)).length,0);
 });
 await t.test('same names stay separate and exact handle sorts first within 20 result cap',async()=>{
  await db.query('update public.profiles set display_name=$1 where id=$2',['Катя Смоки',C]);
  assert.equal((await search('Катя Смоки')).length,2);
  assert.equal((await search('outsider'))[0].id,C);
  for(let i=0;i<24;i++)await db.query('insert into public.profiles(id,username,is_approved,display_name) values(gen_random_uuid(),$1,true,$2)',['demo_'+i,'Пользователь']);
  assert.equal((await search('Пользователь')).length,20);
 });
 await t.test('direct call denies suspended/anonymous/self/unknown target before creating data',async()=>{
  const before=(await db.query('select count(*)::int as n from public.conversations')).rows[0].n;
  await assert.rejects(start('member_b',D),{code:'42501'});
  await assert.rejects(start('member_b',null,'anon'),{code:'42501'});
  await assert.rejects(start('member_a'),{code:'22023'});
  await assert.rejects(start('suspended'),{code:'22023'});
  await assert.rejects(start('missing'),{code:'22023'});
  assert.equal((await db.query('select count(*)::int as n from public.conversations')).rows[0].n,before);
 });
 await t.test('both directions reuse one two-member conversation; group is not reused',async()=>{
  const first=await start(' @MEMBER_B ');assert.equal(first,await start('member_b'));assert.equal(first,await start('member_a',B));
  const members=(await db.query('select user_id from public.conversation_members where conversation_id=$1 order by user_id',[first])).rows;
  assert.deepEqual(members.map(x=>x.user_id),[A,B]);
  // The original fixture contains A/B plus suspended D: that 3-person record is not a DM.
  assert.notEqual(first,'20000000-0000-4000-8000-000000000001');
  assert.match(proposal,/pg_advisory_xact_lock\(pg_catalog\.hashtextextended/);
  assert.match(proposal,/least\(v_me::text,v_target::text\).*greatest\(v_me::text,v_target::text\)/);
 });
 await t.test('dialog list displays names while membership isolation and fallback remain',async()=>{
  const first=await start('member_b');const list=(await as(A,'select * from public.my_conversations_v3()')).rows;
  assert.equal(list.find(x=>x.id===first).title,'Катя Смоки');
  assert.equal(list.some(x=>x.id==='20000000-0000-4000-8000-000000000002'),false);
  await db.query('update public.profiles set display_name=null where id=$1',[B]);
  assert.equal((await as(A,'select * from public.my_conversations_v3()')).rows.find(x=>x.id===first).title,'@member_b');
  assert.equal((await as(D,'select * from public.my_conversations_v3()')).rows.length,0);
 });
 await t.test('edited preview replaces original and deleted message cannot leak in previews or unread count',async()=>{
  // Discovery also works before these additive actions columns exist.
  await db.exec('ALTER TABLE public.messages ADD COLUMN edited_body text,ADD COLUMN deleted_at timestamptz');
  const chat=await start('member_b');
  await db.query("insert into public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body,edited_body,created_at) values(gen_random_uuid(),$1,1,$2,'text','Original private text','Updated text','2026-09-08T10:00:00Z')",[chat,B]);
  await db.query("insert into public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body,deleted_at,created_at) values(gen_random_uuid(),$1,2,$2,'text','Deleted private text',now(),'2026-09-08T10:01:00Z')",[chat,B]);
  await db.query('update public.conversations set last_seq=2 where id=$1',[chat]);
  const list=(await as(A,'select * from public.my_conversations_v3()')).rows;
  const row=list.find(x=>x.id===chat);
  assert.equal(row.last_message,'Updated text');assert.equal(Number(row.unread_count),1);
  assert.equal(new Date(row.last_message_at).toISOString(),'2026-09-08T10:00:00.000Z');
  assert.equal(JSON.stringify(list).includes('Deleted private text'),false);
  assert.equal(JSON.stringify(list).includes('Original private text'),false);
 });
 await t.test('new entrypoints are invoker and helper is private with authenticated-only execute',async()=>{
  const funcs=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anonymous from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('start_direct_conversation','pablicus_search_people','my_conversations','my_conversations_v2','my_conversations_v3')")).rows;
  for(const f of funcs){assert.equal(f.anonymous,false);assert.deepEqual(f.proconfig,['search_path=""']);assert.equal(f.prosecdef,f.nspname==='pablicus_chat_private');}
 });
 await t.test('legacy list RPC shapes remain compatible and cannot expose original/deleted previews',async()=>{
  const chat=await start('member_b');
  for(const [name,keys] of [
   ['my_conversations',['id','title','last_message','last_seq']],
   ['my_conversations_v2',['id','title','last_message','last_seq','last_read_seq','unread_count']]
  ]){
   const list=(await as(A,`select * from public.${name}()`)).rows,row=list.find(x=>x.id===chat);
   assert.deepEqual(Object.keys(row),keys);assert.equal(row.last_message,'Updated text');
   if(name.endsWith('v2'))assert.equal(Number(row.unread_count),1);
   assert.equal(JSON.stringify(list).includes('Deleted private text'),false);
   assert.equal(JSON.stringify(list).includes('Original private text'),false);
   assert.equal((await as(D,`select * from public.${name}()`)).rows.length,0);
   await assert.rejects(as(null,`select * from public.${name}()`,[],'anon'),{code:'42501'});
  }
 });
 await db.close();
});
