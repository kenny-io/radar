// Local source previews only: no sender, queue, database or provider is imported.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderLifecycle, type LifecycleData, type LifecycleType, type WorkUpdateSection } from '../src/server/services/lifecycle/templates';
import { EDUCATION_LESSONS, type EducationContext } from '../src/server/services/lifecycle/educationContent';
import { GUIDE_IDS } from '../src/server/services/lifecycle/guideContent';
import { confirmationEmail, invitationEmail, backlinkApprovedEmail, backlinkDeclinedEmail, backlinkRemovalEmail, backlinkLostEmail, type LegacyEmail } from '../src/server/services/legacyContent';

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
  ['trial_ending', 'billing', 'Current uncancelled trial is approaching its end', '24 hours before trial ends'],
  ['invoice_paid', 'billing', 'Qualifying paid invoice webhook', 'Per qualifying invoice'],
  ['payment_failed', 'billing', 'Eligible invoice failure; still unpaid at send', 'Per eligible failure'],
  ['cancellation_scheduled', 'billing', 'Subscription newly set to cancel at period end', 'Per real transition'],
  ['subscription_ended', 'billing', 'Current subscription becomes canceled or setup expires', 'Per real transition'],
];
for (const [type, group, trigger, cadence] of core) lifecycle(type, type, group, trigger, cadence);
lifecycle('welcome-neutral', 'welcome', 'account', 'Verified account without a completed analysis snapshot', 'Once, immediately', { ...data, businessName: undefined, profileAnalyzed: false }, 'welcome', 'Direct signup / unfinished analysis', false);
const kinds = ['brief_reply', 'calendar_review', 'article_social', 'social_publish'] as const;
const sections: WorkUpdateSection[] = kinds.map((kind, i) => ({ eventId: `00000000-0000-4000-8000-00000000000${i + 1}`, kind, businessId, businessName: 'Fieldnote', ref: kind === 'brief_reply' ? '2026-11-09' : kind === 'calendar_review' ? '2026-11-09T06:00:00Z' : 'preview-resource', count: kind === 'brief_reply' ? 4 : kind === 'calendar_review' ? 8 : 1, title: 'How to choose a design tool for your studio' }));
const delays = ['After 1 hour', 'After 24 hours', 'After 2 hours', 'After 24 hours'];
for (const [i, section] of sections.entries()) lifecycle(`work-${section.kind}`, 'work_update', 'work', 'New relevant work remains without its expected next action', delays[i], { ...data, workSections: [section] });
lifecycle('work-combined', 'work_update', 'work', 'Two or three unfinished work items are eligible together', 'Combined; shared optional 24-hour cap', { ...data, workSections: sections.slice(0, 3) });
for (const [index, lesson] of EDUCATION_LESSONS.entries()) for (const access of ['workspace', 'start_trial', 'restart', 'setup'] as const) {
  lifecycle(`lesson-${lesson}-${access}`, 'weekly_education', 'education', `Core feature lesson ${index + 1} of five`, index ? 'At least 7 days after previous accepted lesson' : 'First eligible slot after enrollment', { ...data, education: { version: 1, lesson, context: { ...context, access }, businessId } }, `lesson-${lesson}`, access, access === 'workspace');
}
for (const guide of GUIDE_IDS) for (const access of ['workspace', 'start_trial', 'restart', 'setup'] as const) {
  lifecycle(`guide-${guide}-${access}`, 'lifecycle_guide', 'education', guide === 'article_workflow' ? 'Own saved/analyzed profile or workspace; no approved/generated content workflow' : 'Real Search Console page data and accepted Organic Search lesson', guide === 'article_workflow' ? '+24 hours of workspace access; +3 days pre-trial' : 'Later of readiness +24 hours and Organic Search lesson +7 days', { ...data, guide: { version: 1, id: guide, context: { ...context, access }, businessId } }, `guide-${guide}`, access, access === 'workspace');
}
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

const rootIndex = process.argv.indexOf('--companion-root');
if (rootIndex >= 0) {
  const root = process.argv[rootIndex + 1];
  if (!root || !path.isAbsolute(root)) throw new Error('--companion-root requires an absolute path');
  const { recommendationDigestContent } = await import(pathToFileURL(path.join(root, 'src/server/services/visibility/digestContent.ts')).href);
  const summary = { weekly: { start: '2026-11-02', end: '2026-11-09', current: { share: .3, mentioned: 6, collected: 20 }, previous: { share: .2, mentioned: 4, collected: 20 }, delta: .1 }, weeklyBiggestMiss: { prompt: 'Which design tools work well for small studios?', entryId: 'preview-topic' } };
  const report = recommendationDigestContent(summary, origin, `${origin}/ai-email-preferences?token=preview-only-not-valid`);
  legacy('ai-weekly-report', 'report', 'Active business has collected AI answers for the week', 'Mondays after 08:00 UTC; separate local feature', { subject: 'Recommendation share this week · fieldnote.example', ...report });
  const noMiss = recommendationDigestContent({ ...summary, weeklyBiggestMiss: null }, origin, `${origin}/ai-email-preferences?token=preview-only-not-valid`);
  legacy('ai-weekly-report-no-miss', 'report', 'Weekly report has no missed question to highlight', 'Same report event, alternate data', { subject: 'Recommendation share this week · fieldnote.example', ...noMiss }, 'ai-weekly-report', 'No missed question', false);
}
await mkdir(out, { recursive: true });
const cards: string[] = [], catalogue: object[] = [], copy: string[] = ['RADAR EMAIL CATALOGUE', 'Fictional local examples. Rendering does not schedule or send emails.', 'Subject, cadence and complete body come from the current builders.', ''];
for (const entry of cases) {
  const { mail } = entry, file = `${entry.id}.html`, format = mail.html ? 'HTML + plain text' : 'Plain text';
  const html = mail.html?.replaceAll(`${origin}/brand/radar-mark-email.png`, logo) || `<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(mail.subject)}</title><body style="margin:0;background:#fff;color:#17181c;font:16px/1.6 Arial,sans-serif;padding:28px;overflow-wrap:anywhere"><p style="font-size:12px;color:#666">ACTUAL PLAIN-TEXT EMAIL BODY</p><pre style="font:inherit;white-space:pre-wrap;overflow-wrap:anywhere">${escape(mail.text)}</pre></body></html>`;
  await writeFile(path.join(out, file), html);
  await writeFile(path.join(out, `${entry.id}.txt`), `Subject: ${mail.subject}\n${mail.preheader ? `Preview: ${mail.preheader}\n` : ''}\n${mail.text.trim()}\n`);
  const meta = { ...entry, mail: undefined, file, format, subject: mail.subject, preheader: mail.preheader || null };
  catalogue.push(meta);
  copy.push(`## ${entry.id}`, `Family: ${entry.family} | Scenario: ${entry.scenario}`, `Trigger: ${entry.trigger}`, `Cadence: ${entry.cadence}`, `Subject: ${mail.subject}`, ...(mail.preheader ? [`Preview: ${mail.preheader}`] : []), '', mail.text.trim(), '', '---', '');
  cards.push(`<article data-group="${entry.group}" data-extra="${!entry.primary}" ${entry.primary ? '' : 'hidden'}><header><small>${escape(entry.group)} · ${escape(entry.scenario)} · ${format}</small><h2>${escape(mail.subject)}</h2>${mail.preheader ? `<p>${escape(mail.preheader)}</p>` : ''}<p><b>When:</b> ${escape(entry.trigger)}<br><b>Timing:</b> ${escape(entry.cadence)}</p><a href="${file}">Open full email</a> · <a href="${entry.id}.txt">Plain text</a></header><iframe loading="lazy" title="${escape(mail.subject)} (${escape(entry.scenario)})" src="${file}"></iframe></article>`);
}
const families = new Set(cases.map(c => c.family)).size;
await writeFile(path.join(out, 'catalogue.json'), JSON.stringify({ families, variants: cases.length, entries: catalogue }, null, 2) + '\n');
await writeFile(path.join(out, 'all-emails.txt'), copy.join('\n').trim() + '\n');
await writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radar email review</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f1ec;color:#17181c;font:15px/1.5 Arial,sans-serif}main{max-width:1420px;margin:auto;padding:32px 20px}h1{font-size:36px;line-height:1.12;letter-spacing:-1px}main>p{max-width:900px;color:#555}.controls{display:flex;flex-wrap:wrap;gap:24px;margin:24px 0}select{font:inherit;padding:8px;background:white;border:1px solid #aaa;border-radius:6px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:24px;align-items:start}article{background:#fff;border:1px solid #d8d8d0;border-radius:12px;overflow:hidden;min-width:0}article[hidden]{display:none}header{padding:20px 24px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}small{text-transform:uppercase;letter-spacing:.05em;font-size:10px;color:#666}h2{font-size:20px;line-height:1.3}header p{font-size:13px;color:#555}a{color:#17181c}iframe{display:block;width:100%;height:1100px;border:0}</style><main><small>RADAR BY THALLY · LOCAL REVIEW</small><h1>Emails for each next step.</h1><p>${families} user-facing families, with ${cases.length} audience and role examples. These are the current source templates, rendered with fictional details. Plain-text senders are shown as plain text. None of the links grants account access, and this gallery sends nothing.</p><p><a href="all-emails.txt">Read every email</a> · <a href="catalogue.json">Full trigger and cadence catalogue</a></p><div class="controls"><label>Category <select id="group"><option value="all">All</option>${['account','billing','education','work','partner','security','report'].map(g => `<option value="${g}">${g}</option>`).join('')}</select></label><label><input type="checkbox" id="variants"> Show audience and role variants</label></div><div class="grid">${cards.join('')}</div></main><script>function filter(){for(const card of document.querySelectorAll('article'))card.hidden=(document.getElementById('group').value!=='all'&&card.dataset.group!==document.getElementById('group').value)||(card.dataset.extra==='true'&&!document.getElementById('variants').checked)}document.getElementById('group').addEventListener('change',filter);document.getElementById('variants').addEventListener('change',filter);for(const frame of document.querySelectorAll('iframe'))frame.addEventListener('load',()=>{try{frame.style.height=Math.max(400,frame.contentDocument.documentElement.scrollHeight)+'px'}catch{}})</script></html>`);
console.log(`Rendered ${families} families / ${cases.length} variants in ${out}; no sends.`);
