/** Private persistence boundary. Pass only a server-owned service-role client. */
export function createStore({ client } = {}) {
  if (!client || typeof client.rpc !== 'function') throw new TypeError('A server RPC client is required');
  const invoke = async (operation, payload = {}) => {
    const result = await client.rpc('pablicus_passkey_store', { operation, payload });
    if (!result || result.error) {
      // Database diagnostics can contain submitted credentials; never propagate them.
      const error = new Error('Passkey storage is unavailable');
      error.code = 'storage_unavailable';
      throw error;
    }
    return result.data;
  };
  const methods = ['config', 'createFlow', 'readFlow', 'setChallenge', 'claimChallenge',
    'findCredential', 'completeRegistration', 'completeAuthentication', 'exchangeCode',
    'userinfo', 'rateLimit'];
  return Object.freeze(Object.fromEntries(methods.map(name => [name, payload => invoke(name, payload)])));
}
