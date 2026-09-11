"""Stateful synthetic HTTP/Phoenix boundary. Never forwards an external request.
The bundled Supabase SDK and all application modules remain unmodified.
"""
from __future__ import annotations
import asyncio, base64, copy, hashlib, json, time
from collections import Counter
from urllib.parse import urlparse, parse_qs

A='11111111-1111-4111-8111-111111111111'
B='22222222-2222-4222-8222-222222222222'
C1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
C2='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
CB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
BOT='dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
API_HOST='ctcoqgsztdtsazdiwcmd.supabase.co'

def b64(v):
    return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).decode().rstrip('=')
def jwt(uid):
    return b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':uid,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600,'iat':int(time.time()),'email':('a' if uid==A else 'b')+'@fixture.invalid'})+'.c3ludGhldGljLXRlc3Qtb25seQ'
def uid_of(token):
    try:
        t=token.removeprefix('Bearer '); part=t.split('.')[1]
        return json.loads(base64.urlsafe_b64decode(part+'='*((-len(part))%4)))['sub']
    except Exception: return None

def user(uid):
    return {'id':uid,'aud':'authenticated','role':'authenticated','email':('a' if uid==A else 'b')+'@fixture.invalid','email_confirmed_at':'2026-01-01T00:00:00Z','created_at':'2026-01-01T00:00:00Z','app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},'identities':[]}
def session(uid):
    return {'access_token':jwt(uid),'refresh_token':'fixture-refresh-'+uid,'token_type':'bearer','expires_in':3600,'expires_at':int(time.time())+3600,'user':user(uid)}

class Boundary:
    def __init__(self, origin):
        self.origin=origin; self.calls=[]; self.unknown=[]; self.blocked=[]
        self.offline=False; self.deny_send=False; self.lose_ack=False
        self.holds=[]; self.messages={}; self.effects=[]; self.objects={}; self.ws_channels=set();self.ws_events=[]
        self.canvases={}
        for uid,cids in [(A,[C1,C2]),(B,[CB])]:
            for i,cid in enumerate(cids):
                self.messages[cid]=[{'id':cid[:-1]+'9','conversation_id':cid,'sender_id':B if uid==A else A,'type':'text','body':'Fixture conversation '+cid[-1], 'server_seq':1,'client_message_id':None,'attachment_metadata':{},'created_at':'2026-01-01T00:00:00Z','deleted_at':None}]
                self.canvases[cid]={'conversation_id':cid,'revision':1,'canvas':{'body':'Saved fixture project','content':{'v':1,'blocks':[{'id':'plan-1','type':'text','text':'Saved fixture project'}]},'revision':1},'tasks':[],'participants':[{'id':uid,'user_id':uid,'display_name':'Fixture '+('A' if uid==A else 'B'),'username':'fixture'}]}
        self.bot={'id':BOT,'name':'Fixture Bot','description':'Isolated scenario','status':'active','visibility':'private','revision':1,'flow':{'version':1,'start':'start','nodes':{'start':{'type':'say','text':'Fixture greeting','next':'end'},'end':{'type':'end','text':'Done'}}}}
    def hold(self,path,uid=None):
        item={'path':path,'uid':uid,'entered':asyncio.Event(),'release':asyncio.Event(),'used':False};self.holds.append(item);return item
    async def wait_holds(self,path,uid):
        for h in self.holds:
            if not h['used'] and h['path'] in path and (h['uid'] is None or h['uid']==uid):
                h['used']=True;h['entered'].set()
                await asyncio.wait_for(h['release'].wait(),15)
                return
    def owns(self,uid,cid):return cid in ([C1,C2] if uid==A else [CB] if uid==B else [])
    def dialogs(self,uid):
        cids=[C1,C2] if uid==A else [CB] if uid==B else []
        return [{'id':c,'title':('A' if uid==A else 'B')+' conversation '+str(i+1),'last_seq':len(self.messages[c]),'last_message':self.messages[c][-1]['body'],'unread_count':0} for i,c in enumerate(cids)]
    async def handle(self,route):
        req=route.request;p=urlparse(req.url)
        if p.scheme in ['data','blob']:await route.continue_();return
        if req.url.startswith(self.origin+'/'):
            await route.continue_();return
        if p.hostname not in [API_HOST,API_HOST.replace('.supabase.co','.storage.supabase.co')]:
            self.blocked.append({'method':req.method,'url':req.url});await route.abort('blockedbyclient');return
        uid=uid_of(req.headers.get('authorization',''));path=p.path;q=parse_qs(p.query)
        try: body=req.post_data_json or {}
        except Exception:body={}
        entry={'method':req.method,'path':path,'uid':uid,'query':p.query,'at':round(time.monotonic(),6)}
        if path.endswith('send_rich_message'):entry['operation_key']=body.get('p_client_message_id')
        self.calls.append(entry)
        async def reply(data=None,status=200):
            entry['status']=status
            await route.fulfill(status=status,content_type='application/json',body=json.dumps(data) if data is not None else '')
        if self.offline:
            entry['status']='NETWORK_UNAVAILABLE';await route.abort('internetdisconnected');return
        # Capture query state before delay, so a late response really belongs to A.
        if path.startswith('/auth/v1/'):
            if path.endswith('/token'):
                if q.get('grant_type')==['refresh_token']:who=body.get('refresh_token','').removeprefix('fixture-refresh-')
                else:who=A if body.get('email','').startswith('a@') else B
                if who not in [A,B]:await reply({'msg':'Invalid fixture credentials'},400);return
                await self.wait_holds(path,who);await reply(session(who));return
            if path.endswith('/user'):await reply(user(uid) if uid else {'msg':'Unauthorized'},200 if uid else 401);return
            if path.endswith('/logout'):await reply(None,204);return
            if path.endswith('/settings'):await reply({});return
        if not uid:
            await reply({'message':'Synthetic boundary: no session'},401);return
        if path.startswith('/rest/v1/rpc/'):
            name=path.split('/')[-1];cid=body.get('p_conversation_id')
            if name in ['my_conversations_v3','my_conversations_v2']:
                result=copy.deepcopy(self.dialogs(uid));await self.wait_holds(path,uid);await reply(result);return
            if name in ['pablicus_get_canvas','pablicus_save_canvas_plan_v2']:
                if not self.owns(uid,cid):await reply({'message':'Fixture forbidden'},403);return
                if name=='pablicus_save_canvas_plan_v2':
                    state=self.canvases[cid];rev=state['canvas']['revision']
                    if body['p_expected_revision']!=rev:await reply({'message':'Fixture revision conflict'},409);return
                    state['canvas']={'content':copy.deepcopy(body['p_content']),'body':'\n'.join(b.get('text','') for b in body['p_content']['blocks']),'revision':rev+1};state['revision']+=1
                result=copy.deepcopy(self.canvases[cid]);await self.wait_holds(path,uid);await reply(result);return
            if name=='send_rich_message':
                if not self.owns(uid,cid):await reply({'message':'Fixture forbidden'},403);return
                if self.deny_send:await reply({'message':'FIXTURE_EXPLICIT_REJECTION','code':'42501'},403);return
                key=body['p_client_message_id'];existing=next((m for m in self.messages[cid] if m['client_message_id']==key and m['sender_id']==uid),None)
                if existing is None:
                    existing={'id':key,'conversation_id':cid,'sender_id':uid,'client_message_id':key,'server_seq':len(self.messages[cid])+1,'body':'\n'.join(b.get('text','') for b in body['p_content']['blocks'] if b['type']=='text'),'type':'rich','attachment_metadata':copy.deepcopy(body['p_content']),'created_at':'2026-01-02T00:00:00Z','deleted_at':None}
                    self.messages[cid].append(existing);self.effects.append({'uid':uid,'conversation':cid,'key':key})
                await self.wait_holds(path,uid)
                if self.lose_ack:
                    self.lose_ack=False;entry['status']='COMMITTED_ACK_LOST';await route.abort('connectionreset');return
                await reply(copy.deepcopy(existing));return
            if name=='pablicus_list_tasks_v2':await reply({'tasks':[],'next_cursor':None});return
            if name=='pablicus_list_projects':await reply({'projects':[],'next_cursor':None});return
            if name=='pablicus_storage_usage':await reply({'total_bytes':0,'own_bytes':0,'unknown_size_count':0});return
            if name in ['mark_conversation_read','pablicus_register_push','pablicus_unregister_push']:await reply(None);return
            if name in ['pablicus_search_people','pablicus_message_changes']:await reply([]);return
        if path.startswith('/rest/v1/'):
            table=path.split('/')[-1]
            def filt(k):return q.get(k,[''])[0].removeprefix('eq.')
            if table=='profiles':
                who=filt('id');result={'id':who,'username':'fixture_a' if who==A else 'fixture_b','display_name':'Fixture A' if who==A else 'Fixture B','avatar_url':None,'is_approved':True}
                await self.wait_holds(path,uid);await reply(result);return
            if table=='messages':
                cid=filt('conversation_id');items=copy.deepcopy(self.messages.get(cid,[])) if cid else copy.deepcopy([m for c,ms in self.messages.items() if self.owns(uid,c) for m in ms])
                if cid and not self.owns(uid,cid):items=[]
                for key in ['id','sender_id','client_message_id']:
                    if key in q:items=[m for m in items if m.get(key)==filt(key)]
                for expr in q.get('server_seq',[]):
                    op,num=expr.split('.',1);n=int(num);items=[m for m in items if {'gt':m['server_seq']>n,'lt':m['server_seq']<n,'gte':m['server_seq']>=n,'lte':m['server_seq']<=n}.get(op,True)]
                items.sort(key=lambda m:m['server_seq'],reverse='desc' in q.get('order',[''])[0]);items=items[:int(q.get('limit',['1000'])[0])]
                await self.wait_holds(path,uid)
                if 'application/vnd.pgrst.object+json' in req.headers.get('accept',''):await reply(items[0] if items else None)
                else:await reply(items)
                return
            if table=='conversation_members':await reply([{'last_read_seq':1}]);return
        if path.startswith('/storage/v1/'):
            if '/object/sign/' in path:
                obj=path.split('/object/sign/',1)[1]
                if obj not in self.objects:await reply({'message':'Object not found'},400);return
                await reply({'signedURL':'/object/sign/'+obj+'?token=fixture-only'});return
            if '/object/' in path and req.method in ['POST','PUT']:
                obj=path.split('/object/',1)[1];data=req.post_data_buffer or b'';self.objects[obj]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)};await reply({'Key':obj});return
        if path.startswith('/functions/v1/public-bot-core/'):
            sub=path.split('/public-bot-core',1)[1]
            if sub=='/v1/bots':await reply({'bots':[self.bot]});return
            if sub=='/v1/bots/'+BOT:await reply(copy.deepcopy(self.bot));return
            if sub=='/v1/bots/'+BOT+'/chats':await reply({'chats':[]});return
        if '/public-push' in path or '/push-' in path:await reply({'enabled':False,'subscriptions':[]});return
        self.unknown.append(entry.copy());await reply({'message':'UNMODELED_BOUNDARY '+path},501)
    def websocket(self,ws):
        # A routed WebSocket is never connected to the external server.
        def on_message(message):
            try:
                msg=json.loads(message)
                if isinstance(msg,list):jr,ref,topic,event,payload=msg
                else:jr=msg.get('join_ref');ref=msg.get('ref');topic=msg.get('topic');event=msg.get('event');payload=msg.get('payload',{})
                self.ws_events.append({'topic':topic,'event':event})
                if event=='phx_join':self.ws_channels.add(topic)
                if event=='phx_leave':self.ws_channels.discard(topic)
                if event in ['phx_join','phx_leave','heartbeat']:
                    response={'status':'ok','response':{}}
                    if event=='phx_join':response['response']['postgres_changes']=[dict(x,id=i+1) for i,x in enumerate(payload.get('config',{}).get('postgres_changes',[]))]
                    answer=[jr,ref,topic,'phx_reply',response] if isinstance(msg,list) else {'join_ref':jr,'ref':ref,'topic':topic,'event':'phx_reply','payload':response}
                    ws.send(json.dumps(answer))
            except Exception as exc:self.unknown.append({'websocket_error':str(exc)})
        ws.on_message(on_message)
    def summary(self):
        return {'calls':self.calls,'effects':self.effects,'objects':self.objects,'unknown':self.unknown,'blocked':self.blocked,'websocket_events':self.ws_events,'active_external_channels':sorted(self.ws_channels)}
