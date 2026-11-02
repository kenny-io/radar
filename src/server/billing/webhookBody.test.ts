import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { processEvent } = vi.hoisted(() => ({ processEvent: vi.fn() }));
vi.mock('./webhook', () => ({ processEvent }));
import { env } from '../env';
import { signPayload } from './signature';
import { POST } from '@/app/api/billing/webhook/route';

const secret = 'whsec_body_test_only', original = env.stripeWebhookSecret;
const MAX = 1024 * 1024;
beforeEach(() => { env.stripeWebhookSecret = secret; processEvent.mockReset(); processEvent.mockResolvedValue('processed'); });
afterEach(() => { env.stripeWebhookSecret = original; });
const streamRequest = (stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/billing/webhook', { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit);

describe('billing webhook public body boundaries', () => {
  it('refuses a missing signature or configuration before reading any body', async () => {
    for (const configured of [true, false]) {
      env.stripeWebhookSecret = configured ? secret : '';
      const pull = vi.fn();
      const request = streamRequest(new ReadableStream({ pull }, { highWaterMark: 0 }), configured ? {} : { 'stripe-signature': 'present' });
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try { expect((await POST(request)).status).toBe(400); }
      finally { log.mockRestore(); }
      expect(request.bodyUsed).toBe(false); expect(pull).not.toHaveBeenCalled();
    }
    expect(processEvent).not.toHaveBeenCalled();
  });
  it('refuses a declared oversized payload without reading it', async () => {
    const pull = vi.fn();
    const request = streamRequest(new ReadableStream({ pull }, { highWaterMark: 0 }), { 'stripe-signature': 'present', 'content-length': String(MAX + 1) });
    expect((await POST(request)).status).toBe(413);
    expect(request.bodyUsed).toBe(false); expect(pull).not.toHaveBeenCalled(); expect(processEvent).not.toHaveBeenCalled();
  });
  it('stops and cancels an unknown-length stream immediately after crossing one MiB', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(pulls <= 2 ? MAX / 2 : 1)); }, cancel }, { highWaterMark: 0 });
    const response = await POST(streamRequest(stream, { 'stripe-signature': 'present' }));
    expect(response.status).toBe(413); expect(pulls).toBe(3); expect(cancel).toHaveBeenCalledOnce();
    expect(processEvent).not.toHaveBeenCalled();
  });
  it('verifies the exact raw UTF-8 body and accepts a valid event/replay unchanged', async () => {
    const raw = ' {"id":"evt_body_fixture","type":"invoice.paid","data":{"object":{"label":"Café ☕"}}}\n';
    for (const result of ['processed', 'replay']) {
      processEvent.mockResolvedValueOnce(result);
      const response = await POST(new Request('http://localhost/api/billing/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signPayload(raw, secret) } }));
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ received: true });
      expect(processEvent).toHaveBeenLastCalledWith(JSON.parse(raw));
    }
    const tampered = await POST(new Request('http://localhost/api/billing/webhook', { method: 'POST', body: raw + ' ', headers: { 'stripe-signature': signPayload(raw, secret) } }));
    expect(tampered.status).toBe(400); expect(processEvent).toHaveBeenCalledTimes(2);
  });
});
