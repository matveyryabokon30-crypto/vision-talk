"""Scoped RC4 login regression. REAL bundled Supabase SDK; MOCKED Auth HTTP.
Separate persistent contexts model isolated Safari/PWA stores. NOT physical iOS.
No real accounts, credentials, emails, or OTPs are created or collected.
"""
import asyncio,base64,json,mimetypes,subprocess,tempfile,time,traceback
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
R=Path(__file__).resolve().parents[1];D=R/'dist';E=R/'evidence';E.mkdir(exist_ok=True)
SITE='http://127.0.0.1:8765/';PROJECT='https://ctcoqgsztdtsazdiwcmd.supabase.co'
EMAIL='rc4-qa@example.invalid';USER='11111111-1111-4111-8111-111111111111'
PROOF='a'*56;LINK=PROJECT+'/auth/v1/verify?token='+PROOF+'&type=magiclink&redirect_to='+SITE
b64=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
now=int(time.time());JWT=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'exp':now+3600,'iat':now,'aud':'authenticated','role':'authenticated'})+'.MOCK_SIGNATURE_NOT_A_CREDENTIAL'
user={'id':USER,'email':EMAIL,'aud':'authenticated','role':'authenticated','app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},'created_at':'2026-09-01T00:00:00Z'}
session={'access_token':JWT,'refresh_token':'MOCK_REFRESH_NOT_A_CREDENTIAL','expires_in':3600,'expires_at':now+3600,'token_type':'bearer','user':user}
NODE=r'''
const assert=require('node:assert/strict'),{parseProof}=require(process.argv[1]);
const p='https://ctcoqgsztdtsazdiwcmd.supabase.co',t='a'.repeat(56),e='qa@example.invalid';
assert.deepEqual(parseProof(p+'/auth/v1/verify?token='+t+'&type=magiclink',p,e),{token_hash:t,type:'email'});
assert.deepEqual(parseProof('123456',p,e),{email:e,token:'123456',type:'email'});
const invalid=['','x'.repeat(5000),'javascript:alert(1)','http://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/verify?token='+t+'&type=magiclink','https://evil.invalid/auth/v1/verify?token='+t+'&type=magiclink',p+'.evil.invalid/auth/v1/verify?token='+t+'&type=magiclink',p+'/auth/v1/verify?token='+t+'&type=recovery',p+'/auth/v1/verify?token='+t+'&type=invite',p+'/auth/v1/verify?token='+t+'&type=signup',p+'/auth/v1/verify?token='+t+'&type=magiclink&type=email',p+'/auth/v1/verify?token='+t+'&token='+t+'&type=email',p+'/auth/v1/verify?token='+t+'&token_hash='+t+'&type=email',p+'/auth/v1/verify?token=short&type=email',p+'/wrong?token='+t+'&type=email',p+'/auth/v1/verify?token='+t+'&type=email#access_token=example','https://user:pass@ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/verify?token='+t+'&type=email'];
for(const value of invalid)assert.throws(()=>parseProof(value,p,e));
console.log(JSON.stringify({scope:'PROOF_PARSER',valid:2,rejected:invalid.length,pass:true}));
'''
parser=json.loads(subprocess.check_output(['node','-e',NODE,str(R/'src/auth-local.js')],text=True));(E/'auth-parser.json').write_text(json.dumps(parser,indent=2))
async def one(engine,name):
 checks=[];errors=[];state={'otp':0,'verify':0,'used':False};contexts=[];directories=[]
 async def make(primed=False):
  directory=tempfile.TemporaryDirectory(prefix='pablicus-auth-');directories.append(directory)
  ctx=await engine.launch_persistent_context(directory.name,headless=True,viewport={'width':440,'height':766},service_workers='block');contexts.append(ctx)
  if primed:
   await ctx.add_init_script('localStorage.setItem("sb-ctcoqgsztdtsazdiwcmd-auth-token",'+json.dumps(json.dumps(session))+');')
  async def route(route):
   u=urlparse(route.request.url)
   if u.netloc=='127.0.0.1:8765':
    f=D/(u.path.lstrip('/') or 'index.html')
    if not f.is_file():return await route.fulfill(status=404,body='not found')
    return await route.fulfill(status=200,content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream',body=f.read_bytes())
   if u.netloc!='ctcoqgsztdtsazdiwcmd.supabase.co':return await route.abort()
   path=u.path;body=route.request.post_data_json if route.request.post_data else {}
   headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'}
   status=200;payload={}
   if route.request.method=='OPTIONS':return await route.fulfill(status=204,headers=headers)
   if path=='/auth/v1/otp':
    assert body['email']==EMAIL and body['create_user'] is False;state['otp']+=1
   elif path=='/auth/v1/verify':
    state['verify']+=1
    assert body.get('token_hash')==PROOF and body['type']=='email'
    if state['used']:status=403;payload={'code':'otp_expired','msg':'Token has expired or is invalid'}
    else:state['used']=True;payload=session
   elif path=='/auth/v1/token':payload=session
   elif path=='/auth/v1/user':payload=user
   elif path=='/rest/v1/profiles':payload={'id':USER,'username':'rc4_qa','display_name':'QA','is_approved':True}
   elif path.startswith('/rest/v1/rpc/my_conversations'):payload=[]
   else:status=404;payload={'error':'unexpected_mock_endpoint'}
   await route.fulfill(status=status,headers=headers,content_type='application/json',body=json.dumps(payload))
  await ctx.route('**/*',route);p=await ctx.new_page();p.set_default_timeout(12000);p.on('pageerror',lambda e:errors.append(str(e)))
  await p.goto(SITE,wait_until='domcontentloaded');return p
 try:
  safari=await make(True);await safari.wait_for_selector('#workspace',state='visible')
  pwa=await make(False);await pwa.wait_for_selector('#loginPane',state='visible')
  assert not await pwa.locator('#workspace').is_visible();checks.append('Authenticated browser does not authorize separate installed-app store')
  assert await pwa.evaluate('PablicusDebug.version')=='0.1.0-rc5'
  await pwa.locator('#email').fill(EMAIL);await pwa.locator('#emailLogin summary').click();await pwa.locator('#magicSubmit').click();await pwa.wait_for_selector('#proofSection',state='visible')
  assert state['otp']==1;assert state['verify']==0;checks.append('Closed email request does not navigate, create a user or fake a session')
  await pwa.reload();await pwa.wait_for_selector('#proofSection',state='visible');assert await pwa.locator('#email').input_value()==EMAIL;checks.append('Pending email form survives relaunch without retaining a credential')
  await pwa.locator('#emailProof').fill('https://evil.invalid/?token='+PROOF);await pwa.locator('#proofSubmit').click();assert state['verify']==0;checks.append('Untrusted link never reaches Auth and never navigates')
  await pwa.screenshot(path=str(E/(name+'-rc4-login.png')))
  await pwa.locator('#emailProof').fill(LINK);await pwa.locator('#proofSubmit').click();await pwa.wait_for_selector('#workspace',state='visible')
  assert state['verify']==1;assert await pwa.locator('#emailProof').input_value()==''
  assert pwa.url==SITE;assert len(pwa.context.pages)==2 # initial blank persistent page plus application
  assert await pwa.evaluate('PablicusDebug.user')==USER
  saved=await pwa.evaluate('Object.values(localStorage).join(" ")');assert PROOF not in saved
  checks.append('Actual bundled SDK verifyOtp writes session in requesting context; proof erased; no new tab')
  await pwa.reload();await pwa.wait_for_selector('#workspace',state='visible');assert state['verify']==1 and state['otp']==1;checks.append('Session restores after reload without another email or verification')
  expired=await make(False);await expired.locator('#email').fill(EMAIL);await expired.locator('#emailLogin summary').click()
  await expired.evaluate('document.getElementById("proofSection").hidden=false')
  await expired.locator('#emailProof').fill(LINK);await expired.locator('#proofSubmit').click();await expired.wait_for_function('document.getElementById("loginError").textContent.includes("уже использована")')
  assert not await expired.locator('#workspace').is_visible();checks.append('Reused proof fails closed and asks for new mail without redirect loop')
  assert not errors,errors
  return {'engine':name,'pass':True,'checks':checks,'scope':'REAL_SDK_MOCK_AUTH_HTTP_SEPARATE_PERSISTENT_STORES','physical_iPhone':False,'real_email_delivery':'NOT_TESTED','errors':errors}
 except Exception:return {'engine':name,'pass':False,'checks':checks,'error':traceback.format_exc(),'errors':errors}
 finally:
  for c in contexts:await c.close()
  for d in directories:d.cleanup()
async def main():
 async with async_playwright() as p:out=[await one(getattr(p,n),n) for n in ['chromium','webkit']]
 (E/'auth-local.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out,ensure_ascii=False));assert all(x['pass'] for x in out)
asyncio.run(main())
