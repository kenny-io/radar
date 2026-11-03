import { describe, expect, it, vi } from 'vitest';
import { startLifecycleDispatcher } from './worker';
import type { DispatchOptions } from './dispatch';

describe('dedicated lifecycle dispatch loop', () => {
  it('dispatches without acquiring analysis job slots and stops before a further iteration', async () => {
    // Every general worker slot is occupied; lifecycle delivery has no dependency on that queue.
    const busyAnalysis = Array.from({ length: 4 }, () => new Promise<void>(() => {}));
    let iteration!: () => void;
    const idleReached = new Promise<void>(resolve => { iteration = resolve; });
    const dispatch = vi.fn(async (o: DispatchOptions) => { expect(o.limit).toBe(10); expect(o.shouldStop?.()).toBe(false); return { processed: 1 }; });
    const loop = startLifecycleDispatcher({ dispatch, pause: async (_, signal) => { iteration(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); } });
    await idleReached; expect(busyAnalysis).toHaveLength(4); expect(dispatch).toHaveBeenCalledTimes(1);
    await loop.stop(); expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('aborts a current provider request on stop and never begins another batch', async () => {
    let entered!: () => void, observed!: DispatchOptions;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const dispatch = vi.fn(async (o: DispatchOptions) => {
      observed = o; entered();
      await new Promise<void>(resolve => o.signal!.addEventListener('abort', () => resolve(), { once: true }));
      return { processed: 1 };
    });
    const loop = startLifecycleDispatcher({ dispatch }); await started; await loop.stop(); await loop.stop();
    expect(observed.signal!.aborted).toBe(true); expect(observed.shouldStop!()).toBe(true); expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('retains the loop after one failed iteration', async () => {
    let finished!: () => void, n = 0;
    const second = new Promise<void>(resolve => { finished = resolve; });
    const dispatch = vi.fn(async () => { n++; if (n === 1) throw new Error('fake transport outage'); finished(); return { processed: 0 }; });
    const loop = startLifecycleDispatcher({ dispatch, pause: async (_, signal) => { if (n < 2) return; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); } });
    await second; await loop.stop(); expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
