import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const delivery = vi.hoisted(() => vi.fn(async (..._args: any[]) => {}));
vi.mock('./delivery', () => ({ persistAndDeliverAlert: delivery }));
import { failureAlertsEnabled, reportFailure, sanitizeDiagnostic, shouldReportFailure, withFailureContext } from './failures';
import { RadarError } from '../errors';
import { publishingDiagnosticText } from '../services/publishing/http';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('RADAR_FAILURE_ALERTS', 'on'); vi.stubEnv('RADAR_DEV_STUBS', '0');
  delivery.mockClear(); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('operational failure reporting', () => {
  it('inherits authorized context while excluding arbitrary payloads and preserving provider diagnostics', async () => {
    await withFailureContext({ source: 'job', operation: 'article.draft', businessId: 'biz', jobId: 'job', attempt: 1 }, async () => {
      await reportFailure(Object.assign(new Error('Insufficient credits'), { status: 402, code: 'insufficient_quota' }), { source: 'ai', operation: 'article.outline', provider: 'openrouter', model: 'model', businessId: undefined, payload: { prompt: 'PRIVATE' } } as any);
    });
    const event = delivery.mock.calls[0][0] as any;
    expect(event.context).toMatchObject({ businessId: 'biz', jobId: 'job', attempt: 1, provider: 'openrouter' });
    expect(event.rootOperation).toBe('article.draft'); expect(event.error.status).toBe(402); expect(event.hint).toContain('balance');
    expect(JSON.stringify(event)).not.toContain('PRIVATE'); expect(event.timestamp).toMatch(/Z$/);
  });
  it('deduplicates the same cause across nested catches but reports distinct failures', async () => {
    const provider = new Error('Provider down'); const parent = Object.assign(new Error('Radar failed'), { cause: provider });
    await withFailureContext({ source: 'action', operation: 'social.generate' }, async () => {
      await reportFailure(provider, { source: 'ai', operation: 'social.copy' });
      await reportFailure(parent, { source: 'action', operation: 'social.generate' });
      await reportFailure(new Error('Storage failed'), { source: 'image', operation: 'image.store' });
    });
    expect(delivery).toHaveBeenCalledTimes(2);
  });
  it('logs a failure that will be retried without alerting, and still alerts when the same failure ends the action', async () => {
    const provider = Object.assign(new Error('Insufficient credits'), { status: 402 });
    await withFailureContext({ source: 'job', operation: 'article.draft' }, async () => {
      await reportFailure(provider, { source: 'ai', operation: 'article.outline', provider: 'openrouter', retrying: true, degraded: true });
      expect(delivery).not.toHaveBeenCalled();
      expect(vi.mocked(console.error).mock.calls.filter(c => c[0] === '[radar.failure]')).toHaveLength(1);
      // Nothing else could be tried: the same error ends the call, and the job then fails with it wrapped.
      await reportFailure(provider, { source: 'ai', operation: 'article.outline', provider: 'openrouter', retrying: false });
      await reportFailure(Object.assign(new Error('Radar failed'), { cause: provider }), { source: 'job', operation: 'article.draft', retrying: false });
    });
    expect(delivery).toHaveBeenCalledTimes(1);
    expect((delivery.mock.calls[0][0] as any).context).toMatchObject({ operation: 'article.outline', provider: 'openrouter', retrying: false });
  });
  it('isolates concurrent request contexts', async () => {
    await Promise.all(['one', 'two'].map(businessId => withFailureContext({ source: 'action', operation: 'generate', businessId }, async () => {
      await Promise.resolve(); await reportFailure(new Error('down'), { source: 'ai', operation: 'writing' });
    })));
    expect({ deliveries: delivery.mock.calls.map(call => (call[0] as any).context.businessId).sort(), logs: vi.mocked(console.error).mock.calls.filter(c => c[0] !== '[radar.failure]') }).toEqual({ deliveries: ['one', 'two'], logs: [] });
  });
  it('never rejects when alert delivery or logging fails', async () => {
    delivery.mockRejectedValueOnce(new Error('Mail unavailable'));
    await expect(reportFailure(new Error('original'), { source: 'system', operation: 'test' })).resolves.toBeUndefined();
    vi.mocked(console.error).mockImplementation(() => { throw new Error('logging failed'); });
    await expect(reportFailure(new Error('original'), { source: 'system', operation: 'test' })).resolves.toBeUndefined();
  });
  it('disables nonproduction/stub emails while production defaults on and supports an explicit kill switch', async () => {
    vi.stubEnv('RADAR_FAILURE_ALERTS', ''); expect(failureAlertsEnabled()).toBe(false);
    vi.stubEnv('RADAR_FAILURE_ALERTS', 'on'); vi.stubEnv('RADAR_DEV_STUBS', '1'); expect(failureAlertsEnabled()).toBe(false);
    await reportFailure(new Error('expected offline'), { source: 'system', operation: 'test' }); expect(delivery).not.toHaveBeenCalled();
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('RADAR_FAILURE_ALERTS', ''); expect(failureAlertsEnabled()).toBe(true);
    vi.stubEnv('RADAR_FAILURE_ALERTS', 'off'); expect(failureAlertsEnabled()).toBe(false);
  });
  it('filters expected request validation/access errors without filtering operational 5xx', () => {
    expect(shouldReportFailure(new RadarError('Sign in', 401))).toBe(false);
    expect(shouldReportFailure({ name: 'ZodError' })).toBe(false);
    expect(shouldReportFailure(new RadarError('AI unavailable', 502))).toBe(true);
    expect(shouldReportFailure(new Error('unknown'))).toBe(true);
  });
  it('keeps incident grouping stable within a five minute window', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T12:01:00Z'));
    await reportFailure(new Error('credits'), { source: 'ai', operation: 'outline', incidentKey: 'provider:402' });
    await reportFailure(new Error('credits'), { source: 'ai', operation: 'outline', incidentKey: 'provider:402' });
    expect(delivery.mock.calls[0][1]).toBe(delivery.mock.calls[1][1]); vi.useRealTimers();
  });
});

describe('diagnostic redaction', () => {
  it('strips configured/encoded credentials, authorization, cookie, signed URL secrets and prompt values', () => {
    vi.stubEnv('TEST_API_KEY', 'private+/key-value');
    const value = sanitizeDiagnostic('private+/key-value private%2B%2Fkey-value Bearer abc123 Basic Zm9vOmJhcg== https://user:pass@provider.test/path?sig=secret#secret api_key=hidden prompt="PRIVATE CONTENT"');
    for (const secret of ['private+', 'private%', 'abc123', 'Zm9v', 'user:pass', 'sig=secret', 'api_key=hidden', 'PRIVATE CONTENT']) expect(value).not.toContain(secret);
    expect(sanitizeDiagnostic('Cookie: radar_session=private_cookie')).not.toContain('private_cookie');
    expect(sanitizeDiagnostic('Structured output failed validation: generated customer output')).toBe('Structured output failed validation');
  });

  /** About 2,700 characters of plain words: nothing in it is redacted, so the sanitized text is the text itself. */
  const longLead = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  it('keeps the 1,600-character bound unless a caller asks for another, and redacts the whole text before any cut', () => {
    expect(longLead.length).toBeGreaterThan(1600);
    expect(sanitizeDiagnostic(longLead)).toBe(longLead.slice(0, 1600));
    expect(sanitizeDiagnostic(longLead, {})).toBe(longLead.slice(0, 1600));
    expect(sanitizeDiagnostic(longLead, { limit: 0 })).toBe(longLead.slice(0, 1600));
    // Passed straight to map, the element index is not mistaken for a limit.
    expect([longLead, longLead, longLead].map(sanitizeDiagnostic as unknown as (value: string, index: number) => string)).toEqual(Array(3).fill(longLead.slice(0, 1600)));
    expect(sanitizeDiagnostic(longLead, { limit: 4000 })).toBe(longLead);
    expect(sanitizeDiagnostic(longLead, { limit: 100 })).toBe(longLead.slice(0, 100));

    vi.stubEnv('TEST_API_KEY', 'configured-secret-value-93');
    const token = 'sk-ant-' + 'Zq7'.repeat(8);
    const late = `${longLead} Bearer late-bearer-credential then ${token} then configured-secret-value-93 then api_key=late-hidden-value end`;
    // Unchanged by default: the first 1,600 characters, exactly as before the option existed.
    expect(sanitizeDiagnostic(late)).toBe(longLead.slice(0, 1600));
    const long = sanitizeDiagnostic(late, { limit: 4000 });
    expect(long.startsWith(longLead + ' ')).toBe(true);
    expect(long.endsWith(' end')).toBe(true);
    for (const secret of ['late-bearer-credential', token, 'configured-secret-value-93', 'late-hidden-value']) expect(long).not.toContain(secret);
  });
  it('publishing text: the bound is unchanged up to 1,600, and a longer one still redacts a private key and a token past character 1,600', () => {
    for (const limit of [300, 1200, 1600]) expect(publishingDiagnosticText(longLead, limit)).toBe(longLead.slice(0, limit).trim());
    expect(publishingDiagnosticText(longLead)).toBe(longLead.slice(0, 300).trim());
    const key = `-----BEGIN OPENSSH PRIVATE KEY-----\n${'b3BlbnNzaC1rZXktdjEA'.repeat(12)}\n-----END OPENSSH PRIVATE KEY-----`;
    const token = 'ghp_' + 'Qz8'.repeat(12);
    const late = `${longLead} ${key} then ${token} then token=late-hidden-value end`;
    expect(late.indexOf('-----BEGIN')).toBeGreaterThan(1600);
    expect(publishingDiagnosticText(late, 1600)).toBe(longLead.slice(0, 1600).trim());
    const long = publishingDiagnosticText(late, 4000);
    expect(long.startsWith(longLead + ' ')).toBe(true);
    expect(long.endsWith(' end')).toBe(true);
    for (const secret of ['PRIVATE KEY', 'b3BlbnNzaC1rZXk', token, 'ghp_', 'late-hidden-value']) expect(long).not.toContain(secret);
  });
});
