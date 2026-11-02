import { NextRequest } from 'next/server';
import { constantTimeSecretMatches, verifyMediaProxyToken } from '@/lib/media-proxy';
import { jsonNoStore, readJsonLimited } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getDriveAccessToken } from '@/lib/google-drive';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const providedSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!constantTimeSecretMatches(providedSecret, process.env.MEDIA_PROXY_SHARED_SECRET)) {
    return jsonNoStore({ error: 'Not authorized.' }, 401);
  }

  try {
    const body = await readJsonLimited<{ token?: string }>(request, 8_000);
    if (typeof body.token !== 'string') return jsonNoStore({ error: 'Invalid media token.' }, 400);
    const claims = verifyMediaProxyToken(body.token);
    if (!claims) return jsonNoStore({ error: 'Media token is invalid or expired.' }, 403);

    const db = supabaseAdmin();
    const { data: media, error: mediaError } = await db.from('media')
      .select('id,event_id,account_type,drive_file_id,original_file_name,mime_type,upload_status,moderation_status')
      .eq('id', claims.mediaId).maybeSingle();
    if (mediaError) throw mediaError;
    if (!media || media.event_id !== claims.eventId || media.account_type !== claims.accountType ||
        media.drive_file_id !== claims.driveFileId || media.upload_status !== 'uploaded' ||
        media.original_file_name !== claims.fileName || media.mime_type !== claims.mimeType) {
      return jsonNoStore({ error: 'Media is no longer available.' }, 404);
    }

    if (claims.access === 'guest') {
      if (media.moderation_status !== 'approved' || !claims.guestSessionHash) {
        return jsonNoStore({ error: 'Media is not available to guests.' }, 403);
      }
      const { data: session, error: sessionError } = await db.from('guest_sessions')
        .select('id').eq('event_id', claims.eventId).eq('session_hash', claims.guestSessionHash)
        .gt('expires_at', new Date().toISOString()).maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return jsonNoStore({ error: 'Guest session has expired.' }, 401);
    }

    const accessToken = await getDriveAccessToken(claims.accountType);
    return jsonNoStore({ accessToken, mimeType: media.mime_type, fileName: media.original_file_name, download: claims.download });
  } catch (error) {
    console.error('Media proxy token request failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not authorize media delivery.' }, 503);
  }
}
