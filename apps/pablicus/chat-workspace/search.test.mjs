import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002';
const C='10000000-0000-4000-8000-000000000003', D='10000000-0000-4000-8000-000000000004';
const CHAT='20000000-0000-4000-8000-000000000001', OTHER='20000000-0000-4000-8000-000000000003';

test('exact search proposal: effective history, membership, block cursors and storage aggregates',async t=>{
  const db=new PGlite();
  try {
    for (const file of ['schema-fixture.sql','SCHEMA_PROPOSAL.sql','REPLY_SCHEMA_PROPOSAL.sql','ACTIONS_SCHEMA_PROPOSAL.sql'])
      await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
    // The production Storage schema has these fields; older test suites need only its minimal subset.
    await db.exec('ALTER TABLE storage.objects ADD COLUMN owner uuid, ADD COLUMN is_delete_marker boolean NOT NULL DEFAULT false, ADD COLUMN archived_at timestamptz');
    await db.exec(await readFile(new URL('SEARCH_SCHEMA_PROPOSAL.sql',import.meta.url),'utf8'));
    const as=async(uid,sql,args=[],role='authenticated')=>{
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
      await db.exec(`SET ROLE ${role}`);
      try { return (await db.query(sql,args)).rows; } finally { await db.exec('RESET ROLE'); }
    };
    const search=(query,{uid=A,chat=CHAT,before=null,limit=30}={})=>as(uid,'select * from public.pablicus_search_messages($1,$2,$3,$4)',[chat,query,before,limit]);
    const materials=(kind,{uid=A,chat=CHAT,query='',seq=null,index=null,limit=40}={})=>as(uid,'select * from public.pablicus_chat_materials($1,$2,$3,$4,$5,$6)',[chat,kind,query,seq,index,limit]);
    const usage=(uid=A)=>as(uid,'select * from public.pablicus_storage_usage()');
    const insert=async(seq,type,body,metadata=null,{chat=CHAT,path=null}={})=>(await db.query(
      'insert into public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_metadata,attachment_path) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6::jsonb,$7) returning *',
      [chat,seq,A,type,body,JSON.stringify(metadata),path])).rows[0];
    await db.query(`insert into public.messages(client_message_id,conversation_id,server_seq,sender_id,type,body)
      select gen_random_uuid(),$1,n,$2,'text',case when n=1 then 'Давний Needle из начала истории' else 'History item '||n end
      from generate_series(1,131) n`,[CHAT,A]);
    const rich=await insert(132,'rich','old original only',{
      v:1,blocks:[
        {id:'text_a',type:'text',text:'Oldneedle https://old.example/a and https://old.example/b.'},
        {id:'photo',type:'image',path:`${CHAT}/${A}/photo.jpg`,name:'Снимок.jpg',mime:'image/jpeg',size:10},
        {id:'doc_a',type:'document',path:`${CHAT}/${A}/one.pdf`,name:'Бюджет_100%.pdf',mime:'application/pdf',size:20},
        {id:'doc_b',type:'document',path:`${CHAT}/${A}/two.pdf`,name:'Бюджет_A100Z.pdf',mime:'application/pdf',size:30},
        {id:'voice_a',type:'audio',path:`${CHAT}/${A}/one.ogg`,name:'Голос 1.ogg',mime:'audio/ogg',size:40,duration:4.5},
        {id:'voice_b',type:'audio',path:`${CHAT}/${A}/two.ogg`,name:'Голос 2.ogg',mime:'audio/ogg',size:50,duration:5},
        {id:'text_b',type:'text',text:'x'.repeat(320)+' late-caption-token'}
      ]
    });
    const legacyAudio=await insert(133,'file','Audio caption',{name:'legacy.ogg',mime_type:'audio/ogg',size_bytes:60},{path:`${CHAT}/${A}/legacy.ogg`});
    const legacyVideo=await insert(134,'video','Video caption',{name:'legacy.mp4',mime_type:'video/mp4',size_bytes:70},{path:`${CHAT}/${A}/legacy.mp4`});
    const legacyText=await insert(135,'text','Old legacy https://legacy-old.example/path');
    await insert(1,'text','Needle from another conversation',null,{chat:OTHER});
    await insert(136,'text','Literal 50%_done and C:\\folder; other text');
    await insert(137,'text','Literal 50ABdone and C:folder; other text');
    const deleted=await insert(138,'rich','Deletion marker',{
      v:1,blocks:[{id:'gone_text',type:'text',text:'Deletedneedle https://deleted.example/path'},
        {id:'gone_doc',type:'document',path:`${CHAT}/${A}/deleted.pdf`,name:'deleted-only.pdf',mime:'application/pdf',size:80}]
    });
    await as(A,'select * from public.delete_message($1,$2,0)',[CHAT,deleted.id]);

    await t.test('all endpoints deny no identity, suspended accounts and anonymous role; chat RPCs deny outsiders',async()=>{
      for(const uid of [null,D]) {
        for(const run of [()=>search('Needle',{uid}),()=>materials('media',{uid}),()=>usage(uid)])
          await assert.rejects(run(),{code:'42501'});
      }
      for(const run of [()=>search('Needle',{uid:C}),()=>materials('documents',{uid:C})]) await assert.rejects(run(),{code:'42501'});
      for(const [sql,args] of [['select * from public.pablicus_search_messages($1,$2)',[CHAT,'Needle']],
        ['select * from public.pablicus_chat_materials($1,$2)',[CHAT,'media']],['select * from public.pablicus_storage_usage()',[]]])
        await assert.rejects(as(null,sql,args,'anon'),{code:'42501'});
    });
    await t.test('history search reaches outside the 120 loaded messages and never crosses chats',async()=>{
      const rows=await search('  дАвНиЙ needle  ');
      assert.equal(rows.length,1);assert.equal(rows[0].server_seq,1);assert.match(rows[0].snippet,/Давний Needle/);
      assert.ok(!('attachment_metadata' in rows[0]));
      assert.deepEqual((await search('Needle from another')).map(r=>r.message_id),[]);
      assert.equal((await search('Needle from another',{chat:OTHER})).length,1);
    });
    await t.test('wildcards and backslash remain literal in messages and filenames',async()=>{
      assert.equal((await search('50%_done')).length,1);
      assert.equal((await search('C:\\folder')).length,1);
      const files=await materials('documents',{query:'_100%'});
      assert.equal(files.length,1);assert.equal(files[0].block_id,'doc_a');
    });
    await t.test('text keyset pages are descending, disjoint, complete and bounded',async()=>{
      const ids=[];let before=null;
      while(true) { const page=await search('History item',{before,limit:17});if(!page.length)break;
        assert.ok(page.length<=17);ids.push(...page.map(r=>r.server_seq));before=page.at(-1).server_seq; }
      assert.equal(ids.length,130);assert.equal(new Set(ids).size,130);
      assert.deepEqual(ids,Array.from({length:130},(_,i)=>131-i));
    });
    await t.test('rich and legacy edits replace text/link search without rewriting original payloads',async()=>{
      assert.equal((await search('Oldneedle')).length,1);
      await as(A,'select * from public.edit_message_text($1,$2,0,$3,$4)',[CHAT,rich.id,'Newneedle https://new.example/a https://new.example/b','text_a']);
      await as(A,'select * from public.edit_message_text($1,$2,0,$3)',[CHAT,legacyText.id,'New legacy https://legacy-new.example/path']);
      assert.equal((await search('Oldneedle')).length,0);
      assert.equal((await search('Newneedle'))[0].message_revision,1);
      assert.equal((await search('legacy-old')).length,0);
      assert.equal((await search('legacy-new')).length,1);
      assert.equal((await materials('links',{query:'old.example'})).length,0);
      assert.equal((await materials('links',{query:'https://new.example/'})).length,2);
      assert.equal((await materials('links',{query:'legacy-old'})).length,0);
      assert.equal((await materials('links',{query:'legacy-new'})).length,1);
      const row=(await db.query('select body,attachment_metadata from messages where id=$1',[rich.id])).rows[0];
      assert.equal(row.body,'old original only');assert.match(row.attachment_metadata.blocks[0].text,/Oldneedle/);
    });
    await t.test('deleted message text, files and URLs are absent in every read API',async()=>{
      assert.equal((await search('Deletedneedle')).length,0);
      assert.equal((await materials('documents',{query:'deleted-only'})).length,0);
      assert.equal((await materials('links',{query:'deleted.example'})).length,0);
    });
    await t.test('materials preserve two document/voice/link blocks in one message across one-row pages',async()=>{
      for(const [kind,query,expected] of [['documents','Бюджет',['doc_a','doc_b']],['audio','Голос',['voice_a','voice_b']],['links','https://new.example',['text_a','text_a']]]) {
        let seq=null,index=null;const rows=[];
        while(true) {const page=await materials(kind,{query,seq,index,limit:1});if(!page.length)break;
          rows.push(...page);seq=page[0].server_seq;index=page[0].block_index;}
        assert.deepEqual(rows.map(r=>r.block_id),expected);
        assert.ok(rows.every(r=>r.message_id===rich.id));
        assert.equal(new Set(rows.map(r=>r.block_index)).size,2);
      }
      const voices=await materials('audio',{query:'Голос'});assert.equal(Number(voices[0].duration),4.5);
    });
    await t.test('legacy attachment metadata is normalized and complete caption text stays searchable',async()=>{
      const audio=(await materials('audio',{query:'legacy.ogg'}))[0];
      assert.equal(audio.message_id,legacyAudio.id);assert.equal(audio.block_id,null);assert.equal(audio.mime,'audio/ogg');assert.equal(audio.size,60);
      assert.equal((await materials('media',{query:'legacy.mp4'}))[0].message_id,legacyVideo.id);
      assert.equal((await materials('documents',{query:'late-caption-token'})).length,2);
    });
    await t.test('snippets include matches late in long text and remain small',async()=>{
      const row=(await search('late-caption-token'))[0];assert.match(row.snippet,/late-caption-token/);assert.ok(row.snippet.length<=280);
    });
    await t.test('malformed query, cursor and limit values fail before returning data',async()=>{
      for(const query of [null,' ','x'.repeat(201),' '.repeat(2000)+'x']) await assert.rejects(search(query),{code:'22023'});
      for(const limit of [null,0,101]) { await assert.rejects(search('x',{limit}),{code:'22023'});await assert.rejects(materials('media',{limit}),{code:'22023'}); }
      for(const opts of [{before:0},{before:-1}]) await assert.rejects(search('x',opts),{code:'22023'});
      for(const kind of [null,'all','files','unknown']) await assert.rejects(materials(kind),{code:'22023'});
      for(const opts of [{seq:132},{index:0},{seq:0,index:0},{seq:132,index:-1},{seq:132,index:100001},{query:'x'.repeat(201)}])
        await assert.rejects(materials('media',opts),{code:'22023'});
    });
    await t.test('revoking conversation membership immediately removes access',async()=>{
      assert.equal((await search('Newneedle',{uid:B})).length,1);
      await db.query('delete from conversation_members where conversation_id=$1 and user_id=$2',[CHAT,B]);
      await assert.rejects(search('Newneedle',{uid:B}),{code:'42501'});await assert.rejects(materials('media',{uid:B}),{code:'42501'});
    });
    await t.test('storage aggregate reads real object sizes, ownership fallback, unknowns, retained versions, and bucket scope',async()=>{
      const objects=[
        ['message-media','own',A,null,{size:100},false,null],
        ['message-media','other',C,null,{size:'200'},false,null],
        ['message-media','unknown',A,null,{size:'bogus'},false,null],
        ['message-media','legacy-owner',null,A,{size:25},false,null],
        ['message-media','archived',C,null,{size:40},false,'2026-01-01'],
        ['message-media','delete-marker',A,null,{size:1000},true,null],
        ['avatars','avatar',A,null,{size:9000},false,null]
      ];
      for(const row of objects) await db.query('insert into storage.objects(bucket_id,name,owner_id,owner,metadata,is_delete_marker,archived_at) values($1,$2,$3,$4,$5::jsonb,$6,$7)',[...row.slice(0,4),JSON.stringify(row[4]),...row.slice(5)]);
      const row=(await usage())[0];
      assert.equal(Number(row.total_bytes),365);assert.equal(Number(row.own_bytes),125);
      assert.equal(row.object_count,5);assert.equal(row.own_object_count,3);assert.equal(row.unknown_size_count,1);assert.ok(row.measured_at);
      assert.deepEqual(Object.keys(row).sort(),['measured_at','object_count','own_bytes','own_object_count','total_bytes','unknown_size_count']);
      const outsider=(await usage(C))[0];assert.equal(Number(outsider.total_bytes),365);assert.equal(Number(outsider.own_bytes),240);
      await assert.rejects(as(A,'select name from storage.objects'),{code:'42501'});
    });
    await t.test('public wrappers are invokers, private helpers cannot be called, and exposed RPCs work in read-only transactions',async()=>{
      const funcs=(await db.query(`select n.nspname,p.proname,p.prosecdef,p.provolatile,p.proconfig,
        has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as member
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in
        ('pablicus_search_messages','pablicus_chat_materials','pablicus_storage_usage','search_messages','chat_materials','storage_usage','assert_search_member','effective_search_text','message_material_rows')`)).rows;
      assert.equal(funcs.length,9);
      for(const f of funcs) {assert.equal(f.anon,false);assert.ok(f.proconfig.includes('search_path=""'));
        if(f.nspname==='public') {assert.equal(f.prosecdef,false);assert.equal(f.member,true);assert.equal(f.provolatile,'s');}}
      await assert.rejects(as(A,'select pablicus_chat_private.assert_search_member($1)',[CHAT]),{code:'42501'});
      await assert.rejects(as(A,'select * from pablicus_chat_private.message_material_rows(null::public.messages)'),{code:'42501'});
      await db.exec('BEGIN READ ONLY');
      try {assert.equal((await search('Newneedle')).length,1);assert.equal((await materials('documents')).length,2);assert.equal((await usage()).length,1);}
      finally {await db.exec('ROLLBACK');}
    });
  } finally {await db.close();}
});
