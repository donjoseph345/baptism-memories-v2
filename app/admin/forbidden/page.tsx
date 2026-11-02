import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
export default function ForbiddenPage() {
  return <main className="page-shell grid min-h-screen place-items-center px-5"><section className="card max-w-md p-8 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-700"><ShieldAlert/></div><h1 className="serif mt-5 text-3xl">Access restricted</h1><p className="muted mt-3 text-sm leading-6">This account is not configured as the administrator for Baptism Memories.</p><Link href="/admin/login" className="btn mt-6">Back to sign in</Link></section></main>;
}
