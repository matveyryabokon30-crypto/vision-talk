/** Public Bot Core browser client. */
export class BotClient {
 constructor({baseUrl,getToken,apiKey=null,fetcher=fetch}){this.baseUrl=String(baseUrl||'').replace(/\/$/,'');this.getToken=getToken;this.apiKey=apiKey;this.fetcher=fetcher;}
 async request(path,{method='GET',data,signal}={}){
  const token=await this.getToken();if(!token)throw Object.assign(new Error('Нужен вход.'),{code:'UNAUTHORIZED'});
  const response=await this.fetcher(this.baseUrl+path,{method,signal:signal||AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,...(this.apiKey?{apikey:this.apiKey}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  let body;try{body=await response.json();}catch{throw new Error('Сервер ботов вернул некорректный ответ.');}
  if(!response.ok)throw Object.assign(new Error(body?.error?.message||'Ошибка сервера ботов'),{status:response.status,code:body?.error?.code});return body;
 }
 me(){return this.request('/v1/me');} templates(){return this.request('/v1/templates');} bots(){return this.request('/v1/bots');}
 createBot(data){return this.request('/v1/bots',{method:'POST',data});}
 updateBot(id,data){return this.request(`/v1/bots/${id}`,{method:'PATCH',data});}
 createChat(bot,id=crypto.randomUUID()){return this.request(`/v1/bots/${bot}/chats`,{method:'POST',data:{id}});}
 chats(bot){return this.request(`/v1/bots/${bot}/chats`);}
 history(chat,after=0){return this.request(`/v1/chats/${chat}?after=${after}`);}
 send(chat,text,revision,id=crypto.randomUUID()){return this.request(`/v1/chats/${chat}/messages`,{method:'POST',data:{id,text,revision}});}
 records(bot,after=0){return this.request(`/v1/bots/${bot}/records?after=${after}`);}
}
