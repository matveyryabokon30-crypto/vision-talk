import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const C='10000000-0000-4000-8000-000000000003',D='10000000-0000-4000-8000-000000000004';
const CHAT='20000000-0000-4000-8000-000000000001',OTHER='20000000-0000-4000-8000-000000000003';
const CLIENT='30000000-0000-4000-8000-000000000001';
const text=(id,value)=>({id,type:'text',text:value});

test('exact message actions migration: authorization, overlays and durable identities',async t=>{
  const db=new PGlite();
  try {
    for(const file of ['schema-fixture.sql','SCHEMA_PROPOSAL.sql','REPLY_SCHEMA_PROPOSAL.sql','ACTIONS_SCHEMA_PROPOSAL.sql'])
      await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
    const as=async(uid,sql,args=[],role='authenticated')=>{
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
      await db.exec(`SET ROLE ${role}`);
      try{return await db.query(sql,args)}finally{await db.exec('RESET ROLE')}
    };
    const send=async(content,{uid=A,chat=CHAT,client=CLIENT}={})=>(await as(uid,'select * from public.send_rich_message($1,$2,$3::jsonb)',[chat,client,JSON.stringify(content)])).rows[0];
    const edit=async(id,revision,value,block=null,{uid=A,chat=CHAT}={})=>(await as(uid,'select * from public.edit_message_text($1,$2,$3,$4,$5)',[chat,id,revision,value,block])).rows[0];
    const del=async(id,revision,{uid=A,chat=CHAT}={})=>(await as(uid,'select * from public.delete_message($1,$2,$3)',[chat,id,revision])).rows[0];
    const pin=async(id,state,{uid=A,chat=CHAT}={})=>(await as(uid,'select public.set_message_pin($1,$2,$3) as value',[chat,id,state])).rows[0].value;
    const react=async(id,emoji,active,{uid=A,chat=CHAT}={})=>(await as(uid,'select public.set_message_reaction($1,$2,$3,$4) as value',[chat,id,emoji,active])).rows[0].value;
    const actions=async(ids,{uid=A,chat=CHAT}={})=>(await as(uid,'select * from public.get_message_actions($1,$2::uuid[])',[chat,ids])).rows;
    const pins=async({uid=A,chat=CHAT}={})=>(await as(uid,'select * from public.get_pinned_messages($1)',[chat])).rows;
    const state=async()=>(await db.query('select id,last_seq from public.conversations order by id')).rows;
    const anchor=await send({v:1,blocks:[text('anchor','Исходное сообщение')]},{client:'30000000-0000-4000-8000-000000000002'});
    const media={id:'voice',type:'audio',path:`${CHAT}/${A}/${CLIENT}/voice/audio.mp4`,name:'Голосовое.mp4',mime:'audio/mp4',size:12,duration:2};
    await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4::jsonb)',
      ['message-media',media.path,A,JSON.stringify({size:12,mimetype:'audio/mp4'})]);
    const original={v:1,blocks:[text('before','До'),media,text('after','После')],reply_to:{message_id:anchor.id,block_id:'anchor'}};
    const rich=await send(original);
    const foreign=await send({v:1,blocks:[text('outside','Другой чат')]},{chat:OTHER,client:'30000000-0000-4000-8000-000000000003'});
    const legacy=(await db.query(`with next as (update public.conversations set last_seq=last_seq+1 where id=$1 returning last_seq)
      insert into public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body)
      select '30000000-0000-4000-8000-000000000004',$1,last_seq,$2,'text','Простой текст' from next returning *`,[CHAT,A])).rows[0];
    const initialSequences=await state();

    await t.test('anonymous, outsider and suspended member cannot read or mutate actions',async()=>{
      for(const uid of [null,C,D]) {
        for(const action of [()=>edit(rich.id,0,'Hack','before',{uid}),()=>del(rich.id,0,{uid}),()=>pin(rich.id,true,{uid}),()=>react(rich.id,'👍',true,{uid}),()=>actions([rich.id],{uid}),()=>pins({uid})])
          await assert.rejects(action(),{code:'42501'});
      }
      await assert.rejects(as(null,'select * from public.get_message_actions($1,$2::uuid[])',[CHAT,[rich.id]],'anon'),{code:'42501'});
      await assert.rejects(as(A,'select pablicus_chat_private.assert_message_member($1)',[CHAT]),{code:'42501'});
    });
    await t.test('member cannot edit/delete someone else, or target another conversation even as its member',async()=>{
      await assert.rejects(edit(rich.id,0,'Hack','before',{uid:B}),{code:'42501'});
      await assert.rejects(del(rich.id,0,{uid:B}),{code:'42501'});
      for(const action of [()=>edit(foreign.id,0,'Hack','outside'),()=>del(foreign.id,0),()=>pin(foreign.id,true),()=>react(foreign.id,'👍',true),()=>actions([rich.id,foreign.id])])
        await assert.rejects(action(),{code:'42501'});
    });
    await t.test('rich block edit preserves every other block, media identity, reply and original ACK content',async()=>{
      const changed=await edit(rich.id,0,'Изменено','before');
      assert.equal(changed.message_revision,1);
      assert.equal(changed.edited_body,'Изменено\nПосле');
      assert.ok(changed.edited_at);
      assert.equal(changed.body,'До\nПосле');
      assert.deepEqual(changed.attachment_metadata,original);
      assert.deepEqual(changed.edited_content,{...original,blocks:[text('before','Изменено'),media,text('after','После')]});
      assert.equal(changed.server_seq,rich.server_seq);
      assert.equal(changed.client_message_id,CLIENT);
      assert.equal((await send(original)).id,rich.id);
      await assert.rejects(send(changed.edited_content),{code:'23505'});
    });
    await t.test('same edit retries succeed once, stale differing edits cannot overwrite newer content',async()=>{
      assert.equal((await edit(rich.id,0,'Изменено','before')).message_revision,1);
      await assert.rejects(edit(rich.id,0,'Старое обновление','after'),{code:'40001'});
      const changed=await edit(rich.id,1,'Вторая часть','after');
      assert.equal(changed.message_revision,2);
      assert.equal(changed.edited_body,'Изменено\nВторая часть');
      assert.deepEqual(changed.edited_content.blocks[1],media);
    });
    await t.test('cannot turn a media block into text, remove blocks, exceed message length, or inject null revision',async()=>{
      for(const [value,block,revision] of [['Текст','voice',2],['Текст','absent',2],['Текст',null,2],['  ','before',2],['a'.repeat(5000),'before',2],['Текст','before',null],['Текст','before',-1]])
        await assert.rejects(edit(rich.id,revision,value,block),{code:'22023'});
      assert.equal((await actions([rich.id]))[0].message_revision,2);
    });
    await t.test('legacy text edits expose overlay while immutable original remains available for send ACK',async()=>{
      const changed=await edit(legacy.id,0,'Новый текст');
      assert.equal(changed.edited_body,'Новый текст');
      assert.equal(changed.body,'Простой текст');
      assert.equal(changed.edited_content,null);
      assert.equal(changed.message_revision,1);
      await assert.rejects(edit(legacy.id,1,'Другой','invented'),{code:'22023'});
    });
    await t.test('pins are shared, deterministic and readable outside current message page',async()=>{
      assert.equal(await pin(rich.id,true,{uid:B}),true);
      assert.equal(await pin(rich.id,true),true);
      assert.equal((await actions([rich.id],{uid:B}))[0].pinned,true);
      let list=await pins({uid:B});
      assert.equal(list.length,1);assert.equal(list[0].id,rich.id);assert.equal(list[0].edited_body,'Изменено\nВторая часть');
      assert.equal(await pin(rich.id,false),false);
      assert.equal(await pin(rich.id,false),false);
      assert.deepEqual(await pins(),[]);
      await pin(rich.id,true);
      await assert.rejects(pin(rich.id,null),{code:'22023'});
    });
    await t.test('reactions count users, setting replaces own emoji, retries do not toggle or duplicate',async()=>{
      await react(rich.id,'👍',true);await react(rich.id,'👍',true);await react(rich.id,'👍',true,{uid:B});
      assert.deepEqual((await actions([rich.id]))[0].reactions,[{emoji:'👍',count:2,mine:true}]);
      await react(rich.id,'❤️',true);
      assert.deepEqual((await actions([rich.id]))[0].reactions,[{emoji:'❤️',count:1,mine:true},{emoji:'👍',count:1,mine:false}]);
      await react(rich.id,'👍',false); // delayed removal of earlier emoji must not remove the new one
      assert.equal((await actions([rich.id]))[0].reactions.find(x=>x.emoji==='❤️').mine,true);
      await react(rich.id,'❤️',false);await react(rich.id,'❤️',false);
      assert.deepEqual((await actions([rich.id]))[0].reactions,[{emoji:'👍',count:1,mine:false}]);
      for(const [emoji,active] of [['<script>',true],[null,true],['👍',null]])await assert.rejects(react(rich.id,emoji,active),{code:'22023'});
    });
    await t.test('batch action read reports overlays and bounds inputs',async()=>{
      const item=(await actions([rich.id,legacy.id]))[0];
      assert.equal(item.message_id,rich.id);assert.equal(item.edited_body,'Изменено\nВторая часть');
      assert.equal(item.message_revision,2);assert.deepEqual(item.edited_content.reply_to,original.reply_to);
      assert.deepEqual(await actions([]),[]);
      for(const ids of [null,[null],Array(201).fill(rich.id)])await assert.rejects(actions(ids),{code:'22023'});
    });
    await t.test('private state tables enforce member SELECT and deny direct writes',async()=>{
      assert.equal((await as(B,'select count(*)::int as n from pablicus_chat_private.message_pins')).rows[0].n,1);
      for(const uid of [C,D])assert.equal((await as(uid,'select count(*)::int as n from pablicus_chat_private.message_pins')).rows[0].n,0);
      await assert.rejects(as(A,'delete from pablicus_chat_private.message_pins'),{code:'42501'});
      await assert.rejects(as(B,"update public.messages set edited_body='forged' where id=$1",[rich.id]),{code:'42501'});
      await assert.rejects(as(A,"insert into pablicus_chat_private.message_reactions(message_id,conversation_id,user_id,emoji) values($1,$2,$3,'🔥')",[rich.id,CHAT,B]),{code:'42501'});
    });
    await t.test('soft delete preserves row ID, sequence, original content and send ACK, and clears pins/reactions',async()=>{
      await assert.rejects(del(rich.id,1),{code:'40001'});
      const removed=await del(rich.id,2);
      assert.equal(removed.id,rich.id);assert.equal(removed.server_seq,rich.server_seq);assert.ok(removed.deleted_at);
      assert.equal(removed.message_revision,3);assert.deepEqual(removed.attachment_metadata,original);
      const retry=await del(rich.id,2);assert.equal(retry.message_revision,3);assert.deepEqual(retry.deleted_at,removed.deleted_at);
      const ack=await send(original);assert.equal(ack.id,rich.id);assert.ok(ack.deleted_at);
      assert.deepEqual(await pins(),[]);
      const item=(await actions([rich.id]))[0];assert.equal(item.pinned,false);assert.deepEqual(item.reactions,[]);assert.ok(item.deleted_at);
      assert.equal(item.edited_body,null);assert.equal(item.edited_content,null);
      for(const uid of [A,B])assert.equal((await as(uid,'select count(*)::int as n from public.messages where id=$1',[rich.id])).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int as n from public.messages where id=$1',[rich.id])).rows[0].n,1);
    });
    await t.test('deleted messages cannot be edited, pinned or reacted to',async()=>{
      for(const action of [()=>edit(rich.id,3,'Восстановить','before'),()=>pin(rich.id,true),()=>pin(rich.id,false),()=>react(rich.id,'🔥',true),()=>react(rich.id,'👍',false)])
        await assert.rejects(action(),{code:'22023'});
      await assert.rejects(del(rich.id,3,{uid:B}),{code:'42501'});
    });
    await t.test('all actions preserve conversation ordering and existing reply references',async()=>{
      assert.deepEqual(await state(),initialSequences);
      assert.equal((await db.query('select attachment_metadata from public.messages where id=$1',[rich.id])).rows[0].attachment_metadata.reply_to.message_id,anchor.id);
      assert.equal((await send(original)).id,rich.id);
    });
    await t.test('all action functions have fixed paths, private definer/public invoker split, and no anonymous execute',async()=>{
      const names=['edit_message_text','delete_message','set_message_pin','set_message_reaction','get_message_actions','get_pinned_messages'];
      const funcs=(await db.query(`select n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as member from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where p.proname=ANY($1::text[]) and n.nspname in ('public','pablicus_chat_private')`,[names])).rows;
      assert.equal(funcs.length,12);
      for(const f of funcs){assert.equal(f.prosecdef,f.nspname==='pablicus_chat_private');assert.deepEqual(f.proconfig,['search_path=""']);assert.equal(f.anon,false);assert.equal(f.member,true);}
    });
  } finally { await db.close(); }
});
