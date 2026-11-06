

export interface Env {

  TOKEN_BROKER_URL: string;

  MEDIA_PROXY_SHARED_SECRET: string;

  MEDIA_PROXY_SIGNING_SECRET: string;

  ALLOWED_ORIGINS?: string;

}



type MediaClaims = {

  mediaId: string;

  eventId: string;

  accountType: 'photos' | 'videos';

  driveFileId: string;

  fileName: string;

  mimeType: string;

  access: 'guest' | 'admin';

  guestSessionHash?: string;

  download: boolean;

  thumbnail?: boolean;

  exp: number;

};



type UploadClaims = {

  purpose: 'drive-upload';

  uploadId: string;

  eventId: string;

  ownerSessionHash: string;

  totalBytes: number;

  exp: number;

};



type UploadBrokerResponse = {

  accessToken?: string;

  sessionUri?: string;

  accountType?: 'photos' | 'videos';

  totalBytes?: number;

  receivedBytes?: number;

  nextOffset?: number;

  done?: boolean;

  error?: string;

};



const MAX_CHUNK_BYTES = 70 * 1024 * 1024;

const GOOGLE_CHUNK_UNIT = 256 * 1024;



const UUID_PATTERN =

  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;



function decodeBase64Url(value: string): Uint8Array {

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');

  const binary = atob(

    normalized + '='.repeat((4 - normalized.length % 4) % 4)

  );



  return Uint8Array.from(

    binary,

    character => character.charCodeAt(0)

  );

}



async function verifySignedToken<T>(

  token: string,

  secret: string

): Promise<T | null> {

  const [encoded, supplied, extra] = token.split('.');



  if (!encoded || !supplied || extra) return null;



  try {

    const key = await crypto.subtle.importKey(

      'raw',

      new TextEncoder().encode(secret),

      { name: 'HMAC', hash: 'SHA-256' },

      false,

      ['verify']

    );



    const signature = decodeBase64Url(supplied);

    const signatureBuffer = new ArrayBuffer(signature.byteLength);

    new Uint8Array(signatureBuffer).set(signature);



    const valid = await crypto.subtle.verify(

      'HMAC',

      key,

      signatureBuffer,

      new TextEncoder().encode(encoded)

    );



    if (!valid) return null;



    return JSON.parse(

      new TextDecoder().decode(decodeBase64Url(encoded))

    ) as T;

  } catch {

    return null;

  }

}



async function verifyMediaToken(

  token: string,

  secret: string

): Promise<MediaClaims | null> {

  const claims = await verifySignedToken<MediaClaims>(token, secret);



  if (!claims) return null;



  if (

    !claims.mediaId ||

    !claims.eventId ||

    !claims.driveFileId ||

    !claims.fileName ||

    !claims.mimeType

  ) return null;



  if (

    claims.accountType !== 'photos' &&

    claims.accountType !== 'videos'

  ) return null;



  if (

    claims.access !== 'guest' &&

    claims.access !== 'admin'

  ) return null;



  if (

    claims.access === 'guest' &&

    !/^[a-f0-9]{64}$/i.test(claims.guestSessionHash || '')

  ) return null;

  if (claims.thumbnail !== undefined && typeof claims.thumbnail !== 'boolean') return null;

  if (

    !Number.isInteger(claims.exp) ||

    claims.exp <= Math.floor(Date.now() / 1000)

  ) return null;



  return claims;

}



async function verifyUploadToken(

  token: string,

  secret: string

): Promise<UploadClaims | null> {

  const claims = await verifySignedToken<UploadClaims>(token, secret);



  if (!claims) return null;



  if (

    claims.purpose !== 'drive-upload' ||

    typeof claims.uploadId !== 'string' ||

    !UUID_PATTERN.test(claims.uploadId) ||

    typeof claims.eventId !== 'string' ||

    !UUID_PATTERN.test(claims.eventId)

  ) return null;



  if (

    typeof claims.ownerSessionHash !== 'string' ||

    !/^[a-f0-9]{64}$/i.test(claims.ownerSessionHash)

  ) return null;



  if (

    !Number.isSafeInteger(claims.totalBytes) ||

    claims.totalBytes < 1

  ) return null;



  if (

    !Number.isInteger(claims.exp) ||

    claims.exp <= Math.floor(Date.now() / 1000)

  ) return null;



  return claims;

}



function safeFilename(value: string): string {
  return value.replace(/[\r\n"\\\u0000-\u001f]/g, '_').slice(0, 180);
}



function allowedOrigins(env: Env): string[] {

  const configured = (env.ALLOWED_ORIGINS || '')

    .split(',')

    .map(value => value.trim())

    .filter(Boolean);



  return configured.length

    ? configured

    : [

        'https://the-little-moments.vercel.app',

        'http://localhost:3000',

        'http://127.0.0.1:3000',

        'http://192.168.1.4:3000',

      ];

}



function corsHeaders(request: Request, env: Env): Headers {

  const headers = new Headers({

    Vary: 'Origin',

    'Cache-Control': 'private, no-store',

    'X-Content-Type-Options': 'nosniff',

  });



  const origin = request.headers.get('Origin');



  if (origin && allowedOrigins(env).includes(origin)) {

    headers.set('Access-Control-Allow-Origin', origin);

    headers.set('Access-Control-Allow-Methods', 'PUT, OPTIONS');

    headers.set(

      'Access-Control-Allow-Headers',

      'Authorization, Content-Type, Content-Range'

    );

    headers.set('Access-Control-Max-Age', '86400');

  }



  return headers;

}



function errorResponse(

  message: string,

  status: number,

  request?: Request,

  env?: Env

): Response {

  const headers = request && env

    ? corsHeaders(request, env)

    : new Headers();



  headers.set('Cache-Control', 'private, no-store');

  headers.set('Content-Type', 'text/plain; charset=utf-8');

  headers.set('X-Content-Type-Options', 'nosniff');



  return new Response(message, { status, headers });

}



function jsonUploadResponse(

  body: Record<string, unknown>,

  request: Request,

  env: Env,

  status = 200

): Response {

  const headers = corsHeaders(request, env);

  headers.set('Content-Type', 'application/json');



  return new Response(JSON.stringify(body), {

    status,

    headers,

  });

}



function uploadBrokerUrl(env: Env): string {

  const url = new URL(env.TOKEN_BROKER_URL);



  if (!url.pathname.endsWith('/token')) {

    throw new Error('The configured token broker URL is invalid.');

  }



  url.pathname =

    url.pathname.slice(0, -'/token'.length) + '/upload';



  return url.toString();

}



async function callUploadBroker(

  env: Env,

  token: string,

  action: 'authorize' | 'progress' | 'status' | 'complete',

  extra: { nextOffset?: number; driveFileId?: string } = {}

): Promise<{ response: Response; data: UploadBrokerResponse }> {

  const response = await fetch(uploadBrokerUrl(env), {

    method: 'POST',

    headers: {

      Authorization: `Bearer ${env.MEDIA_PROXY_SHARED_SECRET}`,

      'Content-Type': 'application/json',

      'Cache-Control': 'no-store',

    },

    body: JSON.stringify({

      action,

      token,

      ...extra,

    }),

  });



  // Response.json() is typed as unknown in the Worker runtime definitions.

  // Validate it as an object before using the broker response fields.

  const rawData: unknown = await response.json().catch(() => ({}));



  const data: UploadBrokerResponse =

    rawData !== null &&

    typeof rawData === 'object' &&

    !Array.isArray(rawData)

      ? rawData as UploadBrokerResponse

      : {};



  return { response, data };

}



// Ask Vercel to query Google Drive and reconcile Supabase.

async function getConfirmedUploadStatus(

  request: Request,

  env: Env,

  token: string

): Promise<Response> {

  const result = await callUploadBroker(env, token, 'status');



  if (!result.response.ok) {

    return errorResponse(

      result.data.error || 'Could not check the confirmed upload status.',

      result.response.status,

      request,

      env

    );

  }



  const nextOffset = Number(result.data.nextOffset);



  if (

    !Number.isSafeInteger(nextOffset) ||

    nextOffset < 0

  ) {

    return errorResponse(

      'The upload status response is invalid.',

      502,

      request,

      env

    );

  }



  return jsonUploadResponse(

    {

      done: Boolean(result.data.done),

      nextOffset,

    },

    request,

    env

  );

}



async function handleUpload(

  request: Request,

  env: Env

): Promise<Response> {

  const headers = corsHeaders(request, env);



  if (request.method === 'OPTIONS') {

    if (!headers.has('Access-Control-Allow-Origin')) {

      return new Response('Origin not allowed.', {

        status: 403,

        headers,

      });

    }



    return new Response(null, { status: 204, headers });

  }



  if (request.method !== 'PUT') {

    return errorResponse('Method not allowed.', 405, request, env);

  }



  if (!headers.has('Access-Control-Allow-Origin')) {

    return errorResponse('Origin not allowed.', 403, request, env);

  }



  const authorization = request.headers.get('Authorization') || '';

  const token = authorization.startsWith('Bearer ')

    ? authorization.slice(7)

    : '';



  if (!token) {

    return errorResponse('Upload token is required.', 401, request, env);

  }



  const claims = await verifyUploadToken(

    token,

    env.MEDIA_PROXY_SIGNING_SECRET

  );



  if (!claims) {

    return errorResponse(

      'Upload token is invalid or expired.',

      403,

      request,

      env

    );

  }



  const contentRange = request.headers.get('Content-Range') || '';

  const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);



  if (!match || !request.body) {

    return errorResponse('Invalid upload chunk.', 400, request, env);

  }



  const start = Number(match[1]);

  const end = Number(match[2]);

  const total = Number(match[3]);

  const expectedLength = end - start + 1;



  const incomingLengthHeader = request.headers.get('Content-Length');

  const incomingLength = incomingLengthHeader === null

    ? expectedLength

    : Number(incomingLengthHeader);



  if (

    !Number.isSafeInteger(start) ||

    !Number.isSafeInteger(end) ||

    !Number.isSafeInteger(total) ||

    !Number.isSafeInteger(expectedLength) ||

    !Number.isSafeInteger(incomingLength) ||

    start < 0 ||

    end < start ||

    total !== claims.totalBytes ||

    end >= total ||

    expectedLength < 1 ||

    expectedLength > MAX_CHUNK_BYTES ||

    incomingLength !== expectedLength ||

    (

      end + 1 < total &&

      expectedLength % GOOGLE_CHUNK_UNIT !== 0

    )

  ) {

    return errorResponse(

      'Upload chunk range is invalid.',

      400,

      request,

      env

    );

  }



  try {

    const authorizationResult = await callUploadBroker(

      env,

      token,

      'authorize'

    );



    if (!authorizationResult.response.ok) {

      return errorResponse(

        authorizationResult.data.error || 'Upload authorization failed.',

        authorizationResult.response.status,

        request,

        env

      );

    }



    const broker = authorizationResult.data;



    // The upload may already be completed.

    if (broker.done) {

      return jsonUploadResponse(

        {

          done: true,

          nextOffset: claims.totalBytes,

        },

        request,

        env

      );

    }



    if (

      !broker.accessToken ||

      !broker.sessionUri ||

      broker.totalBytes !== claims.totalBytes ||

      !Number.isSafeInteger(broker.receivedBytes)

    ) {

      return errorResponse(

        'Upload authorization response is invalid.',

        502,

        request,

        env

      );

    }



    // Reconcile stale database offsets with Google Drive.

    if (start !== broker.receivedBytes) {

      return getConfirmedUploadStatus(request, env, token);

    }



    // Stream the incoming chunk using an exact content length.

    const fixedBody = new FixedLengthStream(expectedLength);

    const pumpPromise = request.body.pipeTo(fixedBody.writable);



    const upstreamPromise = fetch(broker.sessionUri, {

      method: 'PUT',

      headers: {

        Authorization: `Bearer ${broker.accessToken}`,

        'Content-Length': String(expectedLength),

        'Content-Range': contentRange,

      },

      body: fixedBody.readable,

      redirect: 'manual',

    });



    const [upstream] = await Promise.all([

      upstreamPromise,

      pumpPromise,

    ]);



    if (upstream.status === 308) {

      const range = upstream.headers.get('Range');

      const rangeMatch = range?.match(/^bytes=0-(\d+)$/);



      // Reconcile with Google Drive if Range is absent.

      if (!rangeMatch) {

        return getConfirmedUploadStatus(request, env, token);

      }



      const nextOffset = Number(rangeMatch[1]) + 1;



      if (

        !Number.isSafeInteger(nextOffset) ||

        nextOffset < 0 ||

        nextOffset > total

      ) {

        return errorResponse(

          'Google Drive returned an invalid upload offset.',

          502,

          request,

          env

        );

      }



      if (nextOffset < start) {

        return getConfirmedUploadStatus(request, env, token);

      }



      const progressResult = await callUploadBroker(

        env,

        token,

        'progress',

        { nextOffset }

      );



      if (!progressResult.response.ok) {

        return getConfirmedUploadStatus(request, env, token);

      }



      return jsonUploadResponse(

        {

          done: false,

          nextOffset,

        },

        request,

        env

      );

    }



    if (upstream.status === 200 || upstream.status === 201) {

      const file = await upstream.json() as { id?: string };



      if (!file.id) {

        return errorResponse(

          'Google Drive did not return the uploaded file ID.',

          502,

          request,

          env

        );

      }



      const progressResult = await callUploadBroker(

        env,

        token,

        'progress',

        { nextOffset: total }

      );



      if (!progressResult.response.ok) {

        return getConfirmedUploadStatus(request, env, token);

      }



      const completeResult = await callUploadBroker(

        env,

        token,

        'complete',

        { driveFileId: file.id }

      );



      if (!completeResult.response.ok) {

        return getConfirmedUploadStatus(request, env, token);

      }



      return jsonUploadResponse(

        {

          done: true,

          nextOffset: total,

        },

        request,

        env

      );

    }



    const message = await upstream.text().catch(() => '');



    return errorResponse(

      `Google Drive upload failed (HTTP ${upstream.status}). ${message.slice(0, 250)}`,

      upstream.status >= 400 && upstream.status < 500 ? 502 : 503,

      request,

      env

    );

  } catch (error) {

    console.error(

      'Cloudflare upload failed:',

      error instanceof Error ? error.message : 'Unknown error'

    );



    return errorResponse(

      'Upload failed. Check the upload status and retry.',

      503,

      request,

      env

    );

  }

}



async function handleMedia(

  request: Request,

  env: Env

): Promise<Response> {

  if (request.method !== 'GET') {

    return errorResponse('Method not allowed.', 405);

  }



  const url = new URL(request.url);

  const token = url.searchParams.get('token');



  if (!token) {

    return errorResponse('Media token is required.', 401);

  }



  const claims = await verifyMediaToken(

    token,

    env.MEDIA_PROXY_SIGNING_SECRET

  );



  if (!claims) {

    return errorResponse('Media link is invalid or expired.', 403);

  }



  const brokerResponse = await fetch(env.TOKEN_BROKER_URL, {

    method: 'POST',

    headers: {

      Authorization: `Bearer ${env.MEDIA_PROXY_SHARED_SECRET}`,

      'Content-Type': 'application/json',

      'Cache-Control': 'no-store',

    },

    body: JSON.stringify({ token }),

  });



  if (!brokerResponse.ok) {

    return errorResponse(

      'Media access is no longer available.',

      brokerResponse.status === 401 ? 401 : 403

    );

  }



  const broker = await brokerResponse.json() as {

    accessToken?: string;

    mimeType?: string;

    fileName?: string;

    download?: boolean;

    thumbnailLink?: string | null;

  };



  if (!broker.accessToken) {

    return errorResponse('Media authorization failed.', 502);

  }

  // Thumbnail requests use a short-lived Google Drive thumbnail URL supplied
  // only by the authenticated token broker. The URL is never sent to the guest.
  if (claims.thumbnail) {
    if (!broker.thumbnailLink) {
      return errorResponse('A preview thumbnail is not available for this file.', 404);
    }

    let thumbnailUrl: URL;
    try {
      thumbnailUrl = new URL(broker.thumbnailLink);
    } catch {
      return errorResponse('Google Drive returned an invalid thumbnail URL.', 502);
    }

    const thumbnailHost = thumbnailUrl.hostname.toLowerCase();
    const allowedThumbnailHost =
      thumbnailUrl.protocol === 'https:' &&
      (thumbnailHost === 'drive.google.com' ||
        thumbnailHost === 'googleusercontent.com' ||
        thumbnailHost.endsWith('.googleusercontent.com'));

    if (!allowedThumbnailHost) {
      return errorResponse('Google Drive returned an unsupported thumbnail URL.', 502);
    }

    const thumbnailResponse = await fetch(thumbnailUrl, {
      headers: { Authorization: `Bearer ${broker.accessToken}` },
      redirect: 'follow',
    });

    if (!thumbnailResponse.ok) {
      return errorResponse('Google Drive could not deliver this thumbnail.', 404);
    }

    const finalThumbnailHost = new URL(thumbnailResponse.url || thumbnailUrl.toString()).hostname.toLowerCase();
    const finalThumbnailAllowed =
      finalThumbnailHost === 'drive.google.com' ||
      finalThumbnailHost === 'googleusercontent.com' ||
      finalThumbnailHost.endsWith('.googleusercontent.com');
    if (!finalThumbnailAllowed) {
      return errorResponse('Google Drive redirected to an unsupported thumbnail host.', 502);
    }

    const thumbnailContentType = thumbnailResponse.headers.get('content-type') || 'image/jpeg';
    if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(thumbnailContentType)) {
      return errorResponse('Google Drive returned an unsupported thumbnail format.', 502);
    }

    const thumbnailHeaders = new Headers({
      'Content-Type': thumbnailContentType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    const thumbnailLength = thumbnailResponse.headers.get('content-length');
    if (thumbnailLength) thumbnailHeaders.set('Content-Length', thumbnailLength);

    return new Response(thumbnailResponse.body, {
      status: 200,
      headers: thumbnailHeaders,
    });
  }

  const driveUrl = new URL(

    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(claims.driveFileId)}`

  );



  driveUrl.searchParams.set('alt', 'media');



  const range = request.headers.get('range');



  const upstream = await fetch(driveUrl, {

    headers: {

      Authorization: `Bearer ${broker.accessToken}`,

      ...(range && /^bytes=\d*-\d*$/.test(range)

        ? { Range: range }

        : {}),

    },

    redirect: 'follow',

  });



  if (!upstream.ok && upstream.status !== 206) {

    return errorResponse(

      'Google Drive could not deliver this file.',

      upstream.status === 404 ? 404 : 502

    );

  }



  const fileName = safeFilename(broker.fileName || claims.fileName);



  const responseHeaders = new Headers({

    'Content-Type': broker.mimeType || claims.mimeType || 'application/octet-stream',

    'Cache-Control': 'private, no-store',

    'Accept-Ranges': 'bytes',

    'X-Content-Type-Options': 'nosniff',

    'Content-Disposition': `${

      broker.download ? 'attachment' : 'inline'

    }; filename*=UTF-8''${encodeURIComponent(fileName)}`,

  });



  for (const name of [

    'content-length',

    'content-range',

    'last-modified',

    'etag',

  ]) {

    const value = upstream.headers.get(name);

    if (value) responseHeaders.set(name, value);

  }



  return new Response(upstream.body, {

    status: upstream.status,

    headers: responseHeaders,

  });

}



export default {

  async fetch(request: Request, env: Env): Promise<Response> {

    const url = new URL(request.url);



    if (url.pathname === '/media') {

      return handleMedia(request, env);

    }



    if (url.pathname === '/upload') {

      return handleUpload(request, env);

    }



    return errorResponse('Not found.', 404);

  },

};
