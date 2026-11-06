
import { NextRequest } from 'next/server';
import { constantTimeSecretMatches } from '@/lib/media-proxy';
import { verifyUploadProxyToken } from '@/lib/upload-proxy';
import { decryptSecret } from '@/lib/security';
import { jsonNoStore, readJsonLimited } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  getDriveAccessToken,
  getDriveUploadStatus,
} from '@/lib/google-drive';

export const runtime = 'nodejs';

type BrokerBody = {
  action?: 'authorize' | 'progress' | 'status' | 'complete';
  token?: string;
  nextOffset?: number;
  driveFileId?: string;
};

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const providedSecret = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!constantTimeSecretMatches(
    providedSecret,
    process.env.MEDIA_PROXY_SHARED_SECRET
  )) {
    return jsonNoStore({ error: 'Not authorized.' }, 401);
  }

  try {
    const body = await readJsonLimited<BrokerBody>(request, 12_000);

    if (
      typeof body.token !== 'string' ||
      !['authorize', 'progress', 'status', 'complete'].includes(body.action || '')
    ) {
      return jsonNoStore({ error: 'Invalid upload broker request.' }, 400);
    }

    const claims = verifyUploadProxyToken(body.token);

    if (!claims) {
      return jsonNoStore({
        error: 'Upload authorization is invalid or expired.',
      }, 403);
    }

    const db = supabaseAdmin();

    const { data: upload, error: uploadError } = await db
      .from('drive_upload_sessions')
      .select(`
        id,
        event_id,
        media_id,
        account_type,
        upload_session_uri_encrypted,
        owner_session_hash,
        total_bytes,
        received_bytes,
        upload_status,
        expires_at
      `)
      .eq('id', claims.uploadId)
      .eq('event_id', claims.eventId)
      .maybeSingle();

    if (uploadError) throw uploadError;

    if (!upload) {
      return jsonNoStore({ error: 'Upload session not found.' }, 404);
    }

    if (
      upload.owner_session_hash !== claims.ownerSessionHash ||
      Number(upload.total_bytes) !== claims.totalBytes
    ) {
      return jsonNoStore({
        error: 'Upload authorization does not match the session.',
      }, 403);
    }

    if (upload.upload_status === 'completed') {
      return jsonNoStore({
        done: true,
        nextOffset: Number(upload.total_bytes),
      });
    }

    if (
      upload.upload_status !== 'active' ||
      new Date(upload.expires_at).getTime() <= Date.now()
    ) {
      return jsonNoStore({ error: 'Upload session has expired.' }, 410);
    }

    // Existing uploads may finish even if the event is subsequently closed.
    // The guest session and upload session must remain valid.
    const { data: guestSession, error: guestError } = await db
      .from('guest_sessions')
      .select('id')
      .eq('event_id', upload.event_id)
      .eq('session_hash', upload.owner_session_hash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (guestError) throw guestError;

    if (!guestSession) {
      return jsonNoStore({ error: 'Guest session has expired.' }, 401);
    }

    const totalBytes = Number(upload.total_bytes);
    const sessionUri = decryptSecret(
      upload.upload_session_uri_encrypted
    );

    // Query Google Drive for the actual confirmed upload offset.
    if (body.action === 'status') {
      let result;

      try {
        result = await getDriveUploadStatus({
          type: upload.account_type,
          sessionUri,
          total: totalBytes,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('session has expired')
        ) {
          return jsonNoStore({ error: error.message }, 410);
        }

        throw error;
      }

      if (result.done) {
        const { data: finished, error: finishError } = await db.rpc(
          'finish_drive_upload',
          {
            p_upload_session_id: upload.id,
            p_drive_file_id: result.file.id,
          }
        );

        if (finishError) throw finishError;

        if (!finished) {
          return jsonNoStore({
            error: 'Could not finalize the completed upload.',
          }, 409);
        }

        return jsonNoStore({
          done: true,
          nextOffset: totalBytes,
        });
      }

      const nextOffset = result.nextOffset;

      if (
        !Number.isSafeInteger(nextOffset) ||
        nextOffset < 0 ||
        nextOffset > totalBytes
      ) {
        return jsonNoStore({
          error: 'Google Drive returned an invalid upload offset.',
        }, 502);
      }

      const currentOffset = Number(upload.received_bytes);

      const { data: updated, error: updateError } = await db
        .from('drive_upload_sessions')
        .update({
          received_bytes: nextOffset,
          updated_at: new Date().toISOString(),
        })
        .eq('id', upload.id)
        .eq('received_bytes', currentOffset)
        .eq('upload_status', 'active')
        .select('id')
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated) {
        return jsonNoStore({
          error: 'Upload progress changed during status reconciliation. Check status again.',
          nextOffset: currentOffset,
        }, 409);
      }

      return jsonNoStore({
        done: false,
        nextOffset,
      });
    }

    if (body.action === 'authorize') {
      const { data: media, error: mediaError } = await db
        .from('media')
        .select('id,event_id,account_type,upload_status')
        .eq('id', upload.media_id)
        .maybeSingle();

      if (mediaError) throw mediaError;

      if (
        !media ||
        media.event_id !== upload.event_id ||
        media.account_type !== upload.account_type ||
        media.upload_status !== 'uploading'
      ) {
        return jsonNoStore({
          error: 'Media upload record is unavailable.',
        }, 404);
      }

      const accessToken = await getDriveAccessToken(
        upload.account_type
      );

      return jsonNoStore({
        accessToken,
        sessionUri,
        accountType: upload.account_type,
        totalBytes,
        receivedBytes: Number(upload.received_bytes),
      });
    }

    if (body.action === 'progress') {
      const nextOffset = Number(body.nextOffset);
      const currentOffset = Number(upload.received_bytes);

      if (
        !Number.isSafeInteger(nextOffset) ||
        nextOffset < currentOffset ||
        nextOffset > totalBytes
      ) {
        return jsonNoStore({
          error: 'Invalid upload progress offset.',
        }, 400);
      }

      const { data: updated, error: updateError } = await db
        .from('drive_upload_sessions')
        .update({
          received_bytes: nextOffset,
          updated_at: new Date().toISOString(),
        })
        .eq('id', upload.id)
        .eq('received_bytes', currentOffset)
        .eq('upload_status', 'active')
        .select('id')
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated) {
        return jsonNoStore({
          error: 'Upload offset changed. Check the confirmed upload status.',
          nextOffset: currentOffset,
        }, 409);
      }

      return jsonNoStore({
        done: false,
        nextOffset,
      });
    }

    if (body.action === 'complete') {
      if (
        typeof body.driveFileId !== 'string' ||
        !body.driveFileId.trim() ||
        Number(upload.received_bytes) !== totalBytes
      ) {
        return jsonNoStore({
          error: 'Upload completion details are invalid.',
        }, 400);
      }

      const { data: finished, error: finishError } = await db.rpc(
        'finish_drive_upload',
        {
          p_upload_session_id: upload.id,
          p_drive_file_id: body.driveFileId,
        }
      );

      if (finishError) throw finishError;

      if (!finished) {
        return jsonNoStore({
          error: 'Could not finalize the upload.',
        }, 409);
      }

      return jsonNoStore({
        done: true,
        nextOffset: totalBytes,
      });
    }

    return jsonNoStore({
      error: 'Unsupported broker action.',
    }, 400);
  } catch (error) {
    console.error(
      'Upload broker request failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );

    return jsonNoStore({
      error: 'Could not authorize or update the upload.',
    }, 503);
  }
}
