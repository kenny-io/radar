import { describe, expect, it } from 'vitest';
import { FLASH_KEY } from '@/lib/deletion';
import { setFlash, takeFlash } from './flash';

/** sessionStorage as a plain map, with switches to make each call throw (blocked storage). */
function store(broken: { get?: boolean; set?: boolean; remove?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => { if (broken.get) throw new Error('blocked'); return m.has(k) ? m.get(k)! : null; },
    setItem: (k: string, v: string) => { if (broken.set) throw new Error('blocked'); m.set(k, v); },
    removeItem: (k: string) => { if (broken.remove) throw new Error('blocked'); m.delete(k); },
  };
}

describe('a toast that survives a full navigation', () => {
  it('is shown once: the first read returns it and removes it, the second finds nothing', () => {
    const s = store();
    setFlash('Fieldnote restored.', 'ok', s);
    expect(takeFlash(s)).toEqual({ msg: 'Fieldnote restored.', tone: 'ok' });
    expect(s.m.has(FLASH_KEY)).toBe(false);
    expect(takeFlash(s)).toBeNull();
  });

  it('is stored under the shared key in the shape the contract names, with no tone when none is given', () => {
    const s = store();
    setFlash('That business was deleted.', undefined, s);
    expect(JSON.parse(s.m.get(FLASH_KEY)!)).toEqual({ msg: 'That business was deleted.' });
    expect(takeFlash(s)).toEqual({ msg: 'That business was deleted.' });
  });

  it('keeps only the last message when two are set before the next page', () => {
    const s = store();
    setFlash('one', 'ok', s); setFlash('two', 'ok', s);
    expect(takeFlash(s)).toEqual({ msg: 'two', tone: 'ok' });
    expect(takeFlash(s)).toBeNull();
  });

  it('drops a value that is not a flash, and still removes it', () => {
    for (const raw of ['not json', '"text"', 'null', '{}', '{"msg":42}', '{"msg":"  "}', '[]']) {
      const s = store(); s.m.set(FLASH_KEY, raw);
      expect(takeFlash(s), raw).toBeNull();
      expect(s.m.has(FLASH_KEY), raw).toBe(false);
    }
  });

  it('ignores a tone the toast host does not have', () => {
    const s = store(); s.m.set(FLASH_KEY, JSON.stringify({ msg: 'Hello', tone: 'signal' }));
    expect(takeFlash(s)).toEqual({ msg: 'Hello' });
  });

  it('never throws when storage is blocked or missing', () => {
    expect(() => setFlash('x', 'ok', store({ set: true }))).not.toThrow();
    expect(takeFlash(store({ get: true }))).toBeNull();
    expect(() => setFlash('x', 'ok', null)).not.toThrow();
    expect(takeFlash(null)).toBeNull();
    // No window here (the server render): the default store is "none", not a crash.
    expect(() => setFlash('x')).not.toThrow();
    expect(takeFlash()).toBeNull();
  });

  it('shows nothing when the message cannot be removed, so it can never repeat on every page', () => {
    const s = store({ remove: true }); s.m.set(FLASH_KEY, JSON.stringify({ msg: 'stuck' }));
    expect(takeFlash(s)).toBeNull();
  });
});
