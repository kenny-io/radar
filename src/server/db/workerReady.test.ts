import { describe, expect, it, vi } from 'vitest';
import { waitForWorkerSchema } from './workerReady';
import { pool } from './index';

describe('worker rollout readiness', () => {
  it.each([
    ["CHECK (guide_id IN ('article_workflow','search_refresh'))", false],
    ["CHECK (guide_id IN ('article_workflow','search_refresh','autopilot_intro'))", true],
    ["CHECK (guide_id IN ('article_workflow','search_refresh','autopilot_intro_wrong'))", false],
  ])('checks the validated guide allowlist capability before starting: %s', async (definition, ready) => {
    const probe = vi.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] } as never).mockResolvedValueOnce({ rows: [{ definition }] } as never);
    try {
      const result = waitForWorkerSchema({ timeoutMs: 0, log: () => {} });
      if (ready) await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toThrow('schema is not ready');
      expect(probe).toHaveBeenCalledTimes(2);
      expect(probe.mock.calls[1][0]).toMatchObject({ text: expect.stringContaining("conname = 'lifecycle_guide_id_check'") });
      expect(probe.mock.calls[1][0]).toMatchObject({ text: expect.stringContaining("conrelid = 'lifecycle_guide_states'::regclass") });
    } finally { probe.mockRestore(); }
  });
  it('waits through old-schema failures before allowing job startup, with one bounded diagnostic', async () => {
    let time = 0;
    const probe = vi.fn().mockRejectedValueOnce(new Error('missing relation')).mockRejectedValueOnce(new Error('missing column')).mockResolvedValue(undefined);
    const log = vi.fn();
    await waitForWorkerSchema({ probe, log, now: () => time, pause: async ms => { time += ms; } });
    expect(probe).toHaveBeenCalledTimes(3);
    expect(time).toBe(4000);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it('fails closed within the startup budget when the schema remains unavailable', async () => {
    let time = 0;
    const probe = vi.fn().mockRejectedValue(new Error('connection details must not be logged'));
    const log = vi.fn();
    await expect(waitForWorkerSchema({ probe, log, timeoutMs: 4500, now: () => time, pause: async ms => { time += ms; } })).rejects.toThrow('schema is not ready');
    expect(time).toBe(4500);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(log.mock.calls)).not.toContain('connection details');
  });
  it('does not probe or start work after shutdown was requested', async () => {
    const controller = new AbortController(); controller.abort();
    const probe = vi.fn();
    await expect(waitForWorkerSchema({ probe, signal: controller.signal })).rejects.toThrow('startup stopped');
    expect(probe).not.toHaveBeenCalled();
  });
});
