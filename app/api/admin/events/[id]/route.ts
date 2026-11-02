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
    const body = await readJsonLimited<Record<string, unknown>>(request);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === 'string') { const value = body.title.trim().slice(0, 90); if (!value) return jsonNoStore({ error: 'Event title cannot be empty.' }, 400); update.title = value; }
    if (typeof body.babyName === 'string') { const value = body.babyName.trim().slice(0, 80); if (!value) return jsonNoStore({ error: 'Baby name cannot be empty.' }, 400); update.baby_name = value; }
    if (typeof body.venue === 'string') update.venue = body.venue.trim().slice(0, 160) || null;
    if (typeof body.description === 'string') update.description = body.description.trim().slice(0, 1000) || null;
    if (typeof body.date === 'string') { const parsed = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? new Date(`${body.date}T00:00:00.000Z`) : null; if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== body.date) return jsonNoStore({ error: 'Enter a valid event date.' }, 400); update.event_date = body.date; }
    if (typeof body.time === 'string') update.event_time = body.time.trim().slice(0, 20) || null;
    if (typeof body.accessOpen === 'boolean') update.access_open = body.accessOpen;
    if (Object.keys(update).length === 1) return jsonNoStore({ error: 'No valid changes supplied.' }, 400);
    const { data, error } = await supabaseAdmin().from('events').update(update).eq('id', id)
      .select('id,slug,title,baby_name,event_date,event_time,venue,description,access_open').maybeSingle();
    if (error) throw error;
    if (!data) return jsonNoStore({ error: 'Event not found.' }, 404);
    return jsonNoStore({ event: data });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Event update failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not update the event.' }, 500);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    await requireAdmin();
    if (!isSameOrigin(request)) return jsonNoStore({ error: 'Request not allowed.' }, 403);
    const { id } = await context.params;
    const db = supabaseAdmin();
    const { data: event, error: eventError } = await db.from('events').select('id').eq('id', id).maybeSingle();
    if (eventError) throw eventError;
    if (!event) return jsonNoStore({ error: 'Event not found.' }, 404);
    const { data: rows, error: mediaError } = await db.from('media').select('id,account_type,drive_file_id').eq('event_id', id);
    if (mediaError) throw mediaError;
    for (const row of rows || []) {
      if (row.drive_file_id) await trashDriveFile(row.account_type, row.drive_file_id);
    }
    const { data: folders, error: folderError } = await db.from('drive_event_folders').select('account_type,folder_id').eq('event_id', id);
    if (folderError) throw folderError;
    for (const folder of folders || []) await trashDriveFile(folder.account_type, folder.folder_id);
    const { error } = await db.from('events').delete().eq('id', id);
    if (error) throw error;
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_AUTH_REQUIRED') return jsonNoStore({ error: 'Administrator login required.' }, 401);
    console.error('Event delete failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Could not fully delete this event. Check Drive connections and retry.' }, 500);
  }
}
