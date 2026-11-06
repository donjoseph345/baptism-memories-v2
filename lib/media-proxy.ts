import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type MediaProxyClaims = {
  mediaId: string;
  eventId: string;
  accountType: 'photos' | 'videos';
  driveFileId: string;
  fileName: string;
  mimeType: string;
  access: 'guest' | 'admin';
  guestSessionHash?: string;
  download: boolean;
  thumbnail?: boolean;
  exp: number;
};

function signingSecret() {
  const value = process.env.MEDIA_PROXY_SIGNING_SECRET;
  if (!value || value.length < 32) throw new Error('MEDIA_PROXY_SIGNING_SECRET must be at least 32 characters.');
  return value;
}

export function createMediaProxyToken(claims: Omit<MediaProxyClaims, 'exp'>): string {
  const ttl = Math.min(24 * 60 * 60, Math.max(300, Number(process.env.MEDIA_PROXY_TOKEN_TTL_SECONDS || 12 * 60 * 60)));
  const payload: MediaProxyClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + ttl };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyMediaProxyToken(token: string): MediaProxyClaims | null {
  const [encoded, suppliedSignature, extra] = token.split('.');
  if (!encoded || !suppliedSignature || extra) return null;
  const expected = createHmac('sha256', signingSecret()).update(encoded).digest();
  let actual: Buffer;
  try { actual = Buffer.from(suppliedSignature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MediaProxyClaims;
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.mediaId || !payload.eventId || !payload.driveFileId || !payload.fileName || !payload.mimeType) return null;
    if (payload.accountType !== 'photos' && payload.accountType !== 'videos') return null;
    if (payload.access !== 'guest' && payload.access !== 'admin') return null;
    if (payload.access === 'guest' && !/^[a-f0-9]{64}$/i.test(payload.guestSessionHash || '')) return null;
    if (payload.thumbnail !== undefined && typeof payload.thumbnail !== 'boolean') return null;
    if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export function constantTimeSecretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createBrokerSecret() {
  return randomBytes(48).toString('base64url');
}
