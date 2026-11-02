import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { hashAccessCode, randomCode } from '@/lib/security';
import { jsonNoStore, isSameOrigin } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
    const { id } = await context.params;
    const code = randomCode(8);
    const { salt, hash } = await hashAccessCode(code);
    const { data, error } = await supabaseAdmin().from('events').update({ access_code_salt: salt, access_code_hash: hash, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return jsonNoStore({ error: 'Event not found.' }, 404);
    return jsonNoStore({ accessCode: code });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Access code rotation failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not generate a new access code.' }, 500);
  }
}
