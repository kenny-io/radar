import { describe, expect, it } from 'vitest';
import { isGscReconnectNeeded } from './gsc';
import type { GscStatus } from './types';

describe('Search Console authorization recovery', () => {
  it.each(['token refresh failed: invalid_grant', 'not authorized', 'no refresh token', 'Search Console HTTP 401 authError: Invalid Credentials', 'Search Console HTTP 401 UNAUTHENTICATED: Credentials required'])('requests reconnection for %s', error => {
    expect(isGscReconnectNeeded({ status: 'error', error })).toBe(true);
  });
  it.each(['Search Console HTTP 403 rateLimitExceeded: Too many requests', 'Search Console HTTP 403 forbidden: No permission', 'token refresh failed: invalid_client', 'Search Console HTTP 500 backendError: Unavailable', 'network: fetch failed', 'database connection refused', '', null])('keeps ordinary retry for %s', error => {
    expect(isGscReconnectNeeded({ status: 'error', error })).toBe(false);
  });
  it.each<GscStatus>(['none', 'skipped', 'syncing', 'connected'])('ignores old diagnostics when %s', status => {
    expect(isGscReconnectNeeded({ status, error: 'token refresh failed: invalid_grant' })).toBe(false);
  });
});
