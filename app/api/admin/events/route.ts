import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '@/lib/admin';
import { hashAccessCode, randomCode, randomSlugPart } from '@/lib/security';
import { jsonNoStore, isSameOrigin, readJsonLimited } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAdmin();
    const db = supabaseAdmin();
    const { data: events, error } = await db.from('events')
      .select('id,slug,title,baby_name,event_date,event_time,venue,description,access_open,created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const ids = (events || []).map((event) => event.id);
    const counts = new Map<string, { total: number; pending: number; approved: number }>();
    if (ids.length) {
      const { data: media, error: mediaError } = await db.from('media')
        .select('event_id,moderation_status,upload_status').in('event_id', ids);
      if (mediaError) throw mediaError;
      for (const row of media || []) {
        const count = counts.get(row.event_id) || { total: 0, pending: 0, approved: 0 };
        if (row.upload_status === 'uploaded') {
          count.total += 1;
          if (row.moderation_status === 'pending') count.pending += 1;
          if (row.moderation_status === 'approved') count.approved += 1;
        }
        counts.set(row.event_id, count);
      }
    }
    return jsonNoStore({ events: (events || []).map((event) => ({ ...event, counts: counts.get(event.id) || { total: 0, pending: 0, approved: 0 } })) });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Admin event list failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not load events.' }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
    const body = await readJsonLimited<{ title?: string; babyName?: string; date?: string; time?: string; venue?: string; description?: string }>(request);
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 90) : '';
    const babyName = typeof body.babyName === 'string' ? body.babyName.trim().slice(0, 80) : '';
    const date = typeof body.date === 'string' ? body.date : '';
    const time = typeof body.time === 'string' ? body.time.trim().slice(0, 20) : '';
    const venue = typeof body.venue === 'string' ? body.venue.trim().slice(0, 160) : '';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    if (!title || !babyName || !parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return jsonNoStore({ error: 'Enter an event title, baby name and valid date.' }, 400);
    }
    const accessCode = randomCode(8);
    const { salt, hash } = await hashAccessCode(accessCode);
    const slug = `${randomSlugPart(babyName)}-${date}-${randomUUID().slice(0, 5)}`;
    const { data, error } = await supabaseAdmin().from('events').insert({
      slug, title, baby_name: babyName, event_date: date, event_time: time || null,
      venue: venue || null, description: description || null,
      access_code_salt: salt, access_code_hash: hash, access_open: true, created_by: admin.id,
    }).select('id,slug,title,baby_name,event_date,event_time,venue,description,access_open,created_at').single();
    if (error) throw error;
    const base = (process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/+$/, '');
    const guestUrl = `${base}/e/${data.slug}`;
    const qrDataUrl = await QRCode.toDataURL(guestUrl, { width: 720, margin: 2, color: { dark: '#282720', light: '#ffffff' } });
    return jsonNoStore({ event: data, accessCode, guestUrl, qrDataUrl }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') return jsonNoStore({ error: 'Request is too large.' }, 413);
    console.error('Admin event create failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not create the event. Check that the V2 database migration has been applied.' }, 500);
  }
}
