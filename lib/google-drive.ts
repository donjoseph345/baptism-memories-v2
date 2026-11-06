import { supabaseAdmin } from '@/lib/supabase-admin';
import { decryptSecret } from '@/lib/security';

export type DriveAccountType = 'photos' | 'videos';
export type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  thumbnailLink?: string;
  thumbnailVersion?: string;
};

type CachedAccessToken = { value: string; expiresAt: number };
const accessTokenCache = new Map<DriveAccountType, CachedAccessToken>();
const thumbnailLinkCache = new Map<string, { value: string | null; expiresAt: number }>();
const THUMBNAIL_LINK_CACHE_MS = 15 * 60 * 1000;

export function clearDriveAccessTokenCache(type?: DriveAccountType) {
  if (type) accessTokenCache.delete(type);
  else accessTokenCache.clear();
}

function accountEmailEnv(type: DriveAccountType) {
  return type === 'photos' ? process.env.GOOGLE_PHOTOS_ALLOWED_EMAIL : process.env.GOOGLE_VIDEOS_ALLOWED_EMAIL;
}

export async function getDriveAccessToken(type: DriveAccountType): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('drive_connections')
    .select('google_email,refresh_token_encrypted')
    .eq('account_type', type)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`The ${type} Google Drive account is not connected yet.`);
  const expectedEmail = accountEmailEnv(type)?.trim().toLowerCase();
  if (expectedEmail && data.google_email.toLowerCase() !== expectedEmail) {
    throw new Error(`The connected ${type} account does not match the configured Google account.`);
  }
  const cached = accessTokenCache.get(type);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const refreshToken = decryptSecret(data.refresh_token_encrypted);
  const body = new URLSearchParams({
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google ${type} authorization needs to be reconnected${payload.error_description ? `: ${payload.error_description}` : '.'}`);
  }
  const expiresIn = Number(payload.expires_in || 3600);
  accessTokenCache.set(type, { value: payload.access_token, expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000 });
  return payload.access_token;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function driveJson<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
    cache: 'no-store',
  });
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body
      ? JSON.stringify((body as { error: unknown }).error)
      : `Google Drive returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body as T;
}

export async function ensureEventDriveFolder(event: { id: string; title: string; baby_name: string; event_date: string }, type: DriveAccountType) {
  const db = supabaseAdmin();
  const { data: existing, error: lookupError } = await db.from('drive_event_folders')
    .select('folder_id').eq('event_id', event.id).eq('account_type', type).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.folder_id) return existing.folder_id;

  const token = await getDriveAccessToken(type);
  const clean = `${event.baby_name} - ${event.title} - ${event.event_date}`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 150);
  const folder = await driveJson<DriveFile>(token, 'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: clean, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!folder.id) throw new Error('Google Drive did not return a folder ID.');
  const { error: insertError } = await db.from('drive_event_folders').insert({ event_id: event.id, account_type: type, folder_id: folder.id, folder_name: clean });
  if (insertError) {
    const { data: raced } = await db.from('drive_event_folders').select('folder_id').eq('event_id', event.id).eq('account_type', type).maybeSingle();
    if (raced?.folder_id) {
      if (raced.folder_id !== folder.id) await trashDriveFile(type, folder.id).catch(() => undefined);
      return raced.folder_id;
    }
    throw insertError;
  }
  return folder.id;
}

export async function startResumableDriveUpload(args: {
  type: DriveAccountType; folderId: string; fileName: string; mimeType: string; size: number;
}) {
  const token = await getDriveAccessToken(args.type);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,thumbnailLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': args.mimeType,
      'X-Upload-Content-Length': String(args.size),
    },
    body: JSON.stringify({ name: args.fileName, mimeType: args.mimeType, parents: [args.folderId] }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Could not start Google Drive upload (HTTP ${response.status}).`);
  const sessionUri = response.headers.get('location');
  if (!sessionUri || !sessionUri.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
    throw new Error('Google Drive did not return a valid resumable upload session.');
  }
  return sessionUri;
}

export async function uploadDriveChunk(args: {
  type: DriveAccountType; sessionUri: string; bytes: Buffer; start: number; total: number;
}) {
  const token = await getDriveAccessToken(args.type);
  const end = args.start + args.bytes.length - 1;
  const response = await fetch(args.sessionUri, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': String(args.bytes.length),
      'Content-Range': `bytes ${args.start}-${end}/${args.total}`,
    },
    body: new Uint8Array(args.bytes),
    cache: 'no-store',
  });
  if (response.status === 308) {
    const range = response.headers.get('range');
    const match = range?.match(/bytes=0-(\d+)/);
    return { done: false as const, nextOffset: match ? Number(match[1]) + 1 : 0 };
  }
  if (response.status === 200 || response.status === 201) {
    const file = await response.json() as DriveFile;
    if (!file.id) throw new Error('Google Drive upload completed without returning a file ID.');
    return { done: true as const, nextOffset: args.total, file };
  }
  const message = await response.text().catch(() => '');
  throw new Error(`Google Drive upload failed (HTTP ${response.status}). ${message.slice(0, 300)}`);
}

export async function getDriveUploadStatus(args: { type: DriveAccountType; sessionUri: string; total: number }) {
  const token = await getDriveAccessToken(args.type);
  const response = await fetch(args.sessionUri, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${args.total}`, 'Content-Length': '0' },
    cache: 'no-store',
  });
  if (response.status === 308) {
    const match = response.headers.get('range')?.match(/bytes=0-(\d+)/);
    return { done: false as const, nextOffset: match ? Number(match[1]) + 1 : 0 };
  }
  if (response.status === 200 || response.status === 201) {
    const file = await response.json() as DriveFile;
    if (!file.id) throw new Error('Google Drive upload status did not return file metadata.');
    return { done: true as const, nextOffset: args.total, file };
  }
  if (response.status === 404 || response.status === 410) throw new Error('The resumable upload session has expired. Please select the file and try again.');
  const message = await response.text().catch(() => '');
  throw new Error(`Could not resume Google Drive upload (HTTP ${response.status}). ${message.slice(0, 300)}`);
}

export async function getDriveThumbnailLink(type: DriveAccountType, fileId: string): Promise<string | null> {
  const cacheKey = `${type}:${fileId}`;
  const cached = thumbnailLinkCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const token = await getDriveAccessToken(type);
  const metadata = await driveJson<Pick<DriveFile, 'thumbnailLink'>>(
    token,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink`
  );
  const thumbnailLink = typeof metadata.thumbnailLink === 'string' ? metadata.thumbnailLink : null;
  if (thumbnailLinkCache.size >= 1000) {
    const oldestKey = thumbnailLinkCache.keys().next().value;
    if (oldestKey) thumbnailLinkCache.delete(oldestKey);
  }
  thumbnailLinkCache.set(cacheKey, {
    value: thumbnailLink,
    // A missing video thumbnail may become available after Drive finishes
    // processing the upload; retry missing entries much sooner.
    expiresAt: Date.now() + (thumbnailLink ? THUMBNAIL_LINK_CACHE_MS : 30_000),
  });
  return thumbnailLink;
}

function isAllowedGoogleThumbnailUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const allowedHost = hostname === 'drive.google.com' || hostname === 'googleusercontent.com' || hostname.endsWith('.googleusercontent.com');
    return url.protocol === 'https:' && allowedHost ? url : null;
  } catch {
    return null;
  }
}

export async function getDriveThumbnailResponse(type: DriveAccountType, fileId: string): Promise<Response | null> {
  const thumbnailLink = await getDriveThumbnailLink(type, fileId);
  if (!thumbnailLink) return null;
  const url = isAllowedGoogleThumbnailUrl(thumbnailLink);
  if (!url) throw new Error('Google Drive returned an unexpected thumbnail URL.');

  const accessToken = await getDriveAccessToken(type);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
    cache: 'no-store',
  });
  if (!response.ok) return null;
  if (response.url && !isAllowedGoogleThumbnailUrl(response.url)) return null;
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(contentType)) return null;

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}

export async function trashDriveFile(type: DriveAccountType, fileId: string) {
  const token = await getDriveAccessToken(type);
  await driveJson(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  });
}

export async function getDriveMediaResponse(type: DriveAccountType, fileId: string, range: string | null) {
  const token = await getDriveAccessToken(type);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) },
    cache: 'no-store',
  });
  if (!response.ok && response.status !== 206) {
    const message = await response.text().catch(() => '');
    throw new Error(`Google Drive media fetch failed (HTTP ${response.status}). ${message.slice(0, 200)}`);
  }
  return response;
}
