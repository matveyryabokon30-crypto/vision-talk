import { createYandexUserinfoHandler } from './handler.mjs';

// A public application identifier, not a service-role key or a user password.
// Client Secret belongs only in the Supabase custom-provider configuration.
const expectedClientId = Deno.env.get('YANDEX_CLIENT_ID');
if (!expectedClientId) throw new Error('YANDEX_CLIENT_ID must be configured');

Deno.serve(createYandexUserinfoHandler({ expectedClientId }));
