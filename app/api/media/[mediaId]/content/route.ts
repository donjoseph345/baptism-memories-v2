import { NextRequest, NextResponse } from 'next/server';
import { getAdminIdentity } from '@/lib/admin';
import { getGuestSession } from '@/lib/guest';
import { createMediaProxyToken } from '@/lib/media-proxy';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getDriveMediaResponse } from '@/lib/google-drive';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest, context: { params: Promise<{ mediaId: string }> }) {
  try {
    const { mediaId } = await context.params;
    const db = supabaseAdmin();
    const { data: media, error } = await db.from('media')
      .select('id,event_id,account_type,drive_file_id,original_file_name,mime_type,upload_status,moderation_status')
      .eq('id', mediaId).maybeSingle();
    if (error) throw error;
    if (!media || media.upload_status !== 'uploaded' || !media.drive_file_id) return new Response('Media not found.', { status: 404 });

    const admin = await getAdminIdentity();
    let guestSessionHash: string | undefined;
    if (!admin) {
      const { data: event, error: eventError } = await db.from('events').select('slug').eq('id', media.event_id).maybeSingle();
      if (eventError || !event) return new Response('Not found.', { status: 404 });
      const guest = await getGuestSession(request, event.slug);
      if (!guest || guest.event.id !== media.event_id || media.moderation_status !== 'approved') return new Response('Unauthorized.', { status: 401 });
      guestSessionHash = guest.sessionHash;
    }

    const download = request.nextUrl.searchParams.get('download') === '1';
    const proxyBase = process.env.MEDIA_PROXY_BASE_URL;
    if (proxyBase) {
      const token = createMediaProxyToken({
        mediaId: media.id,
        eventId: media.event_id,
        accountType: media.account_type,
        driveFileId: media.drive_file_id,
        fileName: media.original_file_name,
        mimeType: media.mime_type,
        access: admin ? 'admin' : 'guest',
        guestSessionHash,
        download,
      });
      const target = new URL(proxyBase);
      target.searchParams.set('token', token);
      return NextResponse.redirect(target, { status: 307, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
    }

    // Local development can proxy through Next.js. Production must use the Worker
    // because Vercel Functions limit response payloads to 4.5 MB.
    if (process.env.VERCEL === '1') {
      return new Response('Private media streaming is not configured. Set MEDIA_PROXY_BASE_URL.', {
        status: 503, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const upstream = await getDriveMediaResponse(media.account_type, media.drive_file_id, request.headers.get('range'));
    const headers = new Headers();
    headers.set('Content-Type', media.mime_type || 'application/octet-stream');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(media.original_file_name)}`);
    headers.set('Referrer-Policy', 'no-referrer');
    for (const name of ['content-length', 'content-range', 'last-modified', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error('Media content proxy failed:', error instanceof Error ? error.message : 'Unknown error');
    return new Response('Unable to retrieve this media file.', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
