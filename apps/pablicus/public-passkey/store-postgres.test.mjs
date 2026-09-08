import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createStore } from './store.mjs';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point to a disposable local PostgreSQL 16 database');
const database = new URL(databaseUrl);
if (!['localhost','127.0.0.1','[::1]','postgres'].includes(database.hostname)) {
  throw new Error('Refusing schema fixture outside a local/CI database');
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const future = seconds => new Date(Date.now() + seconds * 1000).toISOString();
const callback = 'https://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback';
const knownUser = '00000000-0000-4000-8000-000000000011';
const blockedUser = '00000000-0000-4000-8000-000000000012';
const bannedUser = '00000000-0000-4000-8000-000000000013';
const conversation = '00000000-0000-4000-8000-000000000099';

function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['--no-psqlrc','--set','ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',databaseUrl], { stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Fixture SQL failed (${code}): ${stderr.trim()}`));
    });
    child.stdin.end(statement);
  });
}
const asRole = (role, statement, uid) => sql(`SET ROLE ${role};${uid ? `SET request.jwt.claim.sub=${quote(uid)};` : ''}${statement}`);
const call = async (operation, payload = {}) => {
  const output = await asRole('service_role', `SELECT public.pablicus_passkey_store(${quote(operation)},${quote(JSON.stringify(payload))}::jsonb);`);
  return output ? JSON.parse(output) : null;
};
const store = createStore({ client: { async rpc(name, args) {
  assert.equal(name,'pablicus_passkey_store');
  try { return { data: await call(args.operation,args.payload), error: null }; }
  catch (error) { return { data: null, error: { message: error.message } }; }
} } });
async function flow() {
  const value = { id: randomUUID(), secretHash: hash(random()), state: 'preserved-state', codeChallenge: random(), redirectUri: callback, expiresAt: future(240) };
  assert.equal(await store.createFlow(value), true);
  return value;
}
async function challenge(value, kind = 'registration', extra = {}) {
  const entry = { id: value.id, secretHash: value.secretHash, kind, challenge: random(), nativeChallengeId: kind === 'authentication' ? randomUUID() : null,
    subjectId: kind === 'registration' ? randomUUID() : null, name: kind === 'registration' ? 'Test Person' : null, expiresAt: future(100), ...extra };
  assert.equal(await store.setChallenge(entry), true);
  return entry;
}
async function registration({ credentialId = random(), counter = 0 } = {}) {
  const value = await flow(), entry = await challenge(value);
  assert.ok(await store.claimChallenge({ id: value.id, secretHash: value.secretHash, kind: 'registration' }));
  const credential = { credentialId, publicKey: random(), counter, transports: ['internal'] };
  const completion = { flowId: value.id, subjectId: entry.subjectId, name: entry.name, credential, codeHash: hash(random()), codeExpiresAt: future(50) };
  assert.equal(await store.completeRegistration(completion), true);
  return { value, entry, credential, completion };
}
async function authentication() {
  const value = await flow();
  await challenge(value,'authentication');
  assert.ok(await store.claimChallenge({ id: value.id, secretHash: value.secretHash, kind: 'authentication' }));
  return value;
}
async function nativeCompletion(value, extra = {}) {
  return store.completeAuthentication({ flowId: value.id, subjectId: `native:${knownUser}`, name: 'Existing', credentialId: null,
    oldCounter: null, newCounter: null, userinfo: { sub: `native:${knownUser}`, name: 'Existing', email: 'existing@example.invalid', email_verified: true },
    codeHash: hash(random()), codeExpiresAt: future(50), ...extra });
}
async function insertUser(id, { email = null, phone = null, metadata = {}, anonymous = false, banned = false } = {}) {
  await sql(`INSERT INTO auth.users(id,email,phone,raw_user_meta_data,is_anonymous,banned_until) VALUES (${quote(id)},${email === null ? 'NULL' : quote(email)},${phone === null ? 'NULL' : quote(phone)},${quote(JSON.stringify(metadata))}::jsonb,${anonymous},${banned ? "now()+interval '1 day'" : 'NULL'});`);
}
async function identity(user, subject, provider = 'custom:pablicus-passkey', metadata = {}) {
  await sql(`INSERT INTO auth.identities(user_id,provider,provider_id,identity_data) VALUES (${quote(user)},${quote(provider)},${quote(subject)},${quote(JSON.stringify(metadata))}::jsonb);`);
}
const profile = async id => JSON.parse(await sql(`SELECT row_to_json(p) FROM public.profiles p WHERE id=${quote(id)};`));
let initialMembershipDefinition;
before(async () => {
  await sql(await readFile(new URL('./store-schema-fixture.sql',import.meta.url),'utf8'));
  initialMembershipDefinition = await sql("SELECT pg_get_functiondef('public.is_member(uuid,uuid)'::regprocedure);");
  const installation = await sql(await readFile(new URL('./SCHEMA_PROPOSAL.sql',import.meta.url),'utf8'));
  const [clientId,secret] = installation.split('|');
  assert.equal(clientId,'pablicus-web');
  assert.equal(typeof secret === 'string' && /^[A-Za-z0-9_-]{43}$/.test(secret),true,'installer emits one generated 256-bit secret');
  const config = await store.config();
  assert.equal(config.secretHash,hash(secret));
  assert.deepEqual(Object.keys(config).sort(),['clientId','enabled','secretHash']);
  assert.equal(config.enabled,true);
});

test('private table grants, real database roles and invoker boundary reject client escalation',async () => {
  for (const role of ['anon','authenticated']) {
    for (const statement of ["SELECT * FROM pablicus_passkey_private.configuration;", "SELECT public.pablicus_passkey_store('config','{}');", "INSERT INTO auth.identities(user_id,provider,provider_id) VALUES ('00000000-0000-4000-8000-000000000011','custom:pablicus-passkey','forged');"]) {
      await assert.rejects(asRole(role,statement),/permission denied/);
    }
    await assert.rejects(asRole(role,`SET request.jwt.claims='{"role":"service_role","user_metadata":{"is_approved":true}}'; SELECT public.pablicus_passkey_store('config','{}');`),/permission denied/);
  }
  assert.equal(await sql("SELECT prosecdef FROM pg_proc WHERE oid='public.pablicus_passkey_store(text,jsonb)'::regprocedure;"),'f');
  assert.equal(await sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pablicus_passkey_private' AND c.relkind='r' AND NOT c.relrowsecurity;"),'0');
  await assert.rejects(asRole('authenticated',`UPDATE public.profiles SET is_approved=true WHERE id=${quote(blockedUser)};`,blockedUser),/permission denied/);
  await assert.rejects(asRole('authenticated',`UPDATE public.profiles SET passkey_activation_pending=true WHERE id=${quote(blockedUser)};`,blockedUser),/permission denied/);
  await asRole('authenticated',`UPDATE public.profiles SET display_name='Still editable' WHERE id=${quote(knownUser)};`,knownUser);
  assert.equal((await profile(knownUser)).display_name,'Still editable');
});

test('flow secret, exact redirect, TTL and completion checks are enforced in PostgreSQL',async () => {
  const value = await flow();
  assert.equal((await store.readFlow({id:value.id,secretHash:value.secretHash})).state,value.state);
  assert.equal(await store.readFlow({id:value.id,secretHash:hash('wrong')}),null);
  assert.equal(await store.createFlow({...value,id:randomUUID(),expiresAt:future(400)}),false);
  await assert.rejects(call('createFlow',{...value,id:randomUUID(),redirectUri:'https://attacker.invalid/callback'}),/check constraint/);
  await sql(`UPDATE pablicus_passkey_private.flows SET expires_at=now()-interval '1 second' WHERE id=${quote(value.id)};`);
  assert.equal(await store.readFlow({id:value.id,secretHash:value.secretHash}),null);
  assert.equal(await store.setChallenge({id:value.id,secretHash:value.secretHash,kind:'registration',challenge:random(),subjectId:randomUUID(),name:'Expired',expiresAt:future(50)}),false);
});

test('challenge replacement before claiming, concurrent claim once, and no replacement after claim',async () => {
  const value = await flow();
  const first = await challenge(value), next = await challenge(value);
  assert.notEqual(first.challenge,next.challenge);
  assert.equal(await store.claimChallenge({id:value.id,secretHash:value.secretHash,kind:'authentication'}),null);
  const claims = await Promise.all(Array.from({length:8},()=>store.claimChallenge({id:value.id,secretHash:value.secretHash,kind:'registration'})));
  const accepted = claims.filter(Boolean);
  assert.equal(accepted.length,1); assert.equal(accepted[0].challenge,next.challenge);
  assert.equal(await store.setChallenge({...next,challenge:random()}),false);
  assert.equal(await store.claimChallenge({id:value.id,secretHash:value.secretHash,kind:'registration'}),null);
  const expired = await flow(); await challenge(expired);
  await sql(`UPDATE pablicus_passkey_private.flows SET challenge_expires_at=now()-interval '1 second' WHERE id=${quote(expired.id)};`);
  assert.equal(await store.claimChallenge({id:expired.id,secretHash:expired.secretHash,kind:'registration'}),null);
});

test('registration atomically binds assigned subject and unique credential with no partial duplicate writes',async () => {
  const seeded = await registration();
  assert.equal(await store.completeRegistration(seeded.completion),false);
  assert.equal(await store.readFlow({id:seeded.value.id,secretHash:seeded.value.secretHash}),null);
  const stored = await store.findCredential({credentialId:seeded.credential.credentialId});
  assert.equal(stored.subjectId,seeded.entry.subjectId);
  const value = await flow(), entry = await challenge(value);
  const completion = {...seeded.completion,flowId:value.id,subjectId:entry.subjectId,name:entry.name,codeHash:hash(random())};
  assert.equal(await store.completeRegistration(completion),false,'cannot finish before challenge claim');
  await store.claimChallenge({id:value.id,secretHash:value.secretHash,kind:'registration'});
  assert.equal(await store.completeRegistration({...completion,subjectId:randomUUID()}),false,'preassigned subject cannot change');
  assert.equal(await store.completeRegistration(completion),false,'duplicate credential rolls back subject');
  assert.equal(await sql(`SELECT count(*) FROM pablicus_passkey_private.subjects WHERE id=${quote(entry.subjectId)};`),'0');
  assert.equal(await sql(`SELECT count(*) FROM pablicus_passkey_private.codes WHERE flow_id=${quote(value.id)};`),'0');
});

test('PKCE, client, redirect, token expiry and concurrent one-use OAuth exchange',async () => {
  const {value,completion,entry} = await registration();
  const exchange = {codeHash:completion.codeHash,codeChallenge:value.codeChallenge,redirectUri:callback,clientId:'pablicus-web',tokenHash:hash(random()),tokenExpiresAt:future(50)};
  for (const bad of [{codeChallenge:random()},{clientId:'foreign'},{redirectUri:'https://attacker.invalid'},{tokenExpiresAt:future(100)}]) assert.equal(await store.exchangeCode({...exchange,...bad}),false);
  const attempts = Array.from({length:8},()=>({...exchange,tokenHash:hash(random())}));
  const accepted = await Promise.all(attempts.map(attempt=>store.exchangeCode(attempt)));
  assert.equal(accepted.filter(Boolean).length,1);
  const valid = attempts[accepted.indexOf(true)];
  assert.deepEqual(await store.userinfo({tokenHash:valid.tokenHash}),{sub:entry.subjectId,name:entry.name});
  assert.equal(await store.userinfo({tokenHash:hash('not issued')}),null);
  await sql(`UPDATE pablicus_passkey_private.tokens SET expires_at=now()-interval '1 second' WHERE token_hash=${quote(valid.tokenHash)};`);
  assert.equal(await store.userinfo({tokenHash:valid.tokenHash}),null);
  const expired = await registration();
  await sql(`UPDATE pablicus_passkey_private.codes SET expires_at=now()-interval '1 second' WHERE code_hash=${quote(expired.completion.codeHash)};`);
  assert.equal(await store.exchangeCode({...exchange,codeHash:expired.completion.codeHash,codeChallenge:expired.value.codeChallenge}),false);
});

test('same credential counter races have one winner; zero-counter authenticators remain supported',async () => {
  const seeded = await registration({counter:1}), values = await Promise.all([authentication(),authentication()]);
  const attempt = value => store.completeAuthentication({flowId:value.id,subjectId:seeded.entry.subjectId,name:'Forged browser name',credentialId:seeded.credential.credentialId,
    oldCounter:1,newCounter:2,userinfo:{sub:'forged',name:'forged',email:'unverified@example.invalid'},codeHash:hash(random()),codeExpiresAt:future(50)});
  assert.equal((await Promise.all(values.map(attempt))).filter(Boolean).length,1);
  assert.equal((await store.findCredential({credentialId:seeded.credential.credentialId})).counter,2);
  const duplicateCodeFlow = await authentication();
  assert.equal(await store.completeAuthentication({flowId:duplicateCodeFlow.id,subjectId:seeded.entry.subjectId,credentialId:seeded.credential.credentialId,oldCounter:2,newCounter:3,codeHash:seeded.completion.codeHash,codeExpiresAt:future(50)}),false);
  assert.equal((await store.findCredential({credentialId:seeded.credential.credentialId})).counter,2,'unique-code failure rolls back counter update');
  const rollbackFlow = await authentication();
  assert.equal(await store.completeAuthentication({flowId:rollbackFlow.id,subjectId:seeded.entry.subjectId,credentialId:seeded.credential.credentialId,oldCounter:2,newCounter:1,codeHash:hash(random()),codeExpiresAt:future(50)}),false);
  const zero = await registration({counter:0}), zeroFlow = await authentication();
  assert.equal(await store.completeAuthentication({flowId:zeroFlow.id,subjectId:zero.entry.subjectId,credentialId:zero.credential.credentialId,oldCounter:0,newCounter:0,codeHash:hash(random()),codeExpiresAt:future(50)}),true);
  const codeInfo = JSON.parse(await sql(`SELECT userinfo FROM pablicus_passkey_private.codes WHERE flow_id IN (${values.map(v=>quote(v.id)).join(',')});`));
  assert.deepEqual(codeInfo,{sub:seeded.entry.subjectId,name:seeded.entry.name});
});

test('native bridge accepts only trusted handler subject shape and verified server userinfo',async () => {
  const value = await authentication();
  assert.equal(await nativeCompletion(value,{subjectId:randomUUID()}),false);
  assert.equal(await nativeCompletion(value,{userinfo:{sub:`native:${knownUser}`,name:'Existing',email:'existing@example.invalid',email_verified:false}}),false);
  assert.equal(await nativeCompletion(value,{userinfo:{sub:`native:${knownUser}`,name:'Existing',email:'existing@example.invalid',email_verified:true,access_token:'must never persist'}}),false);
  assert.equal(await nativeCompletion(value),true);
  assert.equal(await nativeCompletion(value),false);
  const info = JSON.parse(await sql(`SELECT userinfo FROM pablicus_passkey_private.codes WHERE flow_id=${quote(value.id)};`));
  assert.deepEqual(Object.keys(info).sort(),['email','email_verified','name','sub']);
});

test('rate limiter is atomic across concurrent requests and cleans expired state',async () => {
  const key = `flow:${randomUUID()}`;
  const responses = await Promise.all(Array.from({length:10},()=>store.rateLimit({key,limit:3,windowSeconds:3600})));
  assert.equal(responses.filter(Boolean).length,3);
  await sql(`UPDATE pablicus_passkey_private.rate_buckets SET window_start=now()-interval '3 hours' WHERE bucket_key=${quote(key)};`);
  assert.equal(await store.rateLimit({key,limit:3,windowSeconds:3600}),true);
  const expired = await flow();
  await sql(`UPDATE pablicus_passkey_private.flows SET expires_at=now()-interval '10 minutes' WHERE id=${quote(expired.id)};`);
  await store.rateLimit({key:`flow:${randomUUID()}`,limit:2,windowSeconds:60});
  assert.equal(await sql(`SELECT count(*) FROM pablicus_passkey_private.flows WHERE id=${quote(expired.id)};`),'0');
});

test('only a new eligible own-provider identity activates a profile; all old approval and bans survive',async () => {
  const seeded = await registration(), id = randomUUID();
  await insertUser(id,{metadata:{name:'Катя',is_approved:true,passkey_activation_pending:true}});
  assert.equal((await profile(id)).is_approved,false);
  await identity(id,seeded.entry.subjectId);
  const p = await profile(id);
  assert.equal(p.is_approved,true); assert.equal(p.passkey_activation_pending,false);
  assert.equal(p.display_name,'Катя'); assert.match(p.username,/^[a-z0-9_]{3,24}$/);
  assert.equal(await sql(`SELECT auth_user_id FROM pablicus_passkey_private.subjects WHERE id=${quote(seeded.entry.subjectId)};`),id);
  for (const old of [blockedUser,bannedUser]) {
    const fresh = await registration(); await identity(old,fresh.entry.subjectId);
    assert.equal((await profile(old)).is_approved,false);
    assert.equal((await profile(old)).passkey_activation_pending,false);
  }
  assert.equal((await profile(knownUser)).is_approved,true);
  assert.equal(await sql(`SELECT banned_until > now() FROM auth.users WHERE id=${quote(bannedUser)};`),'t');
  await sql(`UPDATE public.profiles SET is_approved=false WHERE id=${quote(id)}; DELETE FROM auth.identities WHERE user_id=${quote(id)};`);
  await identity(id,seeded.entry.subjectId);
  assert.equal((await profile(id)).is_approved,false,'relink does not revoke admin denial');
});

test('metadata, other provider, native prefix, missing subject, anonymous, contacts and bans never activate',async () => {
  const cases = [
    {provider:'custom:other'}, {subject:`native:${knownUser}`}, {subject:randomUUID()},
    {user:{anonymous:true}}, {user:{email:'claimed@example.invalid'}}, {user:{phone:'+15555550199'}}, {user:{banned:true}}, {denied:true}
  ];
  for (const item of cases) {
    const seeded = await registration(), id = randomUUID();
    await insertUser(id,{metadata:{name:'Claimed',is_approved:true,provider:'custom:pablicus-passkey'},...item.user});
    if (item.denied) await sql(`UPDATE public.profiles SET is_approved=false WHERE id=${quote(id)};`);
    await identity(id,item.subject || seeded.entry.subjectId,item.provider || 'custom:pablicus-passkey',{email_verified:true,is_approved:true});
    assert.equal((await profile(id)).is_approved,false,JSON.stringify(item));
  }
});

test('username collisions and long/invalid/empty presentation fields create valid unique handles',async () => {
  const ids = [randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  await Promise.all(ids.map((id,index)=>insertUser(id,{metadata:{username:['same_name','same_name','!'.repeat(100),'a'.repeat(150),''][index]}})));
  const values = await Promise.all(ids.map(profile));
  for (const value of values) assert.match(value.username,/^[a-z0-9_]{3,24}$/);
  assert.equal(new Set(values.map(value=>value.username)).size,values.length);
});

test('new third account approval does not grant historical membership, and revocation blocks existing member',async () => {
  const seeded = await registration(), third = randomUUID();
  await insertUser(third); await identity(third,seeded.entry.subjectId);
  assert.equal((await profile(third)).is_approved,true);
  for (const table of ['conversations','conversation_members','messages']) {
    assert.equal(await asRole('authenticated',`SELECT count(*) FROM public.${table};`,third),'0');
  }
  await assert.rejects(asRole('authenticated',`INSERT INTO public.messages(conversation_id,sender_id,body) VALUES (${quote(conversation)},${quote(third)},'intrusion');`,third),/row-level security/);
  assert.equal(await asRole('authenticated',`SELECT count(*) FROM public.messages;`,knownUser),'1');
  assert.equal(await asRole('authenticated',`SELECT count(*) FROM public.messages;`,blockedUser),'0');
  await sql(`UPDATE public.profiles SET is_approved=false WHERE id=${quote(knownUser)};`);
  assert.equal(await asRole('authenticated',`SELECT count(*) FROM public.messages;`,knownUser),'0');
  await sql(`UPDATE public.profiles SET is_approved=true WHERE id=${quote(knownUser)};`);
  assert.equal(await sql("SELECT pg_get_functiondef('public.is_member(uuid,uuid)'::regprocedure);"),initialMembershipDefinition);
});

test('installation cannot silently rotate the working secret and adapter never exposes SQL diagnostics',async () => {
  const old = await store.config();
  await assert.rejects(sql(await readFile(new URL('./SCHEMA_PROPOSAL.sql',import.meta.url),'utf8')),/already exists|profile provisioning changed/);
  assert.deepEqual(await store.config(),old);
  const failing = createStore({client:{rpc:async()=>({error:{message:'PRIVATE DATABASE TOKEN'}})}});
  await assert.rejects(failing.config(),error=>error.message === 'Passkey storage is unavailable' && error.code === 'storage_unavailable');
});
