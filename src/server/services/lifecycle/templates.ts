import { GUIDE_IDS, renderGuide, type GuideId } from './guideContent';
import { EDUCATION_LESSONS, renderEducationLesson, educationProgress, type EducationLessonId, type EducationContext } from './educationContent';
import { FEE_CENTS, PRICE_CENTS, TRIAL_DAYS } from '@/lib/billing';
import { FOUNDER_REPLY_TO } from '../mailIdentity';

export const LIFECYCLE_TYPES = ['welcome', 'founder_note', 'password_reset', 'trial_started', 'invoice_paid', 'payment_failed', 'cancellation_scheduled', 'subscription_ended', 'work_update', 'weekly_education', 'lifecycle_guide'] as const;
export type LifecycleType = typeof LIFECYCLE_TYPES[number] | 'trial_ending'; // Retired type retained for historical payloads.
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
        (g.businessId && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(g.businessId)) ||
        (g.id === 'autopilot_intro' && g.context.access === 'workspace' && !g.businessId)) throw new Error('Invalid lifecycle guide');
      const content = renderGuide(g.id, g.context);
      ({ subject, heading, paragraphs, preheader } = content);
      steps = content.steps || [];
      progress = content.progress || '';
      cta = content.ctaLabel;
      href = g.id === 'autopilot_intro' && g.context.access === 'workspace' ? app('/api/b/current?' + new URLSearchParams({ id: g.businessId!, next: '/settings?section=autopilot' })) : g.id === 'search_refresh' ? app('/blog/page-two-refresh') : g.context.access === 'workspace'
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
      preheader = d.profileAnalyzed ? 'Check the offering, audience and voice in your saved profile.' : 'Continue setting up your Business Profile.';
      if (d.profileAnalyzed) {
        heading = 'Your Business Profile is ready.';
        paragraphs = ['I’m Ekene, Radar’s founder.', d.businessName ? `Your website analysis and Business Profile for ${d.businessName} are saved. Open the profile and check the description of what you sell, who it’s for and how you want to sound.` : 'Your website analysis and Business Profile are saved. Open the profile and check the description of what you sell, who it’s for and how you want to sound.', 'Correct anything Radar misunderstood before generating content. This is the context it will use for your business.'];
        cta = 'Continue with my profile';
      } else {
        heading = 'Welcome to Radar.';
        paragraphs = ['I’m Ekene, Radar’s founder.', 'Add your website to create your Business Profile, then check that Radar has understood what you sell and who it’s for.', 'Correct the profile before generating content so Radar starts with the right context.'];
        cta = 'Open Radar';
      }
      href = app('/dashboard'); break;
    case 'founder_note':
      subject = 'Why I built Radar'; heading = 'Why I built Radar';
      preheader = 'Building is easier. Getting your product beyond your own network still takes work.';
      paragraphs = ['It’s never been easier to build a product. But getting it beyond your own network is still a full-time job.', 'That’s why I built Radar. I wanted to help founders get the articles, posts and useful conversations out there that help people discover their businesses.', 'What are you trying to get your business known for? Reply and tell me. I’d like to understand what you’re working toward.'];
      cta = 'Reply to Ekene'; href = 'mailto:team@thally.io'; break;
    case 'password_reset': {
      subject = 'Reset your Radar password'; heading = 'Choose a new password';
      preheader = 'Use your one-time link within an hour to choose a new password.';
      const reset = new URL(d.resetUrl || '');
      if (reset.origin !== origin.origin || reset.pathname !== '/reset-password' || !new URLSearchParams(reset.hash.slice(1)).get('token')) throw new Error('Invalid reset URL');
      paragraphs = ['Here’s the link you requested to choose a new password for your Radar account.', 'It works once and expires one hour after the request. After changing your password, sign in again on your devices.', 'If you didn’t request a reset, you can ignore this email.'];
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
          case 'brief_reply': return { heading: `${section.businessName} · Daily Brief`, paragraph: `${section.count} ${section.count === 1 ? 'conversation has' : 'conversations have'} been brought into today’s brief. I’d open a promising thread while it’s current; read the latest replies before deciding whether to join in.`, cta: 'See today’s conversations', href };
          case 'calendar_review': return { heading: `${section.businessName} · Content Calendar`, paragraph: `Your plan has ${section.count} proposed ${section.count === 1 ? 'topic' : 'topics'} awaiting a decision. Open a title, check the proposed angle and approve the one you want Radar to draft. Leave the others for later if they don’t fit.`, cta: 'Choose a topic to draft', href };
          case 'article_social': return { heading: `${section.businessName} · Article to social`, paragraph: `${section.title ? `“${section.title}”` : 'Your article'} is available in your saved articles. Select it as the source in Social Marketing to turn its ideas into a post pack.`, cta: 'Make a pack from this article', href };
          case 'social_publish': return { heading: `${section.businessName} · Social posts`, paragraph: `Your social pack${section.title ? ` for “${section.title}”` : ''} is saved. When you’re happy with one of the drafts, schedule it to a supported connected account or copy it to share from the platform yourself.`, cta: 'Open my saved social pack', href };
          default: throw new Error('Invalid work section');
        }
      });
      const first = d.workSections[0].kind;
      subject = work.length > 1 ? 'Your open decisions in Radar' : ({ brief_reply: 'New conversations in your Daily Brief', calendar_review: 'Your content plan is ready for a decision', article_social: 'Make a social pack from a saved article', social_publish: 'Give your saved social posts a publishing time' }[first]);
      preheader = work.length > 1 ? 'A short list of what’s waiting, with a direct link to each item.' : ({ brief_reply: 'The discussion may have moved on. Read the latest replies before jumping in.', calendar_review: 'Decide which proposed topic you want Radar to turn into a draft.', article_social: 'Choose the article as the source for a new pack.', social_publish: 'Choose when and where one saved draft should go out.' }[first]);
      heading = work.length > 1 ? 'Which one will you move forward?' : ({ brief_reply: 'A few threads to look at today.', calendar_review: 'Choose what you want drafted.', article_social: 'Use the article you already have.', social_publish: 'Decide when one post should go out.' }[first]);
      paragraphs = work.length > 1 ? ['These items need different decisions. Pick one below; each link opens the saved work in the right business.'] : [];
      cta = work[0].cta; href = work[0].href; break;
    }
    case 'trial_started':
      subject = 'Your Radar trial is on'; heading = `${TRIAL_DAYS} days to try Radar`;
      preheader = 'Your workspace is open. Here are the trial dates and subscription details.';
      paragraphs = ['Your trial is active. Thanks for giving Radar a try.', `It runs until ${date(d.trialEnd)}. Your Radar subscription starts after the trial and continues automatically. The card-confirmation credit goes toward your first subscription invoice.`, 'Your subscription details are in Settings → Billing.'];
      cta = 'Open my Radar workspace'; href = app('/dashboard'); break;
    case 'trial_ending':
      subject = 'Your Radar trial ends soon'; heading = 'Your trial is nearly up.';
      preheader = 'Check the renewal date and amount, or manage your subscription before it renews.';
      paragraphs = [`Your Radar trial ends on ${date(d.trialEnd)}. Your subscription will then continue automatically.`, `Your first month is normally ${first} after the ${confirmation} card-confirmation credit, followed by ${monthly}/month. Your invoice shows any tax or other adjustments.`, 'To avoid the monthly charge, cancel in Settings → Billing before your trial ends. You can also review your subscription there.'];
      cta = 'Manage subscription'; href = billing; break;
    case 'invoice_paid':
      subject = 'Your Radar subscription receipt'; heading = 'Your subscription receipt';
      preheader = 'Your subscription invoice is paid. Here’s where to find the receipt.';
      paragraphs = [d.amountCents == null ? 'Your Radar subscription invoice is paid.' : `Your Radar subscription invoice is paid: ${money(d.amountCents, d.currency)}.`, ...(d.invoiceNumber ? [`Invoice: ${d.invoiceNumber}.`] : []), 'You can view or download the invoice in Settings → Billing, then Manage billing.'];
      cta = 'Open Billing'; href = billing; break;
    case 'payment_failed':
      subject = 'Your Radar subscription needs attention'; heading = 'Let’s get your subscription sorted.';
      preheader = 'The latest subscription charge didn’t go through. You can check it in Billing.';
      paragraphs = ['The latest charge for your Radar subscription didn’t go through.', 'Open Billing to check your payment method and the outstanding invoice. Your workspace access may be paused while it remains unpaid.', 'If something looks wrong or you need a hand, reply and tell me what you’re seeing.'];
      cta = 'Review my subscription'; href = billing; break;
    case 'cancellation_scheduled':
      subject = 'Your Radar cancellation is confirmed'; heading = 'Your cancellation is confirmed.';
      preheader = 'Your access continues until the end date shown in this email.';
      paragraphs = [`You can keep using your workspace until ${date(d.periodEnd)}. Your Radar subscription won’t renew after that date.`, 'You can review your subscription in Settings → Billing if you decide to continue.'];
      cta = 'Manage subscription'; href = billing; break;
    case 'subscription_ended':
      subject = 'Your Radar subscription has ended'; heading = 'Your subscription has ended';
      preheader = d.status === 'incomplete_expired' ? 'Your subscription setup expired before it was completed.' : 'Open your account if you’d like to restart access.';
      paragraphs = [d.status === 'incomplete_expired' ? 'Your Radar subscription setup expired before it was completed.' : 'Your Radar subscription is no longer active.', 'If you’d like to pick up where you left off, open your account to review the subscription options.', 'If you couldn’t get Radar to do what you needed, reply and tell me. I’d like to help you work through it.'];
      cta = 'Review restart options'; href = app('/start-trial'); break;
  }
  // A real inbox preview is plain text and is escaped independently from the visible email body.
  preheader = (preheader || subject).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const replyTo = FOUNDER_REPLY_TO;
  const optional = (type === 'founder_note' || type === 'work_update' || type === 'weekly_education' || type === 'lifecycle_guide') && ctx.unsubscribeUrl;
  const optoutLabel = type === 'lifecycle_guide' || type === 'weekly_education' ? 'Stop Radar lessons and guides' : type === 'work_update' ? 'Turn off work reminders' : 'Stop optional setup emails';
  const preferencesUrl = optional || app('/email-preferences');
  const company = (type === 'work_update' || type === 'weekly_education' || type === 'lifecycle_guide') ? 'Fairspleet LLC · 348 Business Bay, Dubai, UAE' : '';
  const buttonStyle = 'display:inline-block;padding:7px 16px;font-size:14px;line-height:20px;background:#17181c;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold';
  const footer = `Privacy: ${app('/privacy')} · Terms: ${app('/terms')}`;
  const text = [hi, ...paragraphs, ...steps.map((s, i) => `${i + 1}. ${s}`), ...(progress ? [progress] : []), ...(work.length ? work.flatMap(w => [w.heading, w.paragraph, `${w.cta}: ${w.href}`]) : [`${cta}: ${href}`]), `Ekene\nFounder, Radar\n${replyTo}`, footer, `Email preferences: ${preferencesUrl}`, ...(company ? [company] : []), ...(optional ? [`${optoutLabel}: ${optional}`] : [])].join('\n\n');
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f5f5f2;color:#17181c;font-family:Arial,sans-serif;line-height:1.6;overflow-wrap:anywhere;word-break:break-word"><div lang="en" dir="ltr" aria-hidden="true" style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all">${escape(preheader)}</div><table lang="en" dir="ltr" role="presentation" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td style="padding:32px 16px"><table role="presentation" style="width:100%;max-width:600px;table-layout:fixed;margin:auto;background:#fff;border:1px solid #deded8;border-radius:16px"><tr><td style="padding:32px"><table role="presentation" style="border-collapse:collapse;margin:0 0 28px"><tr><td style="padding:0 10px 0 0;vertical-align:middle"><img src="${escape(app('/brand/radar-mark-email.png'))}" width="28" height="28" alt="" style="display:block;border:0;background:#fff"></td><td style="padding:0;vertical-align:middle;font-size:18px;font-weight:bold;letter-spacing:-.5px">Radar <span style="font-size:12px;font-weight:normal;letter-spacing:normal;color:#666">by Thally</span></td></tr></table><p>${escape(hi)}</p>${paragraphs.map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')}${steps.length ? `<ol style="padding-left:22px">${steps.map(s => `<li style="padding-bottom:12px">${escape(s)}</li>`).join('')}</ol>` : ''}${progress ? `<p>${escape(progress)}</p>` : ''}${work.length ? work.map((w, i) => `<section style="margin:24px 0"><h2 style="font-size:16px;line-height:1.4;margin:0 0 8px">${escape(w.heading)}</h2><p>${escape(w.paragraph)}</p><p><a href="${escape(w.href)}" style="${i === 0 ? buttonStyle : 'font-size:14px;color:#17181c;text-decoration:underline;font-weight:bold'}">${escape(w.cta)}</a></p></section>`).join('') : `<p style="margin:28px 0"><a href="${escape(href)}" style="${buttonStyle}">${escape(cta)}</a></p>`}<p>Ekene<br><span style="font-size:13px;color:#555">Founder, Radar</span><br><a style="font-size:13px;color:#34343a" href="mailto:${replyTo}">${replyTo}</a></p><hr style="border:0;border-top:1px solid #e4e4df;margin:28px 0 20px"><p style="font-size:12px;color:#666"><a style="color:#666" href="${escape(app('/privacy'))}">Privacy</a> &middot; <a style="color:#666" href="${escape(app('/terms'))}">Terms</a></p>${company ? `<p style="font-size:11px;color:#777">${escape(company)}</p>` : ''}${preferencesUrl ? `<p style="margin:16px 0"><a href="${escape(preferencesUrl)}" style="display:inline-block;padding:6px 12px;border:1px solid #d5d5d0;border-radius:6px;color:#34343a;font-size:12px;line-height:18px;text-decoration:none">Email preferences</a></p>` : ''}${optional ? `<p style="font-size:12px"><a style="color:#555" href="${escape(optional)}">${optoutLabel}</a></p>` : ''}</td></tr></table></td></tr></table></body></html>`;
  return { subject, preheader, text, html, replyTo };
}
