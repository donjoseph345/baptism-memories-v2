export interface Env {
  TOKEN_BROKER_URL: string;
  MEDIA_PROXY_SHARED_SECRET: string;
  MEDIA_PROXY_SIGNING_SECRET: string;
}

type Claims = {
  mediaId: string;
  eventId: string;
  accountType: 'photos' | 'videos';
  driveFileId: string;
  fileName: string;
  mimeType: string;
  access: 'guest' | 'admin';
  guestSessionHash?: string;
  download: boolean;
  exp: number;
};

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

async function verifyToken(token: string, secret: string): Promise<Claims | null> {
  const [encoded, supplied, extra] = token.split('.');
  if (!encoded || !supplied || extra) return null;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
   const signature = new Uint8Array(decodeBase64Url(supplied));
const data = new TextEncoder().encode(encoded);

const valid = await crypto.subtle.verify(
  'HMAC',
  key,
  signature,
  data
);
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as Claims;
    if (!claims.mediaId || !claims.eventId || !claims.driveFileId || !claims.fileName || !claims.mimeType) return null;
    if (claims.accountType !== 'photos' && claims.accountType !== 'videos') return null;
    if (claims.access !== 'guest' && claims.access !== 'admin') return null;
    if (claims.access === 'guest' && !/^[a-f0-9]{64}$/i.test(claims.guestSessionHash || '')) return null;
    if (!Number.isInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

function safeFilename(value: string) {
  return value.replace(/[\r\n\\"\u0000-\u001f]/g, '_').slice(0, 180);
}

function errorResponse(message: string, status: number) {
  return new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
    const url = new URL(request.url);
    if (url.pathname !== '/media') return errorResponse('Not found.', 404);
    const token = url.searchParams.get('token');
    if (!token) return errorResponse('Media token is required.', 401);

    const claims = await verifyToken(token, env.MEDIA_PROXY_SIGNING_SECRET);
    if (!claims) return errorResponse('Media link is invalid or expired.', 403);

    const brokerResponse = await fetch(env.TOKEN_BROKER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MEDIA_PROXY_SHARED_SECRET}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ token }),
    });
    if (!brokerResponse.ok) return errorResponse('Media access is no longer available.', brokerResponse.status === 401 ? 401 : 403);
    const broker = await brokerResponse.json() as { accessToken?: string; mimeType?: string; fileName?: string; download?: boolean };
    if (!broker.accessToken) return errorResponse('Media authorization failed.', 502);

    const driveUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(claims.driveFileId)}`);
    driveUrl.searchParams.set('alt', 'media');
    const range = request.headers.get('range');
    const upstream = await fetch(driveUrl, {
      headers: {
        'Authorization': `Bearer ${broker.accessToken}`,
        ...(range && /^bytes=\d*-\d*$/.test(range) ? { 'Range': range } : {}),
      },
      redirect: 'follow',
    });
    if (!upstream.ok && upstream.status !== 206) return errorResponse('Google Drive could not deliver this file.', upstream.status === 404 ? 404 : 502);

    const fileName = safeFilename(broker.fileName || claims.fileName);
    const headers = new Headers({
      'Content-Type': broker.mimeType || claims.mimeType || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${broker.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    for (const name of ['content-length', 'content-range', 'last-modified', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
