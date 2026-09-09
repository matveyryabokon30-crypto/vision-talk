(() => {
'use strict';
const BUILD='pablicus-0.1.0-rc5',COUNT=0,LIMIT=120,OVERSCAN=560;
const $=id=>document.getElementById(id),vp=$('vp'),canvas=$('canvas'),app=$('app'),input=$('input');
let sourceMessages=[],scopeUser=null,scopeChat=null,vaultBound=false;let list=null,running=false,seq=COUNT,simulating=false,layoutFrame=0;
const round=x=>Number(Number(x).toFixed(3));
const runtimeErrors=[],observations={keyboard:[],rotation:[],resizes:[]};
const scrollEvidence={events:0,renders:0,gestures:0,programmatic_writes:0,writes_from_scroll:0,measured_rows:0,min_top:Infinity,reached_start:false,last_write_reason:null};
const counters={active_lists:0,created:0,destroyed:0,max_dom:0};
const report={build:BUILD,generated_at:null,user_agent:navigator.userAgent,dataset:COUNT,scope:'Local persistent draft, IndexedDB and original file bytes. No Auth, uploads, real agent or production integration.',overall:'NOT_RUN',integration:'BLOCKED_PENDING_DEVICE_ACCEPTANCE_AND_SUBSEQUENT_GATES',results:[],manual:{status:'PENDING_USER_CONFIRMATION',keyboard:'NOT_OBSERVED',rotation:'NOT_OBSERVED',smoothness:'NOT_MEASURED'}};
function status(s){$('status').textContent=s}
function fatal(e){const s=String(e?.message||e);runtimeErrors.push(s);status('Ошибка: '+s);if(!list){$('fatal').hidden=false;$('fatal').textContent=s}}
window.addEventListener('error',e=>fatal(e.error||e.message));window.addEventListener('unhandledrejection',e=>fatal(e.reason));
function textFor(i){const types=[
'Да, договорились.',
'Напиши, когда будешь на месте. Я выйду через десять минут — ключи и документы уже собраны.',
'Первый абзац.\n\nВторой абзац остаётся отдельным: пустая строка должна сохраниться.\nТретья строка — короткая.',
'🙂 👨‍👩‍👧‍👦 👍🏽 🇪🇸 🧑‍💻\nЭмодзи, кириллица и Latin text находятся в одном сообщении. Проверяем переносы, а не обрезание.',
'https://example.invalid/very-long-link/'+('long_segment_without_spaces_'.repeat(12)),
'Это длинное сообщение для проверки естественной высоты. На узком экране оно занимает больше строк, на широком — меньше. Ни одна строка не должна исчезать под соседним пузырём. '.repeat(5),
'План на завтра:\n09:00 — встреча.\n11:30 — подготовка материалов.\n14:00 — обсуждение правок.\n18:00 — завершение работы.',
'Супердлинноесловобезпробелов'.repeat(17),
'Hello! This is a mixed-language test.\nمرحبا بالعالم — текст справа налево.\n你好，世界。\nОкончание сообщения.',
'Фото появится здесь позже. Место под него зарезервировано до загрузки.',
'Открываю клавиатуру и пишу ответ. Переписка не должна убегать вверх или вниз сама по себе.',
'Последнее сообщение видно сразу. Можно написать свой текст ниже — он останется только на этой тестовой странице.'
];return types[((i%types.length)+types.length)%types.length]}
function makeMessage(i){return{id:'m'+i,number:i,mine:i%3!==0,text:textFor(i),image:i%12===9,imageReady:false,revision:0}}
function dataset(start,n){return Array.from({length:n},(_,i)=>makeMessage(start+i))}
const svgData='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#385168"/><path d="M0 440L190 160L350 340L460 230L640 440" fill="#86b7a7"/><circle cx="480" cy="100" r="48" fill="#edcf90"/><text x="320" y="455" fill="white" text-anchor="middle" font-size="28">LOCAL TEST IMAGE</text></svg>');
function baseNodeFor(m){const row=document.createElement('article');row.className='row'+(m.mine?' mine':'');row.dataset.id=m.id;const bubble=document.createElement('div');bubble.className='bubble';const text=document.createElement('div');text.className='text';if(m.text.startsWith('https://')){const a=document.createElement('a');a.href=m.text;a.textContent=m.text;a.onclick=e=>e.preventDefault();text.append(a)}else text.textContent=m.text;bubble.append(text);if(m.image){const slot=document.createElement('div');slot.className='mediaSlot';if(m.imageReady){const img=new Image();img.alt='Локальная тестовая картинка';img.src=svgData;slot.append(img)}else slot.textContent='Место под картинку';bubble.append(slot)}const meta=document.createElement('div');meta.className='meta';meta.textContent='#'+m.number+' · локальный тест';bubble.append(meta);row.append(bubble);row.dataset.rev=m.revision;return row}
class NaturalList {
constructor(messages){
this.messages=messages; this.heights=new Map(); this.revisions=new Map(); this.nodes=new Map();
this.offsets=[];this.index=new Map();this.width=vp.clientWidth;this.height=vp.clientHeight;
this.follow=true;this.lastAnchor=null;this.frame=0;this.destroyed=false;this.busy=false;this.fault='';
this.measureBox=document.createElement('div');this.measureBox.className='measureBox';
this.measureBox.setAttribute('aria-hidden','true');app.append(this.measureBox);
this.pendingBelow=0;
this.onScroll=()=>{
if(this.destroyed||this.busy)return;
this.follow=this.bottomDistance()<=3;this.lastAnchor=this.capture(false);
scrollEvidence.events++;scrollEvidence.min_top=Math.min(scrollEvidence.min_top,vp.scrollTop);
if(vp.scrollTop<=2)scrollEvidence.reached_start=true;
this.scheduleRender();if(vp.scrollTop<180)window.PablicusHost?.historyTop?.();
};
this.onTouch=()=>{scrollEvidence.gestures++;};
vp.addEventListener('scroll',this.onScroll,{passive:true});
vp.addEventListener('touchstart',this.onTouch,{passive:true});
this.resizeFrame=0;
this.observer=new ResizeObserver(()=>{
if(this.destroyed||this.resizeFrame)return;
this.resizeFrame=requestAnimationFrame(()=>{
this.resizeFrame=0;
if(this.destroyed||this.busy||vp.clientWidth<2||vp.clientHeight<2)return;
if(Math.abs(vp.clientWidth-this.width)>.5||Math.abs(vp.clientHeight-this.height)>.5)
this.sync(this.lastAnchor,this.follow,'viewport-size');
});
});this.observer.observe(vp);
counters.active_lists++;counters.created++;
this.measureMissing();this.rebuild();
}
measureMissing(){
const missing=this.messages.filter(m=>!this.heights.has(m.id)||this.revisions.get(m.id)!==m.revision);
if(!missing.length)return;
const BATCH=20;this.measureBox.style.width=this.width+'px';
for(let start=0;start<missing.length;start+=BATCH){
const group=missing.slice(start,start+BATCH),fragment=document.createDocumentFragment();
for(const m of group)fragment.append(nodeFor(m));
this.measureBox.replaceChildren(fragment);
const nodes=[...this.measureBox.children];
counters.max_dom=Math.max(counters.max_dom,this.nodes.size+nodes.length);
const measured=nodes.map(n=>n.getBoundingClientRect().height);
for(let j=0;j<group.length;j++){
if(!(measured[j]>0))throw Error('Zero measured height: '+group[j].id);
this.heights.set(group[j].id,measured[j]);this.revisions.set(group[j].id,group[j].revision);
}
scrollEvidence.measured_rows+=group.length;
}
this.measureBox.replaceChildren();
}
rebuild(){
this.index.clear();this.offsets=[0];
for(let i=0;i<this.messages.length;i++){
const m=this.messages[i];this.index.set(m.id,i);
const h=this.heights.get(m.id);if(!h)throw Error('Unmeasured row: '+m.id);
this.offsets.push(this.offsets[i]+h);
}
this.total=this.offsets.at(-1)||0;this.pad=Math.max(0,this.height-this.total);
canvas.style.height=Math.ceil(this.total+this.pad)+'px';
}
at(y){let lo=0,hi=this.messages.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.offsets[mid+1]<=y-this.pad)lo=mid+1;else hi=mid}return Math.max(0,Math.min(lo,this.messages.length-1))}
bottomDistance(){return Math.max(0,Math.ceil(this.total+this.pad)-this.height-vp.scrollTop)}
capture(withFollow=true){
if(withFollow&&this.follow)return{end:true};
const top=vp.scrollTop,i=this.at(top+1),m=this.messages[i];
return m?{id:m.id,offset:this.offsets[i]+this.pad-top}:null;
}
writeScroll(value,reason){
const max=Math.max(0,Math.ceil(this.total+this.pad)-this.height);
const target=Math.max(0,Math.min(max,value));
if(Math.abs(vp.scrollTop-target)<.51)return;
scrollEvidence.programmatic_writes++;
if(reason==='scroll-render')scrollEvidence.writes_from_scroll++;
scrollEvidence.last_write_reason=reason;
vp.scrollTop=target;
}
restore(a,follow,reason='mutation'){
if(this.fault==='skip-anchor')return;
if(follow)this.writeScroll(Math.ceil(this.total+this.pad)-this.height,reason);
else if(a?.id&&this.index.has(a.id))this.writeScroll(this.offsets[this.index.get(a.id)]+this.pad-a.offset,reason);
}
scheduleRender(){if(this.frame||this.destroyed)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.render()})}
render(){
if(this.destroyed||!this.messages.length)return;
const y=vp.scrollTop;
const start=this.at(Math.max(0,y-OVERSCAN)),end=this.at(y+this.height+OVERSCAN);
const wanted=new Set(),fragment=document.createDocumentFragment();
for(let i=start;i<=end;i++){
const m=this.messages[i];wanted.add(m.id);let n=this.nodes.get(m.id);
if(!n||n.dataset.rev!==String(m.revision)){
n?.remove();n=nodeFor(m);this.nodes.set(m.id,n);fragment.append(n);
}
const transform='translateY('+(this.offsets[i]+this.pad)+'px)';
if(n.style.transform!==transform)n.style.transform=transform;
}
for(const[id,n]of this.nodes)if(!wanted.has(id)){n.remove();this.nodes.delete(id)}
canvas.append(fragment);
counters.max_dom=Math.max(counters.max_dom,this.nodes.size);
if(this.nodes.size>LIMIT)throw Error('DOM limit exceeded: '+this.nodes.size);
this.updateReturnButton();
scrollEvidence.renders++;
}
sync(anchor=this.capture(),follow=this.follow,reason='mutation'){
if(this.destroyed||this.busy||vp.clientWidth<2||vp.clientHeight<2)return;
this.busy=true;
try{
const width=vp.clientWidth;
if(Math.abs(width-this.width)>.5){this.width=width;this.heights.clear();this.revisions.clear();}
this.height=vp.clientHeight;
this.measureMissing();this.rebuild();this.restore(anchor,follow,reason);this.render();
this.follow=follow;this.lastAnchor=this.capture(false);
}finally{this.busy=false}
}
updateReturnButton(){
const distance=this.bottomDistance(),button=$('new'),dot=$('newDot');
if(distance<=3)this.pendingBelow=0;
const hidden=distance<=48&&this.pendingBelow===0;
if(button.hidden!==hidden)button.hidden=hidden;
const dotHidden=this.pendingBelow===0;
if(dot.hidden!==dotHidden)dot.hidden=dotHidden;
const label=this.pendingBelow?'К последнему сообщению. Новых сообщений: '+this.pendingBelow:'К последнему сообщению';
if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);
}
bottom(){this.pendingBelow=0;this.follow=true;this.sync({end:true},true,'explicit-bottom');}
go(i){if(!this.messages.length)return;i=Math.max(0,Math.min(i,this.messages.length-1));this.follow=false;this.sync({id:this.messages[i].id,offset:0},false,'explicit-navigation');}
prepend(items){const a=this.capture(),f=this.follow;this.messages=items.concat(this.messages);this.sync(a,f,'prepend');}
append(m,force=false){const a=this.capture(),f=force||this.follow;if(!f)this.pendingBelow++;this.messages.push(m);this.sync(a,f,'append');}
edit(id,suffix){const a=this.capture(),f=this.follow,m=this.messages[this.index.get(id)];if(!m)return;m.text+=suffix;m.revision++;this.sync(a,f,'edit');}
refreshFont(){const a=this.lastAnchor,f=this.follow;this.heights.clear();this.revisions.clear();this.sync(a,f,'font-change');}
destroy(){
if(this.destroyed)return;this.destroyed=true;cancelAnimationFrame(this.frame);cancelAnimationFrame(this.resizeFrame);this.observer.disconnect();
vp.removeEventListener('scroll',this.onScroll);vp.removeEventListener('touchstart',this.onTouch);
this.measureBox.remove();this.nodes.clear();canvas.replaceChildren();counters.active_lists--;counters.destroyed++;
}
}
function stableAnchor(){return list?.capture(false)}
function topOf(a){const n=list?.nodes.get(a?.id);return n?n.getBoundingClientRect().top-vp.getBoundingClientRect().top:null}
function anchorDelta(a){const t=topOf(a);return t===null?Infinity:Math.abs(t-a.offset)}
const frames=(n=3)=>new Promise(resolve=>{const next=()=>--n<=0?resolve():requestAnimationFrame(next);requestAnimationFrame(next)});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function audit(){let maxOverlap=0,maxGap=0,maxModel=0,clipped=0,widthErrors=0;const nodes=[...canvas.querySelectorAll('.row')].sort((a,b)=>list.index.get(a.dataset.id)-list.index.get(b.dataset.id));for(let i=0;i<nodes.length;i++){const n=nodes[i],r=n.getBoundingClientRect(),t=n.querySelector('.text,.richMessage'),b=n.querySelector('.bubble'),c=b.getBoundingClientRect(),nr=vp.getBoundingClientRect();maxModel=Math.max(maxModel,Math.abs(r.height-(list.heights.get(n.dataset.id)||0)));if((t&&t.scrollWidth>t.clientWidth+2)||b.scrollWidth>b.clientWidth+2||c.bottom>r.bottom+1||c.top<r.top-1)clipped++;if(r.left<nr.left-1||r.right>nr.right+1||vp.scrollWidth>vp.clientWidth+1)widthErrors++;if(i&&list.index.get(n.dataset.id)===list.index.get(nodes[i-1].dataset.id)+1){const diff=nodes[i-1].getBoundingClientRect().bottom-r.top;maxOverlap=Math.max(maxOverlap,diff);maxGap=Math.max(maxGap,-diff)}}return{rows:nodes.length,max_overlap_px:round(maxOverlap),max_gap_px:round(maxGap),model_error_px:round(maxModel),clipped,width_errors:widthErrors,active:counters.active_lists}}
function okGeometry(g){return g.max_overlap_px<=1.5&&g.max_gap_px<=1.5&&g.model_error_px<=1.5&&!g.clipped&&!g.width_errors}
const draft={expanded:false,mode:'message',attachments:[],task:null,composing:false};
let richComposer=null,replyTarget=null;
const assets=new Map(),liveUrls=new Set();
const cm={inputs:0,layout_updates:0,metadata_reads:0,metadata_active:0,max_metadata_active:0,urls_created:0,urls_revoked:0,local_sends:0,task_events:0,selection_failures:0};
let aid=0,menuOrigin=null,savedSelection=null,menuWasTyping=false,metadataQueue=Promise.resolve(),generation=0,keyStart=null,lastOrientation=null,composerFrame=0,composerPendingAnchor=null;
function urlCreate(blob){const u=URL.createObjectURL(blob);liveUrls.add(u);cm.urls_created++;return u}
function urlRevoke(u){if(!u||!liveUrls.has(u))return;URL.revokeObjectURL(u);liveUrls.delete(u);cm.urls_revoked++}
function nodeFor(m){if(m.richBlocks)return window.PablicusHost.renderPendingMessage(m);if(m.remote)return window.PablicusHost.renderMessage(m);
if(!m.attachmentId)return decorateQueueRow(baseNodeFor(m),m);
const a=assets.get(m.attachmentId),row=document.createElement('article');row.className='row mine';row.dataset.id=m.id;row.dataset.rev=m.revision;
const bubble=document.createElement('div');bubble.className='bubble localAttachment';
const slot=document.createElement('div');slot.className='preview';
if(a?.preview){const im=new Image();im.src=a.preview;im.alt=a.kind==='image'?'Фото на этой странице':'Кадр видео';slot.append(im)}else slot.textContent=a?.kind==='video'?'Видео · локальный файл':'Документ';
const text=document.createElement('div');text.className='text';text.textContent=a?.name||'Локальный файл';
const meta=document.createElement('div');meta.className='meta';meta.textContent='#'+m.number+' · только здесь'+(a?.kind==='video'?' · без воспроизведения':'');bubble.append(slot,text,meta);row.append(bubble);return decorateQueueRow(row,m);
}
function selection(){if(richComposer)return richComposer.capture().selection;return{start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,scroll:input.scrollTop}}
function restoreSelection(s,focus=false){if(!s)return;if(richComposer){richComposer.restoreSelection(s,focus);return;}if(focus)input.focus({preventScroll:true});input.setSelectionRange(s.start,s.end,s.direction);input.scrollTop=s.scroll}
function metrics(){const v=window.visualViewport;return{width:round(v?.width||innerWidth),height:round(v?.height||innerHeight),offsetTop:round(v?.offsetTop||0),pageTop:round(v?.pageTop||0),scale:round(v?.scale||1),list_width:vp.clientWidth,list_height:vp.clientHeight,orientation:screen.orientation?.type||String(window.orientation??'unknown')}}
function controlsGeometry(){const a=app.getBoundingClientRect(),c=$('composer').getBoundingClientRect(),r=$('send').getBoundingClientRect(),i=input.getBoundingClientRect();return{composer_height:round(c.height),input_height:round(i.height),input_scroll_height:input.scrollHeight,send_inside_shell:r.width>=32&&r.height>=32&&r.top>=a.top-1&&r.bottom<=a.bottom+1&&r.right<=a.right+1&&r.left>=a.left-1,send_inside_composer:r.width>=32&&r.height>=32&&r.top>=c.top-1&&r.bottom<=c.bottom+1,list_height:vp.clientHeight,shell_top:round(a.top),shell_bottom:round(a.bottom),composer_top:round(c.top),composer_bottom:round(c.bottom),send_top:round(r.top),send_bottom:round(r.bottom)}}
let fullEntry=null,viewWasFull=false;
let mirror=null,mirrorText=null,mirrorWidth=0,mirrorHeight=40;
function naturalInputHeight(){if(richComposer)return Math.max(40,richComposer.height);
if(!mirror){mirror=document.createElement('textarea');mirror.id='inputMeasure';mirror.readOnly=true;mirror.tabIndex=-1;mirror.setAttribute('aria-hidden','true');app.append(mirror)}
const width=input.clientWidth;
if(mirrorText!==input.value||Math.abs(mirrorWidth-width)>.25){mirror.style.width=width+'px';mirror.value=input.value;mirrorText=input.value;mirrorWidth=width;mirrorHeight=Math.max(40,mirror.scrollHeight);}
return mirrorHeight;
}
function syncComposer(a=list?.capture(),f=list?.follow??true){
const box=$('composeBox'),composer=$('composer');
const typing=document.activeElement===input||!!richComposer&&$('editor').contains(document.activeElement);
app.classList.toggle('typing',typing);
const rich=!!richComposer?.capture().files.length||draft.expanded||draft.attachments.length>0||draft.task||draft.mode!=='message'||input.value.length>50||input.value.includes('\n');
if(draft.expanded&&!viewWasFull){fullEntry={a,f};app.style.setProperty('--dock-height',composer.offsetHeight+'px');}
const returning=!draft.expanded&&viewWasFull;
app.classList.toggle('composer-fullscreen',draft.expanded);
if(draft.expanded){composer.setAttribute('role','dialog');composer.setAttribute('aria-modal','true');composer.setAttribute('aria-label','Редактор сообщения')}else{composer.removeAttribute('role');composer.removeAttribute('aria-modal');composer.removeAttribute('aria-label')}
for(const n of [app.querySelector('header'),app.querySelector('.tools'),$('chatViewTabs'),$('status'),app.querySelector('.stage')])n.inert=draft.expanded;
box.classList.toggle('rich',!!rich);box.classList.toggle('expanded',draft.expanded);
$('tray').hidden=!draft.attachments.length;
$('tray').style.height=app.clientHeight<500?'58px':'90px';
$('draftNote').hidden=!(draft.attachments.length||draft.mode!=='message');
$('expand').textContent=draft.expanded?'↙':'⛶';$('expand').setAttribute('aria-expanded',String(draft.expanded));$('expand').setAttribute('aria-label',draft.expanded?'Вернуться в чат':'Редактор на весь экран');
const attachmentCount=richComposer?.capture().files.length??draft.attachments.length;$('fullTitle').textContent='Сообщение'+(attachmentCount?' · вложений: '+attachmentCount:'');
$('mode').textContent=draft.mode==='message'?'Сообщение':draft.mode==='assistant'?'Помощник · демо':'Задача · демо';
$('send').textContent=draft.mode==='message'?'↑':'▷';$('send').setAttribute('aria-label',draft.mode==='message'?'Отправить сообщение':'Запустить демонстрацию, без ИИ');
$('send').disabled=!list||draft.composing||richComposer?.composing||(!richComposer?.recording&&!hasComposerContent());
if(draft.expanded){
if(richComposer)$('editor').style.height='100%';else input.style.height='100%';
}else{
if(returning&&!richComposer)input.style.height='40px';
const needed=naturalInputHeight();
const chromeHeight=app.querySelector('header').offsetHeight+$('chatViewTabs').offsetHeight+app.querySelector('.tools').offsetHeight+$('status').offsetHeight;
const overhead=composer.offsetHeight-(richComposer?$('editor').offsetHeight:input.offsetHeight);
const maxComposer=Math.max(overhead+40,Math.min(Math.floor(app.clientHeight*.78),app.clientHeight-chromeHeight-64));
const cap=Math.max(40,maxComposer-overhead);
const target=Math.min(needed,cap);
const measuredEditor=richComposer?$('editor'):input;if(Math.abs(measuredEditor.offsetHeight-target)>.5)measuredEditor.style.height=target+'px';
box.dataset.autoCap=String(cap);
}
cm.layout_updates++;
if(returning&&fullEntry){a=fullEntry.a;f=fullEntry.f;fullEntry=null;}
viewWasFull=draft.expanded;
if(list&&!draft.expanded&&(Math.abs(list.height-vp.clientHeight)>.5||Math.abs(list.width-vp.clientWidth)>.5||returning))list.sync(a,f,'composer-size');
if(!$('menuLayer').hidden)positionMenu();
}
function queueComposer(){if(composerFrame)return;composerPendingAnchor={a:list?.capture(),f:list?.follow??true};composerFrame=requestAnimationFrame(()=>{composerFrame=0;const x=composerPendingAnchor;composerPendingAnchor=null;syncComposer(x?.a,x?.f)})}
function changeUI(fn){const a=list?.capture(),f=list?.follow??true;fn();syncComposer(a,f);draftChanged()}
function toggleExpand(){closeMenu(false);const s=selection();changeUI(()=>{draft.expanded=!draft.expanded});restoreSelection(s);if(input.selectionStart!==s.start||input.selectionEnd!==s.end)cm.selection_failures++}
function keyboardOccludesViewport(v){
const active=document.activeElement;
const editable=active&&app.contains(active)&&!active.readOnly&&!active.disabled&&active.inputMode!=='none'&&(active.isContentEditable||active.tagName==='TEXTAREA'||(active.tagName==='INPUT'&&['text','search','email','url','tel','password','number'].includes(active.type)));
return !!(editable&&v&&Math.abs(v.scale-1)<.02&&Math.max(innerHeight,document.documentElement.clientHeight)-v.height>120);
}
function applyLayout(){if(simulating)return;const v=window.visualViewport,w=v?.width||innerWidth,h=v?.height||innerHeight,a=list?.lastAnchor,f=list?.follow??true;
const width=Math.min(w,800),left=(v?.pageLeft??scrollX)+Math.max(0,(w-800)/2),top=v?.pageTop??scrollY;
const keyboardOpen=keyboardOccludesViewport(v),keyboardChanged=app.classList.contains('keyboard-open')!==keyboardOpen;
app.classList.toggle('keyboard-open',keyboardOpen);
const changed=keyboardChanged||Math.abs(app.clientWidth-width)>.5||Math.abs(app.clientHeight-h)>.5;
app.style.transform='translate3d('+left+'px,'+top+'px,0)';app.style.width=width+'px';app.style.height=h+'px';
if(changed)syncComposer(a,f);
if(!running){const m=metrics();observations.resizes.push(m);if(observations.resizes.length>40)observations.resizes.shift();
if(keyStart&&keyStart.height-m.height>100){report.manual.keyboard='SHRINK_OBSERVED_NOT_HUMAN_ACCEPTANCE';observations.keyboard.push({phase:'shrink',viewport:m,controls:controlsGeometry(),bottom_delta_px:list?round(list.bottomDistance()):null});if(observations.keyboard.length>20)observations.keyboard.shift()}
if(lastOrientation&&Math.abs(lastOrientation.width-m.width)>80){report.manual.rotation='WIDTH_CHANGE_OBSERVED_NOT_HUMAN_ACCEPTANCE';observations.rotation.push({before:lastOrientation,after:m,controls:controlsGeometry()})}lastOrientation=m;}
}
function queueLayout(){if(layoutFrame)return;layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;applyLayout()})}
async function openChat(){list?.destroy();canvas.replaceChildren();seq=COUNT;const t=performance.now();vp.style.visibility='hidden';$('startPanel').hidden=true;list=new NaturalList(sourceMessages.concat(queueMessages()));list.bottom();syncComposer({end:true},true);vp.style.visibility='visible';await frames(2);report.last_open={mount_ms:round(performance.now()-t),bottom_delta_px:round(list.bottomDistance()),last_id:list.messages.at(-1)?.id||null,dom_rows:list.nodes.size};status('');return report.last_open}
function addAssetNode(a){const n=document.createElement('div');n.className='attachment';n.dataset.asset=a.id;const glyph=document.createElement('span');glyph.className='fileGlyph';glyph.textContent=a.kind==='image'?'▧':a.kind==='video'?'▷':'▤';const label=document.createElement('span');label.className='label';label.textContent=a.kind==='document'?a.name:'Готовлю превью…';const b=document.createElement('button');b.type='button';b.className='remove';b.textContent='×';b.setAttribute('aria-label','Удалить вложение '+a.name);b.addEventListener('pointerdown',e=>{if(document.activeElement===input)e.preventDefault()});b.onclick=()=>removeAsset(a.id);n.append(glyph,label,b);$('tray').append(n)}
function assetLabel(a){return a.kind==='video'?(a.duration?Math.floor(a.duration/60)+':'+String(Math.round(a.duration%60)).padStart(2,'0')+' · видео':'Видео'):(a.kind==='image'?'Фото':a.name)}
function updateAssetNode(a){const n=$('tray').querySelector('[data-asset="'+a.id+'"]');if(!n)return;
if(a.preview){const im=new Image();im.alt=a.kind==='image'?'Превью фото':'Кадр видео';im.src=a.preview;n.querySelector('.fileGlyph')?.remove();n.prepend(im)}
n.querySelector('.label').textContent=assetLabel(a)+(a.state==='error'?' · без превью':'');n.title=a.name+(a.state==='error'?' — превью недоступно, файл остаётся в черновике':'');
}
function canvasBlob(c){return new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.72))}
async function makePreview(a){
if(!assets.has(a.id)||a.kind!=='image')return;
cm.metadata_reads++;cm.metadata_active++;cm.max_metadata_active=Math.max(cm.max_metadata_active,cm.metadata_active);
const source=urlCreate(a.file),isVideo=a.kind==='video',el=isVideo?document.createElement('video'):new Image();let timer,settled=false;
try{
const info=await new Promise((resolve,reject)=>{
const fail=()=>{if(!settled){settled=true;reject(Error('preview unavailable'))}};
timer=setTimeout(fail,4500);el.onerror=fail;
if(isVideo){el.muted=true;el.playsInline=true;el.preload='auto';el.onloadedmetadata=()=>{a.duration=Number.isFinite(el.duration)?el.duration:0;try{el.currentTime=Math.min(.1,Math.max(0,(a.duration||1)/3))}catch{fail()}};el.onseeked=()=>{if(!settled){settled=true;resolve({w:el.videoWidth,h:el.videoHeight})}};}
else el.onload=()=>{if(!settled){settled=true;resolve({w:el.naturalWidth,h:el.naturalHeight})}};
el.src=source;
});
clearTimeout(timer);if(!info.w||!info.h)throw Error('no dimensions');
const c=document.createElement('canvas'),scale=Math.min(1,240/Math.max(info.w,info.h));c.width=Math.max(1,Math.round(info.w*scale));c.height=Math.max(1,Math.round(info.h*scale));c.getContext('2d').drawImage(el,0,0,c.width,c.height);const blob=await canvasBlob(c);c.width=c.height=1;
if(blob&&assets.has(a.id)){a.preview=urlCreate(blob);a.width=info.w;a.height=info.h;a.state='ready'}
}catch{if(assets.has(a.id))a.state='error'}finally{clearTimeout(timer);el.onload=el.onerror=null;if(isVideo){el.onloadedmetadata=el.onseeked=null;el.pause();el.removeAttribute('src');el.load()}else el.src='';urlRevoke(source);cm.metadata_active--;if(assets.has(a.id)){updateAssetNode(a);const m=list?.messages.find(m=>m.attachmentId===a.id);if(m){const anchor=list.capture(),follow=list.follow;m.revision++;list.sync(anchor,follow,'poster-ready')}}}
}
function addFiles(files,forceDocument=false){if(richComposer)return richComposer.addFiles(files);
const selected=Array.from(files||[]).filter(f=>window.PablicusHost.acceptFile(f)),s=selection();
changeUI(()=>{for(const file of selected){if(draft.attachments.length>=12){status('В этом стенде максимум 12 вложений в черновике');break}const kind=forceDocument?'document':file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':'document';
const a={id:'a'+DraftVault.uid(),name:file.name,file,kind,preview:null,state:kind==='document'?'ready':'pending',duration:0};assets.set(a.id,a);draft.attachments.push(a.id);addAssetNode(a);
metadataQueue=metadataQueue.then(()=>makePreview(a)).catch(fatal);}});restoreSelection(s);draftChanged();return metadataQueue;
}
function removeAsset(id){const i=draft.attachments.indexOf(id);if(i<0)return;const s=selection();changeUI(()=>{draft.attachments.splice(i,1);$('tray').querySelector('[data-asset="'+id+'"]')?.remove();const a=assets.get(id);urlRevoke(a?.preview);assets.delete(id)});restoreSelection(s);draftChanged()}
function clearDraft(){replyTarget=null;paintReply();richComposer?.clear();const s=selection();changeUI(()=>{for(const id of draft.attachments){urlRevoke(assets.get(id)?.preview);assets.delete(id)}draft.attachments=[];$('tray').replaceChildren();input.value='';draft.expanded=false;draft.mode='message';draft.task=null;renderTask()});restoreSelection({start:0,end:0,direction:'none',scroll:0});draftChanged()}
async function demoPhoto(){const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='#263c52';ctx.fillRect(0,0,320,240);ctx.fillStyle='#acf4c4';ctx.fillRect(45,45,230,150);ctx.fillStyle='#263c52';ctx.font='bold 24px sans-serif';ctx.fillText('LOCAL TEST',78,128);const blob=await canvasBlob(c);return addFiles([new File([blob],'test-photo.jpg',{type:'image/jpeg'})])}
function renderTask(){const t=draft.task;$('taskBar').hidden=!t;$('taskText').textContent=t?'ДЕМО · '+(t.kind==='assistant'?'Помощник':'Задача')+' · '+t.state:'';$('taskNext').hidden=!t||['Готово','Отменено'].includes(t.state)}
function startTask(){if(!input.value.trim()&&!draft.attachments.length)return;changeUI(()=>{draft.task={kind:draft.mode==='assistant'?'assistant':'task',state:'В очереди',input_chars:input.value.length,attachments:draft.attachments.length};draft.mode='message';cm.task_events++;renderTask()});status('Демонстрация. Никакой агент не запущен; черновик сохранён.')}
function advanceTask(cancel=false){if(!draft.task)return;changeUI(()=>{draft.task.state=cancel?'Отменено':draft.task.state==='В очереди'?'Выполняется (демо)':'Готово';cm.task_events++;renderTask()})}
const menuIcons={
gallery:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/>',
camera:'<path d="m8 6 2-3h4l2 3h3a2 2 0 0 1 2 2v11H3V8a2 2 0 0 1 2-2h3Z"/><circle cx="12" cy="12.5" r="3.5"/>',
documents:'<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
modes:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
keyboard:'<rect x="2" y="4" width="20" height="12" rx="3"/><path d="M6 8h.1M10 8h.1M14 8h.1M18 8h.1M6 12h12m-9 8 3 2 3-2"/>',
clear:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
file:'<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5"/>',
scan:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M6 12h12"/>',
back:'<path d="m14 5-7 7 7 7M7 12h14"/>',
message:'<path d="M21 14a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8Z"/>',
assistant:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
task:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
startTask:'<path d="m8 4 12 8-12 8V4Z"/>',nextTask:'<path d="m9 5 7 7-7 7"/>',cancelTask:'<path d="m6 6 12 12M6 18 18 6"/>'
};
const menuRows={
attach:[['gallery','Фото и видео'],['camera','Камера'],['documents','Документы'],['keyboard','Клавиатура'],['clear','Очистить']],
documents:[['file','Файлы'],['scan','Фото документа'],['back','Назад']],
modes:[['message','Сообщение'],['assistant','Помощник · демо'],['task','Задача · демо'],['back','Назад']],
tasks:[['startTask','Создать · демо'],['nextTask','Далее · демо'],['cancelTask','Отменить · демо']]
};
function positionMenu(){
if($('menuLayer').hidden)return;
const p=$('pop'),shell=app.getBoundingClientRect(),button=$('attach').getBoundingClientRect();
const edge=8,gap=6,originTop=button.top-shell.top;
p.style.bottom=Math.max(edge,app.clientHeight-originTop+gap)+'px';
p.style.maxHeight=Math.max(0,originTop-gap-edge)+'px';
p.style.maxWidth=Math.max(0,app.clientWidth-edge*2)+'px';
const width=p.offsetWidth;
p.style.left=Math.max(edge,Math.min(button.left-shell.left,app.clientWidth-width-edge))+'px';
}
function closeMenu(restore=false){
$('menuLayer').hidden=true;menuOrigin?.setAttribute('aria-expanded','false');
if(restore){restoreSelection(savedSelection,menuWasTyping);if(!menuWasTyping)menuOrigin?.focus({preventScroll:true})}
}
function openMenu(kind,origin=$('attach'),keyboard=false){
const layer=$('menuLayer'),pop=$('pop');
if(!layer.hidden&&pop.dataset.kind===kind){closeMenu(true);return}
const opening=layer.hidden;
menuOrigin?.setAttribute('aria-expanded','false');
if(opening){savedSelection=selection();menuWasTyping=document.activeElement===input;menuOrigin=origin;}
origin.setAttribute('aria-expanded','true');pop.dataset.kind=kind;
pop.setAttribute('aria-label',kind==='documents'?'Документы':kind==='modes'||kind==='tasks'?'Демонстрация, без ИИ':'Добавить');
pop.replaceChildren();
for(const [action,label] of menuRows[kind]||menuRows.attach){
const b=document.createElement('button');b.type='button';b.role='menuitem';b.dataset.action=action;b.tabIndex=-1;
const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');icon.innerHTML=menuIcons[action]||menuIcons.file;
const text=document.createElement('span');text.className='menuLabel';text.textContent=label;b.append(icon,text);
if(['documents','modes'].includes(action)){b.setAttribute('aria-haspopup','menu');const mark=document.createElement('span');mark.className='menuChevron';mark.setAttribute('aria-hidden','true');mark.textContent='›';b.append(mark)}
if(action==='clear')b.classList.add('destructive');
b.onpointerdown=e=>{if(menuWasTyping&&e.pointerType!=='')e.preventDefault()};b.onclick=()=>menuAction(action);pop.append(b);
}
layer.hidden=false;positionMenu();if(keyboard)pop.querySelector('button').focus({preventScroll:true});
}
function menuAction(action){
if(['documents','back'].includes(action)){openMenu(action==='back'?'attach':action,menuOrigin);return}
if(['gallery','camera','file','scan'].includes(action)){closeMenu(false);const id={gallery:'galleryInput',camera:'cameraInput',file:'documentInput',scan:'scanInput'}[action];$(id).click();return}
if(action==='clear'){closeMenu(false);if(confirm('Удалить текст и выбранные вложения этого черновика?'))clearDraft();return}
if(action==='keyboard'){closeMenu(false);richComposer?richComposer.blur():input.blur();return}
if(['assistant','task','modes','tasks'].includes(action)){closeMenu(true);window.PablicusHost.unavailable('Помощник');return}if(['message'].includes(action)){closeMenu(false);changeUI(()=>draft.mode=action);restoreSelection(savedSelection,menuWasTyping);return}
closeMenu(false);if(action==='startTask')startTask();if(action==='nextTask')advanceTask();if(action==='cancelTask')advanceTask(true);
}
function menuKeys(e){if($('menuLayer').hidden)return;const items=[...$('pop').querySelectorAll('button')];let i=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();i=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:items.length-1))%items.length;items[Math.max(0,i)].focus({preventScroll:true})}if(e.key==='Escape'){e.preventDefault();closeMenu(true)}if(e.key==='Tab')closeMenu(false)}
function snapshot(){return JSON.parse(JSON.stringify({...report,exported_at:new Date().toISOString(),viewport_now:metrics(),observations,scroll_evidence:scrollEvidence,counters,composer_metrics:cm,controls:controlsGeometry(),draft_summary:{characters:input.value.length,attachments:draft.attachments.length,expanded:draft.expanded,mode:draft.mode,task_state:draft.task?.state||null},resources:{retained_assets:assets.size,active_object_urls:liveUrls.size},errors:runtimeErrors,current_geometry:list?audit():null}))}
function showReport(){closeMenu(false);const r=snapshot();$('verdict').textContent='Автоматическая часть: '+r.overall+' · интеграция заблокирована';$('reportRows').replaceChildren();for(const x of r.results){const n=document.createElement('div');n.className=x.pass?'pass':'fail';n.textContent=(x.pass?'PASS · ':'FAIL · ')+x.name+' — '+JSON.stringify(x.measured);$('reportRows').append(n)}$('reportView').textContent=JSON.stringify(r,null,2);$('modal').showModal()}
async function resetAll(){closeMenu(false);clearDraft();generation++;for(const a of assets.values())urlRevoke(a.preview);assets.clear();await openChat()}
function initComposer(){
app.addEventListener('focusin',queueLayout);app.addEventListener('focusout',queueLayout);
window.addEventListener('resize',queueLayout);window.visualViewport?.addEventListener('resize',queueLayout);window.visualViewport?.addEventListener('scroll',queueLayout);
input.addEventListener('input',()=>{cm.inputs++;queueComposer();draftChanged()});input.addEventListener('compositionstart',()=>{draft.composing=true;$('send').disabled=true});input.addEventListener('compositionend',()=>{draft.composing=false;queueComposer()});
input.addEventListener('focus',()=>{keyStart=metrics();queueComposer();queueLayout()});input.addEventListener('blur',()=>{setTimeout(()=>{if(document.activeElement!==input){if(keyStart&&!running)observations.keyboard.push({phase:'blur',viewport:metrics(),controls:controlsGeometry()});keyStart=null;queueComposer();queueLayout()}},400)});
$('editor').addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!richComposer?.composing){if(!$('menuLayer').hidden){e.preventDefault();closeMenu(true)}else if(draft.expanded){e.preventDefault();toggleExpand()}}});
$('composeBox').addEventListener('pointerdown',e=>{if(e.target.closest('button')&&document.activeElement===input)e.preventDefault()});
$('attach').onclick=e=>openMenu('attach',$('attach'),e.detail===0);$('mode').onclick=e=>openMenu('modes',$('mode'),e.detail===0);$('taskMenu').onclick=()=>window.PablicusHost.unavailable('Помощник');
$('expand').onclick=toggleExpand;$('hideKey').onclick=()=>richComposer?richComposer.blur():input.blur();$('send').onclick=localSend;$('taskNext').onclick=()=>advanceTask();$('taskCancel').onclick=()=>advanceTask(true);$('outside').onpointerdown=e=>{if(menuWasTyping)e.preventDefault()};$('outside').onclick=()=>closeMenu(true);document.addEventListener('keydown',menuKeys);
for(const id of ['galleryInput','cameraInput','documentInput','scanInput'])$(id).onchange=e=>{addFiles(e.target.files,id==='documentInput'||id==='scanInput');e.target.value=''};
input.addEventListener('paste',e=>{const fs=Array.from(e.clipboardData?.files||[]);if(fs.length){e.preventDefault();addFiles(fs)}});
$('new').onpointerdown=e=>{if(document.activeElement===input)e.preventDefault()};$('new').onclick=() =>list?.bottom();$('bottom').onclick=()=>list?.bottom();$('history').onclick=()=>list?.go(130);$('incoming').onclick=()=>{if(list){list.append(makeMessage(++seq));status('Входящее добавлено только локально')}};
$('open').onclick=()=>openChat().catch(fatal);$('demoPhoto').onclick=()=>demoPhoto().catch(fatal);$('reset').onclick=()=>{if(confirm('Сбросить локальную ленту, текст и вложения?'))resetAll().catch(fatal)};
$('reportBtn').onclick=showReport;$('closeReport').onclick=()=>$('modal').close();
$('copy').onclick=async()=>{const t=JSON.stringify(snapshot(),null,2);try{await navigator.clipboard.writeText(t);$('copy').textContent='Скопировано'}catch{const a=$('copyFallback');a.hidden=false;a.value=t;a.select();$('copy').textContent='Скопируй выделенный JSON'}};
$('download').onclick=()=>{const b=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=BUILD+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000)};
window.addEventListener('pagehide',e=>{if(!e.persisted)for(const u of [...liveUrls])urlRevoke(u)});
applyLayout();syncComposer();
}
async function fillDraft(value){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));await frames(3)}
let vault=null,storeTests=null,storeTesting=false;
function captureDraft(){if(richComposer)return {...richComposer.capture(),reply_to:replyTarget,expanded:draft.expanded};return {text:input.value,expanded:draft.expanded,selection:{start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection},files:draft.attachments.map(id=>{const a=assets.get(id);if(!a?.file)throw Error('Missing local file');return{id:a.id,name:a.name,type:a.file.type,size:a.file.size,lastModified:a.file.lastModified,kind:a.kind,file:a.file}})}}
function draftChanged(){vault?.changed()}
async function restoreDraft(s){
 if(richComposer){if(!list)await openChat();await richComposer.restore(s);replyTarget=s.reply_to||null;paintReply();draft.expanded=!!s.expanded;syncComposer();return;}
 if(!list)await openChat();
 clearDraft();
 input.value=s.text;draft.expanded=!!s.expanded;draft.mode='message';draft.task=null;renderTask();
 for(const f of s.files){const a={id:f.id,name:f.name,file:f.file,kind:f.kind,preview:null,state:f.kind==='document'?'ready':'pending',duration:0};assets.set(a.id,a);draft.attachments.push(a.id);addAssetNode(a);metadataQueue=metadataQueue.then(()=>makePreview(a)).catch(fatal)}
 syncComposer();restoreSelection({...s.selection,scroll:0},false);
 status('Черновик восстановлен локально. Ничего не отправлено.');
}
function paintVault(s){
 const needsAttention=['error','load-error','conflict'].includes(s.state);
 $('vaultLine').hidden=!needsAttention;
 $('composer').style.setProperty('--save-feedback-height',needsAttention?'24px':'0px');
 const labels={error:'Не сохранено · '+(s.error?.name||'ошибка'),'load-error':'Восстановление недоступно',conflict:'Изменено в другой вкладке'};
 const n=$('saveState');n.textContent=labels[s.state]??'';n.dataset.state=s.state;n.title=s.error?.message||'Локальное хранилище, не отправка и не облачная резервная копия';
 $('saveRetry').hidden=!['error','load-error'].includes(s.state);
 $('loadSaved').hidden=s.state!=='conflict';
}
function lockDraft(yes){$('composeBox').inert=yes;$('open').disabled=yes;$('reloadSaved').disabled=yes;}
function publicSnapshot(){const old=snapshot();return {...old,scope:'Local durable outbox; atomic draft handoff, original attachment bytes and stable IDs. Same origin/browser; no transport, auth, server ACK, offline shell or background delivery.',overall:queueTests?.overall||'NOT_RUN',generated_at:queueTests?.generated_at||null,results:queueTests?.results||[],summary:queueTests?.summary||null,storage:vault?.public()||null,outbox:queueSummary(),editor_regression:report.overall,manual:{...old.manual,status:'PENDING_DEVICE_ACCEPTANCE'},integration:'BLOCKED_PENDING_DEVICE_AND_REAL_TRANSPORT_GATES'}}
function showStorageReport(){closeMenu(false);const r=publicSnapshot();$('verdict').textContent='Gate 01.5: '+r.overall+' · сохранение: '+(r.storage?.state||'loading');$('reportRows').replaceChildren();for(const x of r.results){const n=document.createElement('div');n.className=x.pass?'pass':'fail';n.textContent=(x.pass?'PASS · ':'FAIL · ')+x.name+' — '+JSON.stringify(x.measured);$('reportRows').append(n)}$('reportView').textContent=JSON.stringify(r,null,2);$('modal').showModal()}
async function runStorageTests(){if(storeTesting)return publicSnapshot();storeTesting=true;const before=captureDraft(),beforeSig=DraftVault.signature(before);$('auto').disabled=true;status('Автотест в отдельной базе. Твой черновик не очищается.');try{storeTests=await DraftVault.tests();const same=DraftVault.signature(captureDraft())===beforeSig;storeTests.results.push({name:'Автотест не меняет пользовательский черновик',pass:same,measured:{unchanged:same}});storeTests.overall=storeTests.results.every(r=>r.pass)?'PASS':'FAIL';storeTests.summary={checks:storeTests.results.length,passed:storeTests.results.filter(r=>r.pass).length};status('ХРАНИЛИЩЕ: '+storeTests.overall+' · обновление страницы проверяется отдельно');}catch(e){storeTests={overall:'FAIL',results:[{name:'Тест хранилища',pass:false,measured:e.name}],generated_at:new Date().toISOString()};status('Автотест: '+e.name)}finally{$('auto').disabled=false;storeTesting=false}return publicSnapshot()}
function notifyError(e){status('Сохранение: '+e.message);return null}
async function initializeVault(){
 vault=new DraftVault.Controller({capture:captureDraft,restore:restoreDraft,paint:paintVault,lock:lockDraft});vault.store=new PablicusRichStore(scopeUser,scopeChat);
 window.vault=vault;
 $('auto').onclick=runQueueTests;
 $('saveRetry').onclick=()=>{if(!vault.ready&&(input.value||draft.attachments.length)&&!confirm('Повторное восстановление может заменить текущий несохранённый текст. Продолжить?'))return;vault.retry().catch(notifyError)};
 $('reloadSaved').onclick=()=>reloadQueue().catch(notifyError);
 $('verifySaved').onclick=()=>vault.verify().then(r=>status(r.pass?'Сверка: текст и байты всех файлов совпали':'Сверка: несовпадение')).catch(notifyError);
 $('loadSaved').onclick=()=>{if(confirm('Заменить текущий несохранённый текст сохранённой версией из другой вкладки?'))vault.loadSaved().catch(notifyError)};

 $('persistRequest').onclick=()=>vault.requestPersistent().then(v=>status(v?'Браузер предоставил устойчивое хранение. Не резервная копия.':'Устойчивое хранение не предоставлено. Обычное локальное сохранение доступно.'));
 $('injectError').onclick=async()=>{if(!vault.ready)return;if(vault.state==='conflict')return;try{await vault.flush()}catch{};vault.store.fault='quota';vault.pending={snapshot:captureDraft()};try{await vault.flush()}catch{status('ДЕМО отказа записи. Текст на экране сохранён; нажми ↻ рядом с ошибкой.')}};
 $('reportBtn').onclick=showStorageReport;
 $('copy').onclick=async()=>{const text=JSON.stringify(publicSnapshot(),null,2);try{await navigator.clipboard.writeText(text);$('copy').textContent='Скопировано'}catch{const a=$('copyFallback');a.hidden=false;a.value=text;a.select();$('copy').textContent='Скопируй JSON'}};
 $('download').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(publicSnapshot(),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=BUILD+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000)};
 $('reset').onclick=()=>{if(confirm('Очистить только черновик? Исходящая очередь не удаляется.')){clearDraft();vault.flush().catch(notifyError)}};
 for(const name of ['select','keyup','pointerup','blur'])input.addEventListener(name,draftChanged);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){draftChanged();vault.flush().catch(()=>{})}else vault.checkOtherTab()});
 window.addEventListener('pageshow',e=>{if(e.persisted)vault.checkOtherTab()});
 window.addEventListener('beforeunload',e=>{if(vault.pending||vault.flight){e.preventDefault();e.returnValue=''}});
 try{queueRows=await vault.store.readQueue();queueLoaded=true;queueStats.restored_groups=queueRows.filter(OutboxVault.active).length;ingestQueue(queueRows);}catch(e){queueError=e;paintQueue();throw e}
 await vault.init();if(!list&&queueRows.some(OutboxVault.active))await openChat();await verifyQueueCheckpoint();
 $('queueBtn').onclick=showQueue;$('closeQueue').onclick=()=>$('queueDialog').close();$('queueVerify').onclick=()=>verifyQueue().catch(()=>{});$('queueReload').onclick=()=>reloadQueue().catch(notifyError);
 $('queueFail').onclick=()=>{vault.store.enqueueFault='quota';status('ТЕСТ: следующая запись в очередь будет отклонена. Напиши текст и нажми отправку.');};
 Object.assign(window.gate,{run:runQueueTests,report:publicSnapshot,captureDraft,queueSummary,verifyQueue,reloadQueue,retryQueued,cancelQueued,refreshQueue,getQueueRows:()=>queueRows,enqueue:localSend});paintQueue();
}
let queueRows=[],queueLoaded=false,queueError=null,submitBusy=false,queueAudit=null,queueReloadCheck=null,queueTests=null,queueTestsBusy=false,submitToken=null;
const queueStats={enqueued_here:0,restored_groups:0,retried_here:0,cancelled_here:0,commit_failures:0};
function queueMessages(){return queueRows.filter(r=>!['sent','cancelled'].includes(r.state)).flatMap(r=>r.messages.map(m=>({id:'out-'+m.id,number:COUNT+m.sequence,mine:true,text:m.text||'',reply_to:m.reply_to||null,richBlocks:m.kind==='rich'?m.blocks:null,image:false,revision:r.version||1,attachmentId:m.assetId||null,outboxId:r.id,queueState:r.state,queueSequence:m.sequence})))}
function decorateQueueRow(node,m){if(!m.outboxId)return node;node.classList.add('outgoing-pending');const meta=node.querySelector('.meta');meta.replaceChildren(...window.PablicusHost.messageMeta({state:m.queueState||'queued'}).childNodes);node.dataset.outboxId=m.outboxId;return node;}
function queueSummary(){const active=queueRows.filter(OutboxVault.active);return{transport:'NOT_CONNECTED',state:queueError?'error':queueLoaded?'ready':'loading',error:queueError?{name:queueError.name,message:queueError.message}:null,groups:active.length,messages:active.reduce((n,x)=>n+x.messages.length,0),files:active.reduce((n,x)=>n+x.files.length,0),cancelled:queueRows.filter(x=>!OutboxVault.active(x)).length,entries:active.map(r=>({client_message_id:r.id,first_sequence:r.first_sequence,messages:r.messages.length,files:r.files.length,state:r.state,retries:r.retries,server_ack:r.server_ack})),...queueStats,submit_in_progress:submitBusy,audit:queueAudit,reload_check:queueReloadCheck,network_observed_online:navigator.onLine,background_delivery:false}}
function paintQueue(){const q=queueSummary();$('queueBtn').textContent=q.groups?'Очередь · '+q.groups:'Очередь';$('queueError').hidden=!queueError;$('queueError').textContent=queueError?(queueError.committed?'Очередь уже записана. Обнови страницу.':'Не добавлено в очередь: '+queueError.message+' · черновик не очищен'):'';if(!$('queueDialog').open)return;renderQueueDialog();}
function ingestQueue(rows){queueRows=rows;for(const r of rows.filter(OutboxVault.active))for(const f of r.files){if(assets.has(f.id))continue;const a={id:f.id,name:f.name,file:f.file,kind:f.kind,preview:null,state:f.kind==='document'?'ready':'pending',duration:0};assets.set(f.id,a);metadataQueue=metadataQueue.then(()=>makePreview(a)).catch(fatal)}
 const held=new Set([...draft.attachments,...rows.filter(OutboxVault.active).flatMap(r=>r.files.map(f=>f.id))]);for(const [id,a]of assets){if(!held.has(id)){urlRevoke(a.preview);assets.delete(id)}}
 if(list){const a=list.capture(),f=list.follow;list.messages=list.messages.filter(m=>!m.outboxId).concat(queueMessages());list.sync(a,f,'queue-update');}paintQueue();}
async function refreshQueue(){const rows=await vault.store.readQueue();ingestQueue(rows);return rows;}
async function localSend(){
 if(submitBusy||draft.composing||richComposer?.composing)return;try{await richComposer?.stopRecording()}catch(e){status(e.message);return;}
 if(!list||submitBusy||!window.PablicusHost?.canSend()||draft.composing||richComposer?.composing||!hasComposerContent())return;
 if(draft.mode!=='message'){startTask();return}
 if(!queueLoaded||!vault.ready){status('Очередь ещё не восстановлена');return}
 let committed=false;submitBusy=true;queueError=null;closeMenu(false);const focused=document.activeElement===input;
 $('composeBox').inert=true;$('send').disabled=true;$('queueError').hidden=true;
 try{
  vault.changed();await vault.flush();const saved=await vault.store.read();
  if(!saved||(!saved.text.trim()&&!saved.files.length))throw Object.assign(Error('Нет сохранённого черновика'),{name:'DataError'});
  submitToken={intent:saved.intent,revision:saved.revision};vault.restoring=true;clearTimeout(vault.timer);
  status('Сохраняю исходящее в очередь…');const result=await vault.store.enqueue(submitToken.intent,submitToken.revision);committed=true;
  if(window.gate.crashAfterCommit){location.reload();return}
  const latest=await vault.store.read();vault.pending=null;vault.rev=latest.revision;
  if(!result.deduplicated){replyTarget=null;paintReply();richComposer?.clear();input.value='';draft.attachments=[];$('tray').replaceChildren();draft.expanded=false;draft.mode='message';draft.task=null;renderTask();}
  else await restoreDraft(latest);
  vault.lastSignature=DraftVault.signature(captureDraft());vault.restoring=false;vault.set('saved');
  await refreshQueue();syncComposer();list.bottom();queueStats.enqueued_here+=result.deduplicated?0:1;cm.local_sends++;
  status('В очереди');window.dispatchEvent(new Event('pablicus:queued'));
 }catch(e){queueError=Object.assign(e,{committed});queueStats.commit_failures++;status(committed?'Очередь записана, но её отображение не обновилось. Перезагрузи страницу.':'Ошибка записи очереди. Текст и вложения оставлены в черновике.');}
 finally{vault.restoring=false;submitBusy=false;$('composeBox').inert=false;syncComposer();if(focused&&!window.gate.crashAfterCommit)input.focus({preventScroll:true});paintQueue();}
}
async function retryQueued(id){try{await vault.store.retry(id);queueStats.retried_here++;await refreshQueue();status('Та же запись остаётся в очереди. Сервера нет — отправки не было.')}catch(e){status(e.message)}return queueSummary()}
async function cancelQueued(id,ask=true){if(ask&&!confirm('Отменить это исходящее только в тестовой очереди? Его вложения будут освобождены, если больше не используются.'))return;await vault.store.cancel(id);queueStats.cancelled_here++;await refreshQueue();status('Исходящее отменено локально. Оно не отправлялось.');}
function renderQueueDialog(){const root=$('queueItems');root.replaceChildren();const active=queueRows.filter(OutboxVault.active);$('queueOverview').textContent='Сервер не подключён. Здесь сохраняются исходящие, но ничего не доставляется. '+(active.length?'В очереди: '+active.length+'.':'Очередь пуста.');
 for(const r of active){const box=document.createElement('section');box.className='queueItem';const h=document.createElement('strong');h.textContent='◷ В очереди · не отправлено';const meta=document.createElement('p');meta.textContent='Порядок '+r.first_sequence+' · сообщений: '+r.messages.length+' · файлов: '+r.files.length+' · повторов: '+r.retries;const preview=document.createElement('p');preview.textContent=r.messages.find(m=>m.kind==='text')?.text.slice(0,160)||'Вложения';
 const retry=document.createElement('button');retry.textContent='Повторить';retry.onclick=async()=>{retry.disabled=true;await retryQueued(r.id)};const cancel=document.createElement('button');cancel.textContent='Отменить';cancel.onclick=()=>cancelQueued(r.id).catch(notifyError);box.append(h,meta,preview,retry,cancel);root.append(box)}
}
function showQueue(){closeMenu(false);$('queueDialog').showModal();renderQueueDialog();}
async function verifyQueue(){try{await vault.flush();const first=await OutboxVault.queueFingerprint(queueRows),stored=await vault.store.readQueue(),second=await OutboxVault.queueFingerprint(stored);const pass=JSON.stringify(first)===JSON.stringify(second);queueAudit={pass,groups:first.length,files:stored.filter(OutboxVault.active).reduce((n,r)=>n+r.files.length,0),total_bytes:stored.filter(OutboxVault.active).reduce((n,r)=>n+r.files.reduce((a,f)=>a+f.size,0),0),kind:'CURRENT_QUEUE_VS_FRESH_DB',checkedAt:new Date().toISOString()};status(pass?'Очередь: текст, порядок и байты совпали':'Очередь: сверка не пройдена');$('queueNote').textContent=pass?'Сверка очереди пройдена':'Сверка не пройдена';return queueAudit;}catch(e){queueAudit={pass:false,error:e.name};notifyError(e);throw e;}}
async function reloadQueue(){
 vault.changed();await vault.flush();const rows=await vault.store.readQueue();const proof=await OutboxVault.queueFingerprint(rows);await vault.store.transaction(['proofs'],'readwrite',tx=>tx.objectStore('proofs').put({id:'queue-checkpoint',value:proof,bootId:vault.bootId,at:new Date().toISOString()}));location.reload();
}
async function verifyQueueCheckpoint(){const proof=await vault.store.transaction(['proofs'],'readonly',(tx,done)=>{const q=tx.objectStore('proofs').get('queue-checkpoint');q.onsuccess=()=>done(q.result)});if(proof&&proof.bootId!==vault.bootId){const actual=await OutboxVault.queueFingerprint(queueRows);queueReloadCheck={pass:JSON.stringify(actual)===JSON.stringify(proof.value),groups:actual.length,kind:'ACTUAL_NEW_PAGE_CHECKPOINT',checkedAt:new Date().toISOString()};await vault.store.transaction(['proofs'],'readwrite',tx=>tx.objectStore('proofs').delete('queue-checkpoint'));if(!queueReloadCheck.pass)status('Контроль очереди после обновления: несовпадение');}}
async function runQueueTests(){if(queueTestsBusy||submitBusy)return publicSnapshot();queueTestsBusy=true;$('auto').disabled=true;const before=DraftVault.signature(captureDraft()),beforeQ=JSON.stringify(queueSummary().entries);status('Проверяю отдельную временную базу, твоя очередь не меняется');try{queueTests=await OutboxVault.tests();queueTests.results.push({name:'Автотест не меняет черновик и пользовательскую очередь',pass:before===DraftVault.signature(captureDraft())&&beforeQ===JSON.stringify(queueSummary().entries),measured:true});queueTests.overall=queueTests.results.every(r=>r.pass)?'PASS':'FAIL';queueTests.summary={checks:queueTests.results.length,passed:queueTests.results.filter(x=>x.pass).length};status('ОЧЕРЕДЬ: '+queueTests.overall+' · реальная доставка не проверялась')}catch(e){queueTests={overall:'FAIL',results:[{name:'Выполнение теста',pass:false,measured:e.name}],summary:{checks:1,passed:0}}}finally{queueTestsBusy=false;$('auto').disabled=false}return publicSnapshot();}

initComposer();
window.gate={build:BUILD,open:openChat,run:runStorageTests,report:snapshot,audit,get list(){return list},draft,cm,assets,liveUrls,scrollEvidence,fillDraft,toggleExpand,addFiles,removeAsset,demoPhoto,clearDraft,openMenu,closeMenu,localSend,startTask,advanceTask,resetAll,selection,syncComposer,controlsGeometry,applyLayout,positionMenu,get previewsSettled(){return metadataQueue}};


function hasComposerContent(){const c=richComposer?.capture();return c?!!c.text.trim()||c.files.length>0:!!input.value.trim()||draft.attachments.length>0;}
function paintReply(){app.classList.toggle('has-reply',!!replyTarget);window.PablicusHost?.paintReplyDraft(replyTarget);}
function setReply(ref){if(submitBusy||vault?.restoring){window.PablicusHost?.notify('Дождитесь сохранения сообщения');return;}if(!list||!vault?.ready)throw Error('Сначала откройте разговор');replyTarget=ref?structuredClone(ref):null;paintReply();draftChanged();queueComposer();richComposer?.focus();}
async function appendContent(content){if(!list||!vault?.ready||submitBusy||vault.restoring||!window.PablicusHost?.canSend())throw Error('Дождитесь сохранения черновика');const targetVault=vault,targetUser=scopeUser,targetChat=scopeChat;await richComposer.stopRecording();if(vault!==targetVault||scopeUser!==targetUser||scopeChat!==targetChat||!window.PablicusHost?.canSend())throw Error('Разговор изменился. Пересылка отменена');const previous=richComposer.capture(),blocks=[...previous.blocks,...content.blocks],files=[...previous.files,...content.files];if(blocks[0]?.type!=='text')blocks.unshift({id:crypto.randomUUID(),type:'text',text:''});if(blocks.at(-1)?.type!=='text')blocks.push({id:crypto.randomUUID(),type:'text',text:''});if(blocks.length>100||blocks.filter(b=>b.type==='text').reduce((n,b)=>n+b.text.length,0)>5000||files.reduce((n,f)=>n+f.size,0)>104857600)throw Error('Вместе с черновиком превышен размер сообщения. Отправьте черновик и повторите пересылку.');richComposer.restore({...previous,blocks,files});draftChanged();queueComposer();await targetVault.flush();if(vault===targetVault&&scopeUser===targetUser&&scopeChat===targetChat&&window.PablicusHost?.canSend())richComposer.focus();}
function ensureRichComposer(){if(richComposer)return;richComposer=PablicusRichComposer.create({
 container:$('editor'),input,
 onChange:()=>{draftChanged();queueComposer()},onGeometry:queueComposer,
 onError:message=>window.PablicusHost?.notify(message),acceptFile:file=>window.PablicusHost.acceptFile(file)
});$('composeBox').append(richComposer.voiceButton);$('composeBox').classList.add('rich-composer');}
window.PablicusChat={
 async open(user,chat,messages){
  ensureRichComposer();await richComposer.stopRecording();
  if(submitBusy)throw Error('Дождитесь сохранения отправки');
  if(vault){draftChanged();await vault.flush();vault.restoring=true;vault.ready=false;clearTimeout(vault.timer);vault.store.close();}
  closeMenu(false);input.blur();list?.destroy();list=null;
  for(const u of [...liveUrls])urlRevoke(u);assets.clear();queueRows=[];queueLoaded=false;queueError=null;
  input.value='';draft.attachments=[];draft.expanded=false;draft.mode='message';draft.task=null;$('tray').replaceChildren();renderTask();
  richComposer.clear();replyTarget=null;paintReply();sourceMessages=messages;scopeUser=user;scopeChat=chat;
  if(!vaultBound){vaultBound=true;await initializeVault()}
  else{vault=new DraftVault.Controller({capture:captureDraft,restore:restoreDraft,paint:paintVault,lock:lockDraft});vault.store=new PablicusRichStore(user,chat);window.vault=vault;queueRows=await vault.store.readQueue();queueLoaded=true;ingestQueue(queueRows);await vault.init();}
  if(!list)await openChat();if(!vault.ready)throw Error('Локальное хранилище недоступно: черновик не будет потерян молча');
  $('reportBtn').onclick=()=>window.PablicusHost.showOutbox();
  syncComposer();return publicSnapshot();
 },
 prepend(messages){if(!messages?.length||!list)return;sourceMessages=messages.concat(sourceMessages);list.prepend(messages);},
 update(messages){sourceMessages=messages;if(!list)return;const a=list.capture(),f=list.follow;
  const incoming=messages.filter(m=>!list.index.has(m.id)).length;
  list.messages=sourceMessages.concat(queueMessages());if(!f)list.pendingBelow+=incoming;
  list.sync(a,f,'server-update');
 },
 async flush(){await richComposer?.stopRecording();if(vault){draftChanged();await vault.flush()}},
 async persistDraft(){if(vault){draftChanged();await vault.flush()}},
 async refreshQueue(){if(vault)return refreshQueue()},
 get scope(){return{user:scopeUser,chat:scopeChat}},
 get store(){return vault?.store},get snapshot(){return publicSnapshot()},
 async leave(){await this.flush();input.blur();closeMenu(false);list?.destroy();list=null;},
 appendContent,setReply,get reply(){return replyTarget},get rich(){return richComposer},
 localAssetUrl(id){const a=assets.get(id);if(!a?.file)throw Error('Вложение не найдено на устройстве');return a.richUrl||(a.richUrl=urlCreate(a.file));},
 addFiles,fillDraft,get list(){return list},get draft(){return draft},get assets(){return assets},
};

})();
