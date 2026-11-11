import * as guideCopy from './guideContent';
import { educationProgress } from './educationContent';
import { describe, expect, it, vi } from 'vitest';
import { LIFECYCLE_TYPES, renderLifecycle, type LifecycleData, type WorkUpdateSection } from './templates';
const ctx = { appUrl: 'https://radar.thally.io', unsubscribeUrl: 'https://radar.thally.io/email-preferences?token=fake' };
const data: LifecycleData = { guide: { version: 1, id: 'article_workflow', context: { businessName: 'Fieldnote', gscConnected: false, access: 'workspace' } }, education: { version: 1, lesson: 'ai_visibility', context: { businessName: 'Fieldnote', gscConnected: false, access: 'workspace' } }, name: 'Alex', businessName: 'Fieldnote', trialEnd: '2026-11-07T12:00:00Z', periodEnd: '2026-12-07T12:00:00Z', amountCents: 4900, currency: 'usd', invoiceNumber: 'ABC-123', workSections: [{ eventId: '00000000-0000-4000-8000-000000000001', kind: 'brief_reply', businessId: '00000000-0000-4000-8000-000000000002', businessName: 'Fieldnote', ref: '2026-11-04', count: 3 }], resetUrl: 'https://radar.thally.io/reset-password#token=not-real' };
describe('lifecycle templates', () => {
  it.each(LIFECYCLE_TYPES.filter(type => type !== 'ai_weekly_report'))('%s has accessible HTML, useful plain text and explicit reply contact', type => {
    const x = renderLifecycle(type, data, ctx);
    expect(x.subject.length).toBeGreaterThan(10);
    expect(x.preheader?.length).toBeGreaterThan(10); expect(x.preheader!.length).toBeLessThanOrEqual(200);
    expect(x.html).toContain('aria-hidden="true"');
    expect(x.html).toContain('<table lang="en" dir="ltr" role="presentation"');
    expect(x.html).toContain('<html lang="en" dir="ltr">'); expect(x.html).toContain('role="presentation"'); expect(x.html).not.toMatch(/<h1[\s>]/i);
    expect(x.text).toContain('Privacy: https://radar.thally.io/privacy'); expect(x.text).toContain('https://radar.thally.io/');
    expect(x.replyTo).toBe('team@thally.io');
    expect(x.html).not.toContain('<script');
    expect(x.html).toContain('>Email preferences</a>');
    expect(x.text).toContain('Email preferences:');
    expect(x.html).toContain('src="https://radar.thally.io/brand/radar-mark-email.png"');
    expect(x.html).not.toContain('◉');
  });
  it('renders exactly two education actions, escaped context and access-safe fixed CTA', () => {
    const d: LifecycleData = { education: { version: 1, lesson: 'daily_brief', context: { businessName: '<img src=x onerror=bad()>', gscConnected: false, access: 'workspace' } } };
    const rendered = renderLifecycle('weekly_education', d, ctx);
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img src=x');
    expect(rendered.html.match(/<li /g)).toHaveLength(2);
    expect(rendered.html.indexOf(educationProgress('daily_brief'))).toBeGreaterThan(rendered.html.indexOf('</ol>'));
    expect(rendered.text).toContain('/email/learn?lesson=daily_brief');
    expect(renderLifecycle('weekly_education', { education: { ...d.education!, context: { ...d.education!.context, access: 'restart' } } }, ctx).text).toContain('https://radar.thally.io/start-trial');
    expect(rendered.html).toContain('>Email preferences</a>');
  });
  it('escapes and bounds inbox preview text without treating it as HTML or header content', () => {
    const mock = vi.spyOn(guideCopy, 'renderGuide').mockReturnValue({ subject: 'A useful guide', preheader: '<img src=x onerror=bad()> & "preview"\r\n' + 'x'.repeat(250), heading: 'One useful action', paragraphs: ['Read the guide.'], ctaLabel: 'Open my calendar' });
    try {
      const rendered = renderLifecycle('lifecycle_guide', data, ctx);
      expect(rendered.preheader).not.toMatch(/[\r\n]/); expect(rendered.preheader).toHaveLength(200);
      expect(rendered.html).toContain('&lt;img src=x onerror=bad()&gt; &amp; &quot;preview&quot;');
      expect(rendered.html).not.toContain('<img src=x'); expect(rendered.text).not.toContain('onerror=bad');
    } finally { mock.mockRestore(); }
  });
  it('opens Autopilot settings for the bound business without putting activation in the email URL', () => {
    const businessId = '00000000-0000-4000-8000-000000000002';
    const guide = { version: 1 as const, id: 'autopilot_intro' as const, businessId, context: { access: 'workspace' as const, gscConnected: false } };
    const mail = renderLifecycle('lifecycle_guide', { guide }, ctx);
    const target = new URL('/api/b/current', ctx.appUrl);
    target.searchParams.set('id', businessId);
    target.searchParams.set('next', '/settings?section=autopilot');
    expect(mail.text).toContain(`Open Autopilot settings: ${target.href}`);
    expect(mail.html).not.toMatch(/<h1[\s>]/i);
    expect(mail.text).not.toMatch(/enabled=true|autopilot\.set|api\/.*act/);
    expect(() => renderLifecycle('lifecycle_guide', { guide: { ...guide, businessId: undefined } }, ctx)).toThrow('Invalid lifecycle guide');
    expect(() => renderLifecycle('lifecycle_guide', { guide: { ...guide, businessId: 'https://foreign.example' } }, ctx)).toThrow('Invalid lifecycle guide');
  });
  it('keeps the Autopilot introduction truthful and gated outside an active workspace', () => {
    for (const access of ['start_trial', 'restart', 'setup'] as const) {
      const mail = renderLifecycle('lifecycle_guide', { guide: { version: 1, id: 'autopilot_intro', context: { access, gscConnected: false } } }, ctx);
      expect(mail.text).toContain(access === 'setup' ? '/onboarding' : '/start-trial');
      expect(mail.text).not.toContain('/api/b/current');
      expect(mail.html).not.toMatch(/<h1[\s>]/i);
    }
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
    expect(direct.text).toContain('Add your website to create your Business Profile');
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
  it('keeps the signed optional preference destination and account preferences for receipts', () => {
    expect(renderLifecycle('founder_note', data, ctx).text).toContain(`Email preferences: ${ctx.unsubscribeUrl}`);
    expect(renderLifecycle('invoice_paid', data, ctx).text).toContain(`Email preferences: ${ctx.appUrl}/email-preferences`);
  });
  it('requires a reset link on the configured origin with a fragment token', () => {
    expect(() => renderLifecycle('password_reset', { resetUrl: 'https://evil.test/reset-password#token=stolen' }, ctx)).toThrow('Invalid reset');
    expect(() => renderLifecycle('password_reset', { resetUrl: 'https://radar.thally.io/reset-password?token=x' }, ctx)).toThrow('Invalid reset');
    expect(renderLifecycle('password_reset', data, ctx).text).toContain('one hour');
  });
  it('does not describe expired subscription setup as a voluntary cancellation', () => {
    expect(renderLifecycle('subscription_ended', { status: 'incomplete_expired' }, ctx).text).toContain('subscription setup expired before it was completed');
  });
  it.each(['brief_reply', 'calendar_review', 'article_social', 'social_publish'] as const)('makes %s useful without inventing outcomes', kind => {
    const section = { ...data.workSections![0], kind, title: 'How to plan your first product launch' };
    const mail = renderLifecycle('work_update', { ...data, workSections: [section] }, ctx);
    expect(mail.text).not.toMatch(/35%|guarantee|haven.t replied|haven.t posted/i);
    expect(mail.text).toContain(`Email preferences: ${ctx.unsubscribeUrl}`);
    expect(mail.text).toContain('348 Business Bay, Dubai, UAE');
    const html = mail.html.replace(/&amp;/g, '&');
    expect(html).toContain('/email/open?businessId=00000000-0000-4000-8000-000000000002&kind=' + kind);
    expect(mail.html).toContain('width="28"');
  });
  it('combines up to three sections without duplicating the primary button or accepting arbitrary destinations', () => {
    const sections: WorkUpdateSection[] = [data.workSections![0], { ...data.workSections![0], kind: 'calendar_review', eventId: '00000000-0000-4000-8000-000000000003', count: 8 }];
    const mail = renderLifecycle('work_update', { workSections: sections }, ctx);
    expect(mail.text).toContain('3 conversations'); expect(mail.text).toContain('8 proposed topics');
    expect(mail.html.match(/background:#17181c/g)).toHaveLength(1);
    expect(() => renderLifecycle('work_update', { workSections: [] }, ctx)).toThrow('Invalid work');
    expect(() => renderLifecycle('work_update', { workSections: sections }, { appUrl: ctx.appUrl })).toThrow('Invalid work');
    expect(() => renderLifecycle('work_update', { workSections: [sections[0], sections[0]] }, ctx)).toThrow('Invalid work');
    expect(() => renderLifecycle('work_update', { workSections: [{ ...sections[0], kind: 'https://other.example' as any }] }, ctx)).toThrow('Invalid work');
    const escaped = renderLifecycle('work_update', { workSections: [{ ...sections[0], businessName: '<script>bad()</script>' }] }, ctx);
    expect(escaped.html).not.toContain('<script>'); expect(escaped.html).toContain('&lt;script&gt;');
  });

});
