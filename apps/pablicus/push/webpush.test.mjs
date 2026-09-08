import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey,verify} from 'node:crypto';
import {allowedEndpoint,validateSubscription,encryptPayload,generateVapid,vapidAuthorization,sendPush,base64url,unbase64url,bytes} from './webpush.mjs';

const ua='BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const as='BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const subscription={endpoint:'https://web.push.apple.com/test-capability',keys:{p256dh:ua,auth:'BTBZMqHH6r4Tts7J_aSIgg'}};
test('RFC 8291 section 5 known vector: every byte matches published ciphertext',async()=>{
 const raw=unbase64url(as),jwk={kty:'EC',crv:'P-256',x:base64url(raw.slice(1,33)),y:base64url(raw.slice(33)),d:'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'};
 const pair={privateKey:await crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),publicKey:await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},true,[])};
 const output=await encryptPayload(subscription,bytes('When I grow up, I want to be a watermelon'),{keyPair:pair,salt:unbase64url('DGv6ra1nlYgDCS1FRnbzlw')});
 const expected='DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
 assert.equal(output.length,unbase64url(expected).length);assert.equal(base64url(output),expected);
});
test('VAPID ES256 verifies with independent Node verifier; correct audience/expiry/contact/key',async()=>{
 const config=await generateVapid(),now=Date.parse('2026-09-08T12:00:00Z');
 const authorization=await vapidAuthorization(subscription.endpoint,config,now);
 const [jwt,key]=authorization.replace('vapid t=','').split(', k=');const [header,payload,signature]=jwt.split('.');
 assert.equal(key,config.publicKey);assert.equal(unbase64url(key).length,65);
 assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')), {typ:'JWT',alg:'ES256'});
 const claim=JSON.parse(Buffer.from(payload,'base64url'));
 assert.equal(claim.aud,'https://web.push.apple.com');assert.equal(claim.exp,now/1000+3600);assert.match(claim.sub,/^https:\/\//);
 const publicJwk={...config.privateJwk};delete publicJwk.d;
 assert.equal(verify('sha256',Buffer.from(header+'.'+payload),{key:createPublicKey({key:publicJwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
});
test('endpoint and subscription guards deny SSRF, redirects, malformed/off-curve keys',async()=>{
 for(const endpoint of ['http://web.push.apple.com/test','https://127.0.0.1/test','https://web.push.apple.com.evil.test/test','https://web.push.apple.com@evil.test/test','https://web.push.apple.com:444/test','https://web.push.apple.com/test#fragment','https://user:pass@web.push.apple.com/test','https://localhost/test','https://169.254.169.254/test'])assert.equal(allowedEndpoint(endpoint),false,endpoint);
 await validateSubscription(subscription);
 await assert.rejects(validateSubscription({...subscription,keys:{...subscription.keys,p256dh:base64url(new Uint8Array(65))}}));
 const offCurve=new Uint8Array(65);offCurve[0]=4;await assert.rejects(validateSubscription({...subscription,keys:{...subscription.keys,p256dh:base64url(offCurve)}}));
 await assert.rejects(validateSubscription({...subscription,keys:{...subscription.keys,auth:'bad'}}));
});
test('send uses encrypted body, fixed bounds, no redirects and preserves expiry status',async()=>{
 const config=await generateVapid();let calls=0;
 const status=await sendPush(subscription,{body:'Новое сообщение'},config,async(url,init)=>{
  calls++;assert.equal(url,subscription.endpoint);assert.equal(init.redirect,'error');assert.equal(init.headers['Content-Encoding'],'aes128gcm');
  assert.equal(init.headers.TTL,'3600');assert.equal(init.method,'POST');assert.ok(init.body.length<4096);assert.equal(new TextDecoder().decode(init.body).includes('Новое сообщение'),false);
  return new Response(null,{status:410});
 });assert.equal(status,410);assert.equal(calls,1);
 await assert.rejects(encryptPayload(subscription,'a'.repeat(3001)));
});
