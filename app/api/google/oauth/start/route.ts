import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { jsonNoStore } from '@/lib/http';
import { createOAuthState, googleAuthorizationUrl, googleOAuthRedirectUri, GOOGLE_STATE_COOKIE } from '@/lib/google-oauth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const account = request.nextUrl.searchParams.get('account');
    if (account !== 'photos' && account !== 'videos') return jsonNoStore({ error: 'Choose a valid Drive account.' }, 400);
    const state = createOAuthState(account);
    const response = NextResponse.redirect(googleAuthorizationUrl(state, googleOAuthRedirectUri(request.url)));
    response.cookies.set(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Google OAuth start failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not start Google Drive connection.' }, 500);
  }
}
