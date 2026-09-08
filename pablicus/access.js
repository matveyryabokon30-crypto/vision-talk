/* Self-service password setup using a server-verified current or recovery
 * session. No privileged key, account lookup or session relay.
 * The user types the new password and explicitly submits it to Supabase Auth.
 */
(() => {
 'use strict';
 const project='https://ctcoqgsztdtsazdiwcmd.supabase.co';
 const publishable='sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw';
 const $=id=>document.getElementById(id);
 const limitedFetch=async(url,options={})=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort)}};
 const client=supabase.createClient(project,publishable,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:limitedFetch}});
 let identity=null,busy=false,success=false,nonceAfter=0;
 function wipe() { for(const id of ['newPassword','repeatPassword','currentPassword','nonce'])$(id).value=''; }
 function lock(on){busy=on;$('savePassword').disabled=on;$('recheck').disabled=on;$('requestNonce').disabled=on;}
 function say(text){$('status').textContent=text;}
 function failure(e){
  const code=e?.code||'',text=e?.message||'';
  if(code==='reauthentication_needed'||code==='reauthentication_not_valid'||/reauthentication|nonce/i.test(text)){$('reauth').hidden=false;return 'Для смены пароля требуется код повторного подтверждения. Используйте блок ниже.'}
  if(/current_password|current password/i.test(code+' '+text)){$('currentRequired').hidden=false;return 'Сервер требует текущий пароль Pablicus. Политика аккаунта не изменена.'}
  if(code==='weak_password'||/weak password|password should|password must/i.test(text))return 'Сервер отклонил новый пароль. Используйте более длинный уникальный пароль с буквами, цифрами и символами.';
  if(code==='same_password')return 'Новый пароль совпадает с текущим. Вы уже можете использовать его в установленном Pablicus.';
  if(e?.status===429)return 'Слишком много попыток. Подождите перед повтором.';
  if(!navigator.onLine||e?.name==='AbortError'||e instanceof TypeError)return 'Нет ответа сервера. Сохранение не подтверждено. Проверьте соединение и повторите.';
  return 'Не удалось сохранить пароль. Сервер не подтвердил изменение. Войдите в Safari заново и повторите.';
 }
 async function check(){
  if(busy)return;lock(true);identity=null;$('passwordSetup').hidden=true;$('needsSession').hidden=true;$('done').hidden=true;$('error').textContent='';say('Проверяю вашу сессию на сервере…');
  try{const {data,error}=await client.auth.getUser();if(error||!data?.user?.id||!data.user.email)throw error||Error('no_session');
   const u=data.user,r=await client.from('profiles').select('id,is_approved').eq('id',u.id).single();
   if(r.error||!r.data?.is_approved||r.data.id!==u.id)throw Error('not_approved');
   identity={id:u.id,email:u.email};$('account').textContent=u.email;$('accountEmail').value=u.email;$('passwordSetup').hidden=false;say('Вход подтверждён. Задайте отдельный пароль Pablicus.');
  }catch{wipe();$('needsSession').hidden=false;say('В этом окне нет подтверждённой сессии Pablicus.');}finally{lock(false)}
 }
 $('passwordSetup').onsubmit=async event=>{
  event.preventDefault();if(busy||!identity)return;
  $('error').textContent='';if(!$('passwordSetup').reportValidity())return;
  if($('newPassword').value!==$('repeatPassword').value){$('error').textContent='Пароли не совпадают. Повторите тот же пароль во втором поле.';return}
  const expected={...identity};lock(true);say('Сохраняю пароль на сервере…');
  try{
   const current=await client.auth.getUser();if(current.error||current.data?.user?.id!==expected.id)throw Error('session_changed');
   const r=await client.auth.updateUser({password:$('newPassword').value,...(!$('reauth').hidden&&$('nonce').value?{nonce:$('nonce').value.trim()}:{}),...(!$('currentRequired').hidden?{current_password:$('currentPassword').value}:{})});
   if(r.error)throw r.error;if(r.data?.user?.id!==expected.id)throw Error('identity_mismatch');
   success=true;wipe();$('passwordSetup').hidden=true;$('doneEmail').textContent=expected.email;$('done').hidden=false;say('Пароль Pablicus сохранён. Введите его в приложении через иконку.');
  }catch(e){say('');$('error').textContent=failure(e);if(e?.message==='session_changed'){wipe();identity=null;$('passwordSetup').hidden=true;$('needsSession').hidden=false;$('error').textContent='Аккаунт в этом браузере изменился. Проверьте вход заново.'}}
  finally{lock(false)}
 };
 $('requestNonce').onclick=async()=>{if(busy||!identity)return;if(Date.now()<nonceAfter){$('error').textContent='Подождите минуту перед повторным запросом кода.';return}lock(true);$('error').textContent='';try{const r=await client.auth.reauthenticate();if(r.error)throw r.error;nonceAfter=Date.now()+60000;say('Код подтверждения запрошен. Введите код из письма в поле ниже.')}catch(e){$('error').textContent=failure(e)}finally{lock(false)}};
 $('showPassword').onchange=()=>{for(const id of ['newPassword','repeatPassword'])$(id).type=$('showPassword').checked?'text':'password'};
 $('recheck').onclick=check;
 client.auth.onAuthStateChange((event,session)=>{if(identity&&(event==='SIGNED_OUT'||session&&session.user.id!==identity.id)){identity=null;wipe();$('passwordSetup').hidden=true;$('needsSession').hidden=false;say('Сессия изменилась. Проверьте вход снова.')}});
 window.addEventListener('pagehide',wipe);
 window.addEventListener('pageshow',event=>{if(event.persisted&&!success)check()});
 check();
})();
