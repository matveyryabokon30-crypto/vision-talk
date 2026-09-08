/* Pablicus: redeem the user's email proof IN THIS browser or installed app.
 * Password recovery is requested only by an explicit user action.
 * No session relay or privileged key.
 * The proof is sent only to the configured Supabase Auth verify endpoint.
 */
(function(root){
 'use strict';
 function parseProof(value, projectUrl, email) {
  const text=String(value||'').trim();
  if (!text || text.length>4096) throw Error('Вставьте код или ссылку из нового письма.');
  if (/^\d{6,10}$/.test(text)) return {email,token:text,type:'email'};
  let u;try{u=new URL(text)}catch{throw Error('Нужна сама ссылка из письма: удерживайте кнопку входа в письме и выберите «Скопировать ссылку».')}
  const trusted=new URL(projectUrl);
  if(u.protocol!=='https:'||u.origin!==trusted.origin||u.username||u.password||u.pathname!=='/auth/v1/verify'||u.hash)
   throw Error('Это не ссылка подтверждения Pablicus. Скопируйте адрес кнопки входа из письма, не открывая её.');
  const type=u.searchParams.get('type');
  if(!['magiclink','email'].includes(type)||u.searchParams.getAll('type').length!==1)
   throw Error('Нужна ссылка для входа, не для регистрации или смены пароля.');
  const names=['token','token_hash'].filter(n=>u.searchParams.has(n));
  if(names.length!==1||u.searchParams.getAll(names[0]).length!==1)
   throw Error('Ссылка неполная. Запросите новое письмо.');
  const token=u.searchParams.get(names[0]);
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(token||''))throw Error('Ссылка неполная. Запросите новое письмо.');
  return {token_hash:token,type:'email'};
 }
 function message(error){
  const code=error?.code||'';
  if(['otp_expired','otp_disabled','access_denied'].includes(code)||/expired|invalid.*token/i.test(error?.message||''))return 'Ссылка уже использована или истекла. Получите новое письмо и скопируйте ссылку, НЕ нажимая её.';
  if(error?.status===429||/rate.limit|too many|security purposes/i.test(error?.message||''))return 'Слишком частые запросы. Подождите минуту перед новым письмом.';
  if(/invalid.*credentials/i.test(error?.message||''))return 'Неверная почта или пароль. Проверьте адрес и пароль Pablicus.';
  if(!navigator.onLine)return 'Нет сети. Подключитесь и повторите вход.';
  return 'Не удалось завершить вход. Проверьте соединение и повторите попытку.';
 }
 function mount({client,projectUrl,authenticate,recoveryClient=client,canSignIn=()=>true}){
  const $=id=>document.getElementById(id),key='pablicus:pending-email-login:v1';
  let requestedEmail='',nextRequest=0,busy=false;
  const error=t=>{$('loginError').textContent=t},notice=t=>{$('loginNotice').textContent=t};
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved?.email&&saved.until>Date.now()){requestedEmail=saved.email;nextRequest=saved.nextRequest||0;$('email').value=saved.email;$('proofSection').hidden=false;$('emailLogin').open=true}}catch{}
  const clear=()=>{requestedEmail='';try{localStorage.removeItem(key)}catch{};$('emailProof').value='';$('proofSection').hidden=true;notice('')};
  function persist(){try{localStorage.setItem(key,JSON.stringify({email:requestedEmail,until:Date.now()+3600000,nextRequest}))}catch{}}
  $('showLoginPassword').onchange=()=>{$('password').type=$('showLoginPassword').checked?'text':'password'};
  $('recoverPassword').onclick=async()=>{
   if(busy||!canSignIn())return;error('');notice('');
   if(!$('email').reportValidity())return;
   if(Date.now()<nextRequest){error('Новое письмо можно запросить через '+Math.ceil((nextRequest-Date.now())/1000)+' сек.');return}
   busy=true;$('recoverPassword').disabled=true;
   try{
    const redirectTo=new URL('access.html',location.href).href;
    const result=await recoveryClient.auth.resetPasswordForEmail($('email').value.trim(),{redirectTo});
    if(result.error)throw result.error;
    nextRequest=Date.now()+60000;
    notice('Восстановление запрошено. Если аккаунт существует, на указанную почту придёт письмо. Нажмите кнопку в письме и задайте новый пароль.');
   }catch(e){error(message(e))}finally{busy=false;$('recoverPassword').disabled=false}
  };
  $('magicForm').onsubmit=async e=>{
   e.preventDefault();if(busy||!canSignIn())return;
   const email=$('email').value.trim().toLowerCase();
   if(!$('email').reportValidity())return;
   if(Date.now()<nextRequest){error('Новое письмо можно запросить через '+Math.ceil((nextRequest-Date.now())/1000)+' сек.');return}
   busy=true;$('magicSubmit').disabled=true;error('');notice('Запрашиваю письмо…');
   try{
    const result=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+location.pathname}});
    if(result.error)throw result.error;
    requestedEmail=email;nextRequest=Date.now()+60000;persist();$('proofSection').hidden=false;
    notice('Письмо запрошено. В письме удерживайте кнопку входа → «Скопировать ссылку». Вернитесь СЮДА и вставьте её в поле ниже. Не открывайте ссылку в Safari.');
   }catch(e){notice('');error(message(e))}finally{busy=false;$('magicSubmit').disabled=false}
  };
  $('proofForm').onsubmit=async e=>{
   e.preventDefault();if(busy||!canSignIn())return;error('');
   const email=$('email').value.trim().toLowerCase();
   if(!$('email').reportValidity())return;
   if(requestedEmail&&requestedEmail!==email){error('Адрес изменился. Запросите письмо для нового адреса.');return}
   let proof;try{proof=parseProof($('emailProof').value,projectUrl,email)}catch(e){error(e.message);return}
   busy=true;$('proofSubmit').disabled=true;notice('Проверяю подтверждение в этом приложении…');
   $('emailProof').value='';
   try{
    const result=await client.auth.verifyOtp(proof);proof=null;
    if(result.error)throw result.error;
    const session=result.data?.session;
    if(!session?.user?.id)throw Error('missing_session');
    if((session.user.email||'').toLowerCase()!==email){await client.auth.signOut({scope:'local'});throw Error('email_mismatch')}
    await authenticate(session);clear();
   }catch(e){notice('');error(message(e))}finally{proof=null;busy=false;$('proofSubmit').disabled=false}
  };
  $('pasteProof').onclick=async()=>{error('');try{
   if(!navigator.clipboard?.readText)throw Error('manual');
   $('emailProof').value=await navigator.clipboard.readText();$('emailProof').focus();
  }catch{notice('Коснитесь поля «Код или ссылка» и выберите «Вставить». Доступ к буферу автоматически не требуется.');$('emailProof').focus()}};
  $('loginForm').onsubmit=async e=>{e.preventDefault();if(busy||!canSignIn())return;error('');busy=true;$('loginSubmit').disabled=true;try{
   const result=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
   if(result.error)throw result.error;$('password').value='';$('password').type='password';$('showLoginPassword').checked=false;await authenticate(result.data.session);clear();
  }catch(e){error(message(e))}finally{busy=false;$('loginSubmit').disabled=false}};
  return {clear,isBusy:()=>busy};
 }
 const api=Object.freeze({parseProof,mount});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.PablicusLogin=api;
})(globalThis);
