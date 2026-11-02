import GuestEvent from '@/components/guest-event';

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <GuestEvent slug={slug} />;
}
