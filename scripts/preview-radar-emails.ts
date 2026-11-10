// Local source previews only: no sender, queue, database or provider is imported.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderLifecycle, type LifecycleData, type LifecycleType, type WorkUpdateSection } from '../src/server/services/lifecycle/templates';
import { EDUCATION_LESSONS, type EducationContext } from '../src/server/services/lifecycle/educationContent';
import { GUIDE_IDS } from '../src/server/services/lifecycle/guideContent';
import { founderFrom, FOUNDER_REPLY_TO } from '../src/server/services/mailIdentity';
import { confirmationEmail, invitationEmail, backlinkApprovedEmail, backlinkDeclinedEmail, backlinkRemovalEmail, backlinkLostEmail, autopilotHandoffEmail, type LegacyEmail } from '../src/server/services/legacyContent';

const outputIndex = process.argv.indexOf('--output');
const requestedOutput = outputIndex < 0 ? '.factory/lifecycle-refinement/previews' : process.argv[outputIndex + 1];
if (!requestedOutput) throw new Error('--output requires a directory');
const out = path.resolve(requestedOutput), origin = 'https://radar.thally.io';
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const logo = `data:image/png;base64,${(await readFile('public/brand/radar-mark-email.png')).toString('base64')}`;
const businessId = '11111111-1111-4111-8111-111111111111';
const context: EducationContext = { businessName: 'Fieldnote', offering: 'design tools', audience: 'independent studios', keyword: 'design tools for small studios', gscConnected: true, access: 'workspace' };
const data: LifecycleData = { name: 'Alex', businessName: 'Fieldnote', profileAnalyzed: true, businessId, trialEnd: '2026-11-12T12:00:00Z', periodEnd: '2026-12-12T12:00:00Z', amountCents: 4900, currency: 'usd', invoiceNumber: 'RADAR-DEMO-0001', status: 'canceled', resetUrl: `${origin}/reset-password#token=preview-only-not-valid` };
const unsubscribeUrl = `${origin}/email-preferences?token=preview-only-not-valid`;
const previewFrom = founderFrom('notifications@radar.example');
type Mail = LegacyEmail & { preheader?: string };
type Case = { id: string; family: string; group: string; scenario: string; primary: boolean; trigger: string; cadence: string; mail: Mail };
const cases: Case[] = [];
function lifecycle(id: string, type: LifecycleType, group: string, trigger: string, cadence: string, sample: LifecycleData = data, family = id, scenario = 'Primary example', primary = true) {
  cases.push({ id, family, group, trigger, cadence, scenario, primary, mail: renderLifecycle(type, sample, { appUrl: origin, unsubscribeUrl }) });
}
const core: [LifecycleType, string, string, string][] = [
  ['welcome', 'account', 'After successful mailbox confirmation or new verified Google account', 'Once, immediately'],
  ['founder_note', 'account', 'New verified account, using the existing founder event', 'Planned +24 hours; optional cap/daytime apply'],
  ['password_reset', 'security', 'Valid password-reset request', 'Per request; one-hour link'],
  ['trial_started', 'billing', 'Successful trial activation', 'Once per trial'],
  ['invoice_paid', 'billing', 'Qualifying paid invoice webhook', 'Per qualifying invoice'],
  ['payment_failed', 'billing', 'Eligible invoice failure; still unpaid at send', 'Per eligible failure'],
  ['cancellation_scheduled', 'billing', 'Subscription newly set to cancel at period end', 'Per real transition'],
  ['subscription_ended', 'billing', 'Current subscription becomes canceled or setup expires', 'Per real transition'],
];
for (const [type, group, trigger, cadence] of core) lifecycle(type, type, group, trigger, cadence);
lifecycle('welcome-neutral', 'welcome', 'account', 'Verified account without a completed analysis snapshot', 'Once, immediately', { ...data, businessName: undefined, profileAnalyzed: false }, 'welcome', 'Direct signup / unfinished analysis', false);
lifecycle('invoice-paid-no-amount', 'invoice_paid', 'billing', 'A qualifying paid invoice has no amount or invoice number in the saved payload', 'Same invoice-paid event; factual fallback', { ...data, amountCents: undefined, invoiceNumber: undefined }, 'invoice_paid', 'Invoice details unavailable', false);
lifecycle('payment-failed-no-amount', 'payment_failed', 'billing', 'An eligible payment failure has no amount in the saved payload', 'Same payment-failure event; factual fallback', { ...data, amountCents: undefined }, 'payment_failed', 'Payment amount unavailable', false);
lifecycle('subscription-setup-expired', 'subscription_ended', 'billing', 'Subscription setup expires before payment is completed', 'Once per real transition', { ...data, status: 'incomplete_expired' }, 'subscription_ended', 'Incomplete subscription setup expired', false);
const kinds = ['brief_reply', 'calendar_review', 'article_social', 'social_publish'] as const;
const sections: WorkUpdateSection[] = kinds.map((kind, i) => ({ eventId: `00000000-0000-4000-8000-00000000000${i + 1}`, kind, businessId, businessName: 'Fieldnote', ref: kind === 'brief_reply' ? '2026-11-09' : kind === 'calendar_review' ? '2026-11-09T06:00:00Z' : 'preview-resource', count: kind === 'brief_reply' ? 4 : kind === 'calendar_review' ? 8 : 1, title: 'How to choose a design tool for your studio' }));
const delays = ['After 1 hour', 'After 24 hours', 'After 2 hours', 'After 24 hours'];
for (const [i, section] of sections.entries()) lifecycle(`work-${section.kind}`, 'work_update', 'work', 'New relevant work remains without its expected next action', delays[i], { ...data, workSections: [section] });
lifecycle('work-combined', 'work_update', 'work', 'Two or three unfinished work items are eligible together', 'Combined; shared optional 24-hour cap', { ...data, workSections: sections.slice(0, 3) });
for (const [index, lesson] of EDUCATION_LESSONS.entries()) for (const access of ['workspace', 'start_trial', 'restart', 'setup'] as const) {
  lifecycle(`lesson-${lesson}-${access}`, 'weekly_education', 'education', `Core feature lesson ${index + 1} of five`, index ? 'At least 7 days after previous accepted lesson' : 'First eligible slot after enrollment', { ...data, education: { version: 1, lesson, context: { ...context, access }, businessId } }, `lesson-${lesson}`, access, access === 'workspace');
}
const guideSchedule = {
  article_workflow: { trigger: 'Own saved/analyzed profile or workspace; no approved/generated content workflow', cadence: '+24 hours of workspace access; +3 days pre-trial' },
  search_refresh: { trigger: 'Real Search Console page data and accepted Organic Search lesson', cadence: 'Later of readiness +24 hours and Organic Search lesson +7 days' },
  autopilot_intro: { trigger: 'Eligible verified owner/profile; no current or previous Autopilot use in any owned business', cadence: 'Once per account; first eligible observation +48 hours; education opt-out, daytime and shared optional cap apply' },
};
for (const guide of GUIDE_IDS) for (const access of ['workspace', 'start_trial', 'restart', 'setup'] as const) {
  lifecycle(`guide-${guide}-${access}`, 'lifecycle_guide', 'education', guideSchedule[guide].trigger, guideSchedule[guide].cadence, { ...data, guide: { version: 1, id: guide, context: { ...context, access }, businessId } }, `guide-${guide}`, access, access === 'workspace');
}
lifecycle('lesson-organic-search-disconnected', 'weekly_education', 'education', 'Organic Search lesson; Search Console is not connected', 'Existing fourth course lesson; no extra send', { ...data, education: { version: 1, lesson: 'organic_search', context: { ...context, gscConnected: false }, businessId } }, 'lesson-organic_search', 'Workspace without Search Console', false);
for (const lesson of EDUCATION_LESSONS) lifecycle(`lesson-${lesson}-neutral`, 'weekly_education', 'education', 'Existing course lesson for an eligible account without saved profile details', 'Same lesson event; neutral setup fallback', { ...data, name: undefined, businessName: undefined, businessId: undefined, education: { version: 1, lesson, context: { access: 'setup', gscConnected: false } } }, `lesson-${lesson}`, 'Setup without profile details', false);
function legacy(id: string, group: string, trigger: string, cadence: string, mail: Mail, family = id, scenario = 'Primary example', primary = true) {
  cases.push({ id, family, group, trigger, cadence, mail, scenario, primary });
}
legacy('confirmation', 'security', 'Password signup or requested confirmation resend', 'Per request; 30-minute link', confirmationEmail({ appUrl: origin, link: `${origin}/verify-email#token=preview-only-not-valid`, minutes: 30 }));
for (const role of ['Editor', 'Admin', 'Viewer'] as const) legacy(`invitation-${role}`, 'partner', 'Owner/Admin invites a team member', 'Per invitation; 14-day acceptance link', invitationEmail({ appUrl: origin, inviter: 'Alex', business: 'Fieldnote', domain: 'fieldnote.example', role, link: `${origin}/api/invites/preview-only-not-valid`, days: 14 }), 'invitation', role, role === 'Editor');
const link = { appUrl: origin, business: 'Fieldnote', domain: 'fieldnote.example', page: 'https://partner.example/articles/design-tools', displayPage: 'partner.example/articles/design-tools', target: 'https://fieldnote.example', anchor: 'Fieldnote', rel: 'sponsored', disclosure: 'Partner link', sentence: 'For small studios, [Fieldnote](https://fieldnote.example) is another option to review.' };
legacy('backlink-approved', 'partner', 'Incoming partner-link proposal approved', 'After the 20-second Undo window', backlinkApprovedEmail({ ...link, canApproveInRadar: true }));
legacy('backlink-approved-manual', 'partner', 'Incoming proposal approved; placement is managed outside Radar', 'After the 20-second Undo window', backlinkApprovedEmail({ ...link, canApproveInRadar: false }), 'backlink-approved', 'Manual placement', false);
legacy('backlink-declined', 'partner', 'Proposal declined with a note', 'After the 20-second Undo window', backlinkDeclinedEmail({ ...link, note: 'This article covers a different audience, so the link doesn’t fit here.' }));
legacy('backlink-removal', 'partner', 'Removal requested for a live backlink', 'Per request; asks for removal within seven days', backlinkRemovalEmail(link));
for (const reason of ['missing', 'rel'] as const) legacy(`backlink-lost-${reason}`, 'partner', reason === 'missing' ? 'Verification finds a previously live link missing' : 'Verification finds the required link qualifier missing', 'On detected transition or manual Re-check', backlinkLostEmail({ ...link, reason }), 'backlink-lost', reason, reason === 'missing');

{
  const totals = (mentioned: number, collected: number) => ({ share: collected ? mentioned / collected : null, mentioned, collected, averagePosition: null, ownDomainCitations: 0, ownDomainCitationShare: collected ? 0 : null, byEngine: {} });
  const summary = { series: 'a'.repeat(64), weekly: { start: '2026-11-02', end: '2026-11-09', previousStart: '2026-10-26', current: totals(6,20), previous: totals(4,20), delta: .1, timezone: 'UTC' as const, days: [{ day: '2026-11-08', ...totals(6,20) }] }, weeklyBiggestMiss: { promptId: '33333333-3333-4333-8333-333333333333', prompt: 'Which design tools work well for small studios?', misses: 14, entryId: 'vis-' + 'b'.repeat(40) } };
  const report = (value: NonNullable<LifecycleData['aiReport']>['summary']) => renderLifecycle('ai_weekly_report', { aiReport: { version: 1, businessId, ownerId: '22222222-2222-4222-8222-222222222222', domain: 'fieldnote.example', series: value.series, periodEnd: value.weekly.end, summary: value } }, { appUrl: origin, unsubscribeUrl: `${origin}/ai-email-preferences?token=preview-only-not-valid` });
  legacy('ai-weekly-report', 'report', 'Active owned business has real collected AI answers for the completed UTC week', 'Monday after 08:00 UTC; once/business/week; shared daytime and optional cap apply', report(summary));
  legacy('ai-weekly-report-no-miss', 'report', 'Weekly report has no missed question to highlight', 'Same report event, alternate data', report({ ...summary, weeklyBiggestMiss: null }), 'ai-weekly-report', 'No missed question', false);
  legacy('ai-weekly-report-no-comparison', 'report', 'Collected answers exist but there is not yet a comparable previous period', 'Same weekly report; no comparison invented', report({ ...summary, weekly: { ...summary.weekly, previous: totals(0,0), delta: null } }), 'ai-weekly-report', 'No previous-week comparison', false);
  legacy('ai-weekly-report-no-topic', 'report', 'A missed question is available without a saved Content Calendar topic', 'Same weekly report; no saved topic promised', report({ ...summary, weeklyBiggestMiss: { ...summary.weeklyBiggestMiss, entryId: null } }), 'ai-weekly-report', 'No saved article topic', false);
}
const manageUrl = `${origin}/api/b/current?id=${businessId}&next=${encodeURIComponent('/settings?section=autopilot')}`;
const handoffItem = { title: 'Connect your publishing destination', reason: 'Radar can prepare articles. Connect a blog so Autopilot can publish them.', href: `${origin}/api/b/current?id=${businessId}&next=${encodeURIComponent('/settings?section=publishing')}` };
const replyItem = { title: 'Reddit: Choosing design tools for a small studio', reason: 'Radar cannot post this comment. Open the conversation and send the prepared reply from your account.', href: `${origin}/api/b/current?id=${businessId}&next=${encodeURIComponent('/brief?date=2026-11-09')}`, sourceUrl: 'https://www.reddit.com/r/design/comments/example', text: 'Start by comparing the tools against one project your studio runs often. Which part of the workflow is slowing you down?' };
for (const [suffix, scenario, items] of [['actions', 'Two owner actions', [handoffItem, replyItem]], ['reply', 'One conversation and prepared draft', [replyItem]], ['publication', 'Unconfirmed publication', [{ title: 'A LinkedIn post needs attention', reason: 'The provider did not confirm publication. Check your account before trying again to avoid a duplicate.', href: `${origin}/api/b/current?id=${businessId}&next=${encodeURIComponent('/social')}` }]]] as const) {
  legacy(`autopilot-${suffix}`, 'work', 'Owner-enabled Autopilot finds new actions requiring the owner', 'Per new deduplicated action batch; activation required; separate from lifecycle cadence', autopilotHandoffEmail({ appUrl: origin, businessName: 'Fieldnote', items: [...items], manageUrl }), 'autopilot-handoff', scenario, suffix === 'actions');
}
// Permanent review numbers: append new families instead of renumbering existing feedback.
const familyNumbers: Record<string, number> = {
  welcome: 1, founder_note: 2, password_reset: 3, trial_started: 4, trial_ending: 5,
  invoice_paid: 6, payment_failed: 7, cancellation_scheduled: 8, subscription_ended: 9,
  'work-brief_reply': 10, 'work-calendar_review': 11, 'work-article_social': 12,
  'work-social_publish': 13, 'work-combined': 14, 'lesson-ai_visibility': 15,
  'lesson-daily_brief': 16, 'lesson-backlinks': 17, 'lesson-organic_search': 18,
  'lesson-social_marketing': 19, 'guide-article_workflow': 20, 'guide-search_refresh': 21,
  confirmation: 22, invitation: 23, 'backlink-approved': 24, 'backlink-declined': 25,
  'backlink-removal': 26, 'backlink-lost': 27, 'ai-weekly-report': 28, 'autopilot-handoff': 29,
  'guide-autopilot_intro': 30,
};
const preserveBareReference = new Set(['founder_note', 'password_reset', 'trial_started', 'trial_ending', 'invoice_paid', 'payment_failed', 'cancellation_scheduled', 'subscription_ended', 'work-brief_reply', 'work-calendar_review', 'work-article_social', 'work-social_publish', 'work-combined', 'confirmation', 'backlink-declined', 'backlink-removal']);
const retired = [{ number: 5, reference: '5', family: 'trial_ending', subject: 'Trial-ending reminder', status: 'Retired', reason: 'Removed at your request. Radar does not queue or send a reminder to cancel before the trial ends.' }];
const status = (_family: string) => 'Implemented runtime email; deployment evidence: docs/EMAILS.md';
const grouped = [...new Set([...cases.map(c => c.family), ...retired.map(c => c.family)])].sort((a, b) => familyNumbers[a] - familyNumbers[b]);
for (const family of grouped) if (!familyNumbers[family]) throw new Error(`Assign a permanent review number to ${family}`);
await mkdir(out, { recursive: true });
const cards: string[] = [], catalogue: object[] = [], reading: string[] = [], markdown: string[] = [
  '# Radar email catalogue', '',
  'Complete refined copy, with permanent review numbers. Refer to an email as **#15** or a specific variant as **#15B**. New families will be appended without changing existing numbers.', '',
  'Fieldnote, Alex, invoice details, dates, links and conversation drafts are fictional examples. Runtime values depend on the recipient and saved work. Preview links grant no account access. No emails are sent by this catalogue.', '',
  'New emails come from **Ekene from Radar**, with replies going to **team@thally.io**. The @radar.example address shown below is a preview stand-in; the configured verified sending address stays unchanged.', '',
  'All active copy is written from Ekene, Radar’s founder. Trial-ending reminder #5 is retired. All families use the app’s actual renderers, including the weekly AI report. See docs/EMAILS.md and the shipping records for deployment evidence. Existing queued messages keep their original frozen body.', '',
  'Optional lifecycle mail is default-on for eligible verified users, preserving recorded opt-outs. Daytime and the shared 24-hour cap may delay its nominal due time. Weekly lessons are at least seven days apart and finish after five. Autopilot handoffs are triggered by the owner-enabled business program and use their separate delivery path.', '',
  '## Index', '', '| Number | Subject | Variants |', '| --- | --- | --- |',
];
for (const family of grouped) {
  const removed = retired.find(c => c.family === family);
  if (removed) { markdown.push(`| [#${removed.number}](#email-${removed.number}) | Retired: ${removed.subject} | — |`); continue; }
  const entries = cases.filter(c => c.family === family), primary = entries.find(c => c.primary)!;
  markdown.push(`| [#${familyNumbers[family]}](#email-${familyNumbers[family]}) | ${primary.mail.subject.replaceAll('|', '\\|')} | ${entries.length} |`);
}
markdown.push('', '---', '');
const toc = grouped.map(family => { const removed = retired.find(c => c.family === family); const entry = cases.find(c => c.family === family && c.primary); return `<li><a href="#email-${familyNumbers[family]}">#${familyNumbers[family]} · ${removed ? `Retired: ${escape(removed.subject)}` : escape(entry!.mail.subject)}</a></li>`; }).join('');
for (const family of grouped) {
  const removed = retired.find(c => c.family === family);
  if (removed) {
    const title = `#${removed.number} · Retired: ${removed.subject}`, note = escape(removed.reason);
    markdown.push(`<a id="email-${removed.number}"></a>`, '', `## #${removed.number} — Retired: ${removed.subject}`, '', removed.reason, '', 'This number stays reserved. No email body is scheduled or sent.', '', '---', '');
    reading.push(`<section id="email-${removed.number}"><h2>${title}</h2><article><p>${note}</p><p>This number stays reserved. No email body is scheduled or sent.</p></article></section>`);
    cards.push(`<article data-group="retired" data-extra="false"><header><small>RETIRED · #${removed.number}</small><h2>${title}</h2><p>${note}</p></header></article>`);
    await writeFile(path.join(out, 'trial_ending.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.6 Arial,sans-serif;padding:32px;max-width:700px"><h1>${title}</h1><p>${note}</p><p>This is a retirement notice for review, not an email template.</p></body></html>`);
    await writeFile(path.join(out, 'trial_ending.txt'), `${title}\n\n${removed.reason}\n\nNo email body is scheduled or sent.\n`);
    continue;
  }
  const entries = cases.filter(c => c.family === family), number = familyNumbers[family], primary = entries.find(c => c.primary)!;
  markdown.push(`<a id="email-${number}"></a>`, '', `## #${number} — ${primary.mail.subject}`, '', `**Status:** ${status(family)}`, '');
  reading.push(`<section id="email-${number}"><h2>#${number} · ${escape(primary.mail.subject)}</h2><p class="meta">${escape(status(family))}</p>`);
  for (const [index, entry] of entries.entries()) {
    const reference = entries.length > 1 && !(index === 0 && preserveBareReference.has(family)) ? `${number}${String.fromCharCode(65 + index)}` : String(number);
    const { mail } = entry, file = `${entry.id}.html`, format = mail.html ? 'HTML + plain text' : 'Plain text';
    const html = mail.html?.replaceAll(`${origin}/brand/radar-mark-email.png`, logo) || `<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(mail.subject)}</title><body style="margin:0;background:#fff;color:#17181c;font:16px/1.6 Arial,sans-serif;padding:28px;overflow-wrap:anywhere"><p style="font-size:12px;color:#666">ACTUAL PLAIN-TEXT EMAIL BODY</p><pre style="font:inherit;white-space:pre-wrap;overflow-wrap:anywhere">${escape(mail.text)}</pre></body></html>`;
    await writeFile(path.join(out, file), html);
    await writeFile(path.join(out, `${entry.id}.txt`), `Email #${reference} · ${entry.scenario}\nFrom: ${previewFrom}\nReply-To: ${FOUNDER_REPLY_TO}\nSubject: ${mail.subject}\n${mail.preheader ? `Preview: ${mail.preheader}\n` : ''}\n${mail.text.trim()}\n`);
    catalogue.push({ ...entry, mail: undefined, number, reference, status: status(family), file, format, from: previewFrom, replyTo: FOUNDER_REPLY_TO, subject: mail.subject, preheader: mail.preheader || null });
    markdown.push(`### #${reference} — ${entry.scenario}`, '', `**From:** ${previewFrom}`, '', `**Reply-To:** ${FOUNDER_REPLY_TO}`, '', `**Subject:** ${mail.subject}`, '', ...(mail.preheader ? [`**Preview text:** ${mail.preheader}`, ''] : []), `**Trigger:** ${entry.trigger}`, '', `**Cadence:** ${entry.cadence}`, '', `**Format:** ${format}`, '', '**Full email:**', '', mail.text.trim(), '', '---', '');
    const body = `<h3>#${reference} · ${escape(entry.scenario)}</h3><dl><dt>From</dt><dd>${escape(previewFrom)}</dd><dt>Reply-To</dt><dd>${escape(FOUNDER_REPLY_TO)}</dd><dt>Subject</dt><dd>${escape(mail.subject)}</dd>${mail.preheader ? `<dt>Preview text</dt><dd>${escape(mail.preheader)}</dd>` : ''}<dt>Trigger</dt><dd>${escape(entry.trigger)}</dd><dt>Cadence</dt><dd>${escape(entry.cadence)}</dd><dt>Format</dt><dd>${format}</dd></dl><div class="body">${escape(mail.text.trim())}</div><p><a href="${file}">Visual email preview</a> · <a href="${entry.id}.txt">Plain text</a> · <a href="#top">Back to index</a></p>`;
    reading.push(entry.primary ? `<article id="variant-${reference}">${body}</article>` : `<details id="variant-${reference}"><summary>#${reference} · ${escape(entry.scenario)} — alternate copy</summary>${body}</details>`);
    cards.push(`<article data-group="${entry.group}" data-extra="${!entry.primary}" ${entry.primary ? '' : 'hidden'}><header><small>#${reference} · ${escape(entry.group)} · ${escape(entry.scenario)} · ${format}</small><h2>#${reference} · ${escape(mail.subject)}</h2>${mail.preheader ? `<p>${escape(mail.preheader)}</p>` : ''}<p><b>From:</b> Ekene from Radar<br><b>Reply-To:</b> ${escape(FOUNDER_REPLY_TO)}</p><p><b>When:</b> ${escape(entry.trigger)}<br><b>Timing:</b> ${escape(entry.cadence)}</p><a href="${file}">Open full email</a> · <a href="${entry.id}.txt">Plain text</a></header><iframe loading="lazy" title="#${reference}: ${escape(mail.subject)} (${escape(entry.scenario)})" src="${file}"></iframe></article>`);
  }
  reading.push('</section>');
}
const families = new Set(cases.map(c => c.family)).size;
await writeFile(path.join(out, 'catalogue.json'), JSON.stringify({ families, variants: cases.length, numberedSlots: grouped.length, retired, entries: catalogue }, null, 2) + '\n');
await writeFile(path.join(out, 'catalogue.md'), markdown.join('\n').trim() + '\n');
await writeFile(path.join(out, 'all-emails.txt'), markdown.join('\n').replace(/<a id="email-\d+"><\/a>\n/g, '').trim() + '\n');
await writeFile(path.join(out, 'catalogue.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Numbered Radar email catalogue</title><style>*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f3f2ed;color:#17181c;font:16px/1.65 Arial,sans-serif;overflow-wrap:anywhere}main{max-width:900px;margin:auto;padding:40px 24px}h1{font-size:38px;line-height:1.12;letter-spacing:-1px}h2{font-size:25px;line-height:1.3}h3{font-size:19px}.meta,dt{font-size:13px;color:#555}section{margin-top:64px;scroll-margin-top:24px}article,details{background:#fff;border:1px solid #d7d7cf;border-radius:12px;margin:20px 0;padding:28px}summary{cursor:pointer;font-weight:bold}dl{font-size:14px;border-bottom:1px solid #ddd;padding-bottom:20px}dt{font-weight:bold}dd{margin:0 0 12px}.body{white-space:pre-wrap;margin:28px 0}a{color:#222}button{font:inherit;padding:9px 14px;background:#17181c;color:#fff;border:0;border-radius:6px;cursor:pointer}nav ol{list-style:none;padding-left:0}nav li{margin:6px 0}@media print{body{background:white}button{display:none}section{break-before:page}details{display:block}}</style><main id="top"><p class="meta">RADAR · REFINED COPY FOR REVIEW</p><h1>Every email, numbered.</h1><p>${families} active email families and ${cases.length} full variants. #5 is retired and stays reserved. Use <b>#15</b> for a family or <b>#15B</b> for a particular variant. These numbers stay fixed for your feedback.</p><p>New emails come from <b>Ekene from Radar</b>, with replies to <b>team@thally.io</b>. The @radar.example address below is a preview stand-in; the configured verified sending address stays unchanged.</p><p>Fictional Fieldnote/Alex examples, dates and draft content show the actual templates. No emails are sent. These previews use the implemented runtime renderers, including the weekly AI report. See docs/EMAILS.md and shipping records for deployment evidence. Existing queued messages retain their original body.</p><p><a href="index.html">Visual previews</a> · <a href="catalogue.md">Complete Markdown catalogue</a> · <a href="all-emails.txt">All copy as text</a></p><button id="expand" type="button" aria-pressed="false">Expand all alternate versions</button><nav aria-label="Email index"><ol>${toc}</ol></nav>${reading.join('')}</main><script>document.getElementById('expand').addEventListener('click',function(){const open=this.getAttribute('aria-pressed')!=='true';for(const d of document.querySelectorAll('details'))d.open=open;this.setAttribute('aria-pressed',String(open));this.textContent=open?'Collapse alternate versions':'Expand all alternate versions'})</script></html>`);
await writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radar email review</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f1ec;color:#17181c;font:15px/1.5 Arial,sans-serif}main{max-width:1420px;margin:auto;padding:32px 20px}h1{font-size:36px;line-height:1.12;letter-spacing:-1px}main>p{max-width:900px;color:#555}.controls{display:flex;flex-wrap:wrap;gap:24px;margin:24px 0}select{font:inherit;padding:8px;background:white;border:1px solid #aaa;border-radius:6px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:24px;align-items:start}article{background:#fff;border:1px solid #d8d8d0;border-radius:12px;overflow:hidden;min-width:0}article[hidden]{display:none}header{padding:20px 24px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}small{text-transform:uppercase;letter-spacing:.05em;font-size:10px;color:#666}h2{font-size:20px;line-height:1.3}header p{font-size:13px;color:#555}a{color:#17181c}iframe{display:block;width:100%;height:1100px;border:0}</style><main><small>RADAR BY THALLY · LOCAL REVIEW</small><h1>Emails for each next step.</h1><p>${families} active numbered user-facing families, with ${cases.length} full audience, role and data variants. #5 is retired and stays reserved. These are the current source templates with fictional details. Plain-text senders are shown as plain text. This gallery sends nothing.</p><p><a href="catalogue.html">Read the numbered catalogue</a> · <a href="catalogue.md">Complete Markdown</a> · <a href="all-emails.txt">All copy as text</a></p><div class="controls"><label>Category <select id="group"><option value="all">All</option>${['account','billing','education','work','partner','security','report','retired'].map(g => `<option value="${g}">${g}</option>`).join('')}</select></label><label><input type="checkbox" id="variants"> Show all numbered variants</label></div><div class="grid">${cards.join('')}</div></main><script>function filter(){for(const card of document.querySelectorAll('article'))card.hidden=(document.getElementById('group').value!=='all'&&card.dataset.group!==document.getElementById('group').value)||(card.dataset.extra==='true'&&!document.getElementById('variants').checked)}document.getElementById('group').addEventListener('change',filter);document.getElementById('variants').addEventListener('change',filter);for(const frame of document.querySelectorAll('iframe'))frame.addEventListener('load',()=>{try{frame.style.height=Math.max(400,frame.contentDocument.documentElement.scrollHeight)+'px'}catch{}})</script></html>`);
console.log(`Rendered ${families} numbered families / ${cases.length} variants in ${out}; no sends.`);
