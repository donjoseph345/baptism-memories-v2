import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { jsonNoStore, isSameOrigin, readJsonLimited } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { trashDriveFile } from '@/lib/google-drive';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    await requireAdmin();
    if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
    const { id } = await context.params;
    const body = await readJsonLimited<{ status?: string }>(request);
    if (!['pending', 'approved', 'hidden'].includes(body.status || '')) return jsonNoStore({ error: 'Invalid moderation status.' }, 400);
    const { data, error } = await supabaseAdmin().from('media').update({
      moderation_status: body.status,
      approved_at: body.status === 'approved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('upload_status', 'uploaded')
      .select('id,moderation_status,approved_at').maybeSingle();
    if (error) throw error;
    if (!data) return jsonNoStore({ error: 'Uploaded media not found.' }, 404);
    return jsonNoStore({ media: data });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Media moderation failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not update media moderation.' }, 500);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    await requireAdmin();
    if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
    const { id } = await context.params;
    const db = supabaseAdmin();
    const { data: media, error } = await db.from('media').select('id,account_type,drive_file_id').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!media) return jsonNoStore({ error: 'Media not found.' }, 404);
    if (media.drive_file_id) await trashDriveFile(media.account_type, media.drive_file_id);
    const { error: deleteError } = await db.from('media').delete().eq('id', id);
    if (deleteError) throw deleteError;
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Media delete failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not delete media from Drive.' }, 500);
  }
}
