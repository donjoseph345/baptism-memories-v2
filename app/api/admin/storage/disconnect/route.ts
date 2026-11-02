import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { decryptSecret } from '@/lib/security';
import { clearDriveAccessTokenCache } from '@/lib/google-drive';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { jsonNoStore, isSameOrigin, readJsonLimited } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
    const body = await readJsonLimited<{ account?: string }>(request, 1000);
    if (body.account !== 'photos' && body.account !== 'videos') return jsonNoStore({ error: 'Invalid Drive account.' }, 400);
    const db = supabaseAdmin();
    const { data, error } = await db.from('drive_connections').select('refresh_token_encrypted').eq('account_type', body.account).maybeSingle();
    if (error) throw error;
    if (data?.refresh_token_encrypted) {
      const token = decryptSecret(data.refresh_token_encrypted);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', cache: 'no-store' }).catch(() => undefined);
    }
    const { error: deleteError } = await db.from('drive_connections').delete().eq('account_type', body.account);
    if (deleteError) throw deleteError;
    clearDriveAccessTokenCache(body.account);
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Drive disconnect failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not disconnect this Drive account.' }, 500);
  }
}
