'use strict';
// Review-only harness. Reuses inspected fixture solely for extraction and fake I/O.
// All controller and app handlers are exact candidate source. The leave method is
// an unchanged extract of pablicus/chat.js:520 read through GitHub at TESTED_SHA.
// Does not test IndexedDB contents, the whole application, server or device.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [mode,root,leavePath]=process.argv.slice(2);
const fixture=fs.readFileSync(path.join(root,'tests/engineering/block-01/controller_1b_scenarios.cjs'),'utf8');
const prefix=fixture.slice(0,fixture.indexOf('async function runCase(){'));
const proxy=Object.create(process);proxy.argv=['node','fixture','review',root,path.join(root,'pablicus/app-controller.js'),path.join(root,'pablicus/app.js')];
const {environment,deferred,until,bounded,drain,evidence}=new Function('require','process',prefix+'\nreturn {environment,deferred,until,bounded,drain,evidence};')(require,proxy);
const leaveSource=fs.readFileSync(leavePath,'utf8');
(async()=>{try{
 const f=environment(),C=f.ctl;await f.canvas();f.ctx.allowExit=mode!=='DENY_CONTROL';
 const gate=deferred();let flushEntered=false;
 f.ctx.reviewFlush=async()=>{flushEntered=true;await gate.promise};
 f.run(`let reviewDestroyed=0,reviewOpened=0;let list={destroy(){reviewDestroyed++}};const input={blur(){}};function closeMenu(){};PablicusChat.flush=reviewFlush;PablicusChat.leave=({${leaveSource}}).leave;Object.defineProperty(PablicusChat,'list',{get(){return list},configurable:true});PablicusChat.open=async()=>{reviewOpened++;list={destroy(){reviewDestroyed++}}};`);
 const before=C.state();const back=f.run("$('chatBack').onclick()");
 let resumed=null;
 if(mode==='DENY_CONTROL'){await back;gate.resolve()}
 else {await until(()=>flushEntered,'actual leave waits on flush');if(mode==='RESUME_WHILE_LEAVING')resumed=await f.run('showConversationView()');gate.resolve();await bounded(back,'old home completion')}
 await drain();const state=C.state();const actual=f.run('({listPresent:!!list,destroyed:reviewDestroyed,opened:reviewOpened})');
 const pass=mode==='DENY_CONTROL'?actual.listPresent&&actual.destroyed===0&&state.screen==='canvas':mode==='COMPLETE_EXIT_CONTROL'?!actual.listPresent&&actual.destroyed===1&&state.screen==='home':actual.listPresent&&state.screen==='conversation';
 console.log(JSON.stringify({test:mode,status:pass?'PASS':'FAIL',result:{before,after:state,resumed,actual,confirm:f.counts.confirm,app:f.snapshot()},leave_source_sha256:crypto.createHash('sha256').update(leaveSource).digest('hex'),source_spans:evidence.source_spans}));process.exitCode=pass?0:1;
 }catch(e){console.log(JSON.stringify({test:mode,status:'ERROR',error:String(e),stack:e.stack}));process.exitCode=2}})();
