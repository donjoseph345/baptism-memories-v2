import QRCode from 'qrcode';
import { requireAdmin } from '@/lib/admin';
import { jsonNoStore } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const { data: event, error } = await supabaseAdmin().from('events').select('slug').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!event) return jsonNoStore({ error: 'Event not found.' }, 404);
    const base = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');
    const guestUrl = `${base}/e/${event.slug}`;
    const qrDataUrl = await QRCode.toDataURL(guestUrl, { width: 720, margin: 2, color: { dark: '#282720', light: '#ffffff' } });
    return jsonNoStore({ guestUrl, qrDataUrl });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    return jsonNoStore({ error: 'Could not generate the event QR code.' }, 500);
  }
}
