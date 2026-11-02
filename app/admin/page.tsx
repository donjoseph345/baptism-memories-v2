'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Copy, ExternalLink, ImagePlus, LoaderCircle, LogOut, Plus, Settings2, Sparkles } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

type EventItem = {
  id: string; slug: string; title: string; baby_name: string; event_date: string;
  venue: string | null; access_open: boolean; counts: { total: number; pending: number; approved: number };
};
type Created = { event: EventItem; accessCode: string; guestUrl: string; qrDataUrl: string };

export default function AdminDashboard() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('A Baptism to Remember');
  const [babyName, setBabyName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [venue, setVenue] = useState('');
  const [description, setDescription] = useState('');
  const [copied, setCopied] = useState(false);

  async function loadEvents() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/events', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load events.');
      setEvents(data.events || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load events.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadEvents(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await fetch('/api/admin/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, babyName, date, time, venue, description }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create event.');
      setCreated(data); setCreating(false); await loadEvents();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create event.'); }
    finally { setSaving(false); }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.href = '/admin/login';
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400);
  }

  return <main className="page-shell min-h-screen px-5 py-6 md:px-10">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="serif text-xl font-semibold">little <span style={{color:'var(--gold)'}}>moments</span> ✳</Link>
        <div className="flex items-center gap-4 text-sm"><Link href="/admin/settings/storage" className="inline-flex items-center gap-2 muted hover:text-black"><Settings2 size={16}/> Storage settings</Link><button onClick={signOut} className="inline-flex items-center gap-2 muted hover:text-black"><LogOut size={16}/> Sign out</button></div>
      </header>

      <section className="mt-12 flex flex-wrap items-end justify-between gap-5">
        <div><div className="eyebrow flex items-center gap-2"><Sparkles size={14}/> Your family&apos;s albums</div><h1 className="serif mt-3 text-4xl md:text-5xl">Event dashboard</h1><p className="muted mt-3 max-w-xl leading-7">Create a private album, connect your two Drive accounts and review the moments guests share.</p></div>
        <button className="btn" onClick={()=>{setCreating(!creating);setCreated(null);setError('');}}><Plus size={17}/> Create event</button>
      </section>

      {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {created && <section className="card mt-7 p-5 md:p-7">
        <div className="flex items-center gap-2 text-sm font-semibold text-green-800"><Check size={18}/> Event created</div>
        <div className="mt-4 grid gap-6 md:grid-cols-[1fr_220px]">
          <div><h2 className="serif text-3xl">{created.event.title}</h2><p className="muted mt-2 text-sm">Save this guest access code. It is displayed only now; a new code can be generated later.</p>
            <div className="mt-5 rounded-2xl bg-[#f5f1e8] p-4"><div className="eyebrow">Guest access code</div><div className="mt-2 flex flex-wrap items-center gap-3"><strong className="text-2xl tracking-[.24em]">{created.accessCode}</strong><button className="btn btn-outline !px-3 !py-2 text-sm" onClick={()=>copy(created.accessCode)}><Copy size={15}/>{copied?'Copied':'Copy code'}</button></div></div>
            <div className="mt-4 break-all rounded-xl border bg-white p-3 text-sm" style={{borderColor:'var(--line)'}}>{created.guestUrl}</div>
            <div className="mt-3 flex flex-wrap gap-3"><button className="btn btn-outline" onClick={()=>copy(created.guestUrl)}><Copy size={15}/> Copy guest link</button><a className="btn" href={created.guestUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Open guest page</a></div>
            <p className="mt-4 text-xs muted">Share the QR code and access code with invited guests. Keep the code private.</p>
          </div>
          <div className="rounded-2xl border bg-white p-3 text-center" style={{borderColor:'var(--line)'}}><img src={created.qrDataUrl} alt="Event QR code" className="mx-auto aspect-square w-full max-w-[190px]"/><a href={created.qrDataUrl} download="baptism-memories-qr.png" className="mt-2 inline-block text-sm underline underline-offset-4">Download QR code</a></div>
        </div>
      </section>}

      {creating && <form onSubmit={submit} className="card mt-7 grid gap-4 p-5 md:grid-cols-2 md:p-7">
        <div className="md:col-span-2"><h2 className="serif text-2xl">Create a new event</h2><p className="muted mt-1 text-sm">A unique access code and QR link will be generated automatically.</p></div>
        <div><label className="mb-2 block text-sm font-semibold">Event title</label><input className="input" required maxLength={90} value={title} onChange={e=>setTitle(e.target.value)} placeholder="A Baptism to Remember"/></div>
        <div><label className="mb-2 block text-sm font-semibold">Baby&apos;s name</label><input className="input" required maxLength={80} value={babyName} onChange={e=>setBabyName(e.target.value)} placeholder="e.g. Noah Joseph"/></div>
        <div><label className="mb-2 block text-sm font-semibold">Event date</label><input className="input" required type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
        <div><label className="mb-2 block text-sm font-semibold">Event time <span className="muted font-normal">(optional)</span></label><input className="input" type="time" value={time} onChange={e=>setTime(e.target.value)}/></div>
        <div><label className="mb-2 block text-sm font-semibold">Church or venue</label><input className="input" maxLength={160} value={venue} onChange={e=>setVenue(e.target.value)} placeholder="Church / reception venue"/></div>
        <div><label className="mb-2 block text-sm font-semibold">Welcome message <span className="muted font-normal">(optional)</span></label><input className="input" maxLength={240} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Share your favourite moments with us"/></div>
        <div className="flex flex-wrap gap-3 md:col-span-2"><button className="btn" disabled={saving}>{saving?<><LoaderCircle className="animate-spin" size={16}/> Creating…</>:'Create private event'}</button><button type="button" className="btn btn-outline" onClick={()=>setCreating(false)}>Cancel</button></div>
      </form>}

      <section className="mt-10">
        <div className="flex items-center justify-between"><h2 className="serif text-2xl">Your events</h2><button className="text-sm muted underline underline-offset-4" onClick={()=>void loadEvents()}>Refresh</button></div>
        {loading ? <div className="card mt-5 grid min-h-36 place-items-center"><LoaderCircle className="animate-spin muted"/></div> : events.length === 0 ? <div className="card mt-5 p-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#f1ecdf]"><ImagePlus/></div><h3 className="serif mt-4 text-2xl">Your first album starts here</h3><p className="muted mt-2 text-sm">Create an event, then share its QR code and guest access code.</p><button className="btn mt-5" onClick={()=>setCreating(true)}><Plus size={16}/> Create event</button></div> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{events.map(event=><article key={event.id} className="card p-5">
          <div className="flex items-start justify-between gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f1ecdf]"><CalendarDays size={19}/></div><span className={event.access_open?'status':'rounded-full bg-[#f3eee4] px-3 py-1.5 text-xs text-[#7d6847]'}>{event.access_open?'Guest access open':'Access closed'}</span></div>
          <h3 className="serif mt-5 text-2xl">{event.title}</h3><p className="muted mt-1 text-sm">{event.baby_name}</p><p className="muted mt-3 text-sm">{new Date(`${event.event_date}T00:00:00`).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})}{event.venue?` · ${event.venue}`:''}</p>
          <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-[#f8f5ee] p-3 text-center"><div><div className="text-lg font-semibold">{event.counts.total}</div><div className="text-[11px] muted">Uploads</div></div><div><div className="text-lg font-semibold">{event.counts.pending}</div><div className="text-[11px] muted">Pending</div></div><div><div className="text-lg font-semibold">{event.counts.approved}</div><div className="text-[11px] muted">Published</div></div></div>
          <Link href={`/admin/events/${event.id}`} className="btn btn-outline mt-4 w-full">Manage event <ArrowRight size={16}/></Link>
        </article>)}</div>}
      </section>
      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t py-6 text-xs muted" style={{borderColor:'var(--line)'}}><span>little moments ✳</span><Link href="/admin/settings/storage" className="underline underline-offset-4">Manage Google Drive</Link><span>Admin account: donjoseph3000@gmail.com</span></footer>
    </div>
  </main>;
}
