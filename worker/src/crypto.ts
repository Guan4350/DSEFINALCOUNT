import { SignJWT, jwtVerify } from 'jose';
import type { Env } from './types';

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function keyFromEnv(env: Env): Promise<CryptoKey> {
  const bytes = base64ToBytes(env.CALDAV_ENC_KEY || '');
  if (bytes.byteLength !== 32) throw new Error('CALDAV_ENC_KEY must be 32 bytes, base64 encoded.');
  return crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(env: Env, value: string): Promise<string> {
  const key = await keyFromEnv(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return bytesToBase64(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
}

export async function decryptSecret(env: Env, value: string): Promise<string> {
  const bytes = base64ToBytes(value);
  const iv = bytes.slice(0, 12);
  const body = bytes.slice(12);
  const key = await keyFromEnv(env);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
  return new TextDecoder().decode(decrypted);
}

export async function signState(env: Env, uid: string): Promise<string> {
  return new SignJWT({ uid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .setIssuer('dse-calendar-bridge')
    .setAudience('dse-calendar-oauth')
    .sign(new TextEncoder().encode(env.STATE_SECRET));
}

export async function verifyState(env: Env, token: string): Promise<string> {
  const verified = await jwtVerify(token, new TextEncoder().encode(env.STATE_SECRET), {
    issuer: 'dse-calendar-bridge',
    audience: 'dse-calendar-oauth',
  });
  const uid = verified.payload.uid;
  if (typeof uid !== 'string' || !uid) throw new Error('Invalid OAuth state.');
  return uid;
}

export function randomToken(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
