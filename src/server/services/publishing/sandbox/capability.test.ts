// The per-run model capability: what a minted token grants, and every way a token is refused. The hand-rolled signer
// below builds tokens from the documented wire format, so a refusal can be pinned to one cause at a time.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mintPublishCapability, verifyPublishCapability } from './capability';
import { CAPABILITY_AUDIENCE, CAPABILITY_MAX_LENGTH, CAPABILITY_MAX_TTL_SEC, CAPABILITY_PREFIX, CAPABILITY_SECRET_MIN_LENGTH } from './types';

const SECRET = 'unit-test-capability-secret-0123456789';
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
const NOW_SEC = NOW / 1000;
const input = { runId: '0b9f6f0e-3c1d-4c58-9d55-6b1f4a2e7c11', bid: '5d0c2a34-8f0b-4d0e-a1a2-0c9a3f5b7e21', entryId: 'e_tl6rSYPs', model: 'claude-opus-5-5', maxUsd: 6, maxCalls: 200, exp: NOW_SEC + 870 };
const claims = { v: 1, aud: CAPABILITY_AUDIENCE, ...input, iat: NOW_SEC };

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
/** A token in the documented format with any prefix, payload text and secret. */
function forge(payloadJson: string, o: { prefix?: string; secret?: string } = {}): string {
  const prefix = o.prefix ?? CAPABILITY_PREFIX, payload = b64(payloadJson);
  return `${prefix}.${payload}.${createHmac('sha256', o.secret ?? SECRET).update(`${prefix}.${payload}`).digest('base64url')}`;
}
const forged = (over: Record<string, unknown>) => forge(JSON.stringify({ ...claims, ...over }));

describe('mintPublishCapability', () => {
  it('binds one run, its business and entry, the model and both caps, issued now and expiring when asked', () => {
    const token = mintPublishCapability(input, SECRET, NOW);
    expect(verifyPublishCapability(token, SECRET, NOW)).toEqual({ v: 1, aud: 'radar-publish-model', runId: input.runId, bid: input.bid, entryId: 'e_tl6rSYPs', model: 'claude-opus-5-5', maxUsd: 6, maxCalls: 200, iat: NOW_SEC, exp: NOW_SEC + 870 });
  });
  it('produces the documented wire format: prefix, base64url claims, HMAC-SHA256 over prefix and claims', () => {
    const token = mintPublishCapability(input, SECRET, NOW);
    const [prefix, payload, signature] = token.split('.');
    expect(prefix).toBe('rdrcap1');
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual(claims);
    expect(signature).toBe(createHmac('sha256', SECRET).update(`rdrcap1.${payload}`).digest('base64url'));
    expect(token.length).toBeLessThanOrEqual(CAPABILITY_MAX_LENGTH);
    // Claim order is not part of the contract: the same claims in another order verify too.
    expect(verifyPublishCapability(forge(JSON.stringify(claims)), SECRET, NOW)).toEqual(verifyPublishCapability(token, SECRET, NOW));
  });
  it('derives iat from a millisecond clock and treats exp as seconds', () => {
    const token = mintPublishCapability({ ...input, exp: NOW_SEC + 60 }, SECRET, NOW + 999);
    expect(verifyPublishCapability(token, SECRET, NOW)).toMatchObject({ iat: NOW_SEC, exp: NOW_SEC + 60 });
  });
  it('uses the secret exactly as set: surrounding whitespace is part of the key', () => {
    const token = mintPublishCapability(input, ` ${SECRET} `, NOW);
    expect(verifyPublishCapability(token, ` ${SECRET} `, NOW)).not.toBeNull();
    expect(verifyPublishCapability(token, SECRET, NOW)).toBeNull();
  });
  it('refuses a secret shorter than the minimum, and accepts one of exactly the minimum length', () => {
    expect(() => mintPublishCapability(input, 'x'.repeat(CAPABILITY_SECRET_MIN_LENGTH - 1), NOW)).toThrow(/secret/);
    expect(() => mintPublishCapability(input, '', NOW)).toThrow(/secret/);
    const least = 'x'.repeat(CAPABILITY_SECRET_MIN_LENGTH);
    expect(verifyPublishCapability(mintPublishCapability(input, least, NOW), least, NOW)).not.toBeNull();
  });
  it('refuses an expiry beyond the lifetime cap, at or before now, or not in whole seconds', () => {
    expect(() => mintPublishCapability({ ...input, exp: NOW_SEC + CAPABILITY_MAX_TTL_SEC + 1 }, SECRET, NOW)).toThrow(/lifetime/);
    expect(mintPublishCapability({ ...input, exp: NOW_SEC + CAPABILITY_MAX_TTL_SEC }, SECRET, NOW)).toEqual(expect.any(String));
    expect(() => mintPublishCapability({ ...input, exp: NOW_SEC }, SECRET, NOW)).toThrow(/claims/);
    expect(() => mintPublishCapability({ ...input, exp: NOW_SEC - 5 }, SECRET, NOW)).toThrow(/claims/);
    expect(() => mintPublishCapability({ ...input, exp: NOW_SEC + 10.5 }, SECRET, NOW)).toThrow(/claims/);
    // A millisecond timestamp passed by mistake is far beyond the cap.
    expect(() => mintPublishCapability({ ...input, exp: NOW + 870_000 }, SECRET, NOW)).toThrow(/lifetime/);
  });
  it.each([
    ['a run id that is not a uuid', { runId: 'run-1' }],
    ['an empty business id', { bid: '' }],
    ['an empty entry id', { entryId: '' }],
    ['a model with a space', { model: 'claude opus' }],
    ['a model with a line break', { model: 'claude-opus-5-5\nx-api-key: k' }],
    ['a zero spend cap', { maxUsd: 0 }],
    ['an infinite spend cap', { maxUsd: Infinity }],
    ['a fractional call cap', { maxCalls: 1.5 }],
    ['a zero call cap', { maxCalls: 0 }],
  ])('refuses %s', (_name, over) => {
    expect(() => mintPublishCapability({ ...input, ...over } as typeof input, SECRET, NOW)).toThrow(/claims/);
  });
  it('never puts the secret or a claim value in an error message', () => {
    const messages: string[] = [];
    for (const attempt of [
      () => mintPublishCapability(input, 'short-secret-value', NOW),
      () => mintPublishCapability({ ...input, runId: 'not-a-uuid-value' }, SECRET, NOW),
      () => mintPublishCapability({ ...input, exp: NOW_SEC + 99_999 }, SECRET, NOW),
    ]) try { attempt(); } catch (error) { messages.push(String((error as Error).message)); }
    expect(messages).toHaveLength(3);
    for (const message of messages) for (const value of ['short-secret-value', SECRET, 'not-a-uuid-value', input.bid, input.entryId]) expect(message).not.toContain(value);
  });
});

describe('verifyPublishCapability refuses', () => {
  const token = mintPublishCapability(input, SECRET, NOW);
  const [, payload, signature] = token.split('.');

  it('a token signed with another secret, and any short verification secret', () => {
    expect(verifyPublishCapability(token, `${SECRET}x`, NOW)).toBeNull();
    const short = 'x'.repeat(CAPABILITY_SECRET_MIN_LENGTH - 1);
    // Correctly signed with the short secret: only the length floor refuses it.
    expect(verifyPublishCapability(forge(JSON.stringify(claims), { secret: short }), short, NOW)).toBeNull();
    expect(verifyPublishCapability(token, '', NOW)).toBeNull();
  });
  it('a payload changed after signing', () => {
    for (const over of [{ maxUsd: 600 }, { maxCalls: 9999 }, { model: 'claude-fable-5-2' }, { exp: NOW_SEC + 1100 }, { runId: '7f3f1a4e-56f1-4b7c-8a1e-0e1b9c2d3a4f' }, { bid: 'another-business' }]) {
      const altered = `rdrcap1.${b64(JSON.stringify({ ...claims, ...over }))}.${signature}`;
      expect(verifyPublishCapability(altered, SECRET, NOW)).toBeNull();
    }
  });
  it('a signature changed in its first, middle or last character, truncated, extended or re-spelled', () => {
    const flip = (at: number) => signature.slice(0, at) + (signature[at] === 'A' ? 'B' : 'A') + signature.slice(at + 1);
    for (const bad of [flip(0), flip(20), flip(signature.length - 2), signature.slice(0, -1), signature.slice(0, 10), `${signature}A`, '', `${signature}=`, signature.replace(/-/g, '+').replace(/_/g, '/')]) {
      if (bad === signature) continue;
      expect(verifyPublishCapability(`rdrcap1.${payload}.${bad}`, SECRET, NOW)).toBeNull();
    }
    // The last character carries unused bits: a second spelling of the same bytes is still not the minted token.
    const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const twin = [...last].map(ch => signature.slice(0, -1) + ch).find(candidate => candidate !== signature && Buffer.from(candidate, 'base64url').equals(Buffer.from(signature, 'base64url')));
    expect(twin).toBeDefined();
    expect(verifyPublishCapability(`rdrcap1.${payload}.${twin}`, SECRET, NOW)).toBeNull();
  });
  it('an expired token, including the exact second of expiry', () => {
    expect(verifyPublishCapability(token, SECRET, (NOW_SEC + 869) * 1000 + 999)).not.toBeNull();
    expect(verifyPublishCapability(token, SECRET, (NOW_SEC + 870) * 1000)).toBeNull();
    expect(verifyPublishCapability(token, SECRET, (NOW_SEC + 5000) * 1000)).toBeNull();
  });
  it('another audience, even when correctly signed', () => {
    expect(verifyPublishCapability(forged({ aud: 'track-docs-agent-model' }), SECRET, NOW)).toBeNull();
    expect(verifyPublishCapability(forged({ aud: '' }), SECRET, NOW)).toBeNull();
  });
  it('another prefix, even when correctly signed for that prefix', () => {
    for (const prefix of ['rdrcap2', 'rdrcap', 'RDRCAP1', 'tdacap1', '']) expect(verifyPublishCapability(forge(JSON.stringify(claims), { prefix }), SECRET, NOW)).toBeNull();
    expect(verifyPublishCapability(`${payload}.${signature}`, SECRET, NOW)).toBeNull();
    expect(verifyPublishCapability(`x.${token}`, SECRET, NOW)).toBeNull();
  });
  it('a token longer than the length cap, where the same claims under the cap are accepted', () => {
    // Trailing JSON whitespace keeps the claims and signature valid, so length is the only difference.
    const padded = (spaces: number) => forge(JSON.stringify(claims) + ' '.repeat(spaces));
    const under = padded(2000), over = padded(3200);
    expect(under.length).toBeLessThanOrEqual(CAPABILITY_MAX_LENGTH);
    expect(over.length).toBeGreaterThan(CAPABILITY_MAX_LENGTH);
    expect(verifyPublishCapability(under, SECRET, NOW)).not.toBeNull();
    expect(verifyPublishCapability(over, SECRET, NOW)).toBeNull();
  });
  it('a lifetime longer than the cap, measured from the verifier clock', () => {
    expect(verifyPublishCapability(forged({ exp: NOW_SEC + CAPABILITY_MAX_TTL_SEC }), SECRET, NOW)).not.toBeNull();
    expect(verifyPublishCapability(forged({ exp: NOW_SEC + CAPABILITY_MAX_TTL_SEC + 1 }), SECRET, NOW)).toBeNull();
    expect(verifyPublishCapability(forged({ exp: NOW_SEC + 365 * 86_400 }), SECRET, NOW)).toBeNull();
    // A capability that will be acceptable later is not acceptable early.
    expect(verifyPublishCapability(token, SECRET, NOW - 600_000)).toBeNull();
  });
  it('claims with a missing, extra, mistyped or out-of-range field', () => {
    const { maxCalls: _dropped, ...withoutCalls } = claims;
    const cases: string[] = [
      JSON.stringify(withoutCalls),
      JSON.stringify({ ...claims, admin: true }),
      JSON.stringify({ ...claims, v: 2 }),
      JSON.stringify({ ...claims, v: '1' }),
      JSON.stringify({ ...claims, runId: 'run-1' }),
      JSON.stringify({ ...claims, bid: 42 }),
      JSON.stringify({ ...claims, entryId: 'x'.repeat(201) }),
      JSON.stringify({ ...claims, model: '' }),
      JSON.stringify({ ...claims, model: 'claude-opus-5-5\r\nx: y' }),
      JSON.stringify({ ...claims, maxUsd: '6' }),
      JSON.stringify({ ...claims, maxUsd: -1 }),
      JSON.stringify({ ...claims, maxCalls: 0 }),
      JSON.stringify({ ...claims, maxCalls: 2.5 }),
      JSON.stringify({ ...claims, exp: String(NOW_SEC + 870) }),
      JSON.stringify({ ...claims, exp: NOW_SEC + 870.5 }),
      JSON.stringify({ ...claims, iat: NOW_SEC + 900 }),
      JSON.stringify({ ...claims, exp: null }),
      `{"__proto__":{"v":1},${JSON.stringify(claims).slice(1)}`,
      JSON.stringify([claims]),
      JSON.stringify(null),
      '"rdrcap1"',
      '{not json',
    ];
    for (const payloadJson of cases) expect(verifyPublishCapability(forge(payloadJson), SECRET, NOW), payloadJson).toBeNull();
  });
  it('anything that is not three dot-separated base64url parts', () => {
    for (const bad of ['', 'rdrcap1', 'rdrcap1.', 'rdrcap1..', `rdrcap1.${payload}`, `rdrcap1.${payload}.${signature}.extra`, `rdrcap1.${payload} .${signature}`, `rdrcap1.${payload}.${signature}\n`, ` ${token}`, `Bearer ${token}`, `rdrcap1.${payload}+.${signature}`]) {
      expect(verifyPublishCapability(bad, SECRET, NOW)).toBeNull();
    }
    for (const bad of [null, undefined, 42, {}, [token]]) expect(verifyPublishCapability(bad as unknown as string, SECRET, NOW)).toBeNull();
  });
  it('uses the current time when no clock is given', () => {
    const live = mintPublishCapability({ ...input, exp: Math.floor(Date.now() / 1000) + 300 }, SECRET);
    expect(verifyPublishCapability(live, SECRET)).toMatchObject({ runId: input.runId });
    expect(verifyPublishCapability(token, SECRET)).toBeNull();
  });
});
