# Baptism Memories V2

A private, mobile-friendly family photo and video album for baptism events. The interface reuses the warm cream, muted-gold and serif styling from the original **little moments** website.

## What is included

- Next.js 15 App Router, React and TypeScript application.
- Supabase PostgreSQL for events, guest sessions, media metadata, OAuth connections and upload-session state.
- Supabase Auth for one administrator email.
- Event-specific guest access codes. Guests do not create accounts.
- Separate Google Drive OAuth connections: one Google account for photos and another for videos.
- Original files are uploaded without resizing, recompression or transcoding.
- Resumable Drive uploads using 4 MiB chunks, with retry/status checks.
- Event-scoped Google Drive folders, created automatically in the relevant account.
- Manual media moderation: pending, approved and hidden.
- Private guest gallery, original downloads, photo viewer and video playback.
- QR code and guest link for each event.
- A small Cloudflare Worker that streams private original media from Drive. This is necessary because Vercel Functions cap request and response bodies at 4.5 MB; Vercel handles the application and metadata, while the Worker streams the large media response.
- Automated unit tests for access-code hashing, guest tokens, token encryption and media-proxy signatures.

## Accounts and configuration selected for this project

| Purpose | Configuration |
|---|---|
| Supabase project | `baptism-memories-new` |
| Supabase URL | `https://oeqvwqvfygkekghuthjq.supabase.co` |
| Administrator | `donjoseph3000@gmail.com` |
| Photo Drive account | `photosbaptism287@gmail.com` |
| Video Drive account | `videobaptism772@gmail.com` |
| Web hosting | Vercel |
| Upload approval | Manual |

No Supabase secret key, Google OAuth client secret, refresh token, or local `.env.local` file is included in this source package.

## Requirements

- Node.js 20.9 or later (Node 22 LTS is recommended).
- npm.
- Supabase project access.
- Google Cloud project with the Drive API enabled and a Web OAuth client.
- Vercel account.
- Cloudflare account for the private media-streaming Worker.
- GitHub account (optional but recommended for Vercel deployment).

Docker and Ubuntu are not needed for normal local development.

---

# 1. Supabase setup

Use the existing `baptism-memories-new` project. Before running SQL, open the Supabase SQL Editor and check whether the new schema already exists:

```sql
select
  to_regclass('public.events') as events_table,
  to_regclass('public.guest_sessions') as guest_sessions_table,
  to_regclass('public.media') as media_table,
  to_regclass('public.drive_connections') as drive_connections_table;
```

For a fresh V2 database, all four values should be `NULL`. If any value is not `NULL`, stop and inspect the current database first. Do not run this baseline migration over an existing schema.

If the check is clean, run this one file in Supabase SQL Editor:

```text
supabase/migrations/0001_v2_schema.sql
```

This is a new, simplified V2 baseline. Do not run the old V1 `0001`, `0002` or `0003` migration files with this project.

After the migration, verify the tables exist:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'events', 'guest_sessions', 'guest_join_rate_limits',
    'drive_connections', 'drive_event_folders', 'media', 'drive_upload_sessions'
  )
order by table_name;
```

All seven tables should be listed.

## Create the administrator Auth user

1. In Supabase, open **Authentication → Users**.
2. Add a user with `donjoseph3000@gmail.com`.
3. Set a strong password and mark/confirm the email as confirmed if the Dashboard offers that option.
4. Disable public sign-ups in the Auth settings if they are not required for your project.
5. Use that email and password at `/admin/login`.

The app checks the signed-in user's email against `ADMIN_EMAIL`; other authenticated users are denied access to the dashboard and admin APIs.

---

# 2. Local environment setup

From the extracted project directory:

```powershell
Copy-Item .env.example .env.local
npm ci
```

Open `.env.local` and fill in these values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://oeqvwqvfygkekghuthjq.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
ADMIN_EMAIL=donjoseph3000@gmail.com
NEXT_PUBLIC_SITE_URL=http://localhost:3000

GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/oauth/callback
GOOGLE_PHOTOS_ALLOWED_EMAIL=photosbaptism287@gmail.com
GOOGLE_VIDEOS_ALLOWED_EMAIL=videobaptism772@gmail.com

GOOGLE_TOKEN_ENCRYPTION_KEY=YOUR_RANDOM_32_BYTE_BASE64_KEY
GOOGLE_OAUTH_STATE_SECRET=YOUR_RANDOM_LONG_SECRET
RATE_LIMIT_HASH_SECRET=YOUR_DIFFERENT_RANDOM_LONG_SECRET

MEDIA_PROXY_BASE_URL=
MEDIA_PROXY_SIGNING_SECRET=YOUR_RANDOM_LONG_SECRET
MEDIA_PROXY_SHARED_SECRET=YOUR_DIFFERENT_RANDOM_LONG_SECRET
MEDIA_PROXY_TOKEN_TTL_SECONDS=43200

GUEST_JOIN_MAX_ATTEMPTS=12
MAX_PHOTO_UPLOAD_BYTES=104857600
MAX_VIDEO_UPLOAD_BYTES=1073741824
```

`SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, encryption keys and proxy secrets are server-only. Never prefix them with `NEXT_PUBLIC_`, commit them, paste them into chat, or place them in browser code.

Generate each random value separately in PowerShell. For the 32-byte encryption key:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

For each other secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use a different generated value for every variable. The `MEDIA_PROXY_SIGNING_SECRET` and `MEDIA_PROXY_SHARED_SECRET` must also be copied to Cloudflare as Worker secrets in the next section.

Start the local app:

```powershell
npm run dev
```

Open `http://localhost:3000`.

The guest pages, access-code flow, event management and uploads can be exercised locally once Supabase and both Drive accounts are configured. For large original-file playback, deploy and configure the Cloudflare Worker; without it, the local app uses a development-only Vercel-free proxy fallback.

---

# 3. Google Cloud and the two Drive accounts

Use the Google Cloud project and Web OAuth client that you already created.

## Google Cloud configuration

- Enable **Google Drive API**.
- Application type: **Web application**.
- Authorized JavaScript origin for local work: `http://localhost:3000`.
- Local authorized redirect URI: `http://localhost:3000/api/google/oauth/callback`.
- Add both configured Gmail accounts under **Google Auth Platform → Audience → Test users**.
- Keep the scopes limited to:
  - `openid`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/drive.file`

One OAuth client is used for both Google identities. Each identity is authorized independently from the admin Storage Settings screen. The refresh token for each account is encrypted and stored separately in Supabase.

Do not upload the OAuth JSON file to GitHub or include it in this ZIP. Copy the Client ID and Client Secret into the local environment file.

## Important Google OAuth testing-mode expiry

When an external OAuth app remains in **Testing** mode and requests Drive scopes, Google issues refresh tokens that expire after seven days. Connect/reconnect both Drive accounts shortly before the event, or complete Google's publishing/verification requirements before relying on longer-term authorization. The application reports a reconnection requirement if Google rejects a refresh token.

## Connect accounts

1. Sign in to `/admin/login`.
2. Open **Storage settings**.
3. Click **Connect Photo Drive** and sign in as `photosbaptism287@gmail.com`.
4. Return to Storage settings.
5. Click **Connect Video Drive** and sign in as `videobaptism772@gmail.com`.
6. Confirm both cards show the expected account email.

A separate event folder is created automatically in the relevant account on first upload. Photos go only to the photo account; videos go only to the video account.

---

# 4. Cloudflare private media-streaming Worker

This Worker streams the private Google Drive file response directly to the browser. It does not store media files. It asks the Vercel server to validate a signed, file-specific token and obtain a short-lived Google access token; the Worker then streams the Drive response, including byte-range requests used by video playback.

The Vercel Function does not return the large media body. This avoids Vercel's 4.5 MB Function request/response body limit.

## Deploy

1. Sign in to Cloudflare and create/select an account.
2. Open `cloudflare-media-proxy/wrangler.toml`.
3. Replace `https://YOUR-VERCEL-DOMAIN/api/internal/media-proxy/token` with your deployed Vercel domain, for example `https://your-project.vercel.app/api/internal/media-proxy/token`.
4. Open PowerShell in `cloudflare-media-proxy`.
5. Install/authenticate Wrangler and deploy:

```powershell
npx wrangler@latest login
npx wrangler@latest secret put MEDIA_PROXY_SIGNING_SECRET
npx wrangler@latest secret put MEDIA_PROXY_SHARED_SECRET
npx wrangler@latest deploy
```

For each `secret put` command, paste the exact corresponding value from Vercel's environment configuration when prompted. Never put either secret in `wrangler.toml` or source control.

6. After deployment, Cloudflare prints a Worker URL similar to:

```text
https://baptism-memories-media.YOUR-SUBDOMAIN.workers.dev
```

Set the Vercel environment variable `MEDIA_PROXY_BASE_URL` to:

```text
https://baptism-memories-media.YOUR-SUBDOMAIN.workers.dev/media
```

7. Redeploy the Vercel app after setting the environment variable.

The Worker does not make Drive files public. Its URLs contain time-limited signed tokens restricted to one media record; the token broker also checks that the guest session remains valid and that the media is still approved.

---

# 5. Vercel deployment

1. Push this project to a **new GitHub repository**. Do not push your old V1 repository or its `.env.local` file.
2. In Vercel, choose **Add New → Project** and import the new repository.
3. Use the Next.js framework preset and the default build command (`npm run build`).
4. Add every environment variable from `.env.example` to Vercel Project Settings → Environment Variables. Use the real secret values from your local secure store.
5. Deploy the app once to get its Vercel domain.
6. Add the production callback URI in Google Cloud OAuth client:

```text
https://YOUR-VERCEL-DOMAIN/api/google/oauth/callback
```

7. Set these Vercel variables to production values:

```env
NEXT_PUBLIC_SITE_URL=https://YOUR-VERCEL-DOMAIN
GOOGLE_REDIRECT_URI=https://YOUR-VERCEL-DOMAIN/api/google/oauth/callback
```

8. Deploy the Cloudflare Worker using the Vercel broker URL, set `MEDIA_PROXY_BASE_URL` in Vercel, and redeploy Vercel.
9. Connect both Drive accounts from the admin dashboard and verify that the account emails match.
10. Test a small photo, a large photo, a short video, video seeking/range playback, original download, moderation, guest logout, and a guest session after event access is closed.

For Vercel Preview deployments, configure matching Preview URLs and OAuth redirect URIs if you intend to test OAuth there. The local development callback is already included in the Google OAuth client setup described above.

---

# 6. Run the checks

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

The source package includes unit tests. In the generation environment, the npm registry was unreachable, so a full dependency install did not complete. TypeScript source files were syntax-transpiled (43 files; zero syntax diagnostics), but a full TypeScript typecheck, ESLint run, Vitest run, and Next.js production build have **not** been verified here. Run all four commands locally after `npm ci` and fix any reported issues before deploying. The SQL migration and Google/Cloudflare integrations also require a real staging run with your Supabase project and the two Google test accounts.

## Suggested end-to-end test

1. Log in as `donjoseph3000@gmail.com`.
2. Create a test event with a future or current date.
3. Save the one-time guest access code and QR code.
4. Connect photo and video Drive accounts.
5. Open `/e/<slug>` in a private browser window and join using the access code.
6. Upload a JPEG and an MP4/MOV file.
7. Confirm the JPEG appears in the photo Drive account and the video in the video Drive account.
8. Confirm both media items are pending and do not appear in the guest gallery.
9. Approve each item from the admin event page.
10. Confirm the guest gallery shows the photo and can play/seek the video.
11. Download originals and compare file sizes/hashes with the selected local files.
12. Hide one item and verify guest access is removed; close guest access and verify existing guests can still view but cannot upload or start new sessions.

---

# 7. Operational notes and limits

- Photos default to a 100 MiB per-file application limit.
- Videos default to a 1 GiB per-file application limit.
- Both are configurable with environment variables. Google Drive account storage/quota still applies.
- Files are not compressed or transcoded. The exact original bytes are uploaded.
- Resumable Drive sessions expire after about one week; unfinished sessions should be resumed before then.
- Guest cookies are event-specific and last 30 days unless the session is deleted/expired.
- Closing guest access blocks new joins and uploads; existing valid guests may continue viewing approved media.
- Disconnecting a Drive account leaves files in Drive but the website cannot display or download that account's media until it is reconnected.
- Deleting an event attempts to move its media and event folders to Drive trash before deleting database rows. If Drive is disconnected, reconnect it and retry rather than assuming the files were removed.
- The database cleanup function is service-role-only and may be invoked manually or by a future scheduled task. No scheduled cleanup is enabled by default.
- A Google OAuth refresh token can be revoked or expire. The app surfaces a reconnection error rather than exposing the token.

## Project safety

- `.env.local`, `.env.*` files (except `.env.example`), `.git`, `node_modules` and `.next` must not be committed or uploaded.
- Do not copy the old V1 migration files into this V2 migration folder.
- Keep the photo and video Google accounts separate; do not connect one identity to both account slots unless you intentionally change the storage design.
- Create a backup/export of Supabase metadata and ensure both Google accounts have enough free Drive space before an event.
