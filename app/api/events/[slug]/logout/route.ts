import { NextRequest, NextResponse } from 'next/server';
import { guestCookieName, hashSessionToken } from '@/lib/security';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { jsonNoStore, isSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
  const { slug } = await context.params;
  const name = guestCookieName(slug);
  const token = request.cookies.get(name)?.value;
  if (token) {
    await supabaseAdmin().from('guest_sessions').delete().eq('session_hash', hashSessionToken(token));
  }
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  response.cookies.set(name, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
