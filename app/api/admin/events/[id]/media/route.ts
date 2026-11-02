import { requireAdmin } from '@/lib/admin';
import { jsonNoStore } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const { data, error } = await supabaseAdmin().from('media')
      .select('id,event_id,account_type,drive_file_id,original_file_name,mime_type,file_size,uploader_name,caption,upload_status,moderation_status,created_at,approved_at')
      .eq('event_id', id).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return jsonNoStore({ media: (data || []).map((row) => ({ ...row, contentUrl: `/api/media/${row.id}/content` })) });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Admin media list failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not load event media.' }, 500);
  }
}
