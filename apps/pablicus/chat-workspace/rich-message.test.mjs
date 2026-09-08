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
 const privileges=async()=> (await db.query("select n.nspname,p.proname,p.proowner,p.prosecdef,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='send_rich_message' order by n.nspname")).rows;
 const originalPrivileges=await privileges();
 await db.exec(await readFile(new URL('./REPLY_SCHEMA_PROPOSAL.sql',import.meta.url),'utf8'));
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

 // Replies add references to the same single rich row; quoted media stays in
 // the original message and is never reuploaded into the replying message.
 const newClient=(()=>{let n=20;return()=>`30000000-0000-4000-8000-${String(n++).padStart(12,'0')}`})();
 const replyContent=reply_to=>({...content([text('answer','Ответ')]),reply_to});
 const target=(await db.query('select * from public.messages where client_message_id=$1',[CLIENT])).rows[0];
 await t.test('whole-message and individual rich-block replies preserve the exact reference in one row',async()=>{
   for(const ref of [{message_id:target.id},...rich.blocks.map(block=>({message_id:target.id,block_id:block.id}))]){
     const before=await state(),value=replyContent(ref),client=newClient();
     const row=await send(value,{client});
     assert.equal(row.type,'rich');assert.equal(row.body,'Ответ');assert.equal(row.attachment_path,null);
     assert.deepEqual(row.attachment_metadata,value);assert.equal(row.server_seq,before.last_seq+1);
     assert.equal((await state()).messages,before.messages+1);
     assert.equal((await as(B,'select attachment_metadata from public.messages where id=$1',[row.id])).rows[0].attachment_metadata.reply_to.message_id,target.id);
   }
 });
 await t.test('multiple voice blocks can be addressed separately inside one mixed body',async()=>{
   const client=newClient();
   const first={...audio,id:'first_voice',path:`${CHAT}/${A}/${client}/first_voice/voice.m4a`};
   const second={...audio,id:'second_voice',path:`${CHAT}/${A}/${client}/second_voice/voice.m4a`};
   await put(first);await put(second);
   const message=await send(content([text('t','Две записи'),first,second]),{client});
   const one=await send(replyContent({message_id:message.id,block_id:first.id}),{client:newClient()});
   const two=await send(replyContent({message_id:message.id,block_id:second.id}),{client:newClient()});
   assert.equal(one.attachment_metadata.reply_to.block_id,'first_voice');
   assert.equal(two.attachment_metadata.reply_to.block_id,'second_voice');
   assert.equal(one.attachment_metadata.reply_to.message_id,two.attachment_metadata.reply_to.message_id);
 });
 await t.test('old plain messages accept whole-message replies but never fabricated block references',async()=>{
   const seq=(await db.query('update public.conversations set last_seq=last_seq+1 where id=$1 returning last_seq',[CHAT])).rows[0].last_seq;
   const legacy=(await db.query("insert into public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body) values($1,$2,$3,$4,'text','Старое сообщение') returning id",[newClient(),CHAT,seq,B])).rows[0];
   assert.equal((await send(replyContent({message_id:legacy.id}),{client:newClient()})).attachment_metadata.reply_to.message_id,legacy.id);
   const before=await state();
   await assert.rejects(send(replyContent({message_id:legacy.id,block_id:'t'}),{client:newClient()}),/reply block not found/);
   assert.deepEqual(await state(),before);
 });
 await t.test('reply authorization is rechecked for outsider, suspended, anonymous and removed members',async()=>{
   const value=replyContent({message_id:target.id,block_id:'voice'}),before=await state();
   for(const uid of [null,C,D])await assert.rejects(send(value,{uid,client:newClient()}),{code:'42501'});
   await assert.rejects(send(value,{uid:null,client:newClient(),role:'anon'}),{code:'42501'});
   await db.query('delete from public.conversation_members where conversation_id=$1 and user_id=$2',[CHAT,B]);
   try{await assert.rejects(send(value,{uid:B,client:newClient()}),{code:'42501'})}
   finally{await db.query('insert into public.conversation_members(conversation_id,user_id) values($1,$2)',[CHAT,B])}
   assert.deepEqual(await state(),before);
 });
 await t.test('nonexistent, cross-conversation and nonexistent-block targets cannot publish or consume a sequence',async()=>{
   const other=await send(content([text('t','Другой разговор')]),{chat:OTHER,client:newClient()});
   const before=await state();
   // A belongs to BOTH conversations: membership in the target chat is not enough.
   for(const id of [other.id,'40000000-0000-4000-8000-000000000099']){
     await assert.rejects(send(replyContent({message_id:id}),{client:newClient()}),/reply target not found in conversation/);
   }
   for(const block_id of ['missing','answer']){
     await assert.rejects(send(replyContent({message_id:target.id,block_id}),{client:newClient()}),/reply block not found/);
   }
   assert.deepEqual(await state(),before);
 });
 await t.test('strict reference shape rejects forged quotes, invalid UUIDs and malformed block IDs',async()=>{
   const before=await state();
   const invalid=[false,1,'target',[],{}, {message_id:null},{message_id:1},{message_id:'invalid'},
     {message_id:target.id,quote:'Чужая цитата'},{message_id:target.id,sender_id:B},
     ...[null,false,[],{},'', '../voice','x'.repeat(129)].map(block_id=>({message_id:target.id,block_id}))];
   for(const reference of invalid)await assert.rejects(send(replyContent(reference),{client:newClient()}),{code:'22023'});
   const client=newClient(),missing={...audio,path:`${CHAT}/${A}/${client}/voice/missing.m4a`};
   await assert.rejects(send({...content([missing]),reply_to:{message_id:target.id}},{client}),/uploaded object not found/);
   assert.deepEqual(await state(),before);
 });
 await t.test('reply retry preserves row and sequence; changing only the reference conflicts',async()=>{
   const client=newClient(),value=replyContent({message_id:target.id,block_id:'voice'});
   const one=await send(value,{client}),before=await state(),two=await send(value,{client});
   assert.equal(one.id,two.id);
   await assert.rejects(send(replyContent({message_id:target.id,block_id:'pic'}),{client}),{code:'23505'});
   await assert.rejects(send(content([text('answer','Ответ')]),{client}),{code:'23505'});
   assert.deepEqual(await state(),before);
 });
 await t.test('absent and explicit-null references remain compatible while dedup keeps exact content',async()=>{
   const client=newClient(),value=replyContent(null),one=await send(value,{client});
   assert.equal(one.attachment_metadata.reply_to,null);
   assert.equal((await send(value,{client})).id,one.id);
   await assert.rejects(send(content([text('answer','Ответ')]),{client}),{code:'23505'});
 });
 await t.test('acknowledged reply retries still work after the target was removed',async()=>{
   const disposable=await send(content([text('t','Удаляемый оригинал')]),{client:newClient()});
   const client=newClient(),value=replyContent({message_id:disposable.id,block_id:'t'});
   const reply=await send(value,{client});
   await db.query('delete from public.messages where id=$1',[disposable.id]);
   const before=await state();
   assert.equal((await send(value,{client})).id,reply.id);
   await assert.rejects(send(value,{client:newClient()}),/reply target not found in conversation/);
   assert.deepEqual(await state(),before);
 });
 await t.test('reply replacement preserves original public/private function owner, grants and search path',async()=>{
   assert.deepEqual(await privileges(),originalPrivileges);
   const before=await state();
   await db.exec(await readFile(new URL('./REPLY_SCHEMA_PROPOSAL.sql',import.meta.url),'utf8'));
   assert.deepEqual(await privileges(),originalPrivileges);
   assert.deepEqual(await state(),before);
 });
 await db.close();
});
