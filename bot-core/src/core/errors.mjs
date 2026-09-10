export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = 'AppError'; this.code = code; this.status = status;
  }
}
export function assert(condition, code, message, status = 400) {
  if (!condition) throw new AppError(code, message, status);
}
export const notFound = () => new AppError('NOT_FOUND', 'Объект не найден или недоступен.', 404);
export const conflict = () => new AppError('REVISION_CONFLICT', 'Данные изменились. Обновите состояние перед отправкой.', 409);
export async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'pbc_' + Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
}
export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function text(value, name, max = 4000, min = 1) {
  assert(typeof value === 'string' && value.trim().length >= min && value.length <= max,
    'INVALID_INPUT', `${name}: требуется текст длиной ${min}–${max} символов.`);
  return value.trim();
}
export function identifier(value, name = 'Идентификатор') {
  const result = text(value, name, 100);
  assert(/^[a-zA-Z0-9_-]+$/.test(result) && !['__proto__','prototype','constructor'].includes(result), 'INVALID_INPUT', `${name}: недопустимый формат.`);
  return result;
}
export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_INPUT', `${name}: недопустимое целое число.`);
  return value;
}
