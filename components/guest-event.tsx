'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CloudUpload, Download, Heart, Image, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Sparkles, UploadCloud, Video, X } from 'lucide-react';

type PublicEvent = { slug: string; title: string; baby_name: string; event_date: string; event_time: string|null; venue: string|null; description: string|null; access_open: boolean };
type MediaItem = { id: string; account_type: 'photos'|'videos'; original_file_name: string; mime_type: string; file_size: number; uploader_name: string|null; caption: string|null; created_at: string; contentUrl: string };
type UploadState = { name: string; progress: number; status: 'queued'|'uploading'|'done'|'error'; message?: string };

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Keep the date label identical during server rendering and browser hydration.
// Event dates are date-only values (YYYY-MM-DD), so do not format them in the
// viewer's local timezone or locale.
function formatEventDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (month < 1 || month > 12 || day < 1 || day > 31) return value;
  return `${day} ${months[month - 1]} ${year}`;
}

const PHOTO_TYPES = ['image/jpeg','image/png','image/webp','image/heic','image/heif'];
const VIDEO_TYPES = ['video/mp4','video/quicktime','video/webm','video/3gpp','video/x-m4v'];

export default function GuestEvent({ slug }: { slug: string }) {
  const [event, setEvent] = useState<PublicEvent|null>(null);
  const [joined, setJoined] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [tab, setTab] = useState<'photos'|'videos'>('photos');
  const [selected, setSelected] = useState<MediaItem|null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [joining, setJoining] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadMedia = useCallback(async () => {
    const response = await fetch(`/api/events/${encodeURIComponent(slug)}/media`, { cache: 'no-store' });
    const data = await response.json();
    if (response.status === 401) { setJoined(false); return false; }
    if (!response.ok) throw new Error(data.error || 'Could not load the gallery.');
    setMedia(data.media || []); setJoined(true); return true;
  }, [slug]);

  useEffect(() => {
    let active = true;
    async function init() {
      setLoading(true); setError('');
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(slug)}/public`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'This event is unavailable.');
        if (!active) return;
        setEvent(data.event);
        try { await loadMedia(); } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Could not load gallery.'); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'This event is unavailable.'); }
      finally { if (active) setLoading(false); }
    }
    void init();
    return () => { active = false; };
  }, [slug, loadMedia]);

  useEffect(() => {
    if (!joined) return;
    const handle = window.setInterval(() => { void loadMedia().catch(() => undefined); }, 25_000);
    return () => window.clearInterval(handle);
  }, [joined, loadMedia]);

  async function join(eventSubmit: FormEvent) {
    eventSubmit.preventDefault(); setJoining(true); setError('');
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(slug)}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode, displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not join this event.');
      setJoined(true); setAccessCode(''); setNotice('Welcome to the family album.'); await loadMedia();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not join the event.'); }
    finally { setJoining(false); }
  }

  function selectFiles(eventChange: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(eventChange.target.files || []);
    setFiles(chosen);
    setUploads(chosen.map(file => ({ name: file.name, progress: 0, status: 'queued' })));
    // Allow the same file to be selected again after removing it.
    eventChange.target.value = '';
    setNotice(''); setError('');
  }

  function removeSelectedFile(index: number) {
    if (uploading) return;
    setFiles(old => old.filter((_, i) => i !== index));
    setUploads(old => old.filter((_, i) => i !== index));
    setError('');
    setNotice('File removed from your selection.');
  }

  function clearSelectedFiles() {
    if (uploading) return;
    setFiles([]);
    setUploads([]);
    const picker = document.getElementById('guest-file-picker') as HTMLInputElement | null;
    if (picker) picker.value = '';
    setError('');
    setNotice('All selected files were removed.');
  }

  function updateUpload(index: number, update: Partial<UploadState>) {
    setUploads(old => old.map((item, i) => i === index ? { ...item, ...update } : item));
  }

  async function uploadOne(file: File, index: number) {
    const isPhoto = PHOTO_TYPES.includes(file.type.toLowerCase());
    const isVideo = VIDEO_TYPES.includes(file.type.toLowerCase());
    if (!isPhoto && !isVideo) throw new Error('This file type is not supported.');
    const initResponse = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/init`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileSize: file.size, uploaderName: displayName }),
    });
    const initData = await initResponse.json();
    if (!initResponse.ok) throw new Error(initData.error || 'Could not start the upload.');
    const uploadId: string = initData.uploadId;
    const chunkSize: number = Number(initData.chunkSize || 4 * 1024 * 1024);
    let offset = 0;
    let retries = 0;
    while (offset < file.size) {
      const endExclusive = Math.min(offset + chunkSize, file.size);
      const chunk = file.slice(offset, endExclusive);
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/${uploadId}/chunk`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${endExclusive - 1}/${file.size}` },
          body: chunk,
        });
        const data = await response.json();
        if (response.status === 409 && Number.isFinite(data.nextOffset)) {
          offset = Number(data.nextOffset); retries = 0;
          updateUpload(index, { progress: Math.round((offset / file.size) * 100) });
          continue;
        }
        if (!response.ok) throw new Error(data.error || 'A file chunk could not be uploaded.');
        offset = Number(data.nextOffset ?? endExclusive);
        retries = 0;
        updateUpload(index, { progress: Math.min(100, Math.round((offset / file.size) * 100)) });
        if (data.done) break;
      } catch (cause) {
        retries += 1;
        if (retries > 3) throw cause;
        // Ask Drive for the confirmed server-side byte range before retrying.
        await new Promise(resolve => window.setTimeout(resolve, retries * 800));
        const statusResponse = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/${uploadId}/status`, { cache: 'no-store' });
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusData.error || 'Could not resume the upload.');
        offset = Number(statusData.nextOffset || 0);
        updateUpload(index, { progress: Math.min(100, Math.round((offset / file.size) * 100)) });
        if (statusData.done) break;
      }
    }
  }

  async function uploadSelected() {
    if (!files.length || uploading) return;
    setUploading(true); setError(''); setNotice('');
    let success = 0;
    const failedFiles: File[] = [];
    const failedUploads: UploadState[] = [];
    for (let index = 0; index < files.length; index += 1) {
      updateUpload(index, { status: 'uploading', progress: 0, message: undefined });
      try {
        await uploadOne(files[index], index);
        updateUpload(index, { status: 'done', progress: 100 }); success += 1;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Upload failed.';
        updateUpload(index, { status: 'error', message });
        // Keep failed files in the queue so the guest can retry or remove them.
        failedFiles.push(files[index]);
        failedUploads.push({ name: files[index].name, progress: uploads[index]?.progress ?? 0, status: 'error', message });
      }
    }
    setUploading(false);
    setFiles(failedFiles);
    setUploads(failedUploads);
    const picker = document.getElementById('guest-file-picker') as HTMLInputElement | null;
    if (picker) picker.value = '';
    setNotice(success && failedFiles.length
      ? `${success} file${success===1?'':'s'} uploaded. ${failedFiles.length} failed; you can retry or remove them.`
      : success
        ? `${success} file${success===1?'':'s'} uploaded. They will appear in the gallery after admin approval.`
        : 'No files were uploaded successfully. You can retry or remove the selected files.');
  }

  async function logout() {
    try { await fetch(`/api/events/${encodeURIComponent(slug)}/logout`, { method: 'POST' }); } catch { /* Cookie expires on its own. */ }
    setJoined(false); setMedia([]); setFiles([]); setUploads([]); setNotice('You have left the album on this device.');
  }

  const photos = useMemo(() => media.filter(item => item.account_type === 'photos'), [media]);
  const videos = useMemo(() => media.filter(item => item.account_type === 'videos'), [media]);
  const visible = tab === 'photos' ? photos : videos;

  if (loading) return <main className="page-shell grid min-h-screen place-items-center"><LoaderCircle className="animate-spin muted"/></main>;
  if (!event) return <main className="page-shell grid min-h-screen place-items-center px-5"><section className="card max-w-md p-8 text-center"><h1 className="serif text-3xl">Album unavailable</h1><p className="muted mt-3 text-sm">{error || 'This event link may be incorrect or unavailable.'}</p><Link href="/" className="btn mt-6">Back to website</Link></section></main>;

  return <main className="page-shell min-h-screen w-full min-w-0 overflow-x-hidden px-4 py-5 sm:px-6 md:px-10">
    <div className="mx-auto min-w-0 max-w-7xl">
      <header className="flex items-center justify-between gap-4"><Link href="/" className="serif text-lg font-semibold">little <span style={{color:'var(--gold)'}}>moments</span></Link>{joined&&<button onClick={logout} className="inline-flex items-center gap-2 text-sm muted"><LogOut size={15}/> Leave album</button>}</header>
      <section className="mt-8 grid gap-6 overflow-hidden rounded-[28px] border bg-[#f1ecdf] p-6 md:grid-cols-[1.3fr_.7fr] md:p-10" style={{borderColor:'var(--line)'}}>
        <div className="flex flex-col justify-center"><div className="eyebrow flex items-center gap-2"><Sparkles size={14}/> A day to remember</div><h1 className="serif mt-4 text-4xl leading-tight md:text-5xl">{event.title}</h1><p className="serif mt-2 text-2xl" style={{color:'var(--gold)'}}>{event.baby_name}</p><p className="muted mt-4 text-sm leading-6">{event.description || 'Every little moment matters. Share your photos and videos so the family can enjoy the day from every angle.'}</p><div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm muted"><span>{formatEventDate(event.event_date)}</span>{event.event_time&&<span>{event.event_time}</span>}{event.venue&&<span>{event.venue}</span>}</div></div>
        <div className="grid min-h-40 place-items-center rounded-2xl bg-gradient-to-br from-[#ded3bb] to-[#b9aa8b] p-7 text-center"><div><Heart size={45} strokeWidth={1.2} className="mx-auto text-white"/><p className="serif mt-3 text-2xl text-white">All our favourite moments.</p><p className="mt-2 text-xs text-white/80">A shared album for family and friends</p></div></div>
      </section>

      {!joined ? <section className="mx-auto mt-8 max-w-xl"><div className="card p-6 md:p-8"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#f1ecdf]"><LockKeyhole size={21}/></div><h2 className="serif mt-4 text-center text-2xl">Enter the family album</h2><p className="muted mt-2 text-center text-sm leading-6">Ask the event host for the access code. No account or app installation is needed.</p>
        {event.access_open ? <form onSubmit={join} className="mt-6 space-y-4"><div><label className="mb-2 block text-sm font-semibold">Your name <span className="muted font-normal">(optional)</span></label><input className="input" maxLength={80} value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your name"/></div><div><label className="mb-2 block text-sm font-semibold">Event access code</label><input className="input text-center text-xl tracking-[.25em] uppercase" required minLength={6} maxLength={12} autoCapitalize="characters" value={accessCode} onChange={e=>setAccessCode(e.target.value.toUpperCase().replace(/\s/g,''))} placeholder="ABCD1234"/></div>{error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button className="btn w-full" disabled={joining}>{joining?<><LoaderCircle size={16} className="animate-spin"/> Checking code…</>:'Open the album'}</button></form> : <div className="mt-6 rounded-xl bg-[#f8f5ee] p-4 text-center text-sm muted">Guest access for this event is closed. Please contact the event host.</div>}
      </div></section> : <>
        <section className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
          <div className="card min-w-0 max-w-full overflow-hidden p-5 md:p-6"><div className="eyebrow flex items-center gap-2"><CloudUpload size={14}/> Add your memories</div><h2 className="serif mt-3 text-2xl">Share a moment</h2><p className="muted mt-2 text-sm leading-6">Select photos and videos from your device. Originals are sent to the event&apos;s separate Google Drive accounts without compression.</p>
            {event.access_open ? <><label htmlFor="guest-file-picker" className={`mt-5 flex w-full min-w-0 flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-[#fbf9f4] px-4 py-8 text-center ${uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`} style={{borderColor:'#d8cfbd'}}><UploadCloud size={30} className="muted"/><span className="mt-3 text-sm font-semibold">Choose photos or videos</span><span className="mt-1 text-xs muted">JPEG, PNG, WebP, HEIC · MP4, MOV, WebM</span><input id="guest-file-picker" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,video/3gpp,video/x-m4v" className="sr-only" disabled={uploading} onChange={selectFiles}/></label>
              {files.length>0&&<><div className="mt-4 min-w-0 space-y-2" aria-label="Selected files"><div className="flex min-w-0 items-center justify-between gap-3"><p className="text-xs font-semibold muted">{files.length} file{files.length===1?'':'s'} selected</p><button type="button" className="shrink-0 text-xs font-semibold underline underline-offset-2 muted disabled:opacity-50" disabled={uploading} onClick={clearSelectedFiles}>Remove all</button></div>{uploads.map((item,index)=>{ const file=files[index]; return <div key={`${item.name}-${file?.size ?? 0}-${file?.lastModified ?? index}`} className="min-w-0 overflow-hidden rounded-xl bg-[#f8f5ee] p-3"><div className="flex min-w-0 items-start gap-2.5"><div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#eee8db]">{file?.type.toLowerCase().startsWith('video/')?<Video size={16}/>:<Image size={16}/>}</div><div className="min-w-0 flex-1"><div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0 break-all text-xs font-semibold leading-5 sm:truncate" title={item.name}>{item.name}</span><span className="shrink-0 text-[11px] muted">{file?formatFileSize(file.size):''} · {item.status==='done'?'Uploaded':item.status==='error'?'Failed':item.status==='uploading'?`${item.progress}%`:'Ready'}</span></div><div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#e8e0d1]"><div className="h-full rounded-full bg-[#a58a57] transition-all" style={{width:`${item.progress}%`}}/></div>{item.message&&<p className="mt-1 break-words text-xs text-red-700">{item.message}</p>}</div><button type="button" aria-label={`Remove ${item.name}`} title="Remove file" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#d8cfbd] text-[#6e6658] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40" disabled={uploading} onClick={()=>removeSelectedFile(index)}><X size={15}/></button></div></div>})}</div><button type="button" className="btn mt-4 w-full" disabled={uploading} onClick={uploadSelected}>{uploading?<><LoaderCircle size={16} className="animate-spin"/> Uploading files…</>:`Upload ${files.length} selected file${files.length===1?'':'s'}`}</button></>}
            </> : <div className="mt-5 rounded-xl bg-[#f8f5ee] p-4 text-sm muted">New uploads are closed for this event. You can still view approved memories.</div>}
            {notice&&<p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}{error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="mt-5 flex items-start gap-2 text-xs leading-5 muted"><ShieldCheck size={15} className="mt-0.5 shrink-0"/> Your uploads are private until the event host approves them. Originals are preserved.</div>
          </div>
          <div className="card min-w-0 max-w-full overflow-hidden p-5 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Shared memories</div><h2 className="serif mt-2 text-2xl">The family gallery</h2></div><button className="inline-flex items-center gap-2 text-sm muted" onClick={()=>void loadMedia().catch(c=>setError(c instanceof Error?c.message:'Refresh failed.'))}><RefreshCw size={14}/> Refresh</button></div>
            <div className="mt-5 flex gap-2"><button className={`rounded-full px-4 py-2 text-sm ${tab==='photos'?'bg-[#282720] text-white':'border bg-white muted'}`} onClick={()=>setTab('photos')}><Image className="mr-1 inline" size={14}/> Photos ({photos.length})</button><button className={`rounded-full px-4 py-2 text-sm ${tab==='videos'?'bg-[#282720] text-white':'border bg-white muted'}`} onClick={()=>setTab('videos')}><Video className="mr-1 inline" size={14}/> Videos ({videos.length})</button></div>
            {visible.length===0 ? <div className="grid min-h-64 place-items-center p-6 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#f1ecdf]"><Heart size={21}/></div><h3 className="serif mt-4 text-xl">{tab==='photos'?'The first photo will go here':'No videos yet'}</h3><p className="muted mt-2 max-w-xs text-sm leading-6">Approved {tab} will appear here for everyone in the album.</p></div></div> : <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{visible.map(item=><div key={item.id} className="group overflow-hidden rounded-xl bg-[#f1ecdf]"><button className="relative block aspect-square w-full" onClick={()=>setSelected(item)} aria-label={`Open ${item.original_file_name}`}>{item.account_type==='photos'?<img src={item.contentUrl} alt={item.caption||item.original_file_name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"/>:<div className="grid h-full place-items-center"><Video size={30} className="muted"/><span className="mt-2 max-w-full truncate px-2 text-xs muted">{item.original_file_name}</span></div>}<span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent p-3 pt-8 text-left text-xs text-white">{item.uploader_name||'A family memory'}</span></button></div>)}</div>}
          </div>
        </section>
      </>}
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t py-6 text-xs muted" style={{borderColor:'var(--line)'}}><span>Made with love, shared with family.</span><span>little moments</span></footer>
    </div>
    {selected&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Memory viewer" onClick={()=>setSelected(null)}><button aria-label="Close viewer" className="absolute right-4 top-4 rounded-full bg-white/15 p-3 text-white" onClick={()=>setSelected(null)}><X/></button><div className="max-h-[90vh] max-w-5xl" onClick={e=>e.stopPropagation()}>{selected.account_type==='photos'?<img src={selected.contentUrl} alt={selected.caption||selected.original_file_name} className="max-h-[78vh] max-w-full rounded-xl object-contain"/>:<video src={selected.contentUrl} controls autoPlay playsInline className="max-h-[78vh] max-w-full rounded-xl"/>}<div className="mt-3 flex items-center justify-between gap-4 text-white"><div><div className="font-semibold">{selected.uploader_name||'A family memory'}</div>{selected.caption&&<p className="mt-1 text-sm text-white/75">{selected.caption}</p>}</div><a href={`${selected.contentUrl}?download=1`} className="rounded-full border border-white/40 p-3" aria-label="Download original" target="_blank" rel="noreferrer"><Download size={18}/></a></div></div></div>}
  </main>;
}
