/** Test-fixture passwords only. Never truncate input or change production Auth settings. */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;
export const QA_PASSWORD_BYTES = 52;
export function assertBcryptPassword(password) {
  if (typeof password !== 'string' || password.length === 0) throw new TypeError('A non-empty password string is required.');
  if (new TextEncoder().encode(password).byteLength > BCRYPT_MAX_PASSWORD_BYTES) throw new RangeError('Test password exceeds the bcrypt limit of 72 UTF-8 bytes.');
  return password;
}
export function createQaPassword() {
  const random = new Uint8Array(24);
  globalThis.crypto.getRandomValues(random);
  return assertBcryptPassword('Qa9!' + Array.from(random, byte => byte.toString(16).padStart(2, '0')).join(''));
}
