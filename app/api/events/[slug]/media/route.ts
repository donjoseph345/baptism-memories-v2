import { NextRequest } from 'next/server';
import { getGuestSession } from '@/lib/guest';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { jsonNoStore } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const access = await getGuestSession(request, slug);
    if (!access) return jsonNoStore({ error: 'Enter the event code to view this album.' }, 401);
    const { data, error } = await supabaseAdmin().from('media')
      .select('id,account_type,original_file_name,mime_type,file_size,uploader_name,caption,created_at')
      .eq('event_id', access.event.id)
      .eq('upload_status', 'uploaded')
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return jsonNoStore({ media: (data || []).map((row) => ({ ...row, contentUrl: `/api/media/${row.id}/content` })) });
  } catch (error) {
    console.error('Guest gallery request failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Unable to load the gallery.' }, 500);
  }
}
