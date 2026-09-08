/* First-key signup uses the configured Pablicus identity service and Supabase
 * PKCE. It never asserts ownership of a typed email or creates a password. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PablicusPublicPasskey=factory();
})(globalThis,function(){
  'use strict';
  const provider='custom:pablicus-passkey';
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function identityValid(user){
    if(!user?.id)return false;
    for(const identity of user.identities||[]){
      if(identity.provider!==provider)continue;
      const subject=identity.identity_data?.sub||identity.id||'';
      if(typeof subject!=='string'||(identity.identity_data?.sub&&identity.id&&identity.identity_data.sub!==identity.id))return false;
      if(subject.startsWith('native:')){
        if(!uuid.test(subject.slice(7))||subject.slice(7).toLowerCase()!==user.id.toLowerCase())return false;
      }else if(!uuid.test(subject))return false;
    }
    return true;
  }
  function ownsPublicKey(user){return !!user?.identities?.some(identity=>identity.provider===provider)}
  function create({client,config,projectUrl,redirectTo,validateAuthorizeUrl,onNavigate=url=>location.assign(url),onChange=()=>{}}){
    let busy=false,phase='idle';
    const snapshot=()=>({busy,phase});
    function update(value){phase=value;onChange(snapshot())}
    async function start(){
      if(busy||config?.enabled!==true)return false;
      busy=true;update('opening');
      try{
        if(typeof validateAuthorizeUrl!=='function')throw Error('configuration');
        const result=await client.auth.signInWithOAuth({provider,options:{redirectTo,skipBrowserRedirect:true}});
        if(result.error||result.data?.provider!==provider||!result.data?.url)throw Error('unavailable');
        const destination=validateAuthorizeUrl(result.data.url,projectUrl,provider,redirectTo);
        update('redirecting');await onNavigate(destination);return true;
      }catch{busy=false;update('error');return false}
    }
    function resume(){if(phase==='redirecting'){busy=false;update('idle')}}
    return {start,resume,snapshot};
  }
  return Object.freeze({provider,identityValid,ownsPublicKey,create});
});
