import { describe, expect, it } from 'vitest';
import { LaterQueue } from './laterQueue';

/** Manual timers: nothing fires until the test says so. */
function fakeTimers() {
  let id = 0; const live = new Map<number, () => void>();
  return { t: { set: (fn: () => void) => { live.set(++id, fn); return id; }, clear: (x: unknown) => { live.delete(x as number); } }, fireAll: () => { const fs = [...live.values()]; live.clear(); fs.forEach(f => f()); }, count: () => live.size };
}
const deferred = () => { let resolve!: () => void; let reject!: (e: unknown) => void; const p = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

describe('LaterQueue (actLater / flushLater)', () => {
  it('debounces per key: the last call wins and earlier ones never run', async () => {
    const ft = fakeTimers(); const q = new LaterQueue(ft.t); const ran: string[] = [];
    q.schedule('text', 600, async () => { ran.push('a'); });
    q.schedule('text', 600, async () => { ran.push('b'); });
    expect(q.size).toBe(1); expect(ft.count()).toBe(1);
    ft.fireAll(); await q.flush();
    expect(ran).toEqual(['b']); expect(q.size).toBe(0);
  });

  it('flush sends waiting saves now (without waiting for their timers) and resolves after they finish', async () => {
    const ft = fakeTimers(); const q = new LaterQueue(ft.t); const d = deferred(); const order: string[] = [];
    q.schedule('text', 600, async () => { order.push('save start'); await d.p; order.push('save done'); });
    q.schedule('title', 600, async () => { order.push('title'); });
    const f = q.flush().then(() => order.push('flushed'));
    expect(ft.count()).toBe(0); // timers cancelled, not left to fire a second time
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['save start', 'title']);
    d.resolve(); await f;
    expect(order).toEqual(['save start', 'title', 'save done', 'flushed']);
  });

  it('flush also waits for a save whose timer already fired and is still in flight', async () => {
    const ft = fakeTimers(); const q = new LaterQueue(ft.t); const d = deferred(); let done = false;
    q.schedule('text', 600, async () => { await d.p; done = true; });
    ft.fireAll(); expect(q.size).toBe(0);
    const f = q.flush(); let flushed = false; f.then(() => { flushed = true; });
    await Promise.resolve(); expect(flushed).toBe(false);
    d.resolve(); await f; expect(done).toBe(true);
  });

  it('never rejects when a save fails (act already shows the error), so Post now can continue', async () => {
    const ft = fakeTimers(); const q = new LaterQueue(ft.t);
    q.schedule('text', 600, async () => { throw new Error('offline'); });
    await expect(q.flush()).resolves.toBeUndefined();
  });

  it('cancel drops a waiting save', async () => {
    const ft = fakeTimers(); const q = new LaterQueue(ft.t); let ran = false;
    q.schedule('k', 600, async () => { ran = true; }); q.cancel('k');
    await q.flush(); expect(ran).toBe(false); expect(ft.count()).toBe(0);
  });
});
