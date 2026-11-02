import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isLogin = path === '/admin/login';
  const isForbidden = path === '/admin/forbidden';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const allowedEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const isAdmin = Boolean(user?.email && allowedEmail && user.email.toLowerCase() === allowedEmail);
  const isAdminArea = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');

  if (path.startsWith('/api/admin/') && !isAdmin) {
    return NextResponse.json({ error: 'Administrator access required.' }, {
      status: user ? 403 : 401, headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  if (isAdminArea && !isLogin && !isForbidden && !isAdmin) {
    const destination = request.nextUrl.clone();
    destination.pathname = user ? '/admin/forbidden' : '/admin/login';
    destination.search = '';
    return NextResponse.redirect(destination);
  }
  if (isLogin && isAdmin) {
    const destination = request.nextUrl.clone();
    destination.pathname = '/admin';
    destination.search = '';
    return NextResponse.redirect(destination);
  }
  return response;
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
