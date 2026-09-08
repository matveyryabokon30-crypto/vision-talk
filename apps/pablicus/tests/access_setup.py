"""Access v1: real bundled SDK, mocked Auth HTTP, isolated persistent stores.
No production credentials, sessions, users or password changes are used.
"""
import asyncio,base64,json,mimetypes,tempfile,time,traceback
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
R=Path(__file__).resolve().parents[1];D=R/'dist';E=R/'evidence';E.mkdir(exist_ok=True)
SITE='http://127.0.0.1:8765/';PROJECT='https://ctcoqgsztdtsazdiwcmd.supabase.co';EMAIL='access-qa@example.invalid';UID='11111111-1111-4111-8111-111111111111'
PASS='Fixture-Only-Not-A-Real-Password-!42'
b64=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
now=int(time.time());JWT=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':UID,'exp':now+3600,'iat':now,'aud':'authenticated','role':'authenticated'})+'.NOT_A_REAL_SIGNATURE'
user={'id':UID,'email':EMAIL,'aud':'authenticated','role':'authenticated','app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},'created_at':'2026-09-01T00:00:00Z'}
session={'access_token':JWT,'refresh_token':'MOCK_REFRESH_ONLY','expires_in':3600,'expires_at':now+3600,'token_type':'bearer','user':user}
async def one(engine,name):
 state={'puts':0,'saved':None,'reject':False,'nonce':False,'approved':True,'switched':False,'logins':0,'forbidden':0};checks=[];errors=[];violations=[];contexts=[];dirs=[]
 async def make(primed=False,path='access.html'):
  t=tempfile.TemporaryDirectory(prefix='pablicus-access-');dirs.append(t)
  c=await engine.launch_persistent_context(t.name,headless=True,viewport={'width':440,'height':766},service_workers='block');contexts.append(c)
  if primed:await c.add_init_script('if(!localStorage.getItem("sb-ctcoqgsztdtsazdiwcmd-auth-token"))localStorage.setItem("sb-ctcoqgsztdtsazdiwcmd-auth-token",'+json.dumps(json.dumps(session))+');')
  async def route(rt):
   u=urlparse(rt.request.url);headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}
   if u.netloc=='127.0.0.1:8765':
    f=D/(u.path.lstrip('/') or 'index.html')
    return await rt.fulfill(status=200 if f.is_file() else 404,content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream',body=f.read_bytes() if f.is_file() else b'not found')
   if u.netloc!='ctcoqgsztdtsazdiwcmd.supabase.co':return await rt.abort()
   if rt.request.method=='OPTIONS':return await rt.fulfill(status=204,headers=headers)
   body=rt.request.post_data_json if rt.request.post_data else {};status=200;payload={}
   if u.path=='/auth/v1/user' and rt.request.method=='GET':payload={**user,**({'id':'22222222-2222-4222-8222-222222222222'} if state['switched'] else {})}
   elif u.path=='/auth/v1/user' and rt.request.method=='PUT':
    state['puts']+=1
    # Inspected bundled gotrue-js 2.65.0 _updateUser adds these two null
    # PKCE properties to every update. Identity/data mutation remains forbidden.
    allowed={'password','nonce','current_password','code_challenge','code_challenge_method'}
    valid=(rt.request.headers.get('authorization')=='Bearer '+JWT and isinstance(body,dict) and set(body).issubset(allowed) and isinstance(body.get('password'),str) and body.get('code_challenge') is None and body.get('code_challenge_method') is None)
    if not valid:
     violations.append({'path':'/auth/v1/user','field_names':sorted(body) if isinstance(body,dict) else []})
     status=400;payload={'code':'bad_json','msg':'Unexpected password-update request shape'}
    elif state['reject']:status=422;payload={'code':'weak_password','msg':'Password should be stronger'}
    elif state['nonce'] and body.get('nonce')!='123456':status=403;payload={'code':'reauthentication_needed','msg':'Reauthentication required'}
    else:state['saved']=body['password'];payload=user
   elif u.path=='/auth/v1/reauthenticate':payload={}
   elif u.path=='/auth/v1/token':
    if 'grant_type=password' in u.query:
     state['logins']+=1
     if body.get('email')!=EMAIL or body.get('password')!=state['saved']:status=400;payload={'code':'invalid_credentials','msg':'Invalid login credentials'}
     else:payload=session
    else:payload=session
   elif u.path=='/rest/v1/profiles':payload={'id':UID,'username':'access_qa','display_name':'QA','is_approved':state['approved']}
   elif u.path.startswith('/rest/v1/rpc/my_conversations'):payload=[]
   else:state['forbidden']+=1;status=404;payload={'error':'Unexpected endpoint'}
   await rt.fulfill(status=status,headers=headers,content_type='application/json',body=json.dumps(payload))
  await c.route('**/*',route);p=await c.new_page();p.set_default_timeout(10000);p.on('pageerror',lambda e:errors.append(str(e)))
  await p.goto(SITE+path,wait_until='domcontentloaded');return p
 async def fill(p,suffix=''):
  await p.locator('#newPassword').fill(PASS+suffix);await p.locator('#repeatPassword').fill(PASS+suffix)
 try:
  no=await make();await no.locator('#needsSession').wait_for();assert not await no.locator('#passwordSetup').is_visible() and state['puts']==0
  checks.append('No session: no password form and no update request')
  state['approved']=False;unapproved=await make(True);await unapproved.locator('#needsSession').wait_for();assert not await unapproved.locator('#passwordSetup').is_visible();state['approved']=True
  checks.append('Unapproved profile fails closed')
  safari=await make(True);await safari.locator('#passwordSetup').wait_for();assert await safari.locator('#account').inner_text()==EMAIL and state['puts']==0
  checks.append('Actual SDK getUser and own profile checked before showing form; no automatic change')
  await fill(safari);await safari.locator('#repeatPassword').fill(PASS+'different');await safari.locator('#savePassword').click();assert state['puts']==0
  checks.append('Mismatch rejected before network update')
  await fill(safari);state['reject']=True;await safari.locator('#savePassword').click();await safari.wait_for_function('document.getElementById("error").textContent.includes("отклонил")');assert not await safari.locator('#done').is_visible();state['reject']=False
  checks.append('Server rejection never displays success')
  await safari.locator('#savePassword').click();await safari.locator('#done').wait_for();assert state['saved']==PASS
  assert await safari.locator('#newPassword').input_value()=='' and await safari.locator('#repeatPassword').input_value()==''
  assert PASS not in await safari.evaluate('Object.values(localStorage).join(" ")+Object.values(sessionStorage).join(" ")+location.href')
  checks.append('Explicit updateUser saves only fixture current-user password; fields erased; no password retention')
  pwa=await make(False,path='');await pwa.locator('#loginPane').wait_for();assert not await pwa.locator('#workspace').is_visible()
  await pwa.locator('#email').fill(EMAIL);await pwa.locator('.passwordLogin summary').click();await pwa.locator('#password').fill(PASS);await pwa.locator('#loginSubmit').click();await pwa.locator('#workspace').wait_for()
  assert await pwa.evaluate('PablicusDebug.user')==UID and state['logins']==1
  checks.append('Independent app store signs in with user-chosen password using actual SDK; no link or token copied')
  await pwa.reload();await pwa.locator('#workspace').wait_for();assert state['logins']==1
  assert PASS not in await pwa.evaluate('Object.values(localStorage).join(" ")+Object.values(sessionStorage).join(" ")+location.href')
  checks.append('App session restores on reload without resending password or email')
  stale=await make(True);await stale.locator('#passwordSetup').wait_for();await fill(stale);state['switched']=True;before=state['puts'];await stale.locator('#savePassword').click();await stale.locator('#needsSession').wait_for();assert state['puts']==before;state['switched']=False
  checks.append('Changed session identity aborts before update')
  reauth=await make(True);await reauth.locator('#passwordSetup').wait_for();await fill(reauth,'new');state['nonce']=True;await reauth.locator('#savePassword').click();await reauth.locator('#reauth').wait_for();assert not await reauth.locator('#done').is_visible()
  await reauth.locator('#requestNonce').click();await reauth.wait_for_function('document.getElementById("status").textContent.includes("запрошен")');await reauth.locator('#nonce').fill('123456');await reauth.locator('#savePassword').click();await reauth.locator('#done').wait_for();state['nonce']=False
  checks.append('Server-requested reauthentication handled; no policy bypass')
  assert not errors,errors;assert not violations,violations;assert state['forbidden']==0
  await safari.screenshot(path=str(E/(name+'-access-success.png')))
  checks.append('No signup/admin/OTP recovery endpoint called; no JavaScript errors')
  return {'engine':name,'pass':True,'checks':checks,'scope':'REAL_SDK_MOCK_AUTH_HTTP_EXISTING_SESSION_SELF_SERVICE_AND_SEPARATE_APP_LOGIN','physical_iPhone':False,'real_user_password_changed':False}
 except Exception:return {'engine':name,'pass':False,'checks':checks,'error':traceback.format_exc(),'js_errors':errors,'request_shape_violations':violations}
 finally:
  for c in contexts:
   try:await c.close()
   except Exception:pass
  for t in dirs:t.cleanup()
async def main():
 out=[]
 async with async_playwright() as p:
  for n in ['chromium','webkit']:
   out.append(await one(getattr(p,n),n));(E/'access-setup.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
 print(json.dumps(out,ensure_ascii=False));assert all(x['pass'] for x in out)
asyncio.run(main())
