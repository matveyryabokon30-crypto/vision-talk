from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha
from integration_case import RESULT, save
from urllib.parse import urlparse, parse_qs
import json
import time
from network import API_HOST, uid_of


def owned_request(request, method, path, uid, cid=None, refresh=False):
 parsed=urlparse(request.url);query=parse_qs(parsed.query)
 if parsed.scheme!='https' or parsed.hostname!=API_HOST or parsed.port not in [None,443] or parsed.path!=path or request.method!=method:return False
 if refresh:
  try:return query=={'grant_type':['refresh_token']} and request.post_data_json.get('refresh_token')=='fixture-refresh-'+uid
  except Exception:return False
 if uid_of(request.headers.get('authorization',''))!=uid:return False
 if cid is not None:
  if method=='GET':return query.get('conversation_id')==['eq.'+cid] and query.get('order')==['server_seq.desc'] and query.get('limit')==['150']
  try:return request.post_data_json.get('p_conversation_id')==cid
  except Exception:return False
 return True


async def completed_response(request, evidence):
 """Wait for this exact browser request, not a release signal or elapsed delay."""
 evidence['request']={'method':request.method,'url':request.url,
                      'synthetic_auth_uid':uid_of(request.headers.get('authorization',''))}
 save()
 try:
  response=await asyncio.wait_for(request.response(),8)
  if response is None:raise RuntimeError('LATE_OPERATION_HAS_NO_HTTP_RESPONSE')
  # Playwright 1.57 Response.finished() leaves its target-close task pending
  # after successful completion. Use its public body/timing/failure observations:
  # responseEnd is updated by the requestFinished/requestFailed event handler.
  # This exact Request already exists, so the driver dispatches its terminal event.
  body=await asyncio.wait_for(response.body(),5)
  evidence['response']={'status':response.status,'finished':False,
                        'completion_observation':'Actual response body plus public Request.timing.responseEnd and Request.failure',
                        'body_sha256':sha(body),'body_bytes':len(body)}
  save()
  deadline=time.monotonic()+8
  while request.timing.get('responseEnd',-1)<0 and request.failure is None and time.monotonic()<deadline:
   await asyncio.sleep(.01)
  timing=dict(request.timing);failure=request.failure
  finished=timing.get('responseEnd',-1)>=0 and failure is None
  evidence['response'].update(finished=finished,finish_error=failure,request_failure=failure,timing=timing)
  save()
  if timing.get('responseEnd',-1)<0 and failure is None:
   raise asyncio.TimeoutError('REQUEST_FINISHED_TIMING_NOT_OBSERVED')
  if response.status!=200 or not finished:
   raise RuntimeError('LATE_OPERATION_RESPONSE_NOT_SUCCESSFUL')
  return json.loads(body)
 except BaseException as exc:
  evidence['completion_error']={'type':type(exc).__name__,'message':str(exc)};save();raise


async def refresh_session_evidence(a):
 """Observe a real SDK refresh, its HTTP body, and its delivered auth event."""
 evidence={};RESULT['same_user_refresh']=evidence;save()
 async with a.page.expect_response(lambda r:owned_request(r.request,'POST','/auth/v1/token',B,refresh=True),timeout=8000) as response_info:
  result=await a.page.evaluate("""async () => {
   const auth=PablicusController.getServices().client.auth,events=[];
   const error=e=>e?{name:e.name,message:e.message,status:e.status}:null;
   const digest=async value=>value?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join(''):null;
   const summary=async session=>{let claims=null;try{claims=JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))}catch{}return{uid:session?.user?.id||null,access_token_sha256:await digest(session?.access_token),iat:claims?.iat??null,expires_at:session?.expires_at??null}};
   const before=await auth.getSession();
   const {data:{subscription}}=auth.onAuthStateChange((event,session)=>{events.push({event,session})});
   try{
    const refreshed=await auth.refreshSession(),after=await auth.getSession();
    // Process the application's zero-delay auth continuation registered before
    // this observer. This does not invoke or replace application callbacks.
    await __integration.delay(0);
    return{before_error:error(before.error),before:await summary(before.data?.session),refresh_error:error(refreshed.error),refreshed:await summary(refreshed.data?.session),after_error:error(after.error),after:await summary(after.data?.session),events:await Promise.all(events.map(async row=>({event:row.event,...await summary(row.session)}))),auth_continuation_turn_completed:true};
   }finally{subscription.unsubscribe()}
  }""")
 response=await response_info.value
 evidence['sdk']=result
 payload=await completed_response(response.request,evidence)
 token_hash=sha(payload.get('access_token','').encode())
 evidence['http_session']={'uid':payload.get('user',{}).get('id'),'access_token_sha256':token_hash,'expires_at':payload.get('expires_at')}
 evidence['boundary_calls']=[c for c in a.net.calls if c['path']=='/auth/v1/token' and c.get('grant_type')=='refresh_token']
 save()
 before,after=result['before'],result['after']
 ok=(not result['before_error'] and not result['refresh_error'] and not result['after_error']
     and before['uid']==result['refreshed']['uid']==after['uid']==B
     and evidence['http_session']['uid']==B and before['access_token_sha256']!=after['access_token_sha256']
     and after['access_token_sha256']==result['refreshed']['access_token_sha256']==token_hash
     and isinstance(before['iat'],int) and isinstance(after['iat'],int) and after['iat']>before['iat']
     and any(row['event']=='TOKEN_REFRESHED' and row['uid']==B and row['access_token_sha256']==token_hash for row in result['events'])
     and len(evidence['boundary_calls'])==1 and evidence['boundary_calls'][0].get('status')==200)
 check('1C-TOKEN-REFRESH-SUCCEEDED',ok,evidence)
 return evidence

async def account_snapshot(a,uid,cid):
 d=await a.state()
 profile=await a.page.evaluate('(uid)=>JSON.parse(localStorage.getItem("pablicus:"+uid+":profile"))',uid)
 store=await a.page.evaluate('({account:PablicusChat.store.account,conversation:PablicusChat.store.conversation,name:PablicusChat.store.name})')
 return {'uid':d['uid'],'current':d['current'],'scope':d['scope'],'route':d['route'],'selected':d['selected'],'list':d['list'],'ready':d['ready'],'profile_cache':profile,'store':store,'live':await a.fp(),'stored':await a.fp('stored',uid,cid),'queue':await a.fp('queue',uid,cid)}

def account_content(snapshot):
 # Re-entering B legitimately changes route and session generations; its user data and selected
 # route/resource must remain identical to the saved B baseline.
 return {**snapshot,'route':{k:v for k,v in snapshot['route'].items() if k not in ['generation','sessionGeneration']}}

async def profile_ui(a,uid,cid,label):
 # The runtime keeps profile in a closure. Read its actual rendered profile,
 # in addition to observing the cache, without adding a runtime debug hook.
 await a.back();await a.nav('profile');await a.page.locator('.profileCard > h2').first.wait_for(state='visible')
 heading=await a.page.locator('.profileCard > h2').first.inner_text();handle=await a.page.locator('.profileCard > p.muted').first.inner_text()
 check(label,heading==('Fixture A' if uid==A else 'Fixture B') and handle==('@fixture_a' if uid==A else '@fixture_b'),{'heading':heading,'handle':handle})
 await a.nav('chats');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(cid)

async def run(a):
 await a.login();await a.conversation();own_a=await a.write(text='Account A private marker',files=FILES[:1],tail='A tail');await a.switch(B);await a.wait(f'!!document.querySelector("[data-conversation-id={CB}]")');await a.conversation(CB);own_b=await a.write(text='Account B private marker',files=FILES[1:2],tail='B tail')
 await a.switch(A);await a.wait(f'!!document.querySelector("[data-conversation-id={C1}]")');await a.conversation();check('1C-ACCOUNT-A-RESTORED',await a.fp()==own_a and await a.fp('stored',A,C1)==own_a,{'A':await a.fp(),'stored_A':await a.fp('stored',A,C1),'expected':own_a});await a.back()
 # Old actual conversation read is paused at its HTTP response boundary.
 held=a.net.hold('/rest/v1/messages',A);navigation_index=await a.page.evaluate('__integration.controllerStats.navigations.length')
 async with a.page.expect_request(lambda r:owned_request(r,'GET','/rest/v1/messages',A,C1),timeout=8000) as request_info:
  await a.page.locator(f'[data-conversation-id="{C1}"] .chatMain').click()
 request=await request_info.value;await asyncio.wait_for(held['entered'].wait(),8)
 operation={'navigation_index':navigation_index,'navigation_before':await a.page.evaluate('index=>__integration.controllerStats.navigations[index]',navigation_index)}
 RESULT.setdefault('late_operations',{})['read']=operation;save()
 if operation['navigation_before']['status']!='pending' or operation['navigation_before']['target'].get('conversationId')!=C1:raise RuntimeError('LATE_READ_NAVIGATION_NOT_PENDING')
 await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);before_b=await account_snapshot(a,B,CB)
 operation['before_release']={'hold_entered':held['entered'].is_set(),'hold_released':held['release'].is_set(),'request_timing':request.timing};save()
 if request.timing.get('responseStart',-1)>=0 or request.failure:raise RuntimeError('LATE_READ_NOT_HELD_BEFORE_RELEASE')
 held['release'].set();await completed_response(request,operation)
 await a.page.wait_for_function('index=>__integration.controllerStats.navigations[index]?.status!=="pending"',arg=navigation_index,timeout=8000)
 operation['navigation_after']=await a.page.evaluate('index=>__integration.controllerStats.navigations[index]',navigation_index);save()
 if operation['navigation_after']['status']!='fulfilled':raise RuntimeError('LATE_READ_NAVIGATION_DID_NOT_SETTLE')
 after_b=await account_snapshot(a,B,CB);check('1C-LATE-ACCOUNT-ISOLATION',after_b==before_b and after_b['live']==after_b['stored']==own_b and after_b['uid']==B and after_b['current']==CB and after_b['scope']=={'user':B,'chat':CB} and after_b['route']['conversationId']==CB and after_b['route']['resourceId'] is None and after_b['profile_cache']['id']==B and not after_b['queue'],{'before':before_b,'after':after_b,'completed_old_operation':operation})
 await profile_ui(a,B,CB,'1C-LATE-READ-PROFILE-B')
 refresh_before=await account_snapshot(a,B,CB);boot=await a.page.evaluate('vault.bootId');counter=await a.page.evaluate('PablicusChat.snapshot.counters.destroyed');refresh=await refresh_session_evidence(a)
 refresh_after=await account_snapshot(a,B,CB);check('1C-TOKEN-REFRESH-PRESERVES',refresh_after==refresh_before and await a.page.evaluate('vault.bootId')==boot and await a.page.evaluate('PablicusChat.snapshot.counters.destroyed')==counter,{'before':refresh_before,'after':refresh_after,'completed_refresh':refresh})
 # Real pending native save A -> B. B cannot acquire A's vault or draft.
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();db=await a.page.evaluate('PablicusChat.store.name');await a.page.evaluate('(database)=>__integration.holdWrite({database})',db);await a.page.locator('#input').fill('A pending save before B');await a.wait('__integration.held()?.entered');pending_a=await a.fp()
 await a.switch(B,wait=False);await a.delay(100);during=await a.state();await a.page.evaluate('__integration.releaseWrite()');await a.wait(f'PablicusDebug.user==="{B}" && !document.querySelector("#workspace").hidden');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB)
 saved_b=await account_snapshot(a,B,CB);stored_a=await a.fp('stored',A,C1)
 check('1C-PENDING-SAVE-ISOLATION',account_content(saved_b)==account_content(refresh_after) and saved_b['route']['sessionGeneration']==refresh_after['route']['sessionGeneration']+2 and saved_b['live']==saved_b['stored']==own_b and stored_a==pending_a,{'during':during,'before_B':refresh_after,'after_B':saved_b,'stored_A':stored_a,'native':await a.page.evaluate('__integration.idbEvents')})
 await profile_ui(a,B,CB,'1C-LATE-WRITE-PROFILE-B')
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();restored=await a.fp();check('1C-PENDING-SAVE-A-RESTORED',restored==pending_a==await a.fp('stored',A,C1) and restored['files']==own_a['files'],{'expected':pending_a,'restored':restored})
