'use strict';
// Independent scenario/observations; the previously inspected executor fixture is
// reused ONLY to load unchanged production functions and provide synthetic I/O.
// Storage, SDK, DOM and list construction are not full-application integration.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [mode,sourceRoot,appPath,controllerPath,chatPath]=process.argv.slice(2);
const fx=fs.readFileSync(path.join(sourceRoot,'tests/engineering/block-01/controller_1b_scenarios.cjs'),'utf8');
const boundary=fx.indexOf('async function runCase(){');if(boundary<0)throw Error('Fixture boundary missing');
const proxy=Object.create(process);proxy.argv=['node','fixture','independent',sourceRoot,controllerPath,appPath];
const {environment,deferred,drain,until,evidence,unhandled}=new Function('require','process',fx.slice(0,boundary)+'\nreturn {environment,deferred,drain,until,evidence,unhandled};')(require,proxy);
const chat=fs.readFileSync(chatPath,'utf8'),leaveLines=chat.split('\n').filter(x=>/^\s*async leave\(\)\{.*\},$/.test(x));
if(leaveLines.length!==1)throw Error('Expected exactly one original leave');
const leave=leaveLines[0]+'\n';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{
 const f=environment(),c=f.ctl;await f.canvas();f.ctx.allowExit=mode!=='deny';
 const gate=deferred(),events=[];let started=false,flushCalls=0;
 f.ctx.reviewFlush=async()=>{flushCalls++;started=true;events.push('flush:start');await gate.promise;events.push('flush:done')};
 f.ctx.reviewEvent=x=>events.push(x);
 f.run(`let destroyed=0,opened=0;const input={blur(){}};function closeMenu(){};
 function makeList(id){return {id,dead:false,destroy(){if(this.dead)throw Error('DOUBLE_DESTROY');this.dead=true;destroyed++;reviewEvent('list:destroy')},probe(){if(this.dead)throw Error('DEAD_RESOURCE');return this.id},refreshFont(){}}}
 let list=makeList('c1');const initialList=list;
 PablicusChat.flush=reviewFlush;PablicusChat.leave=({${leave}}).leave;
 Object.defineProperty(PablicusChat,'list',{get(){return list},configurable:true});
 PablicusChat.open=async(user,id)=>{opened++;list=makeList(id);reviewEvent('list:open')};`);
 const app=fs.readFileSync(appPath,'utf8');
 for(const marker of ['const inboxSeq=new Map()','function mapped(m)']){
  const lines=app.split('\n').filter(l=>l.includes(marker));if(lines.length!==1)throw Error('Production marker missing '+marker);f.run(lines[0]);
 }
 f.ctx.sb.from=()=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:[],error:null})});
 f.ctx.sb.channel=()=>({on(){return this},subscribe(){return this}});f.ctx.messageTools.sync=()=>{};
 const navigation=[];const original=c.navigate;
 c.navigate=(...args)=>{const entry={screen:args[0].screen,state:'pending'};navigation.push(entry);const p=original(...args);
 p.then(result=>{entry.state='fulfilled';entry.result=result;entry.liveAtReturn=f.run('!!list&&!list.dead');events.push('nav:'+entry.screen+':'+result)},error=>{entry.state='rejected';entry.error=error.message;events.push('nav:reject')});return p};
 const before=c.state(),ops=[f.run("$('chatBack').onclick()")];let preRelease;
 if(mode==='deny'){await Promise.allSettled(ops);gate.resolve()}
 else{
  await until(()=>started,'pending real flush');
  if(['resume','reject'].includes(mode))ops.push(f.run('showConversationView()'));
  if(mode==='canvas')ops.push(f.run('showCanvasView()'));
  if(mode==='repeat')ops.push(f.run("$('chatBack').onclick()"));
  if(mode==='latest'){ops.push(f.run('showConversationView()'));ops.push(f.run('showCanvasView()'))}
  const settled=Promise.allSettled(ops);await drain();preRelease=JSON.parse(JSON.stringify(navigation));
  if(mode==='reject')gate.reject(Error('REVIEW_FLUSH_FAILURE'));else gate.resolve();
  await settled;
 }
 await drain();const state=c.state(),appState=f.snapshot(),actual=f.run('({listPresent:!!list,live:!!list&&!list.dead,chat:list?.probe()||null,destroyed,opened,initial:list===initialList})');
 const currentNav=navigation.at(-1);let pass=false;
 if(mode==='deny')pass=JSON.stringify(before)===JSON.stringify(state)&&actual.initial&&actual.live&&flushCalls===0&&actual.destroyed===0&&f.counts.confirm===1&&f.ctx.dirty;
 else if(['complete','repeat'].includes(mode))pass=state.screen==='home'&&appState.current===null&&!actual.listPresent&&actual.destroyed===1&&flushCalls===1&&currentNav.result===true;
 else if(mode==='reject')pass=currentNav.state==='rejected'&&currentNav.error==='REVIEW_FLUSH_FAILURE'&&!navigation.some(n=>n.result===true)&&actual.initial&&actual.live&&actual.destroyed===0&&actual.opened===0&&f.errors.includes('REVIEW_FLUSH_FAILURE');
 else pass=currentNav.result===true&&currentNav.liveAtReturn&&preRelease.at(-1).state==='pending'&&state.screen===(mode==='canvas'||mode==='latest'?'canvas':'conversation')&&state.conversationId==='c1'&&appState.current==='c1'&&actual.live&&actual.chat==='c1'&&actual.destroyed===1&&actual.opened===1&&events.indexOf('flush:done')<events.indexOf('list:destroy')&&events.indexOf('list:destroy')<events.indexOf('list:open')&&events.indexOf('list:open')<events.lastIndexOf('nav:'+state.screen+':true');
 pass=pass&&unhandled.length===0;
 console.log(JSON.stringify({mode,status:pass?'PASS':'FAIL',before,state,appState,actual,events,navigation,preRelease,flushCalls,errors:f.errors,unhandled,leave_sha256:hash(leave),source_spans:evidence.source_spans}));process.exitCode=pass?0:1;
})().catch(e=>{console.log(JSON.stringify({mode,status:'ERROR',reason:e.message,stack:e.stack}));process.exitCode=2});
