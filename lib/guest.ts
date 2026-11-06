
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { guestCookieName, hashSessionToken } from '@/lib/security';

export type EventRow = {
  id: string;
  slug: string;
  title: string;
  baby_name: string;
  event_date: string;
  event_time: string | null;
  venue: string | null;
  description: string | null;
  access_open: boolean;
  require_access_code: boolean;
  allow_photo_uploads: boolean;
  allow_video_uploads: boolean;
  access_code_salt: string;
  access_code_hash: string;
};

export async function loadEventBySlug(slug: string) {
  const { data, error } = await supabaseAdmin()
    .from('events')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw error;
  return data as EventRow | null;
}

export async function getGuestSession(
  request: NextRequest,
  slug: string,
  options?: { requireOpen?: boolean }
) {
  const event = await loadEventBySlug(slug);
  if (!event) return null;
  if (options?.requireOpen && !event.access_open) return null;

  const token = request.cookies.get(guestCookieName(slug))?.value;
  if (!token) return null;

  const sessionHash = hashSessionToken(token);

  const { data: session, error } = await supabaseAdmin()
    .from('guest_sessions')
    .select('id,event_id,session_hash,expires_at')
    .eq('event_id', event.id)
    .eq('session_hash', sessionHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error || !session) return null;

  return { event, session, sessionHash };
}
