import { NextRequest } from 'next/server';
import { getGuestSession } from '@/lib/guest';
import { decryptSecret } from '@/lib/security';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { uploadDriveChunk } from '@/lib/google-drive';
import { jsonNoStore, isSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;
const CHUNK_MAX = 4 * 1024 * 1024;

type Context = { params: Promise<{ slug: string; uploadId: string }> };


export async function PUT(request: NextRequest, context: Context) {
  try {
    if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
    const { slug, uploadId } = await context.params;
    const access = await getGuestSession(request, slug, { requireOpen: true });
    if (!access) return jsonNoStore({ error: 'Your guest session is unavailable or uploads are closed.' }, 401);
    const { data: upload, error } = await supabaseAdmin().from('drive_upload_sessions')
      .select('id,event_id,media_id,account_type,upload_session_uri_encrypted,owner_session_hash,total_bytes,received_bytes,upload_status,expires_at')
      .eq('id', uploadId).eq('event_id', access.event.id).maybeSingle();
    if (error) throw error;
    if (!upload || upload.owner_session_hash !== access.sessionHash) return jsonNoStore({ error: 'Upload session not found.' }, 404);
    if (upload.upload_status === 'completed') return jsonNoStore({ done: true, nextOffset: Number(upload.total_bytes) });
    if (upload.upload_status !== 'active' || new Date(upload.expires_at).getTime() <= Date.now()) return jsonNoStore({ error: 'This upload session has expired.' }, 410);

    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > CHUNK_MAX) return jsonNoStore({ error: 'Upload chunk is too large.' }, 413);
    const contentRange = request.headers.get('content-range') || '';
    const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match) return jsonNoStore({ error: 'A valid Content-Range header is required.' }, 400);
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length < 1 || bytes.length > CHUNK_MAX || end - start + 1 !== bytes.length || total !== Number(upload.total_bytes) || end >= total || (end + 1 < total && bytes.length % (256 * 1024) !== 0)) {
      return jsonNoStore({ error: 'The upload chunk does not match its declared range.' }, 400);
    }

    const sessionUri = decryptSecret(upload.upload_session_uri_encrypted);
    const current = Number(upload.received_bytes);
    if (start !== current) {
      return jsonNoStore({ error: 'Upload offset changed. Resume from the server-reported offset.', nextOffset: current }, 409);
    }

    const result = await uploadDriveChunk({ type: upload.account_type, sessionUri, bytes, start, total });
    if (result.done) {
      const { data: finished, error: finishError } = await supabaseAdmin().rpc('finish_drive_upload', { p_upload_session_id: upload.id, p_drive_file_id: result.file.id });
      if (finishError) throw finishError;
      if (!finished) throw new Error('The upload session could not be finalized.');
      return jsonNoStore({ done: true, nextOffset: total });
    }
    const nextOffset = Math.max(0, Math.min(total, result.nextOffset));
    const { data: updated, error: updateError } = await supabaseAdmin().from('drive_upload_sessions')
      .update({ received_bytes: nextOffset, updated_at: new Date().toISOString() })
      .eq('id', upload.id).eq('received_bytes', current).eq('upload_status', 'active').select('id').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return jsonNoStore({ error: 'Upload offset changed. Check status and resume.', nextOffset }, 409);
    return jsonNoStore({ done: false, nextOffset });
  } catch (error) {
    console.error('Upload chunk failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'The upload chunk failed. Resume the upload and retry.' }, 503);
  }
}
