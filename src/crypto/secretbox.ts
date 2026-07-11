import { base64Url, fromBase64Url } from '../util/ids.ts';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importKey(raw: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptText(keyMaterial: string, plaintext: string): Promise<string> {
  const key = await importKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `v1.${base64Url(iv)}.${base64Url(ct)}`;
}

export async function decryptText(keyMaterial: string, packed: string): Promise<string> {
  const [ver, ivB64, ctB64] = packed.split('.');
  if (ver !== 'v1' || !ivB64 || !ctB64) throw new Error('invalid ciphertext');
  const key = await importKey(keyMaterial);
  const iv = fromBase64Url(ivB64);
  const ct = fromBase64Url(ctB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ct));
  return new TextDecoder().decode(pt);
}
