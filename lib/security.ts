import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const scrypt = promisify(scryptCallback);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export function randomCode(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export function randomSlugPart(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'baptism';
}

export async function hashAccessCode(code: string, salt = randomBytes(16).toString('hex')) {
  const digest = (await scrypt(code, salt, 64)) as Buffer;
  return { salt, hash: digest.toString('hex') };
}

export async function verifyAccessCode(code: string, salt: string, expectedHex: string): Promise<boolean> {
  if (!/^[a-f0-9]{32,128}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = (await scrypt(code, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashSessionToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function guestCookieName(slug: string): string {
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) throw new Error('Invalid event slug.');
  return `bm_guest_${slug}`;
}

export function hashClientIp(request: NextRequest): string {
  const raw = process.env.VERCEL === '1'
    ? (request.headers.get('x-real-ip') || 'vercel-unknown-ip')
    : 'local-development';
  const secret = process.env.RATE_LIMIT_HASH_SECRET;
  if (!secret || secret.length < 32) throw new Error('RATE_LIMIT_HASH_SECRET must be at least 32 characters.');
  return createHmac('sha256', secret).update(raw).digest('hex');
}

export async function consumeJoinRateLimit(request: NextRequest) {
  const scopeHash = hashClientIp(request);
  const now = new Date();
  const windowSeconds = 15 * 60;
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const { data, error } = await supabaseAdmin().rpc('consume_guest_join_attempt', {
    p_ip_hash: scopeHash,
    p_window_started_at: windowStart,
    p_max_attempts: Number(process.env.GUEST_JOIN_MAX_ATTEMPTS || 12),
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return { allowed: Boolean(result?.allowed), retryAfterSeconds: Number(result?.retry_after_seconds || windowSeconds) };
}

export function encryptSecret(value: string): string {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY is missing.');
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function decryptSecret(encoded: string): string {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY is missing.');
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  const payload = Buffer.from(encoded, 'base64url');
  if (payload.length < 29) throw new Error('Encrypted token is invalid.');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
