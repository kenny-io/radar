import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { LEFT_FLASH } from './deletion';
import { createLeave, isBusinessDeleted } from './leave';

const gone = () => new ApiError('Business wasn’t found.', 404, 'business_deleted');
function tab() {
  const flashes: string[] = []; const went: string[] = [];
  return { flashes, went, ...createLeave({ flash: m => flashes.push(m), go: u => went.push(u) }) };
}

describe('leaving a business that was deleted', () => {
  it('leaves on 404 business_deleted: one flash, then the dashboard', () => {
    const t = tab();
    expect(t.onError(gone())).toBe(true);
    expect(t.flashes).toEqual([LEFT_FLASH]);
    expect(t.went).toEqual(['/dashboard']);
    expect(LEFT_FLASH).toBe('That business was deleted.');
  });

  it('fires once when the workspace, the stream probe and a save all fail together', () => {
    const t = tab();
    expect(t.onError(gone())).toBe(true); // refresh()
    expect(t.onError(gone())).toBe(true); // the probe after a stream error: still "leaving", so the caller stays quiet
    expect(t.onError(gone())).toBe(true); // act()
    t.leave();
    expect(t.flashes).toHaveLength(1);
    expect(t.went).toHaveLength(1);
  });

  it('does nothing for any other error', () => {
    const others: unknown[] = [
      new ApiError('That wasn’t found.', 404, 'not_found'),            // an article or a pack that is gone
      new ApiError('That wasn’t found.', 404),                        // a 404 with no code
      new ApiError('Business wasn’t found.', 410, 'business_deleted'), // the code on another status
      new ApiError('Sign in to continue.', 401, 'unauthorized'),
      new ApiError('Subscription required.', 402, 'subscription_required'),
      new ApiError('This business can’t be restored. It may already be wiped.', 404, 'restore_not_found'),
      new Error('Failed to fetch'),
      { status: 404, code: 'business_deleted' },                       // looks like one, is not an ApiError
      null, undefined, 'business_deleted',
    ];
    const t = tab();
    for (const e of others) { expect(isBusinessDeleted(e)).toBe(false); expect(t.onError(e)).toBe(false); }
    expect(t.flashes).toEqual([]);
    expect(t.went).toEqual([]);
  });

  it('can leave again after the page comes back from the back/forward cache', () => {
    const t = tab();
    t.leave(); t.reset(); t.leave();
    expect(t.went).toEqual(['/dashboard', '/dashboard']);
  });
});
