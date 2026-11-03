import { FEE_CENTS, PRICE_CENTS, TRIAL_DAYS } from '@/lib/billing';

export const LIFECYCLE_TYPES = ['welcome', 'founder_note', 'password_reset', 'workspace_ready', 'trial_started', 'trial_ending', 'invoice_paid', 'payment_failed', 'cancellation_scheduled', 'subscription_ended'] as const;
export type LifecycleType = typeof LIFECYCLE_TYPES[number];
export interface LifecycleData {
  name?: string; businessName?: string; businessId?: string; resetUrl?: string;
  trialEnd?: string; periodEnd?: string; amountCents?: number; currency?: string; invoiceNumber?: string;
  subscriptionId?: string; invoiceId?: string; attemptCount?: number; status?: string;
}
export interface RenderContext { appUrl: string; unsubscribeUrl?: string }
export interface RenderedLifecycle { subject: string; text: string; html: string; replyTo: string }
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: number, currency = 'USD') => {
  if (!Number.isSafeInteger(n) || n < 0 || !/^[A-Za-z]{3}$/.test(currency)) throw new Error('Invalid lifecycle amount');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(n / 100);
};
const date = (s: string | undefined) => {
  if (!s || !Number.isFinite(new Date(s).getTime())) throw new Error('Lifecycle date required');
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(s)) + ' UTC';
};

/** Pure, portable templates. No external assets or account tokens in tracking URLs. */
export function renderLifecycle(type: LifecycleType, d: LifecycleData, ctx: RenderContext): RenderedLifecycle {
  const origin = new URL(ctx.appUrl);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid app URL');
  const app = (path: string) => new URL(path, origin).href;
  let subject: string, heading: string, paragraphs: string[], steps: string[] = [], cta: string, href: string;
  const hi = d.name?.trim() ? `Hi ${d.name.trim()},` : 'Hi there,';
  const monthly = money(PRICE_CENTS), first = money(PRICE_CENTS - FEE_CENTS), confirmation = money(FEE_CENTS);
  const billing = app('/settings?section=billing');
  switch (type) {
    case 'welcome':
      subject = 'Welcome to Radar — here’s where to start'; heading = 'Your next steps with Radar';
      paragraphs = ['Your Radar account is ready. Start with your website so Radar can learn what your business does and who it serves.'];
      steps = ['Add your website and review your Business Profile. Correct anything Radar should know before it drafts for you.', 'Connect Google Search Console if you have it. You can skip this and connect it later.', 'Finish setup, review the trial terms, then open your dashboard to choose your first next step.'];
      paragraphs.push('Creating an account alone does not start a paid subscription. Radar asks you to confirm the trial terms and payment before your trial starts.');
      cta = 'Continue setup'; href = app('/start'); break;
    case 'founder_note':
      subject = 'A quick check-in from Ekene, Radar’s founder'; heading = 'How is setup going?';
      paragraphs = ['I’m Ekene, the founder of Radar. I wanted to check that you could get into your account and finish your Business Profile.', 'If setup got stuck, reply with the step you reached and your website. We can help you work through it. Please don’t send passwords, API keys or payment details.', 'Once you’re in, start with one task in your dashboard. Review what Radar suggests before you publish anything.', 'Thanks for giving Radar a try.\nEkene'];
      cta = 'Open Radar'; href = app('/dashboard'); break;
    case 'password_reset': {
      subject = 'Reset your Radar password'; heading = 'Choose a new password';
      const reset = new URL(d.resetUrl || '');
      if (reset.origin !== origin.origin || reset.pathname !== '/reset-password' || !new URLSearchParams(reset.hash.slice(1)).get('token')) throw new Error('Invalid reset URL');
      paragraphs = ['We received a request to reset the password for your Radar account. Use the link below to choose a new one.', 'This link is valid for up to one hour from your request and can be used once. Changing your password signs out your existing sessions.', 'If you didn’t request this, you can ignore this email. Your password has not changed.'];
      cta = 'Reset password'; href = reset.href; break;
    }
    case 'workspace_ready':
      subject = `${d.businessName || 'Your business'} is set up on Radar`; heading = 'Your Business Profile is saved';
      paragraphs = [`${d.businessName || 'Your business'} is ready to open in Radar. Your saved Business Profile will guide its suggestions and drafts.`, 'Open your dashboard to review your next steps. Search Console data, keyword estimates and other analyses may still be collecting; Radar shows their status in the app.', 'Review your profile and publishing settings before turning on any automatic publishing.'];
      cta = 'Open your dashboard'; href = app('/dashboard'); break;
    case 'trial_started':
      subject = 'Your Radar trial has started'; heading = `Your ${TRIAL_DAYS}-day trial is active`;
      paragraphs = [`Your trial ends on ${date(d.trialEnd)}. The ${confirmation} card-confirmation payment is credited toward your first monthly invoice.`, `Unless you cancel before the trial ends, your first monthly invoice is normally ${first} after that credit, then ${monthly} per month. Applicable taxes or other account adjustments, if any, appear on the invoice.`, 'You can review your subscription, update payment details or cancel in Settings → Billing.'];
      cta = 'Open billing settings'; href = billing; break;
    case 'trial_ending':
      subject = 'Your Radar trial ends soon'; heading = 'A reminder before your trial ends';
      paragraphs = [`Your Radar trial ends on ${date(d.trialEnd)}.`, `If you keep your subscription, the first monthly invoice is normally ${first} after your ${confirmation} card-confirmation credit, then ${monthly} per month. Applicable taxes or other account adjustments, if any, appear on the invoice.`, 'To avoid the monthly subscription charge, cancel before the trial ends in Settings → Billing.'];
      cta = 'Review your subscription'; href = billing; break;
    case 'invoice_paid':
      subject = 'Your Radar payment was received'; heading = 'Payment received';
      paragraphs = [d.amountCents == null ? 'Your Radar invoice has been marked paid.' : `Your Radar invoice has been marked paid: ${money(d.amountCents, d.currency)}.`, ...(d.invoiceNumber ? [`Invoice: ${d.invoiceNumber}.`] : []), 'Open Settings → Billing to view your invoices, download a receipt or manage your subscription.'];
      cta = 'View billing and invoices'; href = billing; break;
    case 'payment_failed':
      subject = 'Action needed: your Radar payment failed'; heading = 'Please check your payment details';
      paragraphs = [d.amountCents == null ? 'The payment for your Radar invoice did not complete.' : `The payment for your Radar invoice of ${money(d.amountCents, d.currency)} did not complete.`, 'Open Settings → Billing to review the invoice and update your payment method. Your subscription access may be paused while payment is outstanding.', 'If you believe this is a mistake, reply to this email and we’ll help. Please don’t send card details.'];
      cta = 'Review payment details'; href = billing; break;
    case 'cancellation_scheduled':
      subject = 'Your Radar cancellation is scheduled'; heading = 'Your subscription will end';
      paragraphs = [`Your cancellation is scheduled for ${date(d.periodEnd)}. You can keep using Radar until your current trial or paid access period ends.`, 'No new monthly subscription period will begin after that cancellation. Any existing unpaid invoice remains available in billing.', 'If you change your mind before then, open Settings → Billing to review the available options.'];
      cta = 'Review cancellation'; href = billing; break;
    case 'subscription_ended':
      subject = 'Your Radar subscription has ended'; heading = 'Your subscription has ended';
      paragraphs = [d.status === 'incomplete_expired' ? 'Your Radar subscription setup expired before payment was completed. Subscription access is not active.' : 'Your Radar subscription has ended, and subscription access is no longer active.', 'Open Radar to review your account or restart your subscription. Restart pricing and any outstanding invoice are shown before you confirm payment.', 'If you didn’t expect this, reply and we’ll help you check what happened.'];
      cta = 'Open your account'; href = app('/start-trial'); break;
  }
  const replyTo = type === 'founder_note' ? 'team@thally.io' : 'support@thally.io';
  const optional = type === 'founder_note' && ctx.unsubscribeUrl;
  const footer = 'Radar is a Thally product, operated by Fairspleet LLC.';
  const text = [hi, heading, ...paragraphs, ...steps.map((s, i) => `${i + 1}. ${s}`), `${cta}: ${href}`, `Need help? Reply to ${replyTo}.`, footer, ...(optional ? [`Stop optional setup emails: ${optional}`] : [])].join('\n\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f5f5f2;color:#17181c;font-family:Arial,sans-serif;line-height:1.6"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 16px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;background:#fff;border:1px solid #deded8;border-radius:16px"><tr><td style="padding:32px"><p style="font-size:18px;font-weight:bold;letter-spacing:-.5px;margin:0 0 28px">◉ Radar <span style="font-size:12px;font-weight:normal;color:#666">by Thally</span></p><p>${escape(hi)}</p><h1 style="font-size:26px;line-height:1.2;letter-spacing:-.6px">${escape(heading)}</h1>${paragraphs.map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')}${steps.length ? `<ol style="padding-left:22px">${steps.map(s => `<li style="padding-bottom:12px">${escape(s)}</li>`).join('')}</ol>` : ''}<p style="margin:28px 0"><a href="${escape(href)}" style="display:inline-block;padding:12px 20px;background:#17181c;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">${escape(cta)}</a></p><p style="font-size:13px;color:#555">Need help? Reply to <a style="color:#34343a" href="mailto:${replyTo}">${replyTo}</a>.</p><hr style="border:0;border-top:1px solid #e4e4df;margin:28px 0 20px"><p style="font-size:12px;color:#666">${footer}</p>${optional ? `<p style="font-size:12px"><a style="color:#555" href="${escape(optional)}">Stop optional setup emails</a></p>` : ''}</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html, replyTo };
}
