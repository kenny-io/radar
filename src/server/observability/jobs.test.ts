import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ def: null as any, deliver: vi.fn() }));
vi.mock('../jobs/queue', () => ({ defineJob: (def: any) => { state.def = def; } }));
vi.mock('./delivery', () => ({ ALERT_JOB_KIND: 'observability.alert', deliverAlert: state.deliver }));
import './jobs';
beforeEach(() => { state.deliver.mockReset(); });

describe('queued operational email delivery receipts', () => {
  it('retains the accepted provider message ID from queued delivery', async () => {
    const envelope = { key: 'stable-key', text: 'sanitized' };
    state.deliver.mockResolvedValueOnce({ providerMessageId: 'resend-queued-message' });
    await expect(state.def.run({ payload: envelope })).resolves.toEqual({ accepted: true, providerMessageId: 'resend-queued-message' });
    expect(state.deliver).toHaveBeenCalledWith(envelope);
  });
  it('does not claim acceptance when queued delivery fails', async () => {
    const failure = new Error('Email transport unavailable'); state.deliver.mockRejectedValueOnce(failure);
    await expect(state.def.run({ payload: {} })).rejects.toBe(failure);
  });
});
