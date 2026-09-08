// Web Push: RFC 8291 aes128gcm content coding and RFC 8292 VAPID.
// Uses platform WebCrypto only. Tested against the published RFC 8291 vector.
const enc = new TextEncoder();
export const bytes = value => enc.encode(value);
export const join = (...arrays) => {
  const result = new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));
  let offset=0; for(const a of arrays){result.set(a,offset);offset+=a.length;} return result;
};
export const base64url = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function unbase64url(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length>4096)throw new Error('Invalid key');
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function allowedEndpoint(value) {
  if(typeof value!=='string'||value.length>2048)return false;
  try {
    const u=new URL(value),h=u.hostname;
    const allowed=h==='web.push.apple.com'||h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com';
    return allowed&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.pathname.length>1;
  } catch{return false;}
}
export async function validateSubscription(value) {
  if(!value||typeof value!=='object'||!allowedEndpoint(value.endpoint))throw new Error('Unsupported push endpoint');
  const p256dh=unbase64url(value.keys?.p256dh),auth=unbase64url(value.keys?.auth);
  if(p256dh.length!==65||p256dh[0]!==4||auth.length!==16)throw new Error('Invalid subscription keys');
  // Import verifies that the submitted point is on P-256, not only its length.
  await crypto.subtle.importKey('raw',p256dh,{name:'ECDH',namedCurve:'P-256'},false,[]);
  return {endpoint:value.endpoint,keys:{p256dh:base64url(p256dh),auth:base64url(auth)}};
}
async function hkdf(secret,salt,info,length) {
  const key=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length*8));
}
export async function generateVapid() {
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  return {publicKey:base64url(await crypto.subtle.exportKey('raw',pair.publicKey)),privateJwk:await crypto.subtle.exportKey('jwk',pair.privateKey)};
}
export async function encryptPayload(subscription,payload,fixture={}) {
  const data=typeof payload==='string'?bytes(payload):payload;
  if(data.length>3000)throw new Error('Push payload too large');
  const ua=unbase64url(subscription.keys.p256dh),auth=unbase64url(subscription.keys.auth);
  const uaKey=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const pair=fixture.keyPair||await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const as=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey},pair.privateKey,256));
  const ikm=await hkdf(shared,auth,join(bytes('WebPush: info\0'),ua,as),32);
  const salt=fixture.salt||crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(ikm,salt,bytes('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdf(ikm,salt,bytes('Content-Encoding: nonce\0'),12);
  const key=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,join(data,Uint8Array.of(2))));
  const size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,4096,false);
  return join(salt,size,Uint8Array.of(as.length),as,encrypted);
}
export async function vapidAuthorization(endpoint,config,now=Date.now()) {
  const header=base64url(bytes(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const payload=base64url(bytes(JSON.stringify({aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+3600,sub:'https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/'})));
  const input=header+'.'+payload;
  const key=await crypto.subtle.importKey('jwk',config.privateJwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,bytes(input));
  return 'vapid t='+input+'.'+base64url(signature)+', k='+config.publicKey;
}
export async function sendPush(subscription,payload,config,transport=fetch) {
  await validateSubscription(subscription);
  const body=await encryptPayload(subscription,JSON.stringify(payload));
  const authorization=await vapidAuthorization(subscription.endpoint,config);
  const response=await transport(subscription.endpoint,{method:'POST',headers:{Authorization:authorization,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'3600',Urgency:'high'},body,redirect:'error',signal:AbortSignal.timeout(8000)});
  // Do not log provider bodies or endpoints: subscription URLs are capabilities.
  await response.body?.cancel();
  return response.status;
}
