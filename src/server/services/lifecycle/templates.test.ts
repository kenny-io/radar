import { describe, expect, it } from 'vitest';
import { LIFECYCLE_TYPES, renderLifecycle, type LifecycleData } from './templates';
const ctx = { appUrl: 'https://radar.thally.io', unsubscribeUrl: 'https://radar.thally.io/email-preferences?token=fake' };
const data: LifecycleData = { name: 'Alex', businessName: 'Fieldnote', trialEnd: '2026-11-07T12:00:00Z', periodEnd: '2026-12-07T12:00:00Z', amountCents: 4900, currency: 'usd', invoiceNumber: 'ABC-123', resetUrl: 'https://radar.thally.io/reset-password#token=not-real' };
describe('lifecycle templates', () => {
  it.each(LIFECYCLE_TYPES)('%s has accessible HTML, useful plain text and explicit reply contact', type => {
    const x = renderLifecycle(type, data, ctx);
    expect(x.subject.length).toBeGreaterThan(10);
    expect(x.html).toContain('<html lang="en">'); expect(x.html).toContain('role="presentation"'); expect(x.html).toContain('<h1');
    expect(x.text).toContain('Privacy: https://radar.thally.io/privacy'); expect(x.text).toContain('https://radar.thally.io/');
    expect(x.replyTo).toBe(type === 'founder_note' ? 'team@thally.io' : 'support@thally.io');
    expect(x.html).not.toContain('<script');
    expect(x.html).toContain('src="https://radar.thally.io/brand/radar-mark-email.png"');
    expect(x.html).not.toContain('◉');
  });
  it('escapes all user-controlled values without corrupting plain text', () => {
    const x = renderLifecycle('welcome', { profileAnalyzed: true, name: '<script>bad()</script>', businessName: 'A&B "<test>"' }, ctx);
    expect(x.html).not.toContain('<script>'); expect(x.html).toContain('&lt;script&gt;'); expect(x.html).toContain('A&amp;B &quot;&lt;test&gt;&quot;');
    expect(x.text).toContain('A&B "<test>"');
  });
  it('continues from an analyzed profile without asking the customer to repeat website setup', () => {
    const welcome = renderLifecycle('welcome', { ...data, profileAnalyzed: true }, ctx);
    expect(welcome.text).toContain('Business Profile for Fieldnote');
    expect(welcome.text).toContain('Continue with my profile: https://radar.thally.io/dashboard');
    expect(welcome.text).not.toMatch(/start with your website|add your website|connect.*search console/i);
    const direct = renderLifecycle('welcome', { ...data, profileAnalyzed: false }, ctx);
    expect(direct.text).toContain('Your account is ready');
    expect(direct.text).not.toContain('Business Profile is ready');
    expect(direct.text).not.toContain('has analyzed');
  });
  it('uses actual amounts and UTC dates and the working billing settings destination', () => {
    const paid = renderLifecycle('invoice_paid', { ...data, amountCents: 1234, currency: 'eur' }, ctx);
    expect(paid.text).toContain('€12.34'); expect(paid.text).toContain('/settings?section=billing');
    expect(renderLifecycle('trial_ending', data, ctx).text).toContain('November 7, 2026');
    expect(renderLifecycle('trial_ending', data, ctx).text).toContain('UTC');
    expect(() => renderLifecycle('trial_ending', {}, ctx)).toThrow('date required');
    expect(() => renderLifecycle('invoice_paid', { amountCents: -1 }, ctx)).toThrow('amount');
  });
  it('only offers optional opt-out on founder mail', () => {
    expect(renderLifecycle('founder_note', data, ctx).text).toContain('Stop optional setup emails');
    expect(renderLifecycle('invoice_paid', data, ctx).text).not.toContain('Stop optional');
  });
  it('requires a reset link on the configured origin with a fragment token', () => {
    expect(() => renderLifecycle('password_reset', { resetUrl: 'https://evil.test/reset-password#token=stolen' }, ctx)).toThrow('Invalid reset');
    expect(() => renderLifecycle('password_reset', { resetUrl: 'https://radar.thally.io/reset-password?token=x' }, ctx)).toThrow('Invalid reset');
    expect(renderLifecycle('password_reset', data, ctx).text).toContain('one hour');
  });
  it('does not describe expired subscription setup as a voluntary cancellation', () => {
    expect(renderLifecycle('subscription_ended', { status: 'incomplete_expired' }, ctx).text).toContain('setup expired before payment');
  });
});
