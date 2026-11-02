import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { encryptSecret } from '@/lib/security';
import { clearDriveAccessTokenCache } from '@/lib/google-drive';
import { GOOGLE_STATE_COOKIE, googleOAuthRedirectUri, required, verifyOAuthState } from '@/lib/google-oauth';

export const runtime = 'nodejs';

function finish(request: NextRequest, query: string) {
  const target = new URL('/admin/settings/storage', request.url);
  target.searchParams.set('drive', query);
  const response = NextResponse.redirect(target);
  response.cookies.delete(GOOGLE_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || '';
  const cookieState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value || '';
  if (!state || !cookieState || state !== cookieState) return finish(request, 'state-error');
  const account = verifyOAuthState(state);
  if (!account) return finish(request, 'state-error');
  const providerError = request.nextUrl.searchParams.get('error');
  if (providerError) return finish(request, 'cancelled');
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return finish(request, 'missing-code');

  try {
    const redirectUri = googleOAuthRedirectUri(request.url);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: required('GOOGLE_CLIENT_ID'),
        client_secret: required('GOOGLE_CLIENT_SECRET'),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }), cache: 'no-store',
    });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description || 'Google token exchange failed.');

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: 'no-store',
    });
    const profile = await profileResponse.json() as { email?: string; verified_email?: boolean };
    const email = profile.email?.trim().toLowerCase();
    if (!profileResponse.ok || !email || profile.verified_email === false) throw new Error('Google did not return a verified account email.');

    const expected = (account === 'photos' ? process.env.GOOGLE_PHOTOS_ALLOWED_EMAIL : process.env.GOOGLE_VIDEOS_ALLOWED_EMAIL)?.trim().toLowerCase();
    if (!expected || email !== expected) throw new Error(`Sign in with the configured ${account} Google account.`);

    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const { data: existing } = await supabaseAdmin().from('drive_connections')
        .select('refresh_token_encrypted').eq('account_type', account).maybeSingle();
      if (!existing?.refresh_token_encrypted) throw new Error('Google did not issue a refresh token. Reconnect and approve offline access.');
      // Keep the existing encrypted refresh token when Google omits a replacement.
      const { error } = await supabaseAdmin().from('drive_connections').update({ google_email: email, updated_at: new Date().toISOString() }).eq('account_type', account);
      if (error) throw error;
      clearDriveAccessTokenCache(account);
      return finish(request, `${account}-connected`);
    }

    clearDriveAccessTokenCache(account);
    const { error: saveError } = await supabaseAdmin().from('drive_connections').upsert({
      account_type: account,
      google_email: email,
      refresh_token_encrypted: encryptSecret(refreshToken),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_type' });
    if (saveError) throw saveError;
    return finish(request, `${account}-connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Google OAuth error';
    console.error('Google OAuth callback failed:', message);
    const target = new URL('/admin/settings/storage', request.url);
    target.searchParams.set('drive', 'error');
    target.searchParams.set('reason', 'connection-failed');
    const response = NextResponse.redirect(target);
    response.cookies.delete(GOOGLE_STATE_COOKIE);
    return response;
  }
}
