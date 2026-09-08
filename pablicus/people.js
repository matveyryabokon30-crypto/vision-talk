/* Name/handle discovery. Every result is selected explicitly before a chat opens. */
(function(root){
 'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 function normalizeQuery(value){
  let q=String(value||'').trim();
  if(/^https?:\/\//i.test(q)){try{q=new URL(q).searchParams.get('person')||q}catch{}}
  return q.replace(/^@/,'').trim();
 }
 function profileLink(username,base=root.location.href){
  const name=normalizeQuery(username);if(!/^[a-z0-9_][a-z0-9_.-]{1,79}$/i.test(name))throw Error('Не удалось получить ссылку профиля');
  const url=new URL(base);url.search='';url.hash='';url.searchParams.set('person',name.toLowerCase());return url.href;
 }
 function create(options={}){
  if(typeof options.search!=='function'||typeof options.onOpen!=='function')throw Error('People callbacks are required');
  const panel=el('dialog','peoplePicker');panel.id='peoplePicker';panel.setAttribute('aria-labelledby','peopleTitle');
  const header=el('header','peopleHeader'),title=el('h2','','Найти человека');title.id='peopleTitle';
  const cancel=el('button','peopleClose','×');cancel.type='button';cancel.setAttribute('aria-label','Закрыть поиск');header.append(title,cancel);
  const form=el('form','peopleSearch'),label=el('label','peopleLabel','Имя, @username или ссылка профиля');label.htmlFor='peopleQuery';
  const input=el('input');input.id='peopleQuery';input.type='search';input.placeholder='Имя или @username';input.autocomplete='off';input.autocapitalize='none';input.spellcheck=false;input.maxLength=400;
  const status=el('p','peopleStatus');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const results=el('div','peopleResults');results.setAttribute('aria-label','Найденные люди');
  const hint=el('p','peopleHint','Ссылкой на себя можно поделиться из профиля. Она открывает именно ваш аккаунт, даже если имена совпадают.');
  form.append(label,input);panel.append(header,form,status,results,hint);document.body.append(panel);
  let generation=0,timer=0,opening=false,previousFocus=null,destroyed=false;
  function busy(value){results.setAttribute('aria-busy',String(value));for(const b of results.querySelectorAll('button'))b.disabled=value;}
  function error(e){status.textContent=e?.message||'Поиск не загрузился. Попробуйте ещё раз.';options.onError?.(e);}
  async function select(person){
   if(opening||!panel.open)return;const token=generation;opening=true;busy(true);status.textContent='Открываем разговор…';
   try{await options.onOpen(person,{isCurrent:()=>!destroyed&&panel.open&&token===generation});if(token===generation)close();}
   catch(e){if(token===generation&&panel.open)error(e);}
   finally{if(token===generation){opening=false;busy(false);}}
  }
  function show(list){
   results.replaceChildren();
   for(const person of list.slice(0,20)){
    if(!person?.id||!person.username)continue;
    const button=el('button','peoplePerson'),name=person.display_name?.trim()||'@'+person.username;button.type='button';button.dataset.username=person.username;
    const initials=name.replace(/^@/,'').split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]||'').join('').toUpperCase();
    const avatar=el('span','peopleAvatar',initials),details=el('span','peopleDetails');avatar.setAttribute('aria-hidden','true');
    details.append(el('strong','',name),el('span','peopleHandle','@'+person.username));
    const arrow=el('span','peopleArrow','↗');arrow.setAttribute('aria-hidden','true');button.append(avatar,details,arrow);button.onclick=()=>select(person);results.append(button);
   }
   status.textContent=results.children.length?`Найдено: ${results.children.length}`:'Никого не нашли. Проверьте имя или попросите ссылку профиля.';
  }
  async function search(){
   clearTimeout(timer);const token=++generation;opening=false;results.replaceChildren();const query=normalizeQuery(input.value);
   if(query.length<2){status.textContent='Введите хотя бы 2 символа имени или @username.';busy(false);return;}
   if(query.length>80){status.textContent='Введите имя, @username или ссылку профиля Pablicus.';busy(false);return;}
   status.textContent='Ищем…';busy(true);
   try{const list=await options.search(query);if(!destroyed&&panel.open&&token===generation)show(Array.isArray(list)?list:[]);}
   catch(e){if(!destroyed&&panel.open&&token===generation)error(e);}
   finally{if(token===generation)busy(false);}
  }
  function close(){++generation;clearTimeout(timer);opening=false;results.replaceChildren();if(panel.open)panel.close();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
  function open(initial=''){
   if(destroyed)return;++generation;clearTimeout(timer);opening=false;previousFocus=document.activeElement;
   input.value=normalizeQuery(initial);results.replaceChildren();status.textContent='Введите хотя бы 2 символа имени или @username.';
   if(!panel.open)panel.showModal();input.focus({preventScroll:true});if(input.value)search();
  }
  input.oninput=()=>{++generation;clearTimeout(timer);opening=false;results.replaceChildren();status.textContent='';timer=setTimeout(search,220);};
  form.onsubmit=e=>{e.preventDefault();search();};cancel.onclick=close;
  panel.addEventListener('cancel',e=>{e.preventDefault();close();});
  panel.addEventListener('click',e=>{if(e.target===panel){const r=panel.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
  function destroy(){close();destroyed=true;panel.remove();}
  return{open,close,destroy,get opened(){return panel.open;}};
 }
 root.PablicusPeople={create,normalizeQuery,profileLink};
})(typeof window!=='undefined'?window:globalThis);
