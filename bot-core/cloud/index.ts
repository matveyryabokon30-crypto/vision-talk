// Public Bot Core cloud pilot. Credentials remain in server environment only.
import { BotService } from '../src/core/service.mjs';
import { SupabaseStore } from '../src/storage/supabase.mjs';
import { authenticator, supabaseIdentity } from '../src/http/auth.mjs';
import { createHandler } from '../src/http/handler.mjs';
const url = Deno.env.get('SUPABASE_URL');
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
const serviceKey = Deno.env.get('BOT_SERVICE_KEY') || secretKeys['public_bot_core'] || secretKeys['default'] || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const publicKey = publishableKeys['default'] || Deno.env.get('SUPABASE_ANON_KEY');
const allowedOrigins = (Deno.env.get('BOT_ALLOWED_ORIGINS') || 'https://matveyryabokon30-crypto.github.io').split(',').map(s=>s.trim()).filter(Boolean);
if (!url || !serviceKey || !publicKey || !allowedOrigins.length) throw new Error('Bot Core configuration incomplete. Fail closed.');
const store = new SupabaseStore({url,serviceKey});
const handler = createHandler({service:new BotService(store),authenticate:authenticator(store,supabaseIdentity({url,publicKey})),allowedOrigins,basePath:'/public-bot-core'});
// Gateway JWT verification is disabled ONLY because the handler verifies real
// Supabase user tokens via Auth and revocable, hashed, bot-scoped API keys itself.
Deno.serve((request: Request) => {
  const original = new URL(request.url);
  if (original.pathname.startsWith('/functions/v1/public-bot-core/')) {
    original.pathname = original.pathname.slice('/functions/v1'.length);
    return handler(new Request(original,request));
  }
  return handler(request);
});
