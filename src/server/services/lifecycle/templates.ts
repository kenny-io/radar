import { FEE_CENTS, PRICE_CENTS, TRIAL_DAYS } from '@/lib/billing';

export const LIFECYCLE_TYPES = ['welcome', 'founder_note', 'password_reset', 'workspace_ready', 'trial_started', 'trial_ending', 'invoice_paid', 'payment_failed', 'cancellation_scheduled', 'subscription_ended'] as const;
export type LifecycleType = typeof LIFECYCLE_TYPES[number];
export interface LifecycleData {
  name?: string; businessName?: string; businessId?: string; resetUrl?: string;
  profileAnalyzed?: boolean;
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

/** Pure templates. One first-party brand image; no tracking pixels or token-bearing image URLs. */
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
      subject = 'Welcome to Radar';
      if (d.profileAnalyzed) {
        heading = 'Your Business Profile is ready.';
        paragraphs = [d.businessName ? `Radar has analyzed your website and created the Business Profile for ${d.businessName}.` : 'Radar has analyzed your website and created your Business Profile.', 'That profile is the starting point for your articles, social posts and replies. Open Radar to continue from where you left off.'];
        cta = 'Continue with my profile';
      } else {
        heading = 'Welcome to Radar.';
        paragraphs = ['Your account is ready. Open Radar to pick up where you left off.'];
        cta = 'Open Radar';
      }
      href = app('/dashboard'); break;
    case 'founder_note':
      subject = 'Why we built Radar'; heading = 'A note from Ekene';
      paragraphs = ['I’m Ekene, Radar’s founder.', 'It’s never been easier to build a product. But getting it beyond your own network is still a full-time job.', 'That’s why we built Radar. We wanted to take on the marketing work that helps good products reach the people who need them.', 'If you get stuck or anything is unclear, reply here. I’m happy to help.\n\nEkene'];
      cta = 'Reply to Ekene'; href = 'mailto:team@thally.io'; break;
    case 'password_reset': {
      subject = 'Reset your Radar password'; heading = 'Choose a new password';
      const reset = new URL(d.resetUrl || '');
      if (reset.origin !== origin.origin || reset.pathname !== '/reset-password' || !new URLSearchParams(reset.hash.slice(1)).get('token')) throw new Error('Invalid reset URL');
      paragraphs = ['Use the button below to choose a new password for Radar.', 'This link works once and expires one hour after you requested it. You’ll need to sign in again on your devices after changing your password.', 'If you didn’t ask for this, ignore this email. Your password hasn’t changed.'];
      cta = 'Reset password'; href = reset.href; break;
    }
    case 'workspace_ready':
      subject = 'Your Radar workspace is ready'; heading = 'Your workspace is open.';
      paragraphs = [`${d.businessName || 'Your business'} is now set up in Radar.`, 'Open Content Calendar to plan your articles, or Daily Brief to find conversations worth joining.', 'Search Console data and keyword estimates may still be collecting. You’ll see their progress in Radar.'];
      cta = 'Open my workspace'; href = app('/dashboard'); break;
    case 'trial_started':
      subject = 'Your Radar trial is on'; heading = `${TRIAL_DAYS} days to try Radar`;
      paragraphs = [`Your trial ends on ${date(d.trialEnd)}.`, `The ${confirmation} you paid to confirm your card comes off your first month. That’s normally ${first}, then ${monthly}/month. Any tax or other adjustments will be shown on your invoice.`, 'If you don’t want to continue, cancel in Settings → Billing before the trial ends. Otherwise, your subscription will renew automatically.'];
      cta = 'Manage subscription'; href = billing; break;
    case 'trial_ending':
      subject = 'Your Radar trial ends soon'; heading = 'Your trial is nearly up.';
      paragraphs = [`Your trial ends on ${date(d.trialEnd)}.`, `If you continue, your first month is normally ${first} after the ${confirmation} card-confirmation credit, then ${monthly}/month. Any tax or other adjustments will be shown on your invoice.`, 'No action is needed to keep Radar. To avoid the monthly charge, cancel in Settings → Billing before your trial ends.'];
      cta = 'Manage subscription'; href = billing; break;
    case 'invoice_paid':
      subject = 'Your Radar receipt'; heading = 'Payment received. Thank you.';
      paragraphs = [d.amountCents == null ? 'Your Radar invoice is paid.' : `We’ve received your ${money(d.amountCents, d.currency)} payment for Radar.`, ...(d.invoiceNumber ? [`Invoice: ${d.invoiceNumber}.`] : []), 'Your invoice and receipt are in Settings → Billing.'];
      cta = 'View invoices'; href = billing; break;
    case 'payment_failed':
      subject = 'Your Radar payment didn’t go through'; heading = 'Please check your payment method.';
      paragraphs = [d.amountCents == null ? 'We couldn’t collect your Radar payment.' : `We couldn’t collect your ${money(d.amountCents, d.currency)} payment for Radar.`, 'Open Billing to update your card and pay the invoice. Access may be paused until it’s paid.'];
      cta = 'Open Billing'; href = billing; break;
    case 'cancellation_scheduled':
      subject = 'Your Radar cancellation is confirmed'; heading = 'Your cancellation is confirmed.';
      paragraphs = [`You can keep using Radar until ${date(d.periodEnd)}.`, 'Your subscription won’t renew after that. You can change this in Settings → Billing before it ends.'];
      cta = 'Manage subscription'; href = billing; break;
    case 'subscription_ended':
      subject = 'Your Radar subscription has ended'; heading = 'Your subscription has ended';
      paragraphs = [d.status === 'incomplete_expired' ? 'Your subscription setup expired before payment was completed.' : 'Your Radar subscription is no longer active.', 'You can restart from your account. You’ll see the amount due before confirming payment.'];
      cta = 'Open my account'; href = app('/start-trial'); break;
  }
  const replyTo = type === 'founder_note' ? 'team@thally.io' : 'support@thally.io';
  const optional = type === 'founder_note' && ctx.unsubscribeUrl;
  const footer = 'Radar is a Thally product, operated by Fairspleet LLC.';
  const text = [hi, heading, ...paragraphs, ...steps.map((s, i) => `${i + 1}. ${s}`), `${cta}: ${href}`, `Reply to this email or write to ${replyTo}.`, footer, ...(optional ? [`Stop optional setup emails: ${optional}`] : [])].join('\n\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f5f5f2;color:#17181c;font-family:Arial,sans-serif;line-height:1.6"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 16px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;background:#fff;border:1px solid #deded8;border-radius:16px"><tr><td style="padding:32px"><table role="presentation" style="border-collapse:collapse;margin:0 0 28px"><tr><td style="padding:0 10px 0 0;vertical-align:middle"><img src="${escape(app('/brand/radar-mark-email.png'))}" width="28" height="28" alt="" style="display:block;border:0;background:#fff"></td><td style="padding:0;vertical-align:middle;font-size:18px;font-weight:bold;letter-spacing:-.5px">Radar <span style="font-size:12px;font-weight:normal;letter-spacing:normal;color:#666">by Thally</span></td></tr></table><p>${escape(hi)}</p><h1 style="font-size:26px;line-height:1.2;letter-spacing:-.6px">${escape(heading)}</h1>${paragraphs.map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')}${steps.length ? `<ol style="padding-left:22px">${steps.map(s => `<li style="padding-bottom:12px">${escape(s)}</li>`).join('')}</ol>` : ''}<p style="margin:28px 0"><a href="${escape(href)}" style="display:inline-block;padding:12px 20px;background:#17181c;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">${escape(cta)}</a></p><p style="font-size:13px;color:#555">Reply to this email or write to <a style="color:#34343a" href="mailto:${replyTo}">${replyTo}</a>.</p><hr style="border:0;border-top:1px solid #e4e4df;margin:28px 0 20px"><p style="font-size:12px;color:#666">${footer}</p>${optional ? `<p style="font-size:12px"><a style="color:#555" href="${escape(optional)}">Stop optional setup emails</a></p>` : ''}</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html, replyTo };
}
