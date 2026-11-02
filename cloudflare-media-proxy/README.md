# Private media streaming Worker

This Cloudflare Worker streams original image/video bytes from Google Drive. It is a media relay only; Vercel remains the main Next.js application host, and Supabase remains the database.

## Why this Worker exists

Vercel Functions have a 4.5 MB maximum request/response body size. The app uploads through 4 MiB chunks, but large media responses must not pass back through a Vercel Function. This Worker streams directly from the Google Drive API and supports HTTP Range requests for video seeking.

## Configure

1. Edit `wrangler.toml` and point `TOKEN_BROKER_URL` at the deployed Vercel endpoint:
   `https://YOUR-VERCEL-DOMAIN/api/internal/media-proxy/token`
2. From this directory run:

```powershell
npx wrangler@latest login
npx wrangler@latest secret put MEDIA_PROXY_SIGNING_SECRET
npx wrangler@latest secret put MEDIA_PROXY_SHARED_SECRET
npx wrangler@latest deploy
```

Use exactly the same values as the Vercel environment variables. Do not store secrets in this folder or `wrangler.toml`.

3. Copy the deployed Worker URL and append `/media`.
4. Set `MEDIA_PROXY_BASE_URL` on Vercel to that exact URL, then redeploy Vercel.

The Worker verifies a signed media token and asks Vercel's token broker to validate the live database media record and guest session before it obtains a Drive access token. Guest access is limited to approved media in the matching event. Media remains private in Google Drive.
