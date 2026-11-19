/** Local clocks and identifier-free tombstones shared by projection and server guards. */
export const YOUTUBE_CACHE_MS = 28 * 864e5;
export const YOUTUBE_REVOKE_MS = 24 * 3600e3;
export const YOUTUBE_LABEL = 'YouTube channel';
export const YOUTUBE_NO_RESEND = 'YouTube connection details were removed. This upload may already exist on YouTube; Radar will not upload this post again. Create a new post if you want another upload.';
export const YOUTUBE_APPROVAL = 'Reconnect YouTube and explicitly approve this draft again before publishing.';
export const YOUTUBE_HOLD = 'YouTube publishing is paused while Radar verifies the connection. Radar will retry automatically; your access was not classified as revoked.';
export function trustedClock(value: unknown, fallback: Date, now: number): number {
  if (value === undefined) value = fallback.getTime();
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now + 60_000 ? value : 0;
}
export function youtubeProfileStale(row: { createdAt: Date }, meta: { profileFetchedAt?: number; authorizationCheckedAt?: number } | undefined, now = Date.now()): boolean {
  return Math.min(trustedClock(meta?.profileFetchedAt, row.createdAt, now), trustedClock(meta?.authorizationCheckedAt, row.createdAt, now)) <= now - YOUTUBE_CACHE_MS;
}
export function youtubeReceiptStale(row: { createdAt: Date; postedAt: Date | null; claimedAt: Date | null; payload: any }, now = Date.now()): boolean {
  const clock = trustedClock(row.postedAt?.getTime() ?? row.payload?.processingStartedAt, row.claimedAt || row.createdAt, now);
  return !!row.payload?.youtubeRetention || clock <= now - YOUTUBE_CACHE_MS;
}
