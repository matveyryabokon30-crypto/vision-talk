'use strict';
// R2: execute the production callers and the actual chat.js leave method.
// Only flush, message-list creation/observation, DOM and SDK I/O are synthetic.
// The existing fixture extracts the original app bodies; it is not a second app.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const [id, root, controllerPath, appPath, chatPath] = process.argv.slice(2);
const source = fs.readFileSync(path.join(root, 'tests/engineering/block-01/controller_1b_scenarios.cjs'), 'utf8');
const boundary = source.indexOf('async function runCase(){');
if (boundary < 0) throw Error('SOURCE_EXTRACTION: existing fixture boundary missing');
const proxy = Object.create(process);
proxy.argv = ['node', 'fixture', id, root, controllerPath, appPath];
const fixture = new Function('require', 'process', source.slice(0, boundary) +
  '\nreturn {environment,deferred,until,bounded,drain,evidence,unhandled};')(require, proxy);
const {environment, deferred, until, bounded, drain, evidence, unhandled} = fixture;
const chat = fs.readFileSync(chatPath, 'utf8');
const methods = chat.split('\n').filter(line => /^\s*async leave\(\)\{.*\},$/.test(line));
assert.equal(methods.length, 1, 'SOURCE_EXTRACTION: expected one production leave method');
const leaveSource = methods[0] + '\n';
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const gitBlob = text => crypto.createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
const provenance = {
  path: chatPath, source_sha256: digest(chat), source_git_blob: gitBlob(chat),
  extracted_method_sha256: digest(leaveSource),
  extracted_method_start_line: chat.split('\n').findIndex(line => line === methods[0]) + 1,
  source_kind: chat.trim() === leaveSource.trim() ? 'exact-method-excerpt' : 'full-chat.js',
  fixture_sha256: digest(source),
};
const runs = [];

async function scenario(mode) {
  const f = environment(), C = f.ctl;
  await f.canvas();
  f.ctx.allowExit = mode !== 'DENY';
  const gate = deferred();
  const trace = [];
  let flushEntered = false, flushCalls = 0;
  f.ctx.controlledFlush = async () => {
    flushEntered = true; flushCalls++; trace.push('flush-start');
    await gate.promise; trace.push('flush-end');
  };
  f.ctx.resourceEvent = event => trace.push(event);
  // Install the unmodified method read above. There is no leave implementation here.
  f.run(`
    let destroyed=0,opened=0,used=0,resourceSerial=0;
    function observedList(chatId){
      const value={id:++resourceSerial,chatId,dead:false,
        destroy(){if(this.dead)throw Error('DOUBLE_DESTROY');this.dead=true;destroyed++;resourceEvent('destroy-'+this.id)},
        probe(){if(this.dead)throw Error('DEAD_LIST_USED');used++;return this.chatId},refreshFont(){}};
      return value;
    }
    let list=observedList('c1');const originalList=list;
    const input={blur(){}};function closeMenu(){}
    PablicusChat.flush=controlledFlush;
    PablicusChat.leave=({${leaveSource}}).leave;
    Object.defineProperty(PablicusChat,'list',{get(){return list},configurable:true});
    PablicusChat.open=async(_user,chatId)=>{opened++;list=observedList(chatId);resourceEvent('open-'+list.id)};
  `);
  // Additional production declarations used by the real remount path.
  const appSource=fs.readFileSync(appPath,'utf8');
  for(const marker of ['const inboxSeq=new Map()', 'function mapped(m)']){
    const lines=appSource.split('\n').filter(line=>line.includes(marker));
    if(lines.length!==1)throw Error('SOURCE_EXTRACTION: '+marker);
    f.run(lines[0]);
    evidence.source_spans.push({name:marker,sha256:digest(lines[0])});
  }
  // Network/channel boundaries needed when the *real* mountConversation reopens.
  f.ctx.sb.from = () => ({select(){return this},eq(){return this},order(){return this},
    limit:async()=>({data:[],error:null})});
  f.ctx.messageTools.sync = () => {};
  f.ctx.sb.channel = () => ({on(){return this},subscribe(){return this}});
  const navigation = [];
  const realNavigate = C.navigate;
  C.navigate = (...args) => {
    const record = {target:args[0],status:'pending'}; navigation.push(record);
    const operation = realNavigate(...args);
    // Instrument results without changing the operation returned to the real caller.
    operation.then(value=>{record.status='fulfilled';record.value=value;trace.push('navigate-'+args[0].screen+'-'+value)},
      error=>{record.status='rejected';record.error=String(error.message||error);trace.push('navigate-rejected')});
    return operation;
  };
  const before = C.state();
  const back = f.run("$('chatBack').onclick()");
  let resumed = {status:'not-requested'}, resume = null, secondBack = null;
  if (mode === 'DENY') {
    await bounded(back, 'denied real back'); gate.resolve();
  } else {
    await until(()=>flushEntered, 'real leave entered flush');
    if (['RESUME','REJECT','CANVAS'].includes(mode)) {
      const operation = f.run(mode === 'CANVAS' ? 'showCanvasView()' : 'showConversationView()');
      resumed = {status:'pending'};
      // Attach rejection handling now, not after rejecting the flush gate.
      resume = operation.then(value=>{resumed={status:'fulfilled',value}},
        error=>{resumed={status:'rejected',error:String(error.message||error)}});
    }
    if (mode === 'REPEAT_BACK') secondBack = f.run("$('chatBack').onclick()");
    await drain();
    const beforeRelease = {navigation:JSON.parse(JSON.stringify(navigation)),resumed:{...resumed}};
    if (mode === 'REJECT') gate.reject(Error('1B-LEAVE-FLUSH-FAILURE'));
    else gate.resolve();
    await bounded(Promise.all([back,resume,secondBack].filter(Boolean)), 'leave and successor settlement');
    await drain();
    trace.push('all-operations-settled');
    f.beforeRelease = beforeRelease;
  }
  await drain();
  const state=C.state(), app=f.snapshot();
  const actual=f.run('({listPresent:!!list,destroyed,opened,used,originalPresent:list===originalList,originalDestroyed:originalList.dead,resourceId:list?.id||null})');
  if (actual.listPresent) actual.usableConversation=f.run('PablicusChat.list.probe()');
  const observation={mode,before,after:state,app,actual,resumed,navigation,trace,flushCalls,
    confirm:f.counts.confirm,dirty:f.ctx.dirty,canvasSelected:f.node('canvasTab').getAttribute('aria-selected'),
    errors:[...f.errors],unhandled:[...unhandled],beforeRelease:f.beforeRelease||null};
  runs.push(observation);
  if(f.errors.some(error=>/is not defined|is not a function/.test(error)))throw Error('FIXTURE_ERROR: '+f.errors.join('; '));
  if (mode === 'DENY') {
    assert.ok(JSON.stringify(before)===JSON.stringify(state)&&f.ctx.dirty&&app.visible&&
      actual.originalPresent&&!actual.originalDestroyed&&actual.usableConversation==='c1'&&
      actual.destroyed===0&&flushCalls===0&&f.counts.confirm===1&&navigation[0].value===false,
      '1B-LEAVE-DENY');
  } else if (mode === 'COMPLETE' || mode === 'REPEAT_BACK') {
    assert.ok(state.screen==='home'&&state.conversationId===null&&app.current===null&&
      !actual.listPresent&&actual.destroyed===1&&actual.opened===0&&flushCalls===1&&
      navigation.at(-1).value===true, '1B-LEAVE-COMPLETE');
  } else if (mode === 'REJECT') {
    assert.ok(resumed.status==='rejected'&&resumed.error==='1B-LEAVE-FLUSH-FAILURE'&&
      !navigation.some(event=>event.value===true)&&actual.originalPresent&&!actual.originalDestroyed&&
      actual.usableConversation==='c1'&&actual.destroyed===0&&actual.opened===0&&
      app.current==='c1'&&state.screen==='conversation'&&state.conversationId==='c1'&&
      f.errors.includes('1B-LEAVE-FLUSH-FAILURE')&&unhandled.length===0,
      '1B-LEAVE-FLUSH-REJECT');
  } else {
    assert.ok(resumed.status==='fulfilled'&&resumed.value===true&&
      state.screen===(mode==='CANVAS'?'canvas':'conversation')&&state.conversationId==='c1'&&
      state.resourceId===null&&state.canvas===(mode==='CANVAS')&&app.current==='c1'&&
      actual.listPresent&&actual.usableConversation==='c1'&&actual.destroyed===1&&actual.opened===1&&
      f.beforeRelease.resumed.status==='pending'&&
      trace.indexOf('destroy-1')<trace.indexOf('open-2')&&
      trace.indexOf('open-2')<trace.indexOf('navigate-'+state.screen+'-true')&&
      !f.errors.length&&unhandled.length===0,
      '1B-LEAVE-RESUME');
  }
}

(async()=>{
  try {
    const modes={'1B-LEAVE-DENY':['DENY'],'1B-LEAVE-COMPLETE':['COMPLETE'],
      '1B-LEAVE-RESUME':Array(5).fill('RESUME'),'1B-LEAVE-FLUSH-REJECT':['REJECT'],
      '1B-LEAVE-CANVAS-RESUME':['CANVAS'],'1B-LEAVE-REPEAT-BACK':['REPEAT_BACK']};
    if(!modes[id])throw Error('Unknown leave scenario '+id);
    const failures=[];
    for(const mode of modes[id]){
      try{await scenario(mode)}catch(error){
        if(error.code!=='ERR_ASSERTION')throw error;
        failures.push(error);
      }
    }
    if(failures.length)throw failures[0];
    assert.equal(unhandled.length,0,'NO_UNHANDLED_REJECTION');
    console.log(JSON.stringify({test:id,status:'PASS',provenance,runs,source_spans:evidence.source_spans}));
  } catch(error) {
    console.log(JSON.stringify({test:id,status:error.code==='ERR_ASSERTION'?'FAIL':'ERROR',
      reason:error.message,stack:error.stack,provenance,runs,source_spans:evidence.source_spans,unhandled}));
    process.exitCode=1;
  }
})();
