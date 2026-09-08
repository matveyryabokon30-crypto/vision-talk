import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const C='10000000-0000-4000-8000-000000000003',D='10000000-0000-4000-8000-000000000004';
const CHAT='20000000-0000-4000-8000-000000000001',OTHER='20000000-0000-4000-8000-000000000003';
const CLIENT='30000000-0000-4000-8000-000000000001';
const text=(id,value)=>({id,type:'text',text:value});
const content=blocks=>({v:1,blocks});

test('exact rich-message proposal: isolated PostgreSQL authorization and atomicity',async t=>{
 const db=new PGlite();
 await db.exec(await readFile(new URL('./schema-fixture.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./SCHEMA_PROPOSAL.sql',import.meta.url),'utf8'));
 const as=async(uid,sql,args=[],role='authenticated')=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
   await db.exec(`SET ROLE ${role}`);
   try{return await db.query(sql,args)}finally{await db.exec('RESET ROLE')}
 };
 const send=async(value,{uid=A,chat=CHAT,client=CLIENT,role='authenticated'}={})=>
   (await as(uid,'select * from public.send_rich_message($1,$2,$3::jsonb)',[chat,client,JSON.stringify(value)],role)).rows[0];
 const state=async()=> (await db.query('select last_seq,(select count(*)::int from public.messages) as messages from public.conversations where id=$1',[CHAT])).rows[0];
 const media=(id,type,mime,size=10)=>({id,type,path:`${CHAT}/${A}/${CLIENT}/${id}/file.bin`,name:'файл.bin',mime,size});
 const put=async(block,{owner=A,mime=block.mime,size=block.size}={})=>db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4::jsonb) on conflict(bucket_id,name) do update set owner_id=excluded.owner_id,metadata=excluded.metadata',['message-media',block.path,owner,JSON.stringify({size,mimetype:mime})]);
 const pic=media('pic','image','image/jpeg'),video=media('movie','video','video/mp4'),doc=media('doc','document','application/pdf'),audio=media('voice','audio','audio/mp4');
 const rich=content([text('first','До фотографии'),pic,text('second','После фотографии'),video,doc,audio]);

 await t.test('anonymous, nonmember and suspended member are denied before publication',async()=>{
   for(const uid of [null,C,D])await assert.rejects(send(content([text('t','private')]),{uid}),{code:'42501'});
   await assert.rejects(send(content([text('t','private')]),{uid:null,role:'anon'}),{code:'42501'});
   assert.deepEqual(await state(),{last_seq:0,messages:0});
 });
 await t.test('last missing media rolls back whole message, then exact six-block order publishes once',async()=>{
   for(const block of [pic,video,doc])await put(block);
   await assert.rejects(send(rich),/uploaded object not found/);
   assert.deepEqual(await state(),{last_seq:0,messages:0});
   await put(audio);
   const row=await send(rich);
   assert.equal(row.type,'rich');assert.equal(row.server_seq,1);assert.equal(row.attachment_path,null);
   assert.deepEqual(row.attachment_metadata,rich);assert.equal(row.body,'До фотографии\nПосле фотографии');
   assert.deepEqual(await state(),{last_seq:1,messages:1});
 });
 await t.test('lost-response retry returns same row; content and conversation UUID reuse conflict',async()=>{
   const first=await send(rich),second=await send(rich);assert.equal(first.id,second.id);
   await assert.rejects(send(content([text('t','different')])),/client_message_conflict/);
   await assert.rejects(send(rich,{chat:OTHER}),/client_message_conflict/);
   assert.deepEqual(await state(),{last_seq:1,messages:1});
   await db.query('delete from storage.objects where name=$1',[audio.path]);
   assert.equal((await send(rich)).id,first.id); // acknowledgement does not require reupload
 });
 await t.test('RLS exposes the completed message only to approved members',async()=>{
   assert.equal((await as(B,'select id from public.messages')).rows.length,1);
   assert.equal((await as(C,'select id from public.messages')).rows.length,0);
   assert.equal((await as(D,'select id from public.messages')).rows.length,0);
   await assert.rejects(as(A,"update public.messages set body='forged'"),{code:'42501'});
   await assert.rejects(as(A,'select * from pablicus_chat_private.saved_conversations'),{code:'42501'});
 });
 await t.test('foreign paths, object ownership, sizes and MIME are verified server-side',async()=>{
   const client='30000000-0000-4000-8000-000000000002';
   const block={...pic,path:pic.path.replace(CLIENT,client)};
   const attempt=()=>send(content([block]),{client});
   await put(block,{owner:B});await assert.rejects(attempt(),/uploaded object not found/);
   await put(block,{size:20});await assert.rejects(attempt(),/attachment size mismatch/);
   await put(block,{mime:'image/png'});await assert.rejects(attempt(),/attachment MIME mismatch/);
   await put(block);
   for(const path of [block.path.replace(A,B),block.path.replace(CHAT,OTHER),block.path.replace('/pic/','/other/'),block.path.replace('file.bin','../file.bin')]){
     await assert.rejects(send(content([{...block,path}]),{client}),/invalid attachment path/);
   }
   await assert.rejects(send(content([{...block,mime:'video/mp4'}]),{client}),/MIME does not match/);
   assert.deepEqual(await state(),{last_seq:1,messages:1});
 });
 await t.test('invalid rich structures and limits cannot create rows',async()=>{
   const client='30000000-0000-4000-8000-000000000003';
   const invalid=[null,{},content([]),{v:2,blocks:[text('t','ok')]},content([text('x','a'),text('x','b')]),content([text('t',' ')]),content([text('t','x'.repeat(5001))]),content([text('../path','bad')]),content([{id:'x',type:'script',text:'bad'}]),content([{...text('t','ok'),unexpected:1}]),{...content([text('t','ok')]),extra:true},content(Array.from({length:101},(_,i)=>text('t'+i,'x')))];
   for(const value of invalid)await assert.rejects(send(value,{client}),{code:'22023'});
   const block={...pic,path:pic.path.replace(CLIENT,client),size:26214401};
   await assert.rejects(send(content([block]),{client}),/exceeds 25 MiB/);
   assert.deepEqual(await state(),{last_seq:1,messages:1});
 });
 await t.test('audio MIME codec parameter is normalized against storage MIME',async()=>{
   const client='30000000-0000-4000-8000-000000000004';
   const block={...audio,path:audio.path.replace(CLIENT,client),mime:'audio/webm;codecs=opus',duration:1.25};
   await put(block,{mime:'audio/webm'});
   assert.equal((await send(content([block]),{client})).body,'Аудио');
 });
 await t.test('saved conversations create no data until requested, then isolate owners and reuse UUID',async()=>{
   const get=async uid=>(await as(uid,'select public.start_saved_conversation() as id')).rows[0].id;
   assert.equal((await db.query('select count(*)::int as n from pablicus_chat_private.saved_conversations')).rows[0].n,0);
   const a=await get(A),again=await get(A),b=await get(B);assert.equal(a,again);assert.notEqual(a,b);
   assert.equal((await db.query('select count(*)::int as n from public.conversation_members where conversation_id=$1',[a])).rows[0].n,1);
   assert.equal((await as(B,'select id from public.conversations where id=$1',[a])).rows.length,0);
   await assert.rejects(get(D),{code:'42501'});await assert.rejects(get(null),{code:'42501'});
   const selfMessage=await send(content([text('t','Личная заметка')]),{chat:a,client:'30000000-0000-4000-8000-000000000005'});
   assert.equal(selfMessage.server_seq,1);assert.equal(selfMessage.conversation_id,a);
 });
 await t.test('new public RPCs are invoker-only and neither anonymous nor table writes are granted',async()=>{
   const rows=(await db.query("select proname,prosecdef from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('send_rich_message','start_saved_conversation')")).rows;
   assert.equal(rows.length,2);assert.ok(rows.every(x=>!x.prosecdef));
   assert.equal((await db.query("select has_function_privilege('anon','public.send_rich_message(uuid,uuid,jsonb)','execute') as allowed")).rows[0].allowed,false);
 });
 await db.close();
});
