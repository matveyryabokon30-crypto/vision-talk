"""Stateful synthetic HTTP/Phoenix boundary. Never forwards an external request.
The bundled Supabase SDK and all application modules remain unmodified.
"""
from __future__ import annotations
import asyncio, base64, copy, hashlib, json, time
from collections import Counter
from email import policy
from email.parser import BytesParser
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
def jwt(uid,epoch=None):
    now=int(time.time()) if epoch is None else epoch
    return b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':uid,'aud':'authenticated','role':'authenticated','exp':now+3600,'iat':now,'email':('a' if uid==A else 'b')+'@fixture.invalid'})+'.c3ludGhldGljLXRlc3Qtb25seQ'
def uid_of(token):
    try:
        if not token.startswith('Bearer '):return None
        parts=token.removeprefix('Bearer ').split('.')
        if len(parts)!=3 or parts[2]!='c3ludGhldGljLXRlc3Qtb25seQ':return None
        part=parts[1];claims=json.loads(base64.urlsafe_b64decode(part+'='*((-len(part))%4)))
        if claims.get('sub') not in [A,B] or claims.get('aud')!='authenticated' or claims.get('role')!='authenticated' or claims.get('exp',0)<=time.time():return None
        return claims['sub']
    except Exception: return None

def user(uid):
    return {'id':uid,'aud':'authenticated','role':'authenticated','email':('a' if uid==A else 'b')+'@fixture.invalid','email_confirmed_at':'2026-01-01T00:00:00Z','created_at':'2026-01-01T00:00:00Z','app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},'identities':[]}
def session(uid,epoch=None):
    now=int(time.time()) if epoch is None else epoch
    return {'access_token':jwt(uid,now),'refresh_token':'fixture-refresh-'+uid,'token_type':'bearer','expires_in':3600,'expires_at':now+3600,'user':user(uid)}

class Boundary:
    def __init__(self, origin, session_epoch=None):
        self.session_epoch=session_epoch
        self.origin=origin; self.calls=[]; self.unknown=[]; self.blocked=[]
        self.offline=False; self.deny_send=False; self.lose_ack=False
        self.holds=[]; self.messages={}; self.effects=[]; self.objects={}; self.ws_channels=set();self.ws_events=[]
        self.ws_serial=0;self.ws_connections={};self.read_marks={}
        self.ws_jobs=set();self.ws_errors=[];self.ws_routes={};self.ws_lifecycle={};self.ws_page_serial=0
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
        if p.scheme!='https' or p.port not in [None,443] or p.hostname not in [API_HOST,API_HOST.replace('.supabase.co','.storage.supabase.co')]:
            self.blocked.append({'method':req.method,'url':req.url});await route.abort('blockedbyclient');return
        uid=uid_of(req.headers.get('authorization',''));path=p.path;q=parse_qs(p.query,keep_blank_values=True)
        try: body=req.post_data_json
        except Exception:body=None
        special={'/rest/v1/rpc/get_message_actions','/rest/v1/rpc/get_pinned_messages','/rest/v1/rpc/factory_list_projects'}
        entry={'host':p.hostname,'method':req.method,'path':path,'uid':uid,'query':p.query,'at':round(time.monotonic(),6)}
        if path in special:entry['context']=copy.deepcopy(body)
        if path.endswith('send_rich_message'):entry['operation_key']=body.get('p_client_message_id') if isinstance(body,dict) else None
        self.calls.append(entry)
        async def reply(data=None,status=200):
            entry['status']=status
            await route.fulfill(status=status,content_type='application/json',body=json.dumps(data) if data is not None else '')
        if self.offline:
            entry['status']='NETWORK_UNAVAILABLE';await route.abort('internetdisconnected');return
        async def unmodeled():
            entry['status']=501;self.unknown.append(entry.copy())
            await reply({'message':'UNMODELED_BOUNDARY '+path},501)
        # Exact declared callers only: suffix matches and arbitrary methods do
        # not acquire a synthetic success merely by resembling a known route.
        rpc_names={'my_conversations_v3','my_conversations_v2','pablicus_get_canvas','pablicus_save_canvas_plan_v2',
                   'send_rich_message','pablicus_list_tasks_v2','pablicus_list_projects','pablicus_storage_usage',
                   'mark_conversation_read','pablicus_register_push','pablicus_unregister_push',
                   'pablicus_search_people','pablicus_message_changes','get_message_actions','get_pinned_messages','factory_list_projects'}
        methods={'/auth/v1/token':{'POST'},'/auth/v1/user':{'GET'},'/auth/v1/settings':{'GET'},'/auth/v1/logout':{'POST'},
                 **{'/rest/v1/rpc/'+name:{'POST'} for name in rpc_names},
                 **{'/rest/v1/'+name:{'GET'} for name in ['profiles','messages','conversation_members']},
                 **{'/functions/v1/public-bot-core'+sub:{'GET'} for sub in ['/v1/bots','/v1/bots/'+BOT,'/v1/bots/'+BOT+'/chats']}}
        storage=path.startswith('/storage/v1/object/')
        allowed=({'POST'} if path.startswith('/storage/v1/object/sign/') else {'POST','PUT'}) if storage else methods.get(path,set())
        if req.method not in allowed or (not storage and p.hostname!=API_HOST):
            await unmodeled();return
        if req.method in ['POST','PUT'] and not storage and path!='/auth/v1/logout' and not isinstance(body,dict):
            await reply({'message':'Fixture JSON object required'},400);return
        # Capture query state before delay, so a late response really belongs to A.
        if path.startswith('/auth/v1/'):
            if path.endswith('/token'):
                who=None
                if isinstance(body,dict) and set(q)=={'grant_type'}:
                    if q['grant_type']==['refresh_token']:who=body.get('refresh_token','').removeprefix('fixture-refresh-')
                    elif q['grant_type']==['password'] and body.get('password')=='fixture-only-password':who={'a@fixture.invalid':A,'b@fixture.invalid':B}.get(body.get('email'))
                if who not in [A,B]:await reply({'msg':'Invalid fixture credentials'},400);return
                await self.wait_holds(path,who);await reply(session(who,self.session_epoch));return
            if path.endswith('/user'):await reply(user(uid) if uid else {'msg':'Unauthorized'},200 if uid else 401);return
            if path.endswith('/logout'):await reply(None,204);return
            if path.endswith('/settings'):await reply({});return
        if uid not in [A,B]:
            await reply({'message':'Synthetic boundary: no session'},401);return
        if path in special:
            if p.hostname!=API_HOST or req.method!='POST' or p.query or not isinstance(body,dict):
                entry['status']=501;self.unknown.append(entry.copy());await reply({'message':'UNMODELED_BOUNDARY '+path},501);return
            if path.endswith('/factory_list_projects'):
                if body:
                    await reply({'message':'Fixture invalid factory context'},400);return
            else:
                cid=body.get('p_conversation_id')
                if not self.owns(uid,cid):
                    await reply({'message':'Fixture forbidden'},403);return
                allowed={'p_conversation_id'}
                if path.endswith('/get_message_actions'):
                    allowed.add('p_message_ids');ids=body.get('p_message_ids')
                    known={m['id'] for m in self.messages[cid]}
                    if not isinstance(ids,list) or not ids or len(ids)>200 or any(not isinstance(i,str) or i not in known for i in ids):
                        await reply({'message':'Fixture invalid message context'},400);return
                if set(body)!=allowed:
                    await reply({'message':'Fixture invalid request context'},400);return
            # Existing empty collections now share host/auth/offline guards and journal.
            await reply([]);return
        if path.startswith('/rest/v1/rpc/'):
            name=path.split('/')[-1];cid=body.get('p_conversation_id')
            if name=='mark_conversation_read':
                entry['context']=copy.deepcopy(body)
                if p.query or set(body)!={'p_conversation_id','p_last_read_seq'}:
                    await reply({'message':'Fixture invalid read context'},400);return
                if not self.owns(uid,cid):await reply({'message':'Fixture forbidden read context'},403);return
                seq=body['p_last_read_seq'];last=max(m['server_seq'] for m in self.messages[cid])
                if type(seq) is not int or not 0<=seq<=last:
                    await reply({'message':'Fixture invalid read sequence'},400);return
                self.read_marks[(uid,cid)]=max(self.read_marks.get((uid,cid),0),seq)
                await reply(None);return
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
            if name in ['pablicus_register_push','pablicus_unregister_push']:await reply(None);return
            if name in ['pablicus_search_people','pablicus_message_changes']:await reply([]);return
        if path.startswith('/rest/v1/'):
            table=path.split('/')[-1]
            def filt(k):return q.get(k,[''])[0].removeprefix('eq.')
            if table=='profiles':
                who=filt('id')
                if who!=uid:await reply({'message':'Fixture forbidden profile context'},403);return
                result={'id':who,'username':'fixture_a' if who==A else 'fixture_b','display_name':'Fixture A' if who==A else 'Fixture B','avatar_url':None,'is_approved':True}
                await self.wait_holds(path,uid);await reply(result);return
            if table=='messages':
                entry['context']=copy.deepcopy(q)
                known={'select','conversation_id','id','sender_id','client_message_id','server_seq','order','limit'}
                if set(q)-known or any(len(values)!=1 for key,values in q.items() if key!='server_seq'):
                    await unmodeled();return
                selection=q.get('select',[''])[0]
                if selection not in ['*','id,server_seq,client_message_id,conversation_id,type,attachment_metadata']:
                    await unmodeled();return
                for key in ['conversation_id','id','sender_id','client_message_id']:
                    if key in q and (not q[key][0].startswith('eq.') or not filt(key)):
                        await reply({'message':'Fixture equality context required'},400);return
                cid=filt('conversation_id')
                if cid:
                    if not self.owns(uid,cid):await reply({'message':'Fixture forbidden conversation'},403);return
                    if selection!='*' or 'sender_id' in q or 'client_message_id' in q:
                        await unmodeled();return
                elif filt('sender_id')!=uid or not filt('client_message_id') or selection=='*' or set(q)!={'select','sender_id','client_message_id'}:
                    await reply({'message':'Fixture owned conversation or same-user ACK context required'},400);return
                ordering=q.get('order',['server_seq.asc'])[0]
                if ordering not in ['server_seq.asc','server_seq.desc']:
                    await unmodeled();return
                limit=q.get('limit',['200'])[0]
                if not limit.isdecimal() or not 1<=int(limit)<=200:
                    await reply({'message':'Fixture invalid message limit'},400);return
                ranges=[]
                for expr in q.get('server_seq',[]):
                    op,separator,num=expr.partition('.')
                    if op not in ['gt','lt','gte','lte'] or not separator or not num.isdecimal():
                        await unmodeled();return
                    ranges.append((op,int(num)))
                if len(ranges)>2 or (len(ranges)==2 and {op for op,num in ranges}!={'gte','lte'}):
                    await unmodeled();return
                items=copy.deepcopy(self.messages[cid]) if cid else copy.deepcopy([m for c,ms in self.messages.items() if self.owns(uid,c) for m in ms])
                for key in ['id','sender_id','client_message_id']:
                    if key in q:items=[m for m in items if m.get(key)==filt(key)]
                for op,n in ranges:
                    items=[m for m in items if {'gt':m['server_seq']>n,'lt':m['server_seq']<n,'gte':m['server_seq']>=n,'lte':m['server_seq']<=n}[op]]
                items.sort(key=lambda m:m['server_seq'],reverse=ordering=='server_seq.desc');items=items[:int(limit)]
                await self.wait_holds(path,uid)
                if 'application/vnd.pgrst.object+json' in req.headers.get('accept',''):await reply(items[0] if items else None)
                else:await reply(items)
                return
            if table=='conversation_members':
                entry['context']=copy.deepcopy(q)
                if set(q)!={'select','conversation_id','user_id'} or any(len(values)!=1 for values in q.values()) or q['select']!=['last_read_seq'] or q['user_id']!=['neq.'+uid] or not q['conversation_id'][0].startswith('eq.'):
                    await reply({'message':'Fixture invalid member read context'},400);return
                cid=filt('conversation_id')
                if not self.owns(uid,cid):await reply({'message':'Fixture forbidden member context'},403);return
                # Declared peer fixture starts at sequence 1; actual mark-read
                # operations update the corresponding synthetic read position.
                peer=B if uid==A else A
                await reply([{'last_read_seq':self.read_marks.get((peer,cid),1)}]);return
        if path.startswith('/storage/v1/'):
            obj=path.split('/object/sign/',1)[1] if '/object/sign/' in path else path.split('/object/',1)[1]
            segments=obj.split('/')
            if len(segments)<5 or segments[0]!='message-media' or not self.owns(uid,segments[1]) or segments[2]!=uid or any(s in ['','..','.'] for s in segments):
                await reply({'message':'Fixture forbidden object path'},403);return
            entry['context']={'object':obj,'conversation':segments[1]}
            if '/object/sign/' in path:
                if obj not in self.objects:await reply({'message':'Object not found'},400);return
                await reply({'signedURL':'/object/sign/'+obj+'?token=fixture-only'});return
            if '/object/' in path and req.method in ['POST','PUT']:
                raw=req.post_data_buffer or b'';content_type=req.headers.get('content-type','application/octet-stream');data=raw;filename=None
                if content_type.startswith('multipart/form-data;'):
                    message=BytesParser(policy=policy.default).parsebytes(('Content-Type: '+content_type+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
                    files=[part for part in message.iter_parts() if part.get_content_disposition()=='form-data' and part.get_filename() is not None]
                    if len(files)!=1:await reply({'message':'Fixture invalid multipart upload'},400);return
                    data=files[0].get_payload(decode=True);content_type=files[0].get_content_type();filename=files[0].get_filename()
                self.objects[obj]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'mime':content_type,'filename':filename,'uid':uid,'conversation':segments[1],'request_bytes':len(raw)}
                await reply({'Key':obj});return
        if path.startswith('/functions/v1/public-bot-core/'):
            sub=path.split('/public-bot-core',1)[1]
            if sub=='/v1/bots':await reply({'bots':[self.bot]});return
            if sub=='/v1/bots/'+BOT:await reply(copy.deepcopy(self.bot));return
            if sub=='/v1/bots/'+BOT+'/chats':await reply({'chats':[]});return
        await unmodeled()
    def _ws_error(self,source,error):
        entry={'event':'qualification_error','source':source,'status':'BOUNDARY_CALLBACK_ERROR','error':str(error),'at':round(time.monotonic(),6)}
        self.ws_errors.append(entry);self.unknown.append(entry.copy())
    def _ws_job(self,awaitable,source):
        task=asyncio.create_task(awaitable);self.ws_jobs.add(task)
        def completed(done):
            self.ws_jobs.discard(done)
            if done.cancelled():self._ws_error(source,'Cancelled boundary operation')
            else:
                error=done.exception()
                if error is not None:self._ws_error(source,error)
        task.add_done_callback(completed)
    async def drain(self):
        if self.ws_jobs:await asyncio.wait_for(asyncio.gather(*list(self.ws_jobs),return_exceptions=True),5)
        if self.ws_errors:raise RuntimeError('WebSocket boundary qualification errors: '+str(self.ws_errors))
    def _ws_closed(self,connection,source,status='CLOSED'):
        for topic in list(self.ws_connections[connection]):self.ws_channels.discard((connection,topic))
        self.ws_connections[connection].clear()
        self.ws_events.append({'connection':connection,'event':'close','status':status,'source':source,'at':round(time.monotonic(),6)})
    def _bind_socket_observers(self):
        assigned={item.get('connection') for item in self.ws_lifecycle.values()}
        for token,item in self.ws_lifecycle.items():
            if 'connection' in item:continue
            connection=next((c for c,r in self.ws_routes.items() if c not in assigned and r.url==item['url']),None)
            if connection is None:continue
            item['connection']=connection;assigned.add(connection)
            self.ws_events.append({'connection':connection,'event':'observed','token':token,'source':'native.WebSocket.lifecycle','at':round(time.monotonic(),6)})
            if item.get('closed'):self._ws_closed(connection,'native.WebSocket.close')
    async def attach_page(self,page):
        # Playwright 1.57 does not emit page.websocket for routed sockets. Its
        # route.on_close also indexes absent code/reason for close(). Observe
        # native lifecycle events through the public binding/init-script APIs.
        # This identical observer is present in A, B0 and B1, independently of
        # instrument.js; it never replaces native send/close or connects a server.
        self.ws_page_serial+=1;page_id=self.ws_page_serial
        def observed(source,event):
            try:
                token=event['token'];kind=event['event']
                if kind=='created':
                    if token in self.ws_lifecycle:raise ValueError('Duplicate native socket token')
                    self.ws_lifecycle[token]={'url':event['url'],'page':page_id,'closed':False}
                    self._bind_socket_observers()
                else:
                    item=self.ws_lifecycle[token]
                    self.ws_events.append({**event,'connection':item.get('connection'),'source':'native.WebSocket.'+kind,'at':round(time.monotonic(),6)})
                    if kind=='close':
                        item['closed']=True
                        if 'connection' in item:self._ws_closed(item['connection'],'native.WebSocket.close')
                    elif kind=='error':self._ws_error('native.WebSocket.error','Native socket error '+item['url'])
            except Exception as exc:self._ws_error('native.WebSocket.lifecycle',exc)
        await page.expose_binding('__integrationBoundarySocketEvent',observed)
        await page.add_init_script(script='''(() => {
          const Native=window.WebSocket, report=window.__integrationBoundarySocketEvent;
          const pageId=PAGE_ID, documentId=crypto.randomUUID(); let serial=0;
          const notify=event=>{report(event).catch(error=>{setTimeout(()=>{throw error},0)})};
          window.WebSocket=new Proxy(Native,{construct(target,args,newTarget){
            const socket=Reflect.construct(target,args,newTarget),token=pageId+':'+documentId+':'+(++serial);
            notify({token,event:'created',url:socket.url});
            socket.addEventListener('open',()=>notify({token,event:'open'}),{once:true});
            socket.addEventListener('close',event=>notify({token,event:'close',code:event.code,reason:event.reason,wasClean:event.wasClean}),{once:true});
            socket.addEventListener('error',()=>notify({token,event:'error'}),{once:true});
            return socket;
          }});
        })();'''.replace('PAGE_ID',json.dumps(str(page_id))))
        def dispose_document(source):
            for item in self.ws_lifecycle.values():
                if item['page']==page_id and not item['closed']:
                    item['closed']=True;item['disposed_by']=source
                    if 'connection' in item:self._ws_closed(item['connection'],source,'CONTEXT_DISPOSED')
        page.on('close',lambda *_:dispose_document('playwright.page.close'))
        page.on('framenavigated',lambda frame:dispose_document('playwright.main_frame.navigation') if frame==page.main_frame else None)
    async def websocket(self,ws):
        # Only the bundled SDK's declared Phoenix endpoint is modeled. This
        # route never calls connect_to_server; authentication is in join frames.
        self.ws_serial+=1;connection=self.ws_serial;p=urlparse(ws.url);q=parse_qs(p.query,keep_blank_values=True)
        channels={};self.ws_connections[connection]=channels;self.ws_routes[connection]=ws
        self._bind_socket_observers()
        endpoint={'connection':connection,'host':p.hostname,'path':p.path,'event':'connect','source':'playwright.route_web_socket','at':round(time.monotonic(),6)}
        self.ws_events.append(endpoint)
        def clear_channels():
            for topic in list(channels):self.ws_channels.discard((connection,topic))
            channels.clear()
        async def close(code,reason):
            clear_channels();await asyncio.wait_for(ws.close(code=code,reason=reason),3)
        if p.scheme!='wss' or p.hostname!=API_HOST or p.port not in [None,443] or p.path!='/realtime/v1/websocket' or set(q)!={'apikey','vsn'} or len(q['apikey'])!=1 or not q['apikey'][0] or q['vsn']!=['2.0.0']:
            endpoint['status']='UNMODELED_BOUNDARY';self.blocked.append(endpoint.copy());await close(1008,'UNMODELED_BOUNDARY websocket');return
        if self.offline:
            endpoint['status']='NETWORK_UNAVAILABLE';await close(1013,'NETWORK_UNAVAILABLE');return
        endpoint['status']='SYNTHETIC_CONNECTION'
        def on_message(message):
            entry={'connection':connection,'event':'invalid-frame','source':'playwright.WebSocketRoute.on_message','at':round(time.monotonic(),6)};self.ws_events.append(entry)
            try:
                msg=json.loads(message)
                if isinstance(msg,list) and len(msg)==5:jr,ref,topic,event,payload=msg
                elif isinstance(msg,dict):jr=msg.get('join_ref');ref=msg.get('ref');topic=msg.get('topic');event=msg.get('event');payload=msg.get('payload')
                else:raise ValueError('Invalid Phoenix envelope')
                entry.update(topic=topic,event=event,uid=channels.get(topic))
                def reply(status,response):
                    content={'status':status,'response':response}
                    answer=[jr,ref,topic,'phx_reply',content] if isinstance(msg,list) else {'join_ref':jr,'ref':ref,'topic':topic,'event':'phx_reply','payload':content}
                    ws.send(json.dumps(answer))
                def reject(reason,unknown=False):
                    entry['status']=reason
                    if unknown:self.unknown.append(entry.copy())
                    reply('error',{'reason':reason})
                if self.offline:
                    entry['status']='NETWORK_UNAVAILABLE';self._ws_job(close(1013,'NETWORK_UNAVAILABLE'),'offline-close');return
                if not isinstance(topic,str) or not isinstance(payload,dict):raise ValueError('Invalid Phoenix topic/payload')
                known_topics={'realtime:pablicus-inbox-'+uid for uid in [A,B]}|{'realtime:pablicus-chat-'+cid for cid in [C1,C2,CB]}
                if event in ['phx_leave','access_token'] and topic not in known_topics:
                    reject('UNMODELED_BOUNDARY topic',True);return
                if event=='heartbeat':
                    if topic!='phoenix' or payload:reject('UNMODELED_BOUNDARY heartbeat',True);return
                    entry['status']='OK';reply('ok',{});return
                if event=='phx_leave':
                    if payload or not topic.startswith(('realtime:pablicus-inbox-','realtime:pablicus-chat-')):reject('UNMODELED_BOUNDARY leave',True);return
                    channels.pop(topic,None);self.ws_channels.discard((connection,topic));entry['status']='LEFT';reply('ok',{});return
                if event=='access_token':
                    token_uid=uid_of('Bearer '+str(payload.get('access_token','')));entry['uid']=token_uid
                    if set(payload)!={'access_token'} or token_uid is None:reject('UNAUTHORIZED');return
                    # SDK account change updates old channels before leave.
                    # Revoke their old authorization; same-user refresh retains it.
                    old_uid=channels.get(topic)
                    if old_uid is None:entry['status']='TOKEN_FOR_LEFT_CHANNEL';return
                    if old_uid!=token_uid:
                        channels.pop(topic,None);self.ws_channels.discard((connection,topic));entry['status']='STALE_CHANNEL_REVOKED';return
                    entry['status']='TOKEN_REFRESHED';return
                if event!='phx_join':reject('UNMODELED_BOUNDARY '+str(event),True);return
                token_uid=uid_of('Bearer '+str(payload.get('access_token','')));entry['uid']=token_uid
                config=payload.get('config');entry['context']=copy.deepcopy(config)
                if token_uid is None:reject('UNAUTHORIZED');return
                if set(payload)-{'config','access_token','version'} or ('version' in payload and payload['version']!='realtime-js/2.105.0'):
                    reject('UNMODELED_BOUNDARY join payload',True);return
                if not isinstance(config,dict) or set(config)!={'broadcast','presence','postgres_changes','private'} or config['broadcast']!={'ack':False,'self':False} or config['presence']!={'key':'','enabled':False} or config['private'] is not False:
                    reject('UNMODELED_BOUNDARY channel config',True);return
                expected={'event':'INSERT','schema':'public','table':'messages'}
                if topic=='realtime:pablicus-inbox-'+token_uid:pass
                elif topic.startswith('realtime:pablicus-chat-') and self.owns(token_uid,topic.removeprefix('realtime:pablicus-chat-')):
                    expected['filter']='conversation_id=eq.'+topic.removeprefix('realtime:pablicus-chat-')
                else:reject('FORBIDDEN_SUBSCRIPTION');return
                if config['postgres_changes']!=[expected]:reject('UNMODELED_BOUNDARY postgres subscription',True);return
                channels[topic]=token_uid;self.ws_channels.add((connection,topic));entry['status']='JOINED'
                reply('ok',{'postgres_changes':[dict(expected,id=1)]})
            except Exception as exc:
                entry.update(status='UNMODELED_BOUNDARY',error=str(exc));self.unknown.append(entry.copy())
                self._ws_job(close(1008,'UNMODELED_BOUNDARY frame'),'invalid-frame-close')
        ws.on_message(on_message)
    def summary(self):
        return {'calls':self.calls,'effects':self.effects,'objects':self.objects,'unknown':self.unknown,'blocked':self.blocked,'websocket_events':self.ws_events,'websocket_lifecycle':self.ws_lifecycle,'websocket_qualification_errors':self.ws_errors,'pending_websocket_jobs':len(self.ws_jobs),'active_external_channels':[{'connection':connection,'topic':topic,'uid':self.ws_connections[connection].get(topic)} for connection,topic in sorted(self.ws_channels)]}
