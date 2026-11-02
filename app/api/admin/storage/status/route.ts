import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { jsonNoStore } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await supabaseAdmin().from('drive_connections').select('account_type,google_email,connected_at,updated_at');
    if (error) throw error;
    const byType = new Map((data || []).map((row) => [row.account_type, row]));
    return jsonNoStore({
      photos: { connected: byType.has('photos'), email: byType.get('photos')?.google_email || null, connectedAt: byType.get('photos')?.connected_at || null },
      videos: { connected: byType.has('videos'), email: byType.get('videos')?.google_email || null, connectedAt: byType.get('videos')?.connected_at || null },
      expected: { photos: process.env.GOOGLE_PHOTOS_ALLOWED_EMAIL || null, videos: process.env.GOOGLE_VIDEOS_ALLOWED_EMAIL || null },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Drive status error:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not load Drive connection status.' }, 500);
  }
}
