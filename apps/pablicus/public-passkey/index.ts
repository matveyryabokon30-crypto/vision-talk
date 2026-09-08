// Candidate Edge entrypoint. Deploy only after the owner-applied private-schema
// setup and normal Custom OAuth provider configuration have been accepted.
import * as library from 'npm:@simplewebauthn/server@13.3.0';
import { createHandler, createEdgeAdapter, productionConfig } from './handler.mjs';
import { createWebAuthn } from './webauthn.mjs';
import { createNative } from './native.mjs';
import { createStore } from './store.mjs';

function unavailable() {
  return new Response(JSON.stringify({ error: 'unavailable', message: 'Вход временно недоступен. Попробуйте позже.' }), {
    status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

let handler: (request: Request) => Promise<Response>;
try {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (supabaseUrl !== 'https://ctcoqgsztdtsazdiwcmd.supabase.co' || !serviceRole || !apiKey) throw new Error('missing_runtime_configuration');
  // Runtime data operations only. This narrowly scoped adapter has no DDL,
  // management, admin-user creation, or auth-table access operation.
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'pablicus_passkey_store') return { data: null, error: { message: 'unavailable' } };
      try {
        const result = await fetch(supabaseUrl + '/rest/v1/rpc/pablicus_passkey_store', {
          method: 'POST', headers: { apikey: serviceRole, Authorization: 'Bearer ' + serviceRole, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(args), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        if (!result.ok) return { data: null, error: { message: 'unavailable' } };
        return { data: await result.json(), error: null };
      } catch { return { data: null, error: { message: 'unavailable' } }; }
    },
  };
  handler = createHandler({
    store: createStore({ client }),
    webauthn: createWebAuthn({ library, rpId: productionConfig.rpId, origin: productionConfig.origin }),
    native: createNative({ supabaseUrl, apiKey, rpId: productionConfig.rpId, origin: productionConfig.origin }),
    config: productionConfig,
  });
} catch { handler = async () => unavailable(); }

Deno.serve(createEdgeAdapter((request: Request) => handler(request)));
