// Webhook signature verification (architecture §16.2): pure, no database.
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { signPayload, verifySignature } from './signature';

const SECRET = 'whsec_test_secret';
const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1', customer: 'cus_1' } } });
const now = 1_800_000_000;
const v1 = (raw: string, t: number, secret = SECRET) => createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    expect(verifySignature(body, signPayload(body, SECRET, now), SECRET, now)).toBe(true);
    expect(verifySignature(body, `t=${now},v1=${v1(body, now)}`, SECRET, now + 299)).toBe(true);
  });
  it('rejects a signature made with another secret', () => {
    expect(verifySignature(body, signPayload(body, 'whsec_other', now), SECRET, now)).toBe(false);
  });
  it('rejects a tampered body', () => {
    expect(verifySignature(body.replace('cus_1', 'cus_2'), signPayload(body, SECRET, now), SECRET, now)).toBe(false);
  });
  it('rejects a timestamp more than 300s away, either way', () => {
    expect(verifySignature(body, signPayload(body, SECRET, now - 301), SECRET, now)).toBe(false);
    expect(verifySignature(body, signPayload(body, SECRET, now + 301), SECRET, now)).toBe(false);
    expect(verifySignature(body, signPayload(body, SECRET, now - 300), SECRET, now)).toBe(true);
  });
  it('accepts two v1 entries when one is valid (a secret being rolled), in either order', () => {
    expect(verifySignature(body, `t=${now},v1=${v1(body, now, 'whsec_old')},v1=${v1(body, now)}`, SECRET, now)).toBe(true);
    expect(verifySignature(body, `t=${now},v1=${v1(body, now)},v1=deadbeef`, SECRET, now)).toBe(true);
    expect(verifySignature(body, `t=${now},v1=${v1(body, now, 'a')},v1=${v1(body, now, 'b')}`, SECRET, now)).toBe(false);
  });
  it('rejects a missing or malformed header, and ignores other schemes', () => {
    expect(verifySignature(body, null, SECRET, now)).toBe(false);
    expect(verifySignature(body, '', SECRET, now)).toBe(false);
    expect(verifySignature(body, `v1=${v1(body, now)}`, SECRET, now)).toBe(false);                   // no t
    expect(verifySignature(body, `t=${now}`, SECRET, now)).toBe(false);                                // no v1
    expect(verifySignature(body, `t=${now},v0=${v1(body, now)}`, SECRET, now)).toBe(false);            // v0 is not v1
    expect(verifySignature(body, `t=abc,v1=${v1(body, now)}`, SECRET, now)).toBe(false);
  });
  it('never verifies against an empty secret', () => {
    expect(verifySignature(body, signPayload(body, '', now), '', now)).toBe(false);
  });
});
