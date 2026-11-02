import { afterEach, describe, expect, it, vi } from 'vitest';
import { coalescedReads } from './cache';

afterEach(() => vi.useRealTimers());
describe('coalesced business reads', () => {
  it('shares one load across 1000 concurrent readers and isolates business keys', async () => {
    const load = vi.fn(async (key: string) => ({ business: key }));
    const read = coalescedReads(load);
    const values = await Promise.all(Array.from({ length: 1000 }, () => read('one')));
    expect(load).toHaveBeenCalledTimes(1);
    expect(values.every(v => v === values[0])).toBe(true);
    expect(await read('two')).toEqual({ business: 'two' });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('refreshes expired values and retries failed reads', async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const read = coalescedReads(load, 1000);
    await expect(read('one')).rejects.toThrow('offline');
    expect(await read('one')).toBe(1);
    expect(await read('one')).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await read('one')).toBe(2);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('bounds pending keys without evicting active reads', async () => {
    let finish!: (value: number) => void;
    const load = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
    const read = coalescedReads(load, 1000, 1);
    const first = read('one');
    await Promise.resolve();
    await expect(read('two')).rejects.toThrow('Read capacity reached');
    expect(read('one')).toBe(first);
    finish(1);
    expect(await first).toBe(1);
  });
});
