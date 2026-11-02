'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Cloud, ExternalLink, LoaderCircle, RefreshCw, Unplug } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Connection = { connected: boolean; email: string | null; connectedAt: string | null };
type Status = { photos: Connection; videos: Connection; expected: { photos: string | null; videos: string | null } };

export default function StorageSettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'photos' | 'videos' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/storage/status', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load storage settings.');
      setStatus(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load storage settings.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); const params = new URLSearchParams(window.location.search); const drive = params.get('drive'); if (drive?.endsWith('-connected')) setMessage(`${drive.startsWith('photos')?'Photo':'Video'} Google Drive connected successfully.`); else if (drive === 'error') setError('Google Drive connection failed. Check that the correct account was selected and try again.'); else if (drive === 'state-error') setError('The Google connection timed out or could not be verified. Start the connection again.'); }, []);

  async function disconnect(account: 'photos' | 'videos') {
    if (!window.confirm(`Disconnect the ${account} Google Drive account? Existing files will remain in Drive, but the website cannot display or download media from this account until it is reconnected.`)) return;
    setBusy(account); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/storage/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not disconnect account.');
      await load(); setMessage(`${account === 'photos'?'Photo':'Video'} Drive disconnected. Existing files remain in Drive; reconnect to restore website access to them.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not disconnect account.'); }
    finally { setBusy(null); }
  }

  async function signOut() { await supabaseBrowser().auth.signOut(); window.location.href = '/admin/login'; }

  return <main className="page-shell min-h-screen px-5 py-6 md:px-10"><div className="mx-auto max-w-4xl">
    <header className="flex items-center justify-between"><Link href="/admin" className="inline-flex items-center gap-2 text-sm muted"><ArrowLeft size={15}/> Dashboard</Link><button onClick={signOut} className="text-sm muted">Sign out</button></header>
    <div className="mt-12"><div className="eyebrow flex items-center gap-2"><Cloud size={14}/> Connected storage</div><h1 className="serif mt-3 text-4xl">Google Drive accounts</h1><p className="muted mt-3 max-w-2xl leading-7">Connect each Google account once. Photos are routed to the photo account and videos to the video account. Refresh tokens are encrypted before being stored.</p></div>
    {message && <p className="mt-6 rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <div className="card mt-7 grid min-h-40 place-items-center"><LoaderCircle className="animate-spin muted"/></div> : <div className="mt-7 grid gap-5 md:grid-cols-2">{(['photos','videos'] as const).map((account)=>{
      const connection = status?.[account];
      const expected = status?.expected[account];
      return <section key={account} className="card p-6">
        <div className="flex items-start justify-between gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f1ecdf]"><Cloud/></div><span className={connection?.connected?'status':'rounded-full bg-[#f3eee4] px-3 py-1.5 text-xs text-[#7d6847]'}>{connection?.connected?'Connected':'Not connected'}</span></div>
        <h2 className="serif mt-5 text-2xl">{account==='photos'?'Photo Drive':'Video Drive'}</h2><p className="muted mt-1 text-sm">{account==='photos'?'Stores original photographs.':'Stores original video files.'}</p>
        <div className="mt-5 rounded-xl bg-[#f8f5ee] p-3"><div className="text-xs muted">Expected Google account</div><div className="mt-1 break-all text-sm font-semibold">{expected || 'Not configured'}</div></div>
        {connection?.connected && <div className="mt-3 text-sm"><div className="muted text-xs">Connected as</div><div className="mt-1 font-medium">{connection.email}</div><div className="mt-1 text-xs muted">Connected {connection.connectedAt?new Date(connection.connectedAt).toLocaleString():'recently'}</div></div>}
        <div className="mt-5 flex flex-wrap gap-2">{connection?.connected ? <><button className="btn btn-outline" disabled={busy===account} onClick={()=>void disconnect(account)}>{busy===account?<LoaderCircle className="animate-spin" size={15}/>:<Unplug size={15}/>} Disconnect</button><a className="btn btn-outline" target="_blank" rel="noreferrer" href={account==='photos'?'https://drive.google.com/drive/my-drive':'https://drive.google.com/drive/my-drive'}><ExternalLink size={15}/> Open Drive</a></> : <a className="btn w-full" href={`/api/google/oauth/start?account=${account}`}>Connect {account==='photos'?'Photo':'Video'} Drive <ExternalLink size={15}/></a>}</div>
      </section>;
    })}</div>}
    <div className="mt-7 rounded-2xl border bg-white/60 p-5 text-sm leading-6 muted" style={{borderColor:'var(--line)'}}><div className="flex items-center gap-2 font-semibold text-[#48463d]"><CheckCircle2 size={16}/> Privacy and account separation</div><p className="mt-2">The website never stores Google passwords or access tokens in the browser. The two refresh tokens are stored encrypted server-side. Each upload is routed to the matching account; guest users cannot browse either Drive.</p></div>
    <button className="mt-5 inline-flex items-center gap-2 text-sm muted underline underline-offset-4" onClick={()=>void load()}><RefreshCw size={14}/> Refresh connection status</button>
  </div></main>;
}
