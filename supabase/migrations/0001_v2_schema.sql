-- Baptism Memories V2: clean, simple event gallery schema.
-- Apply this to the baptism-memories-new project only after confirming
-- that this V2 database is separate from any existing live data.

create extension if not exists pgcrypto;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,90}$'),
  title text not null check (char_length(title) between 1 and 90),
  baby_name text not null check (char_length(baby_name) between 1 and 80),
  event_date date not null,
  event_time text,
  venue text,
  description text,
  access_code_salt text not null,
  access_code_hash text not null,
  access_open boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_created_at_idx on public.events(created_at desc);
create index events_access_open_idx on public.events(access_open);

create table public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index guest_sessions_event_expiry_idx on public.guest_sessions(event_id, expires_at);

create table public.guest_join_rate_limits (
  ip_hash text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (ip_hash, window_started_at)
);
create index guest_join_rate_limits_window_idx on public.guest_join_rate_limits(window_started_at);

create table public.drive_connections (
  account_type text primary key check (account_type in ('photos', 'videos')),
  google_email text not null,
  refresh_token_encrypted text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drive_event_folders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  account_type text not null check (account_type in ('photos', 'videos')),
  folder_id text not null,
  folder_name text not null,
  created_at timestamptz not null default now(),
  unique(event_id, account_type),
  unique(account_type, folder_id)
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  account_type text not null check (account_type in ('photos', 'videos')),
  drive_file_id text,
  original_file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  uploader_name text,
  caption text,
  upload_status text not null default 'uploading' check (upload_status in ('uploading', 'uploaded', 'failed')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);
create index media_event_created_idx on public.media(event_id, created_at desc);
create index media_event_gallery_idx on public.media(event_id, moderation_status, upload_status, created_at desc);
create index media_drive_file_idx on public.media(drive_file_id) where drive_file_id is not null;

create table public.drive_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  media_id uuid not null unique references public.media(id) on delete cascade,
  account_type text not null check (account_type in ('photos', 'videos')),
  upload_session_uri_encrypted text not null,
  owner_session_hash text not null,
  total_bytes bigint not null check (total_bytes > 0),
  received_bytes bigint not null default 0 check (received_bytes >= 0),
  upload_status text not null default 'active' check (upload_status in ('active', 'completed', 'failed')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drive_upload_sessions_expiry_idx on public.drive_upload_sessions(upload_status, expires_at);

-- All data access is server-mediated. Browser roles receive no table privileges.
do $$
declare
  t text;
begin
  foreach t in array array[
    'events', 'guest_sessions', 'guest_join_rate_limits', 'drive_connections',
    'drive_event_folders', 'media', 'drive_upload_sessions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.consume_guest_join_attempt(
  p_ip_hash text,
  p_window_started_at timestamptz,
  p_max_attempts integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64
     or p_window_started_at is null
     or p_max_attempts not between 1 and 1000 then
    raise exception 'invalid guest rate-limit arguments';
  end if;

  insert into public.guest_join_rate_limits(ip_hash, window_started_at, attempt_count, updated_at)
  values (p_ip_hash, p_window_started_at, 1, clock_timestamp())
  on conflict (ip_hash, window_started_at)
  do update set
    attempt_count = public.guest_join_rate_limits.attempt_count + 1,
    updated_at = clock_timestamp()
  returning attempt_count into v_count;

  return query select
    v_count <= p_max_attempts,
    greatest(1, ceil(extract(epoch from (p_window_started_at + interval '15 minutes' - clock_timestamp())))::integer);
end;
$$;
revoke all on function public.consume_guest_join_attempt(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.consume_guest_join_attempt(text, timestamptz, integer) to service_role;

-- Complete the Drive upload and publish its metadata transition atomically.
create or replace function public.finish_drive_upload(
  p_upload_session_id uuid,
  p_drive_file_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_media_id uuid;
  v_total_bytes bigint;
  v_upload_status text;
  v_media_status text;
begin
  if p_upload_session_id is null or p_drive_file_id is null or length(trim(p_drive_file_id)) = 0 then
    raise exception 'invalid upload completion arguments';
  end if;

  select media_id, total_bytes, upload_status
    into v_media_id, v_total_bytes, v_upload_status
  from public.drive_upload_sessions
  where id = p_upload_session_id
  for update;
  if not found then return false; end if;

  if v_upload_status = 'completed' then
    return true;
  end if;
  if v_upload_status <> 'active' then return false; end if;

  select upload_status into v_media_status
  from public.media
  where id = v_media_id
  for update;
  if not found or v_media_status <> 'uploading' then
    raise exception 'media row is not awaiting upload completion';
  end if;

  update public.media
  set drive_file_id = p_drive_file_id,
      upload_status = 'uploaded',
      updated_at = clock_timestamp()
  where id = v_media_id;

  update public.drive_upload_sessions
  set received_bytes = v_total_bytes,
      upload_status = 'completed',
      updated_at = clock_timestamp()
  where id = p_upload_session_id;

  return true;
end;
$$;
revoke all on function public.finish_drive_upload(uuid, text) from public, anon, authenticated;
grant execute on function public.finish_drive_upload(uuid, text) to service_role;

-- Remove expired guest sessions and old rate-limit windows; safe to run periodically.
create or replace function public.cleanup_baptism_memories_v2(p_before timestamptz default now() - interval '30 days')
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sessions integer := 0;
  v_limits integer := 0;
begin
  if p_before is null then raise exception 'cleanup cutoff is required'; end if;
  delete from public.guest_sessions where expires_at < clock_timestamp();
  get diagnostics v_sessions = row_count;
  delete from public.guest_join_rate_limits where window_started_at < p_before;
  get diagnostics v_limits = row_count;
  return v_sessions + v_limits;
end;
$$;
revoke all on function public.cleanup_baptism_memories_v2(timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_baptism_memories_v2(timestamptz) to service_role;
