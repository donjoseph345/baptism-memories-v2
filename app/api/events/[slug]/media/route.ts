import { NextRequest } from 'next/server';
import { getGuestSession } from '@/lib/guest';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { jsonNoStore } from '@/lib/http';

export const runtime = 'nodejs';

const PAGE_SIZE = 16;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

type GalleryCursor = { createdAt: string; id: string };

type MediaRow = {
  id: string;
  account_type: 'photos' | 'videos';
  original_file_name: string;
  mime_type: string;
  file_size: number;
  uploader_name: string | null;
  caption: string | null;
  created_at: string;
};

function decodeCursor(value: string | null): GalleryCursor | null | false {
  if (!value) return null;
  if (value.length > 512) return false;

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<GalleryCursor>;
    if (
      typeof parsed.createdAt !== 'string' ||
      !ISO_TIMESTAMP_PATTERN.test(parsed.createdAt) ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id)
    ) {
      return false;
    }

    // Preserve the exact database timestamp string, including fractional
    // seconds, so the composite cursor cannot skip rows sharing a timestamp.
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return false;
  }
}

function encodeCursor(row: MediaRow): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), 'utf8').toString('base64url');
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const access = await getGuestSession(request, slug);
    if (!access) return jsonNoStore({ error: 'Enter the event code to view this album.' }, 401);

    const search = request.nextUrl.searchParams;
    const accountType = search.get('type') || 'photos';
    if (accountType !== 'photos' && accountType !== 'videos') {
      return jsonNoStore({ error: 'Invalid gallery category.' }, 400);
    }

    const cursor = decodeCursor(search.get('cursor'));
    if (cursor === false) return jsonNoStore({ error: 'Invalid gallery cursor.' }, 400);

    const db = supabaseAdmin();
    let pageQuery = db.from('media')
      .select('id,account_type,original_file_name,mime_type,file_size,uploader_name,caption,created_at', { count: 'exact' })
      .eq('event_id', access.event.id)
      .eq('account_type', accountType)
      .eq('upload_status', 'uploaded')
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (cursor) {
      pageQuery = pageQuery.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    const otherType = accountType === 'photos' ? 'videos' : 'photos';
    let pageResult: Awaited<typeof pageQuery>;
    let otherCount = 0;

    if (cursor) {
      // Infinite-scroll pages only need their own page data. Don't repeat the
      // category-count query for every additional batch.
      pageResult = await pageQuery;
    } else {
      const [firstPageResult, otherCountResult] = await Promise.all([
        pageQuery,
        db.from('media').select('id', { count: 'exact', head: true })
          .eq('event_id', access.event.id)
          .eq('account_type', otherType)
          .eq('upload_status', 'uploaded')
          .eq('moderation_status', 'approved'),
      ]);
      if (otherCountResult.error) throw otherCountResult.error;
      pageResult = firstPageResult;
      otherCount = otherCountResult.count ?? 0;
    }

    if (pageResult.error) throw pageResult.error;

    const rows = (pageResult.data || []) as MediaRow[];
    const hasMore = rows.length > PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const lastRow = pageRows[pageRows.length - 1];

    return jsonNoStore({
      media: pageRows.map(row => ({
        ...row,
        contentUrl: `/api/media/${row.id}/content`,
        thumbnailUrl: `/api/media/${row.id}/content?thumbnail=1`,
      })),

      nextCursor: hasMore && lastRow ? encodeCursor(lastRow) : null,
      pageSize: PAGE_SIZE,
      totalCount: cursor ? undefined : (pageResult.count ?? 0),
      // Counts are only refreshed on the first page. Cursor pages can have
      // a smaller filtered count and must not overwrite the total badges.
      counts: cursor ? undefined : (accountType === 'photos'
        ? { photos: pageResult.count ?? 0, videos: otherCount }
        : { photos: otherCount, videos: pageResult.count ?? 0 }),
    });
  } catch (error) {
    console.error('Guest gallery request failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Unable to load the gallery.' }, 500);
  }
}
