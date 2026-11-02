import { NextRequest } from 'next/server';
import { getGuestSession } from '@/lib/guest';
import { jsonNoStore, isSameOrigin, readJsonLimited } from '@/lib/http';
import { UPLOAD_CHUNK_BYTES, encryptSecret } from '@/lib/security';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ensureEventDriveFolder, startResumableDriveUpload, type DriveAccountType } from '@/lib/google-drive';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v']);
const MAX_PHOTO_BYTES = Number(process.env.MAX_PHOTO_UPLOAD_BYTES || 100 * 1024 * 1024);
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_UPLOAD_BYTES || 1024 * 1024 * 1024);

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
    const { slug } = await context.params;
    const access = await getGuestSession(request, slug, { requireOpen: true });
    if (!access) return jsonNoStore({ error: 'Your guest session is unavailable or uploads are closed.' }, 401);
    const body = await readJsonLimited<{ fileName?: string; mimeType?: string; fileSize?: number; uploaderName?: string; caption?: string }>(request, 12_000);
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim().replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180) : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
    const fileSize = Number(body.fileSize);
    const isPhoto = PHOTO_MIMES.has(mimeType);
    const isVideo = VIDEO_MIMES.has(mimeType);
    if (!fileName || !Number.isSafeInteger(fileSize) || fileSize < 1 || (!isPhoto && !isVideo)) {
      return jsonNoStore({ error: 'Choose a supported photo or video file.' }, 400);
    }
    if ((isPhoto && fileSize > MAX_PHOTO_BYTES) || (isVideo && fileSize > MAX_VIDEO_BYTES)) {
      return jsonNoStore({ error: `This file exceeds the configured ${isPhoto ? 'photo' : 'video'} upload limit.` }, 413);
    }
    const accountType: DriveAccountType = isPhoto ? 'photos' : 'videos';
    const folderId = await ensureEventDriveFolder(access.event, accountType);
    const file = await supabaseAdmin().from('media').insert({
      event_id: access.event.id, account_type: accountType, original_file_name: fileName,
      mime_type: mimeType, file_size: fileSize,
      uploader_name: typeof body.uploaderName === 'string' ? body.uploaderName.trim().slice(0, 80) || null : null,
      caption: typeof body.caption === 'string' ? body.caption.trim().slice(0, 240) || null : null,
      upload_status: 'uploading', moderation_status: 'pending',
    }).select('id').single();
    if (file.error || !file.data) throw file.error || new Error('Could not create media record.');
    try {
      const sessionUri = await startResumableDriveUpload({ type: accountType, folderId, fileName, mimeType, size: fileSize });
      const { data: upload, error } = await supabaseAdmin().from('drive_upload_sessions').insert({
        event_id: access.event.id, media_id: file.data.id, account_type: accountType,
        upload_session_uri_encrypted: encryptSecret(sessionUri), owner_session_hash: access.sessionHash,
        total_bytes: fileSize, received_bytes: 0, upload_status: 'active',
      }).select('id').single();
      if (error || !upload) throw error || new Error('Could not save the upload session.');
      return jsonNoStore({ uploadId: upload.id, chunkSize: UPLOAD_CHUNK_BYTES, totalBytes: fileSize }, 201);
    } catch (error) {
      await supabaseAdmin().from('media').update({ upload_status: 'failed', updated_at: new Date().toISOString() }).eq('id', file.data.id);
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') return jsonNoStore({ error: 'Request is too large.' }, 413);
    console.error('Upload initialization failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: error instanceof Error && error.message.includes('not connected') ? error.message : 'Could not start the upload. Check the Google Drive connection and try again.' }, 503);
  }
}
