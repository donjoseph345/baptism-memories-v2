
import { NextRequest, NextResponse } from 'next/server';
import {
  consumeJoinRateLimit,
  createSessionToken,
  GUEST_SESSION_TTL_SECONDS,
  guestCookieName,
  hashSessionToken,
  verifyAccessCode,
} from '@/lib/security';
import { loadEventBySlug } from '@/lib/guest';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { jsonNoStore, isSameOrigin, readJsonLimited } from '@/lib/http';

export const runtime = 'nodejs';

type Context = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    if (!isSameOrigin(request)) {
      return jsonNoStore({ error: 'Request not allowed.' }, 403);
    }

    const contentType = request.headers.get('content-type')?.split(';')[0];
    if (contentType !== 'application/json') {
      return jsonNoStore({ error: 'Invalid request.' }, 415);
    }

    const body = await readJsonLimited<{
      accessCode?: unknown;
      displayName?: unknown;
    }>(request, 4096);

    const code =
      typeof body.accessCode === 'string'
        ? body.accessCode.replace(/\s+/g, '').toUpperCase()
        : '';

    const displayName =
      typeof body.displayName === 'string'
        ? body.displayName.trim().slice(0, 80)
        : '';

    if (!displayName) {
      return jsonNoStore({ error: 'Please enter your name.' }, 400);
    }

    const rate = await consumeJoinRateLimit(request);

    if (!rate.allowed) {
      const response = jsonNoStore(
        { error: 'Too many attempts. Please try again later.' },
        429
      );
      response.headers.set('Retry-After', String(rate.retryAfterSeconds));
      return response;
    }

    const { slug } = await context.params;
    const event = await loadEventBySlug(slug);

    if (!event || !event.access_open) {
      return jsonNoStore(
        { error: 'This event is not accepting new guest sessions.' },
        403
      );
    }

    if (event.require_access_code) {
      if (!/^[A-Z2-9]{6,12}$/.test(code)) {
        return jsonNoStore(
          { error: 'Enter the event access code.' },
          400
        );
      }

      const valid = await verifyAccessCode(
        code,
        event.access_code_salt,
        event.access_code_hash
      );

      if (!valid) {
        return jsonNoStore(
          {
            error: 'That access code is not correct. Please check with the event host.',
          },
          401
        );
      }
    }

    const token = createSessionToken();
    const sessionHash = hashSessionToken(token);
    const expiresAt = new Date(
      Date.now() + GUEST_SESSION_TTL_SECONDS * 1000
    ).toISOString();

    const { error } = await supabaseAdmin()
      .from('guest_sessions')
      .insert({
        event_id: event.id,
        session_hash: sessionHash,
        expires_at: expiresAt,
      });

    if (error) throw error;

    const response = NextResponse.json(
      {
        ok: true,
        event: {
          title: event.title,
          baby_name: event.baby_name,
        },
      },
      {
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );

    response.cookies.set(guestCookieName(slug), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: GUEST_SESSION_TTL_SECONDS,
    });

    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
      return jsonNoStore({ error: 'Request is too large.' }, 413);
    }

    console.error(
      'Guest join failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );

    return jsonNoStore(
      { error: 'Unable to join right now. Please try again.' },
      503
    );
  }
}