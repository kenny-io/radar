import type { GscState } from './types';

/** Classify persisted diagnostics without showing provider details to users. */
export function isGscReconnectNeeded(g: Pick<GscState, 'status' | 'error'>): boolean {
  if (g.status !== 'error' || !g.error) return false;
  return /\binvalid_grant\b/i.test(g.error)
    || /^(?:not authorized|no refresh token)$/i.test(g.error.trim())
    || /^Search Console HTTP 401\b/i.test(g.error);
}
