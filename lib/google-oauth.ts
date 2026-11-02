import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DriveAccountType } from '@/lib/google-drive';

const STATE_COOKIE = 'bm_google_oauth_state';
export const GOOGLE_STATE_COOKIE = STATE_COOKIE;

function stateSecret() {
  const value = process.env.GOOGLE_OAUTH_STATE_SECRET;
  if (!value || value.length < 32) throw new Error('GOOGLE_OAUTH_STATE_SECRET must be at least 32 characters.');
  return value;
}

export function createOAuthState(account: DriveAccountType) {
  const payload = Buffer.from(JSON.stringify({ account, issuedAt: Date.now(), nonce: randomBytes(18).toString('base64url') })).toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string): DriveAccountType | null {
  const [payload, signature, extra] = state.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', stateSecret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { account?: string; issuedAt?: number };
    if (!parsed.issuedAt || Date.now() - parsed.issuedAt > 10 * 60 * 1000 || parsed.issuedAt > Date.now() + 60_000) return null;
    return parsed.account === 'photos' || parsed.account === 'videos' ? parsed.account : null;
  } catch { return null; }
}

export function googleOAuthRedirectUri(requestUrl: string) {
  return process.env.GOOGLE_REDIRECT_URI || `${new URL(requestUrl).origin}/api/google/oauth/callback`;
}

export function googleAuthorizationUrl(state: string, redirectUri: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', required('GOOGLE_CLIENT_ID'));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
