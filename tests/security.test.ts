import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSessionToken,
  encryptSecret,
  decryptSecret,
  guestCookieName,
  hashAccessCode,
  randomCode,
  randomSlugPart,
  verifyAccessCode,
} from '@/lib/security';
import { createMediaProxyToken, verifyMediaProxyToken } from '@/lib/media-proxy';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
  process.env.MEDIA_PROXY_SIGNING_SECRET = 'test-only-media-proxy-signing-secret-which-is-long-enough';
  process.env.MEDIA_PROXY_TOKEN_TTL_SECONDS = '300';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('guest access helpers', () => {
  it('generates an eight-character code from the safe alphabet', () => {
    expect(randomCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('hashes and verifies an event access code', async () => {
    const { salt, hash } = await hashAccessCode('ABCD2389');
    await expect(verifyAccessCode('ABCD2389', salt, hash)).resolves.toBe(true);
    await expect(verifyAccessCode('ABCD2388', salt, hash)).resolves.toBe(false);
  });

  it('creates a high-entropy guest session token and event-specific cookie name', () => {
    const token = createSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(guestCookieName('noah-2026')).toBe('bm_guest_noah-2026');
    expect(() => guestCookieName('Bad Slug')).toThrow();
  });

  it('normalizes event slug text', () => {
    expect(randomSlugPart('Noah Joseph!')).toBe('noah-joseph');
  });
});

describe('secret encryption', () => {
  it('round-trips a refresh token without storing it as plain text', () => {
    const refreshToken = 'refresh-token-for-a-test-only';
    const encrypted = encryptSecret(refreshToken);
    expect(encrypted).not.toContain(refreshToken);
    expect(decryptSecret(encrypted)).toBe(refreshToken);
  });

  it('rejects modified encrypted data', () => {
    const encrypted = encryptSecret('secret-value');
    const modified = `${encrypted.slice(0, -2)}AA`;
    expect(() => decryptSecret(modified)).toThrow();
  });
});

describe('private media proxy links', () => {
  it('signs and verifies a guest-scoped file token', () => {
    const token = createMediaProxyToken({
      mediaId: 'media-1', eventId: 'event-1', accountType: 'photos', driveFileId: 'drive-file-1',
      fileName: 'family.jpg', mimeType: 'image/jpeg', access: 'guest', guestSessionHash: 'a'.repeat(64), download: false,
    });
    expect(verifyMediaProxyToken(token)).toMatchObject({ mediaId: 'media-1', accountType: 'photos', access: 'guest' });
  });

  it('rejects a tampered or incomplete proxy token', () => {
    const token = createMediaProxyToken({
      mediaId: 'media-1', eventId: 'event-1', accountType: 'videos', driveFileId: 'drive-file-2',
      fileName: 'clip.mp4', mimeType: 'video/mp4', access: 'admin', download: true,
    });
    expect(verifyMediaProxyToken(`${token.slice(0, -1)}x`)).toBeNull();
    expect(verifyMediaProxyToken('')).toBeNull();
  });
});
