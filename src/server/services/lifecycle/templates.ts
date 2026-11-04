import { FEE_CENTS, PRICE_CENTS, TRIAL_DAYS } from '@/lib/billing';

export const LIFECYCLE_TYPES = ['welcome', 'founder_note', 'password_reset', 'trial_started', 'trial_ending', 'invoice_paid', 'payment_failed', 'cancellation_scheduled', 'subscription_ended', 'work_update'] as const;
export type LifecycleType = typeof LIFECYCLE_TYPES[number];
export interface WorkUpdateSection {
  eventId: string;
  kind: 'brief_reply' | 'calendar_review' | 'article_social' | 'social_publish';
  businessId: string;
  businessName: string;
  ref: string;
  count: number;
  title?: string;
}
export interface LifecycleData {
  name?: string; businessName?: string; businessId?: string; resetUrl?: string;
  profileAnalyzed?: boolean;
  workSections?: WorkUpdateSection[];
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
  let work: { heading: string; paragraph: string; cta: string; href: string }[] = [];
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
    case 'work_update': {
      if (!ctx.unsubscribeUrl || !d.workSections?.length || d.workSections.length > 3) throw new Error('Invalid work update');
      const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
      const seen = new Set<string>();
      work = d.workSections.map(section => {
        if (!uuid.test(section.eventId) || !uuid.test(section.businessId) || seen.has(section.eventId) ||
          !section.ref || section.ref.length > 200 || !section.businessName?.trim() || section.businessName.length > 200 ||
          !Number.isSafeInteger(section.count) || section.count < 1 || section.count > 10000 || (section.title?.length || 0) > 300) throw new Error('Invalid work section');
        seen.add(section.eventId);
        const href = app('/email/open?' + new URLSearchParams({ businessId: section.businessId, kind: section.kind, ref: section.ref }));
        switch (section.kind) {
          case 'brief_reply': return { heading: `${section.businessName} · Daily Brief`, paragraph: `Your Daily Brief has ${section.count} ${section.count === 1 ? 'conversation' : 'conversations'} ready to review. Pick one where you have something useful to add, make the suggested reply your own, and join in.`, cta: 'Find a conversation', href };
          case 'calendar_review': return { heading: `${section.businessName} · Content Calendar`, paragraph: `${section.count} ${section.count === 1 ? 'topic is' : 'topics are'} ready for review. Approve the ones you want to use, then review and schedule the drafts when they’re ready.`, cta: 'Review my topics', href };
          case 'article_social': return { heading: `${section.businessName} · Article to social`, paragraph: `${section.title ? `“${section.title}”` : 'Your article'} is ready in Radar. Use it to create social posts, then review them before anything goes out.`, cta: 'Create social posts', href };
          case 'social_publish': return { heading: `${section.businessName} · Social posts`, paragraph: `Your posts${section.title ? ` for “${section.title}”` : ''} are saved in your social library. Review them, then publish now or choose a time that works for you.`, cta: 'Review my posts', href };
          default: throw new Error('Invalid work section');
        }
      });
      const first = d.workSections[0].kind;
      subject = work.length > 1 ? 'A few things to pick up in Radar' : ({ brief_reply: 'Conversations worth joining', calendar_review: 'Choose the topics you want to publish', article_social: 'Turn your article into social posts', social_publish: 'Your social posts are ready to schedule' }[first]);
      heading = work.length > 1 ? 'Pick up where you left off.' : subject;
      paragraphs = work.length > 1 ? ['Here’s the work that’s ready for your next step.'] : [];
      cta = work[0].cta; href = work[0].href; break;
    }
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
      paragraphs = [d.amountCents == null ? 'Your Radar invoice is paid.' : `We’ve received your ${money(d.amountCents, d.currency)} payment for Radar.`, ...(d.invoiceNumber ? [`Invoice: ${d.invoiceNumber}.`] : []), 'To view or download your invoice, open Settings → Billing, then Manage billing.'];
      cta = 'Open Billing'; href = billing; break;
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
  const optional = (type === 'founder_note' || type === 'work_update') && ctx.unsubscribeUrl;
  const optoutLabel = type === 'work_update' ? 'Turn off work reminders' : 'Stop optional setup emails';
  const company = type === 'work_update' ? 'Fairspleet LLC · 348 Business Bay, Dubai, UAE' : '';
  const buttonStyle = 'display:inline-block;padding:7px 16px;font-size:14px;line-height:20px;background:#17181c;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold';
  const footer = `Privacy: ${app('/privacy')} · Terms: ${app('/terms')}`;
  const text = [hi, heading, ...paragraphs, ...steps.map((s, i) => `${i + 1}. ${s}`), ...(work.length ? work.flatMap(w => [w.heading, w.paragraph, `${w.cta}: ${w.href}`]) : [`${cta}: ${href}`]), `Reply to this email or write to ${replyTo}.`, footer, ...(company ? [company] : []), ...(optional ? [`${optoutLabel}: ${optional}`] : [])].join('\n\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f5f5f2;color:#17181c;font-family:Arial,sans-serif;line-height:1.6"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 16px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;background:#fff;border:1px solid #deded8;border-radius:16px"><tr><td style="padding:32px"><table role="presentation" style="border-collapse:collapse;margin:0 0 28px"><tr><td style="padding:0 10px 0 0;vertical-align:middle"><img src="${escape(app('/brand/radar-mark-email.png'))}" width="28" height="28" alt="" style="display:block;border:0;background:#fff"></td><td style="padding:0;vertical-align:middle;font-size:18px;font-weight:bold;letter-spacing:-.5px">Radar <span style="font-size:12px;font-weight:normal;letter-spacing:normal;color:#666">by Thally</span></td></tr></table><p>${escape(hi)}</p><h1 style="font-size:26px;line-height:1.2;letter-spacing:-.6px">${escape(heading)}</h1>${paragraphs.map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')}${steps.length ? `<ol style="padding-left:22px">${steps.map(s => `<li style="padding-bottom:12px">${escape(s)}</li>`).join('')}</ol>` : ''}${work.length ? work.map((w, i) => `<section style="margin:24px 0"><h2 style="font-size:16px;line-height:1.4;margin:0 0 8px">${escape(w.heading)}</h2><p>${escape(w.paragraph)}</p><p><a href="${escape(w.href)}" style="${i === 0 ? buttonStyle : 'font-size:14px;color:#17181c;text-decoration:underline;font-weight:bold'}">${escape(w.cta)}</a></p></section>`).join('') : `<p style="margin:28px 0"><a href="${escape(href)}" style="${buttonStyle}">${escape(cta)}</a></p>`}<p style="font-size:13px;color:#555">Reply to this email or write to <a style="color:#34343a" href="mailto:${replyTo}">${replyTo}</a>.</p><hr style="border:0;border-top:1px solid #e4e4df;margin:28px 0 20px"><p style="font-size:12px;color:#666"><a style="color:#666" href="${escape(app('/privacy'))}">Privacy</a> &middot; <a style="color:#666" href="${escape(app('/terms'))}">Terms</a></p>${company ? `<p style="font-size:11px;color:#777">${escape(company)}</p>` : ''}${optional ? `<p style="font-size:12px"><a style="color:#555" href="${escape(optional)}">${optoutLabel}</a></p>` : ''}</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html, replyTo };
}
