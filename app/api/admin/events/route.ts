
import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '@/lib/admin';
import { hashAccessCode, randomCode, randomSlugPart } from '@/lib/security';
import { jsonNoStore, isSameOrigin, readJsonLimited } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAdmin();

    const db = supabaseAdmin();

    const { data: events, error } = await db
      .from('events')
      .select(
        'id,slug,title,baby_name,event_date,event_time,venue,description,access_open,require_access_code,allow_photo_uploads,allow_video_uploads,created_at'
      )
      .order('created_at', { ascending: false });

    if (error) throw error;

    const eventsWithCounts = await Promise.all(
      (events || []).map(async (event) => {
        const [totalResult, pendingResult, approvedResult] =
          await Promise.all([
            db
              .from('media')
              .select('id', { count: 'exact', head: true })
              .eq('event_id', event.id)
              .eq('upload_status', 'uploaded'),

            db
              .from('media')
              .select('id', { count: 'exact', head: true })
              .eq('event_id', event.id)
              .eq('upload_status', 'uploaded')
              .eq('moderation_status', 'pending'),

            db
              .from('media')
              .select('id', { count: 'exact', head: true })
              .eq('event_id', event.id)
              .eq('upload_status', 'uploaded')
              .eq('moderation_status', 'approved'),
          ]);

        if (totalResult.error) throw totalResult.error;
        if (pendingResult.error) throw pendingResult.error;
        if (approvedResult.error) throw approvedResult.error;

        return {
          ...event,
          counts: {
            total: totalResult.count ?? 0,
            pending: pendingResult.count ?? 0,
            approved: approvedResult.count ?? 0,
          },
        };
      })
    );

    return jsonNoStore({ events: eventsWithCounts });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'ADMIN_AUTH_REQUIRED'
    ) {
      return jsonNoStore(
        { error: 'Administrator login required.' },
        401
      );
    }

    console.error(
      'Admin event list failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );

    return jsonNoStore({ error: 'Could not load events.' }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();

    if (!isSameOrigin(request)) {
      return jsonNoStore({ error: 'Request not allowed.' }, 403);
    }

    const body = await readJsonLimited<{
      title?: string;
      babyName?: string;
      date?: string;
      time?: string;
      venue?: string;
      description?: string;
      requireAccessCode?: boolean;
      allowPhotoUploads?: boolean;
      allowVideoUploads?: boolean;
    }>(request);

    const title =
      typeof body.title === 'string'
        ? body.title.trim().slice(0, 90)
        : '';

    const babyName =
      typeof body.babyName === 'string'
        ? body.babyName.trim().slice(0, 80)
        : '';

    const date = typeof body.date === 'string' ? body.date : '';

    const time =
      typeof body.time === 'string'
        ? body.time.trim().slice(0, 20)
        : '';

    const venue =
      typeof body.venue === 'string'
        ? body.venue.trim().slice(0, 160)
        : '';

    const description =
      typeof body.description === 'string'
        ? body.description.trim().slice(0, 1000)
        : '';

    // Preserve the secure default for older clients.
    const requireAccessCode =
      typeof body.requireAccessCode === 'boolean'
        ? body.requireAccessCode
        : true;

    // Older clients retain the existing behaviour: both types allowed.
    const allowPhotoUploads =
      typeof body.allowPhotoUploads === 'boolean'
        ? body.allowPhotoUploads
        : true;

    const allowVideoUploads =
      typeof body.allowVideoUploads === 'boolean'
        ? body.allowVideoUploads
        : true;

    if (!allowPhotoUploads && !allowVideoUploads) {
      return jsonNoStore(
        { error: 'Allow at least one upload type: photos or videos.' },
        400
      );
    }

    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(`${date}T00:00:00.000Z`)
      : null;

    if (
      !title ||
      !babyName ||
      !parsed ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      return jsonNoStore(
        { error: 'Enter an event title, baby name and valid date.' },
        400
      );
    }

    // The database requires a salt and hash for every event.
    // These values remain unused when access-code protection is disabled.
    const accessCode = randomCode(8);
    const { salt, hash } = await hashAccessCode(accessCode);

    const slug = `${randomSlugPart(babyName)}-${date}-${randomUUID().slice(0, 5)}`;

    const { data, error } = await supabaseAdmin()
      .from('events')
      .insert({
        slug,
        title,
        baby_name: babyName,
        event_date: date,
        event_time: time || null,
        venue: venue || null,
        description: description || null,
        access_code_salt: salt,
        access_code_hash: hash,
        require_access_code: requireAccessCode,
        allow_photo_uploads: allowPhotoUploads,
        allow_video_uploads: allowVideoUploads,
        access_open: true,
        created_by: admin.id,
      })
      .select(
        'id,slug,title,baby_name,event_date,event_time,venue,description,access_open,require_access_code,allow_photo_uploads,allow_video_uploads,created_at'
      )
      .single();

    if (error) throw error;

    const base = (
      process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin
    ).replace(/\/+$/, '');

    const guestUrl = `${base}/e/${data.slug}`;

    const qrDataUrl = await QRCode.toDataURL(guestUrl, {
      width: 720,
      margin: 2,
      color: {
        dark: '#282720',
        light: '#ffffff',
      },
    });

    return jsonNoStore(
      {
        event: data,
        ...(requireAccessCode ? { accessCode } : {}),
        guestUrl,
        qrDataUrl,
      },
      201
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'ADMIN_AUTH_REQUIRED'
    ) {
      return jsonNoStore(
        { error: 'Administrator login required.' },
        401
      );
    }

    if (
      error instanceof Error &&
      error.message === 'REQUEST_TOO_LARGE'
    ) {
      return jsonNoStore(
        { error: 'Request is too large.' },
        413
      );
    }

    console.error(
      'Admin event create failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );

    return jsonNoStore(
      {
        error:
          'Could not create the event. Check that the V2 database migration has been applied.',
      },
      500
    );
  }
}
