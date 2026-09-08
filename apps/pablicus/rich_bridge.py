"""Adapt the accepted composer without changing the archived Gate source."""


def replace_once(source, old, new):
    assert source.count(old) == 1, f"Rich bridge anchor changed: {old[:100]}"
    return source.replace(old, new, 1)


def adapt_vault(source):
    source = replace_once(source, 'indexedDB.open(this.name,1)', 'indexedDB.open(this.name,3)')
    source = replace_once(source, 'JSON.stringify({text:s.text,selection:s.selection,expanded:s.expanded,files:', 'JSON.stringify({text:s.text,blocks:s.blocks,reply_to:s.reply_to||null,recording:s.recording,selection:s.selection,expanded:s.expanded,files:')
    source = replace_once(source, 'return {text:await digest(new Blob([s.text])),selection:', 'return {blocks:s.blocks,reply_to:s.reply_to||null,recording:s.recording,text:await digest(new Blob([s.text])),selection:')
    source = replace_once(source, "this.set(record?'restored':'empty');", """this.set(record?'restored':'empty');
   // Persist restored block normalization (legacy migration or interrupted audio)
   // before an unchanged draft can be enqueued from its older stored record.
   const normalized=this.a.capture();
   if(record&&(JSON.stringify(record.blocks)!==JSON.stringify(normalized.blocks)||JSON.stringify(record.recording||null)!==JSON.stringify(normalized.recording||null))){this.lastSignature='';this.changed();await this.flush();}""")
    return source


def adapt_chat(source):
    s = replace_once(source, 'const assets=new Map(),liveUrls=new Set();', 'let richComposer=null,replyTarget=null;\nconst assets=new Map(),liveUrls=new Set();')
    s = replace_once(s, 'function nodeFor(m){', 'function nodeFor(m){if(m.richBlocks)return window.PablicusHost.renderPendingMessage(m);')
    s = replace_once(s, "t=n.querySelector('.text')", "t=n.querySelector('.text,.richMessage')")
    s = replace_once(s, "if(t.scrollWidth>t.clientWidth+2||", "if((t&&t.scrollWidth>t.clientWidth+2)||")
    s = replace_once(s, "input.addEventListener('keydown',e=>{if(e.key==='Escape'){", "$('editor').addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!richComposer?.composing){")
    s = replace_once(s, 'function selection(){return', 'function selection(){if(richComposer)return richComposer.capture().selection;return')
    s = replace_once(s, 'function restoreSelection(s,focus=false){if(!s)return;', 'function restoreSelection(s,focus=false){if(!s)return;if(richComposer){richComposer.restoreSelection(s,focus);return;}')
    s = replace_once(s, 'function naturalInputHeight(){', 'function naturalInputHeight(){if(richComposer)return Math.max(40,richComposer.height);')
    s = replace_once(s, 'const typing=document.activeElement===input;', "const typing=document.activeElement===input||!!richComposer&&$('editor').contains(document.activeElement);")
    s = replace_once(s, 'const rich=draft.expanded||', 'const rich=!!richComposer?.capture().files.length||draft.expanded||')
    s = replace_once(s, "$('fullTitle').textContent='Сообщение'+(draft.attachments.length?' · вложений: '+draft.attachments.length:'');", "const attachmentCount=richComposer?.capture().files.length??draft.attachments.length;$('fullTitle').textContent='Сообщение'+(attachmentCount?' · вложений: '+attachmentCount:'');")
    s = replace_once(s, "$('send').disabled=!list||draft.composing||(!input.value.trim()&&!draft.attachments.length);", "$('send').disabled=!list||draft.composing||richComposer?.composing||(!richComposer?.recording&&!hasComposerContent());")
    s = replace_once(s, "input.style.height='100%';", "if(richComposer)$('editor').style.height='100%';else input.style.height='100%';")
    s = replace_once(s, "if(returning)input.style.height='40px';", "if(returning&&!richComposer)input.style.height='40px';")
    s = replace_once(s, "const overhead=composer.offsetHeight-input.offsetHeight;", "const overhead=composer.offsetHeight-(richComposer?$('editor').offsetHeight:input.offsetHeight);")
    s = replace_once(s, "if(Math.abs(input.offsetHeight-target)>.5)input.style.height=target+'px';", "const measuredEditor=richComposer?$('editor'):input;if(Math.abs(measuredEditor.offsetHeight-target)>.5)measuredEditor.style.height=target+'px';")
    s = replace_once(s, 'function addFiles(files,forceDocument=false){', 'function addFiles(files,forceDocument=false){if(richComposer)return richComposer.addFiles(files);')
    s = replace_once(s, 'function clearDraft(){', 'function clearDraft(){replyTarget=null;paintReply();richComposer?.clear();')
    s = replace_once(s, "if(action==='keyboard'){closeMenu(false);input.blur();return}", "if(action==='keyboard'){closeMenu(false);richComposer?richComposer.blur():input.blur();return}")
    s = replace_once(s, "$('hideKey').onclick=()=>input.blur();", "$('hideKey').onclick=()=>richComposer?richComposer.blur():input.blur();")
    s = replace_once(s, 'function captureDraft(){return', 'function captureDraft(){if(richComposer)return {...richComposer.capture(),reply_to:replyTarget,expanded:draft.expanded};return')
    s = replace_once(s, 'async function restoreDraft(s){', "async function restoreDraft(s){\n if(richComposer){if(!list)await openChat();await richComposer.restore(s);replyTarget=s.reply_to||null;paintReply();draft.expanded=!!s.expanded;syncComposer();return;}")
    s = replace_once(s, "text:m.text||'',image:false", "text:m.text||'',reply_to:m.reply_to||null,richBlocks:m.kind==='rich'?m.blocks:null,image:false")
    s = replace_once(s, "if(!assets.has(a.id)||a.kind==='document')return;", "if(!assets.has(a.id)||a.kind!=='image')return;")
    s = replace_once(s, 'async function localSend(){', "async function localSend(){\n if(submitBusy||draft.composing||richComposer?.composing)return;try{await richComposer?.stopRecording()}catch(e){status(e.message);return;}")
    s = replace_once(s, "if(!list||submitBusy||!window.PablicusHost?.canSend()||draft.composing||(!input.value.trim()&&!draft.attachments.length))return;", "if(!list||submitBusy||!window.PablicusHost?.canSend()||draft.composing||richComposer?.composing||!hasComposerContent())return;")
    s = replace_once(s, "if(!result.deduplicated){input.value='';", "if(!result.deduplicated){replyTarget=null;paintReply();richComposer?.clear();input.value='';")
    s = replace_once(s, 'window.PablicusChat={', r'''
function hasComposerContent(){const c=richComposer?.capture();return c?!!c.text.trim()||c.files.length>0:!!input.value.trim()||draft.attachments.length>0;}
function paintReply(){app.classList.toggle('has-reply',!!replyTarget);window.PablicusHost?.paintReplyDraft(replyTarget);}
function setReply(ref){if(submitBusy||vault?.restoring){window.PablicusHost?.notify('Дождитесь сохранения сообщения');return;}if(!list||!vault?.ready)throw Error('Сначала откройте разговор');replyTarget=ref?structuredClone(ref):null;paintReply();draftChanged();queueComposer();richComposer?.focus();}
async function appendContent(content){if(!list||!vault?.ready||submitBusy||vault.restoring||!window.PablicusHost?.canSend())throw Error('Дождитесь сохранения черновика');const targetVault=vault,targetUser=scopeUser,targetChat=scopeChat;await richComposer.stopRecording();if(vault!==targetVault||scopeUser!==targetUser||scopeChat!==targetChat||!window.PablicusHost?.canSend())throw Error('Разговор изменился. Пересылка отменена');const previous=richComposer.capture(),blocks=[...previous.blocks,...content.blocks],files=[...previous.files,...content.files];if(blocks[0]?.type!=='text')blocks.unshift({id:crypto.randomUUID(),type:'text',text:''});if(blocks.at(-1)?.type!=='text')blocks.push({id:crypto.randomUUID(),type:'text',text:''});if(blocks.length>100||blocks.filter(b=>b.type==='text').reduce((n,b)=>n+b.text.length,0)>5000||files.reduce((n,f)=>n+f.size,0)>104857600)throw Error('Вместе с черновиком превышен размер сообщения. Отправьте черновик и повторите пересылку.');richComposer.restore({...previous,blocks,files});draftChanged();queueComposer();await targetVault.flush();if(vault===targetVault&&scopeUser===targetUser&&scopeChat===targetChat&&window.PablicusHost?.canSend())richComposer.focus();}
function ensureRichComposer(){if(richComposer)return;richComposer=PablicusRichComposer.create({
 container:$('editor'),input,
 onChange:()=>{draftChanged();queueComposer()},onGeometry:queueComposer,
 onError:message=>window.PablicusHost?.notify(message),acceptFile:file=>window.PablicusHost.acceptFile(file)
});$('composeBox').append(richComposer.voiceButton);$('composeBox').classList.add('rich-composer');}
window.PablicusChat={''')
    s = replace_once(s, ' async open(user,chat,messages){', ' async open(user,chat,messages){\n  ensureRichComposer();await richComposer.stopRecording();')
    s = replace_once(s, "sourceMessages=messages;scopeUser=user;scopeChat=chat;", "richComposer.clear();replyTarget=null;paintReply();sourceMessages=messages;scopeUser=user;scopeChat=chat;")
    s = s.replace('new PablicusStore(', 'new PablicusRichStore(')
    s = replace_once(s, ' async flush(){if(vault){draftChanged();await vault.flush()}},', ' async flush(){await richComposer?.stopRecording();if(vault){draftChanged();await vault.flush()}},')
    # finalize.py still owns list disconnection; leave keeps its stable bridge anchor.
    s = replace_once(s, ' addFiles,fillDraft,get list()', ''' appendContent,setReply,get reply(){return replyTarget},get rich(){return richComposer},
 localAssetUrl(id){const a=assets.get(id);if(!a?.file)throw Error('Вложение не найдено на устройстве');return a.richUrl||(a.richUrl=urlCreate(a.file));},
 addFiles,fillDraft,get list()''')
    return s
