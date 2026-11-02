import { supabaseServer } from '@/lib/supabase-server';

export type AdminIdentity = { id: string; email: string };

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const allowed = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!allowed) throw new Error('ADMIN_EMAIL is not configured.');
  const supabase = await supabaseServer();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email || user.email.toLowerCase() !== allowed) return null;
  return { id: user.id, email: user.email };
}

export async function requireAdmin() {
  const identity = await getAdminIdentity();
  if (!identity) throw new Error('ADMIN_AUTH_REQUIRED');
  return identity;
}
