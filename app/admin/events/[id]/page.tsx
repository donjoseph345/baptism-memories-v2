
'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

type EventRow = {
  id: string;
  slug: string;
  title: string;
  baby_name: string;
  event_date: string;
  venue: string | null;
  description: string | null;
  access_open: boolean;
};

type MediaRow = {
  id: string;
  account_type: 'photos' | 'videos';
  original_file_name: string;
  mime_type: string;
  file_size: number;
  uploader_name: string | null;
  caption: string | null;
  upload_status: string;
  moderation_status: 'pending' | 'approved' | 'hidden';
  created_at: string;
  contentUrl: string;
  thumbnailUrl: string;
};

function AdminMediaPreview({ row }: { row: MediaRow }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative aspect-[4/3] bg-[#f0ebdf]">
      {!failed ? (
        <img
          src={row.thumbnailUrl}
          alt={`${row.original_file_name} preview`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full place-items-center">
          {row.account_type === 'videos' ? (
            <div className="text-center">
              <Video size={40} className="muted mx-auto" />
              <span className="mt-2 block text-xs muted">
                Video preview unavailable
              </span>
            </div>
          ) : (
            <span className="text-xs muted">Preview unavailable</span>
          )}
        </div>
      )}

      <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs">
        {row.moderation_status}
      </span>
    </div>
  );
}

export default function AdminEventPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [event, setEvent] = useState<EventRow | null>(null);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [qr, setQr] = useState<{ guestUrl: string; qrDataUrl: string } | null>(null);
  const [newCode, setNewCode] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'hidden'>('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBaby, setEditBaby] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [eventResponse, mediaResponse, qrResponse] = await Promise.all([
        fetch(`/api/admin/events/${id}`, { cache: 'no-store' }),
        fetch(`/api/admin/events/${id}/media`, { cache: 'no-store' }),
        fetch(`/api/admin/events/${id}/qr`, { cache: 'no-store' }),
      ]);

      const [eventData, mediaData, qrData] = await Promise.all([
        eventResponse.json(),
        mediaResponse.json(),
        qrResponse.json(),
      ]);

      if (!eventResponse.ok || !mediaResponse.ok || !qrResponse.ok) {
        throw new Error(
          eventData.error ||
          mediaData.error ||
          qrData.error ||
          'Could not load event.'
        );
      }

      const found = eventData.event as EventRow | undefined;

      if (!found) {
        throw new Error('Event not found.');
      }

      setEvent(found);
      setEditTitle(found.title);
      setEditBaby(found.baby_name);
      setEditDate(found.event_date);
      setEditVenue(found.venue || '');
      setEditDescription(found.description || '');
      setMedia(mediaData.media || []);
      setQr(qrData);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load event.'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function request(path: string, body?: unknown, method = 'POST') {
    const response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed.');
    }

    return data;
  }

  async function moderate(
    row: MediaRow,
    status: 'approved' | 'hidden' | 'pending'
  ) {
    setBusy(row.id);
    setError('');
    setNotice('');

    try {
      await request(`/api/admin/media/${row.id}`, { status }, 'PATCH');

      setMedia((current) =>
        current.map((item) =>
          item.id === row.id
            ? { ...item, moderation_status: status }
            : item
        )
      );

      setNotice(
        status === 'approved'
          ? 'Media published to the guest gallery.'
          : 'Media status updated.'
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update media.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: MediaRow) {
    if (
      !window.confirm(
        `Move "${row.original_file_name}" to Google Drive trash and remove it from the gallery?`
      )
    ) {
      return;
    }

    setBusy(row.id);
    setError('');
    setNotice('');

    try {
      await request(`/api/admin/media/${row.id}`, undefined, 'DELETE');

      setMedia((current) =>
        current.filter((item) => item.id !== row.id)
      );

      setNotice('Media moved to Drive trash and removed from the gallery.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not delete media.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleAccess() {
    if (!event) return;

    setBusy('access');
    setError('');
    setNotice('');

    try {
      const data = await request(
        `/api/admin/events/${id}`,
        { accessOpen: !event.access_open },
        'PATCH'
      );

      setEvent((old) =>
        old ? { ...old, access_open: data.event.access_open } : old
      );

      setNotice(
        data.event.access_open
          ? 'Guest access reopened.'
          : 'New guest joins and uploads are closed.'
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update access.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    setBusy('details');
    setError('');
    setNotice('');

    try {
      const data = await request(
        `/api/admin/events/${id}`,
        {
          title: editTitle,
          babyName: editBaby,
          date: editDate,
          venue: editVenue,
          description: editDescription,
        },
        'PATCH'
      );

      setEvent((old) => (old ? { ...old, ...data.event } : old));
      setEditOpen(false);
      setNotice('Event details updated.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update event details.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function deleteEvent() {
    if (
      !window.confirm(
        'Delete this event, its database records and move its media folders/files to Google Drive trash? This cannot be undone.'
      )
    ) {
      return;
    }

    setBusy('delete');
    setError('');
    setNotice('');

    try {
      await request(`/api/admin/events/${id}`, undefined, 'DELETE');
      window.location.href = '/admin';
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not delete event.'
      );
      setBusy(null);
    }
  }

  async function rotateCode() {
    if (
      !window.confirm(
        'Generate a new access code? The previous code will stop working for new guest sessions.'
      )
    ) {
      return;
    }

    setBusy('code');
    setError('');
    setNotice('');

    try {
      const data = await request(`/api/admin/events/${id}/access-code`);
      setNewCode(data.accessCode);
      setNotice('New access code generated. Copy and save it now.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not generate access code.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice('Copied to clipboard.');
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.href = '/admin/login';
  }

  const filtered = useMemo(
    () =>
      media.filter(
        (row) => filter === 'all' || row.moderation_status === filter
      ),
    [media, filter]
  );

  if (loading) {
    return (
      <main className="page-shell grid min-h-screen place-items-center">
        <LoaderCircle className="animate-spin muted" />
      </main>
    );
  }

  return (
    <main className="page-shell min-h-screen px-5 py-6 md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between">
          <Link href="/admin" className="inline-flex items-center gap-2 text-sm muted">
            <ArrowLeft size={15} /> All events
          </Link>
          <button onClick={signOut} className="text-sm muted">
            Sign out
          </button>
        </header>

        {error && (
          <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {notice && (
          <p className="mt-6 rounded-xl bg-green-50 p-3 text-sm text-green-800">
            {notice}
          </p>
        )}

        {event && (
          <>
            <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_260px]">
              <div>
                <div className="eyebrow">Event management</div>
                <h1 className="serif mt-3 text-4xl md:text-5xl">{event.title}</h1>

                <p className="muted mt-2">
                  {event.baby_name} ·{' '}
                  {new Date(`${event.event_date}T00:00:00`).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  {event.venue ? ` · ${event.venue}` : ''}
                </p>

                <p className="muted mt-4 max-w-2xl text-sm leading-6">
                  {event.description ||
                    'Manage uploaded photos and videos, review submissions and control guest access.'}
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button className="btn btn-outline" onClick={() => setEditOpen(!editOpen)}>
                    {editOpen ? 'Close editor' : 'Edit event details'}
                  </button>

                  <button
                    className="btn btn-outline"
                    onClick={() => void toggleAccess()}
                    disabled={busy === 'access'}
                  >
                    {event.access_open ? <EyeOff size={16} /> : <Eye size={16} />}
                    {event.access_open ? 'Close guest access' : 'Reopen guest access'}
                  </button>

                  <button
                    className="btn btn-outline"
                    onClick={() => void rotateCode()}
                    disabled={busy === 'code'}
                  >
                    {busy === 'code' ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    Generate new code
                  </button>

                  <a
                    className="btn"
                    href={qr?.guestUrl || `/e/${event.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={15} /> Guest page
                  </a>

                  <button
                    className="rounded-full border px-4 py-3 text-sm text-red-700"
                    style={{ borderColor: '#efd4d1' }}
                    onClick={() => void deleteEvent()}
                    disabled={busy === 'delete'}
                  >
                    {busy === 'delete' ? (
                      <LoaderCircle size={15} className="animate-spin inline mr-1" />
                    ) : (
                      <Trash2 size={15} className="inline mr-1" />
                    )}
                    Delete event
                  </button>
                </div>

                {newCode && (
                  <div className="mt-5 inline-block rounded-2xl bg-[#f5f1e8] p-4">
                    <div className="eyebrow">New guest access code — copy now</div>
                    <div className="mt-2 flex items-center gap-3">
                      <strong className="text-2xl tracking-[.24em]">{newCode}</strong>
                      <button
                        className="btn btn-outline !px-3 !py-2 text-sm"
                        onClick={() => void copy(newCode)}
                      >
                        <Copy size={14} /> Copy
                      </button>
                    </div>
                  </div>
                )}

                {editOpen && (
                  <form
                    onSubmit={saveDetails}
                    className="card mt-5 grid gap-3 p-5 sm:grid-cols-2"
                  >
                    <div className="sm:col-span-2">
                      <h2 className="serif text-xl">Edit event details</h2>
                      <p className="muted mt-1 text-xs">
                        Changes appear on the guest event page.
                      </p>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold">Event title</label>
                      <input
                        className="input"
                        required
                        maxLength={90}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold">Baby&apos;s name</label>
                      <input
                        className="input"
                        required
                        maxLength={80}
                        value={editBaby}
                        onChange={(e) => setEditBaby(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold">Event date</label>
                      <input
                        className="input"
                        required
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold">Venue</label>
                      <input
                        className="input"
                        maxLength={160}
                        value={editVenue}
                        onChange={(e) => setEditVenue(e.target.value)}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-semibold">
                        Welcome message
                      </label>
                      <textarea
                        className="input min-h-24"
                        maxLength={1000}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <button className="btn" disabled={busy === 'details'}>
                        {busy === 'details' ? (
                          <LoaderCircle className="animate-spin" size={15} />
                        ) : null}
                        Save changes
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {qr && (
                <div className="card p-4 text-center">
                  <img
                    src={qr.qrDataUrl}
                    alt="Event QR code"
                    className="mx-auto aspect-square w-full max-w-[190px]"
                  />
                  <button
                    className="mt-2 text-sm underline underline-offset-4"
                    onClick={() => void copy(qr.guestUrl)}
                  >
                    Copy guest URL
                  </button>
                  <a
                    href={qr.qrDataUrl}
                    download={`${event.slug}-qr.png`}
                    className="ml-4 text-sm underline underline-offset-4"
                  >
                    Download QR
                  </a>
                </div>
              )}
            </section>

            <section className="mt-12">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="eyebrow">Guest contributions</div>
                  <h2 className="serif mt-2 text-3xl">Photo &amp; video review</h2>
                  <p className="muted mt-2 text-sm">
                    Only approved uploads are shown in the guest gallery.
                  </p>
                </div>

                <button
                  className="text-sm muted underline underline-offset-4"
                  onClick={() => void load()}
                >
                  <RefreshCw className="mr-1 inline" size={14} /> Refresh
                </button>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {(['pending', 'approved', 'hidden', 'all'] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={`rounded-full px-4 py-2 text-sm ${
                      filter === value
                        ? 'bg-[#282720] text-white'
                        : 'border bg-white muted'
                    }`}
                    style={filter === value ? {} : { borderColor: 'var(--line)' }}
                  >
                    {value[0].toUpperCase() + value.slice(1)}{' '}
                    {value === 'all'
                      ? `(${media.length})`
                      : `(${media.filter((row) => row.moderation_status === value).length})`}
                  </button>
                ))}
              </div>

              {filtered.length === 0 ? (
                <div className="card mt-5 p-9 text-center">
                  <div className="serif text-2xl">Nothing to review here</div>
                  <p className="muted mt-2 text-sm">
                    New guest uploads will appear in this section.
                  </p>
                </div>
              ) : (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filtered.map((row) => (
                    <article key={row.id} className="card overflow-hidden">
                      <AdminMediaPreview row={row} />

                      <div className="p-4">
                        <div className="truncate text-sm font-semibold">
                          {row.original_file_name}
                        </div>

                        <div className="mt-1 text-xs muted">
                          {row.account_type === 'photos' ? 'Photo' : 'Video'} ·{' '}
                          {(row.file_size / 1024 / 1024).toFixed(1)} MB
                        </div>

                        {row.uploader_name && (
                          <div className="mt-2 text-xs muted">
                            From {row.uploader_name}
                          </div>
                        )}

                        {row.caption && (
                          <p className="mt-2 text-xs muted">{row.caption}</p>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          {row.moderation_status !== 'approved' && (
                            <button
                              disabled={busy === row.id}
                              onClick={() => void moderate(row, 'approved')}
                              className="btn !px-3 !py-2 text-xs"
                            >
                              <ShieldCheck size={14} /> Approve
                            </button>
                          )}

                          {row.moderation_status !== 'hidden' && (
                            <button
                              disabled={busy === row.id}
                              onClick={() => void moderate(row, 'hidden')}
                              className="btn btn-outline !px-3 !py-2 text-xs"
                            >
                              <EyeOff size={14} /> Hide
                            </button>
                          )}

                          <a
                            href={`${row.contentUrl}?download=1`}
                            className="btn btn-outline !px-3 !py-2 text-xs"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download
                          </a>

                          <button
                            disabled={busy === row.id}
                            onClick={() => void remove(row)}
                            className="rounded-full border px-3 py-2 text-xs text-red-700"
                            style={{ borderColor: '#efd4d1' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
