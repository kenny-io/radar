import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderLifecycle } from '../src/server/services/lifecycle/templates.ts';
import { EDUCATION_LESSONS, educationProgress, renderEducationLesson } from '../src/server/services/lifecycle/educationContent.ts';

const out = path.resolve('.factory/weekly-education/previews');
await mkdir(out, { recursive: true });
const origin = 'https://radar.thally.io';
const image = `data:image/png;base64,${(await readFile('public/brand/radar-mark-email.png')).toString('base64')}`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const contexts = ['workspace', 'start_trial', 'restart', 'setup'];
const cards = [];
const text = ['Radar: five weeks, five practical lessons', '', 'Example business: Paper & Pixel. Example recipient: Alex.', 'These are local previews, not messages sent to customers.', ''];
for (const access of contexts) {
  for (const [index, lesson] of EDUCATION_LESSONS.entries()) {
    const context = { businessName: 'Paper & Pixel', offering: 'design tools', audience: 'independent studios', keyword: 'design tools for small studios', gscConnected: false, access };
    const content = renderEducationLesson(lesson, context);
    const mail = renderLifecycle('weekly_education', { name: 'Alex', education: { version: 1, lesson, context, businessId: '11111111-1111-4111-8111-111111111111' } }, { appUrl: origin, unsubscribeUrl: `${origin}/email-preferences?token=preview-only-not-valid` });
    const filename = `${index + 1}-${lesson}-${access}`;
    await writeFile(path.join(out, `${filename}.html`), mail.html.replaceAll(`${origin}/brand/radar-mark-email.png`, image));
    await writeFile(path.join(out, `${filename}.txt`), `${mail.subject}\n\n${mail.text}\n`);
    cards.push(`<article data-audience="${access}" ${access === 'workspace' ? '' : 'hidden'}><div class="card-label"><span>Week ${index + 1} · ${escape(lesson.replaceAll('_', ' '))}</span><h2>${escape(content.subject)}</h2><a href="${filename}.html">Open full email</a> · <a href="${filename}.txt">Plain text</a></div><iframe title="Week ${index + 1}: ${escape(content.subject)}" src="${filename}.html" loading="lazy"></iframe></article>`);
    if (access === 'workspace') text.push(`WEEK ${index + 1} — ${content.subject}`, '', content.heading, ...content.paragraphs, '', ...content.steps.map((step, i) => `${i + 1}. ${step}`), '', educationProgress(lesson), '', `Button: ${content.ctaLabel}`, '', '---', '');
  }
}
await writeFile(path.join(out, 'sequence.txt'), text.join('\n\n'));
await writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radar weekly lessons</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f5f2;color:#17181c;font:16px/1.5 Arial,sans-serif}main{max-width:1400px;margin:auto;padding:40px 24px}h1{font-size:38px;line-height:1.12;max-width:700px;letter-spacing:-1px}p{max-width:750px;color:#555}label{display:block;margin:24px 0}select{font:inherit;padding:10px;border:1px solid #aaa;border-radius:6px;background:white}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:24px}article{background:#fff;border:1px solid #deded8;border-radius:12px;overflow:hidden}article[hidden]{display:none}.card-label{padding:22px;border-bottom:1px solid #ddd}.card-label span{font-size:12px;text-transform:uppercase;letter-spacing:.08em}h2{font-size:20px;line-height:1.3}a{color:#17181c}iframe{display:block;width:100%;height:1100px;border:0}footer{margin-top:36px;color:#666}</style><main><small>RADAR BY THALLY · EMAIL PREVIEW</small><h1>Five weeks. Five ways to put Radar to work.</h1><p>One lesson per week, with two actions and a progress check. These fictional examples show the implemented email templates. No customer messages are sent by this gallery.</p><p><a href="sequence.txt">Read the complete five-email sequence</a></p><label>Preview audience <select id="audience"><option value="workspace">Active workspace</option><option value="start_trial">Registered, pre-trial</option><option value="restart">Lapsed access</option><option value="setup">Setup incomplete</option></select></label><div class="grid">${cards.join('')}</div><footer>Unsubscribe links are preview-only. Production links are signed and scoped to weekly lessons.</footer></main><script>document.getElementById('audience').addEventListener('change',event=>{for(const card of document.querySelectorAll('[data-audience]'))card.hidden=card.dataset.audience!==event.target.value})</script></html>`);
console.log(`Created ${cards.length} local email previews: ${path.join(out, 'index.html')}`);
