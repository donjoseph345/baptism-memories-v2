
import { createHmac, timingSafeEqual } from 'node:crypto';

export type UploadProxyClaims = {
  purpose: 'drive-upload';
  uploadId: string;
  eventId: string;
  ownerSessionHash: string;
  totalBytes: number;
  exp: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signingSecret(): string {
  const value = process.env.MEDIA_PROXY_SIGNING_SECRET;

  if (!value || value.length < 32) {
    throw new Error(
      'MEDIA_PROXY_SIGNING_SECRET must be at least 32 characters.'
    );
  }

  return value;
}

export function createUploadProxyToken(
  claims: Omit<UploadProxyClaims, 'purpose' | 'exp'>
): string {
  const ttlSeconds = 12 * 60 * 60;

  if (
    !UUID_PATTERN.test(claims.uploadId) ||
    !UUID_PATTERN.test(claims.eventId) ||
    !/^[a-f0-9]{64}$/i.test(claims.ownerSessionHash) ||
    !Number.isSafeInteger(claims.totalBytes) ||
    claims.totalBytes < 1
  ) {
    throw new Error('Invalid upload authorization claims.');
  }

  const payload: UploadProxyClaims = {
    purpose: 'drive-upload',
    ...claims,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const encoded = Buffer
    .from(JSON.stringify(payload), 'utf8')
    .toString('base64url');

  const signature = createHmac('sha256', signingSecret())
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${signature}`;
}

export function verifyUploadProxyToken(
  token: string
): UploadProxyClaims | null {
  const [encoded, suppliedSignature, extra] = token.split('.');

  if (!encoded || !suppliedSignature || extra) {
    return null;
  }

  try {
    const expected = createHmac('sha256', signingSecret())
      .update(encoded)
      .digest();

    const actual = Buffer.from(suppliedSignature, 'base64url');

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return null;
    }

    const claims = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as UploadProxyClaims;

    if (!claims || typeof claims !== 'object') return null;
    if (claims.purpose !== 'drive-upload') return null;

    if (
      typeof claims.uploadId !== 'string' ||
      !UUID_PATTERN.test(claims.uploadId)
    ) {
      return null;
    }

    if (
      typeof claims.eventId !== 'string' ||
      !UUID_PATTERN.test(claims.eventId)
    ) {
      return null;
    }

    if (
      typeof claims.ownerSessionHash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(claims.ownerSessionHash)
    ) {
      return null;
    }

    if (
      !Number.isSafeInteger(claims.totalBytes) ||
      claims.totalBytes < 1
    ) {
      return null;
    }

    if (
      !Number.isInteger(claims.exp) ||
      claims.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}
