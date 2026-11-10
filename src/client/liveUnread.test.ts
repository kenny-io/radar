// RL-4: the bell's unread number between workspace refetches is the server's count plus one per toast event, once per id.
import { describe, expect, it } from 'vitest';
import { LiveUnread } from './liveUnread';

describe('LiveUnread', () => {
  it('counts one per toast id and tells its subscribers', () => {
    const u = new LiveUnread(); let calls = 0; const off = u.subscribe(() => { calls++; });
    u.add('biz', 'n1'); u.add('biz', 'n2');
    expect(u.count('biz')).toBe(2); expect(calls).toBe(2);
    off(); u.add('biz', 'n3'); expect(calls).toBe(2); expect(u.count('biz')).toBe(3);
  });
  it('the same event again is not counted twice', () => {
    const u = new LiveUnread(); let calls = 0; u.subscribe(() => { calls++; });
    u.add('biz', 'n1'); u.add('biz', 'n1');
    expect(u.count('biz')).toBe(1); expect(calls).toBe(1);
  });
  it('a workspace from the server (or reading the list) replaces the number: back to zero', () => {
    const u = new LiveUnread(); u.add('biz', 'n1'); u.add('biz', 'n2');
    let calls = 0; u.subscribe(() => { calls++; });
    u.settle('biz'); expect(u.count('biz')).toBe(0); expect(calls).toBe(1);
    u.settle('biz'); expect(calls).toBe(1); // nothing to settle, nobody is told
    // An event that was already counted before the workspace arrived does not come back afterwards...
    u.add('biz', 'n2'); expect(u.count('biz')).toBe(0);
    // ...and a new one counts from zero.
    u.add('biz', 'n3'); expect(u.count('biz')).toBe(1);
  });
  it('keeps businesses apart', () => {
    const u = new LiveUnread(); u.add('a', 'n1'); u.add('b', 'n1'); u.add('b', 'n2');
    expect(u.count('a')).toBe(1); expect(u.count('b')).toBe(2);
    u.settle('a'); expect(u.count('a')).toBe(0); expect(u.count('b')).toBe(2);
  });
  it('ignores an event without an id or without a business', () => {
    const u = new LiveUnread(); u.add('biz', undefined); u.add('biz', ''); u.add('biz', 7); u.add(null, 'n1');
    expect(u.count('biz')).toBe(0); expect(u.count(null)).toBe(0);
  });
});
