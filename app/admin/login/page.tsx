'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('donjoseph3000@gmail.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError('');
    try {
      const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      router.replace('/admin');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally { setLoading(false); }
  }

  return <main className="page-shell grid min-h-screen place-items-center px-5 py-10">
    <div className="w-full max-w-md">
      <Link href="/" className="inline-flex items-center gap-2 text-sm muted"><ArrowLeft size={15}/> Back to website</Link>
      <div className="card mt-8 p-7 md:p-9">
        <div className="eyebrow flex items-center gap-2"><Sparkles size={14}/> Little moments · Admin</div>
        <div className="mt-5 grid h-12 w-12 place-items-center rounded-2xl bg-[#f1ecdf]"><LockKeyhole size={22}/></div>
        <h1 className="serif mt-5 text-3xl">Welcome back.</h1>
        <p className="muted mt-2 text-sm leading-6">Sign in to create events and manage your family galleries.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <div><label className="mb-2 block text-sm font-semibold">Administrator email</label><input className="input" type="email" autoComplete="username" required value={email} onChange={(e)=>setEmail(e.target.value)}/></div>
          <div><label className="mb-2 block text-sm font-semibold">Password</label><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e)=>setPassword(e.target.value)}/></div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button className="btn w-full" disabled={loading}>{loading ? <><LoaderCircle size={17} className="animate-spin"/> Signing in…</> : 'Sign in'}</button>
        </form>
        <p className="mt-5 text-xs leading-5 muted">Only the administrator email configured for this website can access the dashboard.</p>
      </div>
    </div>
  </main>;
}
