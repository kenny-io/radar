import { GUIDE_IDS, renderGuide, type GuideId } from './guideContent';
import { EDUCATION_LESSONS, renderEducationLesson, educationProgress, type EducationLessonId, type EducationContext } from './educationContent';
import { FEE_CENTS, PRICE_CENTS, TRIAL_DAYS } from '@/lib/billing';

export const LIFECYCLE_TYPES = ['welcome', 'founder_note', 'password_reset', 'trial_started', 'trial_ending', 'invoice_paid', 'payment_failed', 'cancellation_scheduled', 'subscription_ended', 'work_update', 'weekly_education', 'lifecycle_guide'] as const;
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
  guide?: { version: 1; id: GuideId; context: EducationContext; businessId?: string };
  education?: { version: 1; lesson: EducationLessonId; context: EducationContext; businessId?: string };
  trialEnd?: string; periodEnd?: string; amountCents?: number; currency?: string; invoiceNumber?: string;
  subscriptionId?: string; invoiceId?: string; attemptCount?: number; status?: string;
}
export interface RenderContext { appUrl: string; unsubscribeUrl?: string }
export interface RenderedLifecycle { preheader?: string; subject: string; text: string; html: string; replyTo: string }
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
  let preheader = '';
  let progress = '';
  let work: { heading: string; paragraph: string; cta: string; href: string }[] = [];
  const billing = app('/settings?section=billing');
  switch (type) {
    case 'lifecycle_guide': {
      const g = d.guide;
      if (!ctx.unsubscribeUrl || g?.version !== 1 || !GUIDE_IDS.includes(g.id) ||
        !['workspace', 'start_trial', 'restart', 'setup'].includes(g.context?.access) || typeof g.context?.gscConnected !== 'boolean' ||
        ['businessName', 'industry', 'offering', 'audience', 'keyword'].some(key => { const value = g.context[key as keyof EducationContext]; return value !== undefined && (typeof value !== 'string' || value.length > 200); }) ||
        (g.businessId && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(g.businessId))) throw new Error('Invalid lifecycle guide');
      const content = renderGuide(g.id, g.context);
      ({ subject, heading, paragraphs, preheader } = content);
      steps = content.steps || [];
      progress = content.progress || '';
      cta = content.ctaLabel;
      href = g.id === 'search_refresh' ? app('/blog/page-two-refresh') : g.context.access === 'workspace'
        ? app('/email/learn?' + new URLSearchParams({ lesson: 'organic_search', ...(g.businessId ? { businessId: g.businessId } : {}) }))
        : app(g.context.access === 'setup' ? '/onboarding' : '/start-trial');
      break;
    }
    case 'weekly_education': {
      const e = d.education;
      if (!ctx.unsubscribeUrl || e?.version !== 1 || !EDUCATION_LESSONS.includes(e.lesson) ||
        !['workspace', 'start_trial', 'restart', 'setup'].includes(e.context?.access) || typeof e.context?.gscConnected !== 'boolean' ||
        ['businessName', 'industry', 'offering', 'audience', 'keyword'].some(key => { const value = e.context[key as keyof EducationContext]; return value !== undefined && (typeof value !== 'string' || value.length > 200); }) ||
        (e.businessId && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(e.businessId))) throw new Error('Invalid education lesson');
      const content = renderEducationLesson(e.lesson, e.context);
      ({ subject, heading, paragraphs, steps, preheader } = content);
      if (steps.length !== 2) throw new Error('Education requires two actions');
      progress = educationProgress(e.lesson);
      cta = content.ctaLabel;
      href = e.context.access === 'workspace' ? app('/email/learn?' + new URLSearchParams({ lesson: e.lesson, ...(e.businessId ? { businessId: e.businessId } : {}) })) : app(e.context.access === 'setup' ? '/onboarding' : '/start-trial');
      break;
    }
    case 'welcome':
      subject = d.profileAnalyzed ? 'Put your Business Profile to work' : 'Welcome to Radar';
      preheader = d.profileAnalyzed ? 'Your website analysis is saved. Pick up from your Business Profile.' : 'Your account is ready. Continue from where you left off.';
      if (d.profileAnalyzed) {
        heading = 'Your Business Profile is ready.';
        paragraphs = [d.businessName ? `Your website analysis and Business Profile for ${d.businessName} are saved in Radar.` : 'Your website analysis and Business Profile are saved in Radar.', 'Review what Radar learned about your business, audience and voice. That profile guides the topics, posts and replies it prepares for you.', 'Start with one question you’d want your next customer to find an answer to. Open Radar to continue from your profile.'];
        cta = 'Continue with my profile';
      } else {
        heading = 'Welcome to Radar.';
        paragraphs = ['Your Radar account is ready. Open it to continue from where you left off.', 'Your website and Business Profile give Radar the context for the articles, social posts and replies it prepares. You can review that context as you get started.'];
        cta = 'Open Radar';
      }
      href = app('/dashboard'); break;
    case 'founder_note':
      subject = 'Why we built Radar'; heading = 'A note from Ekene';
      preheader = 'Building is easier. Getting your product beyond your own network still takes work.';
      paragraphs = ['I’m Ekene, Radar’s founder.', 'It’s never been easier to build a product. But getting it beyond your own network is still a full-time job.', 'That’s why we built Radar. We wanted to take on the marketing work that helps good products reach the people who need them.', 'If you get stuck or anything is unclear, reply and tell me what you’re trying to do. I’m happy to help.\n\nEkene'];
      cta = 'Reply to Ekene'; href = 'mailto:team@thally.io'; break;
    case 'password_reset': {
      subject = 'Reset your Radar password'; heading = 'Choose a new password';
      preheader = 'Use your one-time link within an hour to choose a new password.';
      const reset = new URL(d.resetUrl || '');
      if (reset.origin !== origin.origin || reset.pathname !== '/reset-password' || !new URLSearchParams(reset.hash.slice(1)).get('token')) throw new Error('Invalid reset URL');
      paragraphs = ['Use this link to choose a new password for your Radar account.', 'The link works once and expires one hour after the request. After changing your password, sign in again on your devices.', 'If you didn’t request a reset, you can ignore this email.'];
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
          case 'brief_reply': return { heading: `${section.businessName} · Daily Brief`, paragraph: `${section.count} ${section.count === 1 ? 'conversation is' : 'conversations are'} ready to review. Read the original thread for one you can help with, edit the suggested reply and join in.`, cta: 'Review a conversation', href };
          case 'calendar_review': return { heading: `${section.businessName} · Content Calendar`, paragraph: `${section.count} proposed ${section.count === 1 ? 'topic is' : 'topics are'} waiting in your content plan. Open one, check the question it should answer and approve it if it’s useful. You can review the draft when it’s ready.`, cta: 'Choose my next topic', href };
          case 'article_social': return { heading: `${section.businessName} · Article to social`, paragraph: `${section.title ? `“${section.title}”` : 'Your article'} is ready to use in a social pack. Choose an idea from it, let Radar prepare the posts and check each one before sharing.`, cta: 'Make posts from my article', href };
          case 'social_publish': return { heading: `${section.businessName} · Social posts`, paragraph: `Your social posts${section.title ? ` for “${section.title}”` : ''} are saved in Radar. Check the wording, image and link, then publish one or choose a time to schedule it.`, cta: 'Review and schedule my posts', href };
          default: throw new Error('Invalid work section');
        }
      });
      const first = d.workSections[0].kind;
      subject = work.length > 1 ? 'A few things to pick up in Radar' : ({ brief_reply: 'Conversations worth joining', calendar_review: 'Choose the topics you want to publish', article_social: 'Turn your article into social posts', social_publish: 'Your social posts are ready to schedule' }[first]);
      preheader = work.length > 1 ? 'Choose one useful next step from the work already saved in your account.' : ({ brief_reply: 'Read a thread, edit the reply and add something useful to the conversation.', calendar_review: 'Pick a proposed topic you want Radar to draft.', article_social: 'Use an idea from your article in a post you can review and share.', social_publish: 'Check your saved posts and choose when to share them.' }[first]);
      heading = work.length > 1 ? 'Pick up where you left off.' : subject;
      paragraphs = work.length > 1 ? ['There’s work saved in your account that you can pick up. Choose one next step when you open Radar.'] : [];
      cta = work[0].cta; href = work[0].href; break;
    }
    case 'trial_started':
      subject = 'Your Radar trial is on'; heading = `${TRIAL_DAYS} days to try Radar`;
      preheader = 'Your trial end date, first-month credit and subscription controls.';
      paragraphs = [`Your Radar trial ends on ${date(d.trialEnd)}.`, `Your ${confirmation} card-confirmation payment is credited to your first month. That month is normally ${first}, followed by ${monthly}/month. Your invoice shows any tax or other adjustments.`, 'Your subscription continues automatically after the trial. To avoid the monthly charge, cancel before the end date in Settings → Billing.'];
      cta = 'Manage subscription'; href = billing; break;
    case 'trial_ending':
      subject = 'Your Radar trial ends soon'; heading = 'Your trial is nearly up.';
      preheader = 'Check the renewal date and amount, or manage your subscription before it renews.';
      paragraphs = [`Your Radar trial ends on ${date(d.trialEnd)}. Your subscription will then continue automatically.`, `Your first month is normally ${first} after the ${confirmation} card-confirmation credit, followed by ${monthly}/month. Your invoice shows any tax or other adjustments.`, 'To avoid the monthly charge, cancel in Settings → Billing before your trial ends. You can also review your subscription there.'];
      cta = 'Manage subscription'; href = billing; break;
    case 'invoice_paid':
      subject = 'Your Radar receipt'; heading = 'Payment received. Thank you.';
      preheader = 'Your payment details and where to download the invoice.';
      paragraphs = [d.amountCents == null ? 'Your Radar invoice is paid.' : `We’ve received your ${money(d.amountCents, d.currency)} payment for Radar.`, ...(d.invoiceNumber ? [`Invoice: ${d.invoiceNumber}.`] : []), 'To view or download your invoice, open Settings → Billing, then Manage billing.'];
      cta = 'Open Billing'; href = billing; break;
    case 'payment_failed':
      subject = 'Your Radar payment didn’t go through'; heading = 'Please check your payment method.';
      preheader = 'Open Billing to check your card and pay the outstanding invoice.';
      paragraphs = [d.amountCents == null ? 'Your Radar invoice payment didn’t go through.' : `Your ${money(d.amountCents, d.currency)} invoice payment for Radar didn’t go through.`, 'Open Billing to check or update your payment method and pay the invoice. Access may be paused while it remains unpaid.'];
      cta = 'Review my payment'; href = billing; break;
    case 'cancellation_scheduled':
      subject = 'Your Radar cancellation is confirmed'; heading = 'Your cancellation is confirmed.';
      preheader = 'Your access continues until the end date shown in this email.';
      paragraphs = [`You can keep using Radar until ${date(d.periodEnd)}. Your subscription won’t renew after that date.`, 'If you decide to continue, open Settings → Billing before it ends to manage the cancellation.'];
      cta = 'Manage subscription'; href = billing; break;
    case 'subscription_ended':
      subject = 'Your Radar subscription has ended'; heading = 'Your subscription has ended';
      preheader = d.status === 'incomplete_expired' ? 'Subscription setup expired before payment was completed.' : 'Open your account if you’d like to restart access.';
      paragraphs = [d.status === 'incomplete_expired' ? 'Your subscription setup expired before payment was completed.' : 'Your Radar subscription is no longer active.', 'To restart access, open your account and review the amount due before confirming payment.'];
      cta = 'Review restart options'; href = app('/start-trial'); break;
  }
  // A real inbox preview is plain text and is escaped independently from the visible email body.
  preheader = (preheader || subject).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const replyTo = type === 'founder_note' ? 'team@thally.io' : 'support@thally.io';
  const optional = (type === 'founder_note' || type === 'work_update' || type === 'weekly_education' || type === 'lifecycle_guide') && ctx.unsubscribeUrl;
  const optoutLabel = type === 'lifecycle_guide' || type === 'weekly_education' ? 'Stop Radar lessons and guides' : type === 'work_update' ? 'Turn off work reminders' : 'Stop optional setup emails';
  const preferencesUrl = optional || app('/email-preferences');
  const company = (type === 'work_update' || type === 'weekly_education' || type === 'lifecycle_guide') ? 'Fairspleet LLC · 348 Business Bay, Dubai, UAE' : '';
  const buttonStyle = 'display:inline-block;padding:7px 16px;font-size:14px;line-height:20px;background:#17181c;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold';
  const footer = `Privacy: ${app('/privacy')} · Terms: ${app('/terms')}`;
  const text = [hi, heading, ...paragraphs, ...steps.map((s, i) => `${i + 1}. ${s}`), ...(progress ? [progress] : []), ...(work.length ? work.flatMap(w => [w.heading, w.paragraph, `${w.cta}: ${w.href}`]) : [`${cta}: ${href}`]), `Reply to this email or write to ${replyTo}.`, footer, `Email preferences: ${preferencesUrl}`, ...(company ? [company] : []), ...(optional ? [`${optoutLabel}: ${optional}`] : [])].join('\n\n');
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f5f5f2;color:#17181c;font-family:Arial,sans-serif;line-height:1.6;overflow-wrap:anywhere;word-break:break-word"><div lang="en" dir="ltr" aria-hidden="true" style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all">${escape(preheader)}</div><table lang="en" dir="ltr" role="presentation" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td style="padding:32px 16px"><table role="presentation" style="width:100%;max-width:600px;table-layout:fixed;margin:auto;background:#fff;border:1px solid #deded8;border-radius:16px"><tr><td style="padding:32px"><table role="presentation" style="border-collapse:collapse;margin:0 0 28px"><tr><td style="padding:0 10px 0 0;vertical-align:middle"><img src="${escape(app('/brand/radar-mark-email.png'))}" width="28" height="28" alt="" style="display:block;border:0;background:#fff"></td><td style="padding:0;vertical-align:middle;font-size:18px;font-weight:bold;letter-spacing:-.5px">Radar <span style="font-size:12px;font-weight:normal;letter-spacing:normal;color:#666">by Thally</span></td></tr></table><p>${escape(hi)}</p><h1 style="font-size:26px;line-height:1.2;letter-spacing:-.6px">${escape(heading)}</h1>${paragraphs.map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')}${steps.length ? `<ol style="padding-left:22px">${steps.map(s => `<li style="padding-bottom:12px">${escape(s)}</li>`).join('')}</ol>` : ''}${progress ? `<p>${escape(progress)}</p>` : ''}${work.length ? work.map((w, i) => `<section style="margin:24px 0"><h2 style="font-size:16px;line-height:1.4;margin:0 0 8px">${escape(w.heading)}</h2><p>${escape(w.paragraph)}</p><p><a href="${escape(w.href)}" style="${i === 0 ? buttonStyle : 'font-size:14px;color:#17181c;text-decoration:underline;font-weight:bold'}">${escape(w.cta)}</a></p></section>`).join('') : `<p style="margin:28px 0"><a href="${escape(href)}" style="${buttonStyle}">${escape(cta)}</a></p>`}<p style="font-size:13px;color:#555">Reply to this email or write to <a style="color:#34343a" href="mailto:${replyTo}">${replyTo}</a>.</p><hr style="border:0;border-top:1px solid #e4e4df;margin:28px 0 20px"><p style="font-size:12px;color:#666"><a style="color:#666" href="${escape(app('/privacy'))}">Privacy</a> &middot; <a style="color:#666" href="${escape(app('/terms'))}">Terms</a></p>${company ? `<p style="font-size:11px;color:#777">${escape(company)}</p>` : ''}${preferencesUrl ? `<p style="margin:16px 0"><a href="${escape(preferencesUrl)}" style="display:inline-block;padding:6px 12px;border:1px solid #d5d5d0;border-radius:6px;color:#34343a;font-size:12px;line-height:18px;text-decoration:none">Email preferences</a></p>` : ''}${optional ? `<p style="font-size:12px"><a style="color:#555" href="${escape(optional)}">${optoutLabel}</a></p>` : ''}</td></tr></table></td></tr></table></body></html>`;
  return { subject, preheader, text, html, replyTo };
}
