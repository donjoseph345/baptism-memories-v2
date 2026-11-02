import { NextRequest } from 'next/server';
import { getGuestSession } from '@/lib/guest';
import { decryptSecret } from '@/lib/security';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getDriveUploadStatus } from '@/lib/google-drive';
import { jsonNoStore } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;


export async function GET(request: NextRequest, context: { params: Promise<{ slug: string; uploadId: string }> }) {
  try {
    const { slug, uploadId } = await context.params;
    const access = await getGuestSession(request, slug);
    if (!access) return jsonNoStore({ error: 'Guest session required.' }, 401);
    const { data: upload, error } = await supabaseAdmin().from('drive_upload_sessions')
      .select('id,event_id,media_id,account_type,upload_session_uri_encrypted,owner_session_hash,total_bytes,received_bytes,upload_status,expires_at')
      .eq('id', uploadId).eq('event_id', access.event.id).maybeSingle();
    if (error) throw error;
    if (!upload || upload.owner_session_hash !== access.sessionHash) return jsonNoStore({ error: 'Upload session not found.' }, 404);
    if (upload.upload_status === 'completed') return jsonNoStore({ done: true, nextOffset: Number(upload.total_bytes) });
    if (upload.upload_status !== 'active' || new Date(upload.expires_at).getTime() <= Date.now()) return jsonNoStore({ error: 'Upload session expired.' }, 410);
    const result = await getDriveUploadStatus({
      type: upload.account_type,
      sessionUri: decryptSecret(upload.upload_session_uri_encrypted),
      total: Number(upload.total_bytes),
    });
    if (result.done) {
      const { data: finished, error: finishError } = await supabaseAdmin().rpc('finish_drive_upload', { p_upload_session_id: upload.id, p_drive_file_id: result.file.id });
      if (finishError) throw finishError;
      if (!finished) throw new Error('The upload session could not be finalized.');
      return jsonNoStore({ done: true, nextOffset: Number(upload.total_bytes) });
    }
    const nextOffset = Math.max(0, Math.min(Number(upload.total_bytes), result.nextOffset));
    const { error: updateError } = await supabaseAdmin().from('drive_upload_sessions')
      .update({ received_bytes: nextOffset, updated_at: new Date().toISOString() }).eq('id', upload.id);
    if (updateError) throw updateError;
    return jsonNoStore({ done: false, nextOffset });
  } catch (error) {
    console.error('Upload status check failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: error instanceof Error ? error.message : 'Could not resume upload.' }, 503);
  }
}
