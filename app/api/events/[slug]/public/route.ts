import { loadEventBySlug } from '@/lib/guest';
import { jsonNoStore } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const event = await loadEventBySlug(slug);
    if (!event) return jsonNoStore({ error: 'This event could not be found.' }, 404);
    return jsonNoStore({ event: {
      slug: event.slug, title: event.title, baby_name: event.baby_name,
      event_date: event.event_date, event_time: event.event_time, venue: event.venue,
      description: event.description, access_open: event.access_open,
    } });
  } catch (error) {
    console.error('Public event lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return jsonNoStore({ error: 'Unable to load this event.' }, 500);
  }
}
