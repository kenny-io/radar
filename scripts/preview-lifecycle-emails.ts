// Local preview only. Does not enqueue or send emails and uses fictional sample details.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { LIFECYCLE_TYPES, renderLifecycle, type LifecycleData } from '../src/server/services/lifecycle/templates';
const folder = '.factory/lifecycle-emails/previews';
const data: LifecycleData = { name: 'Alex', businessName: 'Fieldnote', profileAnalyzed: true, businessId: '00000000-0000-4000-8000-000000000000', trialEnd: '2026-11-07T12:00:00Z', periodEnd: '2026-12-07T12:00:00Z',
  amountCents: 4900, currency: 'usd', invoiceNumber: 'RADAR-DEMO-0001', status: 'canceled', resetUrl: 'https://radar.thally.io/reset-password#token=preview-only-not-a-real-token' };
await mkdir(folder, { recursive: true });
for (const extension of ['html', 'txt']) await rm(`${folder}/workspace_ready.${extension}`, { force: true });
const catalogue: string[] = ['# Radar email previews', '', 'Fictional sample data; no email is sent by this script.', ''];
const descriptions: Record<string, [string, string]> = {
  welcome: ['Welcome', 'After account creation; continues from the Business Profile already created from the website.'],
  founder_note: ['Founder note', 'One day after signup, unless optional setup emails are turned off.'],
  password_reset: ['Password reset', 'When someone requests a password reset for their password account.'],
  trial_started: ['Trial started', 'When the subscription trial starts.'],
  trial_ending: ['Trial ending', 'Before the active trial ends.'],
  invoice_paid: ['Payment receipt', 'When a paid subscription invoice is confirmed.'],
  payment_failed: ['Payment failed', 'When a subscription invoice payment fails.'],
  cancellation_scheduled: ['Cancellation confirmed', 'When cancellation at the end of the current period is scheduled.'],
  subscription_ended: ['Subscription ended', 'When the subscription ends.'],
};
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// Only the review gallery embeds the PNG so it works offline. Outgoing templates use its first-party HTTPS URL.
const brand = 'data:image/png;base64,' + (await readFile('public/brand/radar-mark-email.png')).toString('base64');
const cards: string[] = [];
for (const type of LIFECYCLE_TYPES) {
  const mail = renderLifecycle(type, data, { appUrl: 'https://radar.thally.io', unsubscribeUrl: 'https://radar.thally.io/email-preferences?token=preview-only' });
  await writeFile(`${folder}/${type}.html`, mail.html);
  await writeFile(`${folder}/${type}.txt`, `${mail.subject}\nReply to: ${mail.replyTo}\n\n${mail.text}\n`);
  catalogue.push(`- [${type}](${type}.html): ${mail.subject}`);
  const [label, event] = descriptions[type];
  cards.push(`<section id="${type}"><header><h2>${escape(label)}</h2><p>${escape(event)}</p><p><strong>Subject:</strong> ${escape(mail.subject)}<br><strong>Reply to:</strong> ${mail.replyTo}</p></header><iframe title="${escape(label)} email" srcdoc="${escape(mail.html.replace('https://radar.thally.io/brand/radar-mark-email.png', brand))}"></iframe></section>`);
}
await writeFile(`${folder}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radar — ${LIFECYCLE_TYPES.length} email previews</title><style>*{box-sizing:border-box}body{margin:0;background:#eeeee9;color:#17181c;font:15px/1.5 Arial,sans-serif}main{max-width:1280px;margin:auto;padding:28px 20px}h1{margin:0 0 8px;font-size:30px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0}nav a{background:white;border:1px solid #d6d6cf;border-radius:6px;padding:7px 12px;color:#17181c;text-decoration:none}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}section{background:white;border:1px solid #d6d6cf;border-radius:12px;overflow:hidden;scroll-margin-top:20px}header{padding:20px 24px;border-bottom:1px solid #deded8}h2{font-size:20px;margin:0 0 6px}header p{font-size:14px;margin:6px 0;color:#555}iframe{display:block;width:100%;height:980px;border:0}@media(max-width:850px){.grid{grid-template-columns:1fr}main{padding:20px 8px}}</style></head><body><main><h1>Radar email previews</h1><p>${LIFECYCLE_TYPES.length} current templates with Radar’s actual logo. Fictional sample details. No email has been sent; these changes are awaiting deployment.</p><nav>${LIFECYCLE_TYPES.map(type => `<a href="#${type}">${escape(descriptions[type][0])}</a>`).join('')}</nav><div class="grid">${cards.join('')}</div></main><script>document.querySelectorAll('iframe').forEach(frame=>frame.addEventListener('load',()=>{frame.style.height=Math.ceil(frame.contentDocument.body.firstElementChild.getBoundingClientRect().bottom)+'px'}));</script></body></html>`);
catalogue.splice(4, 0, '[Open the complete visual gallery](index.html)', '');
await writeFile(`${folder}/README.md`, catalogue.join('\n') + '\n');
console.log(`Rendered${LIFECYCLE_TYPES.length} local lifecycle previews (no sends).`);
