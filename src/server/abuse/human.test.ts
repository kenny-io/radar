import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../env';
import { verifyHuman, verifySignupHuman, SIGNUP_TURNSTILE_ACTION } from './human';
import { assertVerificationConfigured } from '../auth/verification';
const saved = { signupTurnstileRequired: env.signupTurnstileRequired, devStubs: env.devStubs, isProd: env.isProd, turnstileSiteKey: env.turnstileSiteKey, turnstileSecretKey: env.turnstileSecretKey, guestTurnstileSecretKey: env.guestTurnstileSecretKey, resendKey: env.resendKey };
afterEach(() => { Object.assign(env, saved); vi.unstubAllGlobals(); });
function configured() { Object.assign(env, { signupTurnstileRequired: true, devStubs: false, isProd: true, turnstileSiteKey: 'real-site-key', turnstileSecretKey: 'real-secret', resendKey: 'provider-key' }); }
const success = () => ({ success: true, hostname: new URL(env.appUrl).hostname, action: SIGNUP_TURNSTILE_ACTION });
describe('signup human verification', () => {
  it('requires strict success, expected action and hostname, successful HTTP and bounded token', async () => {
    configured();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const result of [success(), { ...success(), success: 'true' }, { ...success(), action: 'other-form' }, { ...success(), hostname: 'evil.example' }, { success: false, 'error-codes': ['timeout-or-duplicate'] }]) {
      fetcher.mockResolvedValueOnce(Response.json(result));
      expect(await verifySignupHuman('token', '1.2.3.4')).toBe(result.success === true && 'action' in result && result.action === SIGNUP_TURNSTILE_ACTION && 'hostname' in result && result.hostname === new URL(env.appUrl).hostname);
    }
    fetcher.mockResolvedValueOnce(Response.json(success(), { status: 500 }));
    expect(await verifySignupHuman('token', '1.2.3.4')).toBe(false);
    fetcher.mockRejectedValueOnce(new Error('network'));
    expect(await verifySignupHuman('token', '1.2.3.4')).toBe(false);
    fetcher.mockResolvedValueOnce(new Response('broken json'));
    expect(await verifySignupHuman('token', '1.2.3.4')).toBe(false);
    const calls = fetcher.mock.calls.length;
    expect(await verifySignupHuman('', 'ip')).toBe(false);
    expect(await verifySignupHuman('x'.repeat(2049), 'ip')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    const sent = fetcher.mock.calls[0][1];
    expect(sent.signal).toBeInstanceOf(AbortSignal);
    expect(sent.body.get('remoteip')).toBe('1.2.3.4');
  });
  it('does not allow dev stub or missing configuration to bypass production protection', async () => {
    configured(); env.devStubs = true; env.turnstileSecretKey = '';
    expect(await verifySignupHuman('token', 'ip')).toBe(false);
    expect(() => assertVerificationConfigured()).toThrow();
    env.turnstileSecretKey = 'real-secret'; env.turnstileSiteKey = '1x00000000000000000000AA';
    expect(() => assertVerificationConfigured()).toThrow();
    env.isProd = false;
    expect(await verifySignupHuman(undefined, 'ip')).toBe(true);
  });
  it('signup key does not silently enable the unfinished guest widget', async () => {
    configured(); env.guestTurnstileSecretKey = '';
    expect(await verifyHuman(undefined, 'ip')).toBe(true);
    expect(await verifySignupHuman(undefined, 'ip')).toBe(false);
  });
});
