/* Candidate, not included in the published RC5 build.
 * Uses only Supabase's phone OTP API. The server must provision verified
 * profiles and configure an SMS provider before enabled may be set to true.
 */
(function(root){
 'use strict';
 function normalizePhone(value){
  const phone=String(value||'').trim().replace(/[ ()-]/g,'');
  if(!/^\+[1-9][0-9]{7,14}$/.test(phone))throw Error('Укажите номер с кодом страны, начиная с +.');
  return phone;
 }
 function phoneMatches(value,expected){return String(value||'').replace(/^\+/,'')===expected.slice(1)}
 function errorText(e){
  if(e?.code==='otp_expired')return 'Код неверный или истёк. Проверьте SMS или запросите новый код.';
  if(e?.status===429)return 'Слишком много попыток. Подождите перед повторным запросом.';
  if(e?.code==='phone_provider_disabled'||e?.code==='sms_send_failed')return 'Не удалось отправить SMS. Попробуйте позже.';
  if(e?.message==='identity_mismatch')return 'Подтверждён другой номер. Запросите код заново.';
  if(e?.message==='profile_unavailable')return 'Номер подтверждён, но вход в приложение не завершён. Повторите попытку позже.';
  return 'Не удалось завершить вход. Проверьте соединение и повторите попытку.';
 }
 function create({client,authenticate,enabled=false,clock=()=>Date.now(),onChange=()=>{}}){
  let phase='phone',pendingPhone='',busy=false,resendAt=0,error='';
  const snapshot=()=>Object.freeze({phase,phone:pendingPhone,busy,resendAt,error});
  const publish=()=>onChange(snapshot());
  const fail=text=>{error=text;publish();return false};
  async function request(value,captchaToken){
   if(busy)return false;
   if(!enabled)return fail('Вход по SMS ещё не подключён.');
   let phone;try{phone=normalizePhone(value)}catch(e){return fail(e.message)}
   if(clock()<resendAt)return fail('Повторный код можно запросить через '+Math.ceil((resendAt-clock())/1000)+' сек.');
   busy=true;error='';publish();
   try{
    const result=await client.auth.signInWithOtp({phone,options:{shouldCreateUser:true,channel:'sms',...(captchaToken?{captchaToken}:{})}});
    if(result.error)throw result.error;
    pendingPhone=phone;phase='code';resendAt=clock()+60000;return true;
   }catch(e){error=errorText(e);return false}finally{busy=false;publish()}
  }
  async function verify(value,captchaToken){
   if(busy)return false;
   if(!enabled||phase!=='code'||!pendingPhone)return fail('Сначала запросите SMS-код.');
   let code=String(value||'').trim();
   if(!/^[0-9]{6}$/.test(code))return fail('Введите шесть цифр из SMS.');
   const expectedPhone=pendingPhone;busy=true;error='';publish();
   try{
    const result=await client.auth.verifyOtp({phone:expectedPhone,token:code,type:'sms',...(captchaToken?{options:{captchaToken}}:{})});
    code='';if(result.error)throw result.error;
    const session=result.data?.session;
    const checked=await client.auth.getUser();
    if(checked.error)throw checked.error;
    const user=checked.data?.user;
    if(!session?.user?.id||user?.id!==session.user.id||!user?.phone_confirmed_at||!phoneMatches(user.phone,expectedPhone)){
     await client.auth.signOut({scope:'local'});pendingPhone='';phase='phone';throw Error('identity_mismatch');
    }
    // The host keeps its server profile/member checks. OTP verification alone
    // never grants chat membership or overwrites approval/suspension flags.
    try{await authenticate(session)}catch{throw Error('profile_unavailable')}
    pendingPhone='';phase='signed_in';return true;
   }catch(e){error=errorText(e);return false}finally{code='';busy=false;publish()}
  }
  function changeNumber(){if(busy)return;pendingPhone='';phase='phone';error='';publish()}
  return Object.freeze({request,verify,changeNumber,snapshot});
 }
 function mount({element,client,authenticate,enabled=false,getCaptchaToken=()=>undefined}){
  const q=id=>element.querySelector('[data-sms="'+id+'"]');
  const flow=create({client,authenticate,enabled,onChange:s=>{
   q('request').disabled=s.busy;q('verify').disabled=s.busy;q('change').disabled=s.busy;
   q('phone').disabled=s.busy||s.phase==='code';q('codeForm').hidden=s.phase!=='code';
   q('error').textContent=s.error;
   q('notice').textContent=s.phase==='code'?'Введите код из SMS на '+s.phone+'.':'';
   q('request').textContent=s.phase==='code'?'Получить код повторно':'Получить код SMS';
  }});
  q('requestForm').onsubmit=async e=>{e.preventDefault();if(!q('phone').reportValidity())return;await flow.request(q('phone').value,getCaptchaToken())};
  q('codeForm').onsubmit=async e=>{e.preventDefault();let value=q('code').value;q('code').value='';const promise=flow.verify(value,getCaptchaToken());value='';await promise};
  q('change').onclick=()=>{q('code').value='';flow.changeNumber();q('phone').focus()};
  const clearCode=()=>{q('code').value=''};
  root.addEventListener?.('pagehide',clearCode);
  return {flow,destroy:()=>root.removeEventListener?.('pagehide',clearCode)};
 }
 const api=Object.freeze({create,mount,normalizePhone});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PablicusSmsLogin=api;
})(globalThis);
