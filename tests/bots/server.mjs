// LOCAL fixture only. No cloud credentials. Authentication is intentionally a
// test double; the BotService, HTTP routes, validation and SQLite are real.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {BotService} from '../../bot-core/src/core/service.mjs';
import {SQLiteStore} from '../../bot-core/src/storage/sqlite.mjs';
import {createHandler} from '../../bot-core/src/http/handler.mjs';
import {AppError} from '../../bot-core/src/core/errors.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),store=new SQLiteStore(process.env.BOT_TEST_DB||':memory:');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const handle=createHandler({service:new BotService(store),basePath:'/api',authenticate:async req=>{const value=req.headers.get('authorization');const id=value==='Bearer local-a'||value==='Bearer local-a-new'?A:value==='Bearer local-b'?B:null;if(!id)throw new AppError('UNAUTHORIZED','Test session not valid',401);return{id,scope:'manage'};},logger:{error:()=>{}}});
const server=http.createServer(async(req,res)=>{try{const origin='http://127.0.0.1:'+server.address().port;const u=new URL(req.url,origin);
 if(u.pathname.startsWith('/api/')){let body='';for await(const c of req){body+=c;if(body.length>70000)throw Error('Too large');}const r=await handle(new Request(u,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:body}));res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;}
 if(u.pathname==='/fixture-stats'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({bots:store.db.prepare('SELECT count(*) n FROM bots').get().n,records:store.db.prepare('SELECT count(*) n FROM records').get().n,events:store.db.prepare('SELECT count(*) n FROM events').get().n}));return;}
 const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+'/'))throw Error('path');const data=await readFile(file.endsWith('/')?file+'index.html':file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(404);res.end('not found');}});
server.listen(Number(process.env.PORT||8097),'127.0.0.1',()=>console.log('LOCAL_FIXTURE_READY '+server.address().port));
process.on('SIGTERM',()=>server.close(()=>{store.close();process.exit(0)}));
