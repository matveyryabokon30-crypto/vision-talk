"""Contract controls for synthetic routes; no external requests or product credit."""
import argparse, asyncio, hashlib, inspect, json, traceback
from pathlib import Path
from network import Boundary, A, B, C1, CB, API_HOST, jwt

class Request:
    def __init__(self,url,body,method='POST',uid=A,raw=b'',content_type='application/json'):
        self.url=url;self.method=method;self.post_data_json=body;self.post_data_buffer=raw
        self.headers={'content-type':content_type}
        if uid: self.headers['authorization']='Bearer '+jwt(uid)

class Route:
    def __init__(self,request):self.request=request;self.result={};self.responses=0
    async def fulfill(self,**kwargs):self.result=kwargs;self.responses+=1
    async def abort(self,reason):self.result={'abort':reason};self.responses+=1
    async def continue_(self):raise AssertionError('Unexpected external forwarding')

class Socket:
    def __init__(self,url):self.url=url;self.sent=[];self.closed=[];self.message_handler=None;self.close_handler=None
    def send(self,message):self.sent.append(json.loads(message))
    async def close(self,**kwargs):self.closed.append(kwargs)
    def on_message(self,handler):self.message_handler=handler
    def on_close(self,handler):raise AssertionError('Do not install affected Playwright 1.57 close callback')
    def connect_to_server(self):raise AssertionError('External socket connection forbidden')
    def emit(self,message):
        # Match the real API: callback return value is NOT awaited by Playwright.
        result=self.message_handler(message)
        assert not inspect.isawaitable(result),'WebSocket callback must execute synchronously'

UNSPECIFIED=object()
async def run():
    checks=[]
    async def request(name,url,body,expected,method='POST',uid=A,offline=False,raw=b'',content_type='application/json',expected_body=UNSPECIFIED):
        boundary=Boundary('http://127.0.0.1:1234');boundary.offline=offline
        route=Route(Request(url,body,method,uid,raw,content_type));await boundary.handle(route)
        assert route.responses==1,(name,'exactly one response required')
        actual=route.result.get('abort',route.result.get('status'))
        assert actual==expected,(name,actual,expected)
        if isinstance(actual,int):
            response=json.loads(route.result['body']) if route.result['body'] else None
            if actual==200 and any(url.endswith('/'+rpc) for rpc in ['get_message_actions','get_pinned_messages','factory_list_projects']):assert response==[],(name,'exact empty collection')
            if expected_body is not UNSPECIFIED:assert response==expected_body,(name,'response contract',response,expected_body)
            if actual==501:assert response['message'].startswith('UNMODELED_BOUNDARY '),(name,'explicit failure')
        if 'foreign-host' not in name:
            assert len(boundary.calls)==1 and 'status' in boundary.calls[0],(name,'journal')
        checks.append({'name':name,'status':'PASS','expected':expected,'actual':actual})
        return boundary
    for name in ['get_message_actions','get_pinned_messages','factory_list_projects']:
        url='https://'+API_HOST+'/rest/v1/rpc/'+name
        body={} if name.startswith('factory') else {'p_conversation_id':C1}
        if name=='get_message_actions':body['p_message_ids']=[C1[:-1]+'9']
        await request(name+'/valid',url,body,200)
        await request(name+'/method',url,body,501,method='GET')
        await request(name+'/no-auth',url,body,401,uid=None)
        net=await request(name+'/offline',url,body,'internetdisconnected',offline=True)
        assert net.calls[0]['context']==body
        await request(name+'/foreign-host',url.replace(API_HOST,'foreign.fixture.invalid'),body,'blockedbyclient')
        await request(name+'/wrong-path',url+'-unknown',body,501)
        await request(name+'/bad-context',url,{'unexpected':True},400 if name.startswith('factory') else 403)
        for invalid in [None,[],0,'not an object']:
            await request(name+'/nonobject-'+str(invalid),url,invalid,400)
        if not name.startswith('factory'):await request(name+'/other-owner',url,body,403,uid=B)
    for path in ['/auth/v1/other/token','/rest/v1/messages/','/functions/v1/public-push/unknown','/functions/v1/push-anything']:
        await request('unknown'+path,'https://'+API_HOST+path,{},501)
    await request('invalid-credentials','https://'+API_HOST+'/auth/v1/token?grant_type=password',{'email':'invented@fixture.invalid','password':'anything'},400)
    for uid in [B,'unknown']:
        await request('profile-other-owner-'+uid,'https://'+API_HOST+'/rest/v1/profiles?id=eq.'+uid,None,403,method='GET')
    data='Original alpha\nСтрока один\n'.encode()
    raw=(b'--fixture-boundary\r\nContent-Disposition: form-data; name="cacheControl"\r\n\r\n3600\r\n'
         b'--fixture-boundary\r\nContent-Disposition: form-data; name=""; filename="1-alpha.txt"\r\nContent-Type: text/plain\r\n\r\n'+data+b'\r\n--fixture-boundary--\r\n')
    obj='message-media/'+C1+'/'+A+'/message/block/1-alpha.txt'
    net=await request('multipart-original-blob','https://'+API_HOST+'/storage/v1/object/'+obj,{},200,raw=raw,content_type='multipart/form-data; boundary=fixture-boundary')
    observed=net.objects[obj]
    assert observed['bytes']==len(data) and observed['sha256']==hashlib.sha256(data).hexdigest() and observed['mime']=='text/plain' and observed['request_bytes']==len(raw)
    checks.append({'name':'multipart-original-bytes-sha256','status':'PASS','actual':observed})
    await request('upload-other-owner','https://'+API_HOST+'/storage/v1/object/'+obj,{},403,uid=B,raw=raw,content_type='multipart/form-data; boundary=fixture-boundary')
    read_url='https://'+API_HOST+'/rest/v1/rpc/mark_conversation_read'
    read_body={'p_conversation_id':C1,'p_last_read_seq':1}
    net=await request('mark-read-valid',read_url,read_body,200,expected_body=None)
    assert net.read_marks[(A,C1)]==1 and net.calls[0]['context']==read_body
    await request('mark-read-no-auth',read_url,read_body,401,uid=None)
    await request('mark-read-offline',read_url,read_body,'internetdisconnected',offline=True)
    await request('mark-read-other-owner',read_url,read_body,403,uid=B)
    await request('mark-read-method',read_url,read_body,501,method='GET')
    for seq in [-1,2,'1',True,None]:
        await request('mark-read-invalid-sequence-'+str(seq),read_url,{**read_body,'p_last_read_seq':seq},400)
    await request('mark-read-extra-context',read_url,{**read_body,'unknown':1},400)
    members='https://'+API_HOST+'/rest/v1/conversation_members?select=last_read_seq&conversation_id=eq.'+C1+'&user_id=neq.'+A
    await request('member-valid',members,None,200,method='GET',expected_body=[{'last_read_seq':1}])
    await request('member-other-owner',members.replace(C1,CB),None,403,method='GET')
    await request('member-wrong-peer',members.replace('neq.'+A,'neq.'+B),None,400,method='GET')
    await request('member-extra-filter',members+'&ignored=true',None,400,method='GET')
    await request('member-offline',members,None,'internetdisconnected',method='GET',offline=True)
    messages='https://'+API_HOST+'/rest/v1/messages?select=*&conversation_id=eq.'+C1
    initial=Boundary('http://127.0.0.1:1234').messages[C1]
    await request('message-initial',messages+'&order=server_seq.desc&limit=150',None,200,method='GET',expected_body=initial)
    await request('message-catchup',messages+'&server_seq=gt.1&order=server_seq.asc&limit=200',None,200,method='GET',expected_body=[])
    await request('message-range',messages+'&server_seq=gte.1&server_seq=lte.2&order=server_seq.asc&limit=61',None,200,method='GET',expected_body=initial)
    await request('message-by-id',messages+'&id=eq.'+initial[0]['id'],None,200,method='GET',expected_body=initial)
    ack='https://'+API_HOST+'/rest/v1/messages?select=id,server_seq,client_message_id,conversation_id,type,attachment_metadata&sender_id=eq.'+A+'&client_message_id=eq.synthetic-operation'
    await request('message-ack',ack,None,200,method='GET',expected_body=[])
    await request('message-ack-other-owner',ack.replace('sender_id=eq.'+A,'sender_id=eq.'+B),None,400,method='GET')
    await request('message-other-conversation',messages.replace(C1,CB),None,403,method='GET')
    await request('message-offline',messages,None,'internetdisconnected',method='GET',offline=True)
    for suffix in ['&ignored=true','&server_seq=eq.1','&server_seq=gte.invalid','&select=*','&order=unknown.desc']:
        await request('message-unmodeled-'+suffix,messages+suffix,None,501,method='GET')
    for suffix in ['&limit=0','&limit=-1','&limit=201','&id=neq.message']:
        await request('message-invalid-'+suffix,messages+suffix,None,400,method='GET')

    socket_url='wss://'+API_HOST+'/realtime/v1/websocket?apikey=fixture-public-key&vsn=2.0.0'
    topic='realtime:pablicus-inbox-'+A
    config={'broadcast':{'ack':False,'self':False},'presence':{'key':'','enabled':False},'private':False,'postgres_changes':[{'event':'INSERT','schema':'public','table':'messages'}]}
    async def socket_case(name,frame=None,expected='JOINED',url=socket_url,offline=False):
        boundary=Boundary('http://127.0.0.1:1234');boundary.offline=offline;socket=Socket(url)
        await boundary.websocket(socket)
        if frame is not None:
            assert socket.message_handler,(name,'message handler absent')
            socket.emit(json.dumps(frame));await boundary.drain()
        observed=boundary.ws_events[-1]
        assert observed['status']==expected,(name,observed)
        checks.append({'name':name,'status':'PASS','actual':observed})
        return boundary,socket
    join=['1','1',topic,'phx_join',{'config':config,'access_token':jwt(A)}]
    net,socket=await socket_case('socket-inbox-join',join)
    assert socket.sent[-1][4]=={'status':'ok','response':{'postgres_changes':[dict(config['postgres_changes'][0],id=1)]}}
    assert len(net.ws_channels)==1 and net.ws_events[-1]['context']==config
    socket.emit(json.dumps([None,'2','phoenix','heartbeat',{}]));await net.drain()
    assert net.ws_events[-1]['status']=='OK' and socket.sent[-1][4]['status']=='ok'
    checks.append({'name':'socket-heartbeat','status':'PASS'})
    socket.emit(json.dumps(['1','3',topic,'access_token',{'access_token':jwt(A)}]));await net.drain()
    assert net.ws_events[-1]['status']=='TOKEN_REFRESHED' and len(net.ws_channels)==1
    checks.append({'name':'socket-same-user-token-refresh','status':'PASS'})
    socket.emit(json.dumps(['1','4',topic,'phx_leave',{}]));await net.drain()
    assert net.ws_events[-1]['status']=='LEFT' and not net.ws_channels
    checks.append({'name':'socket-leave-cleans','status':'PASS'})
    net,socket=await socket_case('socket-account-change-initial',join)
    socket.emit(json.dumps(['1','5',topic,'access_token',{'access_token':jwt(B)}]));await net.drain()
    assert not net.ws_channels and net.ws_events[-1]['status']=='STALE_CHANNEL_REVOKED'
    checks.append({'name':'socket-account-change-revokes-old-channel','status':'PASS'})
    net,socket=await socket_case('socket-online-initial',join);net.offline=True
    socket.emit(json.dumps([None,'6','phoenix','heartbeat',{}]));await net.drain()
    assert net.ws_events[-1]['status']=='NETWORK_UNAVAILABLE' and not net.ws_channels and socket.closed[-1]['code']==1013
    checks.append({'name':'socket-offline-frame-closes','status':'PASS'})
    await socket_case('socket-offline-connect',expected='NETWORK_UNAVAILABLE',offline=True)
    for label,invalid_url in [('foreign-host',socket_url.replace(API_HOST,'foreign.fixture.invalid')),('wrong-path',socket_url.replace('/websocket','/other')),('wrong-scheme',socket_url.replace('wss:','ws:')),('wrong-version',socket_url.replace('2.0.0','9.0.0')),('extra-query',socket_url+'&unknown=true')]:
        net,socket=await socket_case('socket-invalid-endpoint-'+label,expected='UNMODELED_BOUNDARY',url=invalid_url)
        assert socket.closed and net.blocked
    for label,token in [('missing',''),('other-owner',jwt(B)),('invalid','invalid-token')]:
        expected='FORBIDDEN_SUBSCRIPTION' if token==jwt(B) else 'UNAUTHORIZED'
        net,socket=await socket_case('socket-invalid-auth-context-'+label,['1','1',topic,'phx_join',{'config':config,'access_token':token}],expected)
        assert socket.sent[-1][4]['status']=='error' and not net.ws_channels
    chat_config={**config,'postgres_changes':[dict(config['postgres_changes'][0],filter='conversation_id=eq.'+C1)]}
    await socket_case('socket-chat-join',['1','1','realtime:pablicus-chat-'+C1,'phx_join',{'config':chat_config,'access_token':jwt(A)}])
    wrong_config={**config,'postgres_changes':[{'event':'DELETE','schema':'public','table':'messages'}]}
    net,socket=await socket_case('socket-wrong-subscription',['1','1',topic,'phx_join',{'config':wrong_config,'access_token':jwt(A)}],'UNMODELED_BOUNDARY postgres subscription')
    assert net.unknown and not net.ws_channels
    await socket_case('socket-unknown-event',['1','1',topic,'unknown_event',{}],'UNMODELED_BOUNDARY unknown_event')
    await socket_case('socket-unknown-leave-topic',['1','1','realtime:pablicus-chat-unknown','phx_leave',{}],'UNMODELED_BOUNDARY topic')
    await socket_case('socket-unknown-refresh-topic',['1','1','realtime:pablicus-inbox-unknown','access_token',{'access_token':jwt(A)}],'UNMODELED_BOUNDARY topic')
    return {'test_id':'NETWORK-BOUNDARY-CONTRACT-01','status':'PASS','checks':checks,'behavioral_product_assertions':0}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path);parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    try:result=asyncio.run(run())
    except Exception as exc:result={'status':'FAIL','reason':str(exc),'traceback':traceback.format_exc()}
    if args.output:
        args.output.mkdir(parents=True,exist_ok=True);(args.output/'results.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['status']=='PASS' else 1)
