import { base64Url, fromBase64Url } from '../util/ids.ts';
import { PASSWORD_MAX } from '../util/password_policy.ts';

const PREFIX = 'pbkdf2-sha256';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations }, key, 256);
  return `${PREFIX}$${iterations}$${base64Url(salt)}$${base64Url(bits)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 10000) return false;
  const salt = fromBase64Url(parts[2]);
  const expected = fromBase64Url(parts[3]);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations }, key, expected.byteLength * 8);
  const actual = new Uint8Array(bits);
  if (actual.byteLength !== expected.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < actual.byteLength; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function needsRehash(encoded: string, targetIterations: number): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) return true;
  return Number(parts[1]) !== targetIterations;
}
