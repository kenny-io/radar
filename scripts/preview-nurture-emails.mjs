// Local preview of the seven mapped lifecycle messages. No queue, sender or database imports.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { nurtureDrafts } from '../.factory/lifecycle-emails/nurture/copy.mjs';
const out = '.factory/lifecycle-emails/previews/nurture';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logo = 'data:image/png;base64,' + (await readFile('public/brand/radar-mark-email.png')).toString('base64');
const cards = [], text = ['RADAR LIFECYCLE SCHEDULE', 'The seven former drafts now map to actual runtime events and lessons.', 'Fictional source previews only; generating this gallery sends nothing.', ''];
await mkdir(out, { recursive: true });
for (const record of nurtureDrafts) {
  const { mail } = record;
  const html = mail.html.replaceAll('https://radar.thally.io/brand/radar-mark-email.png', logo);
  await writeFile(`${out}/${record.id}.html`, html);
  await writeFile(`${out}/${record.id}.txt`, `Subject: ${mail.subject}\nPreview: ${mail.preheader || ''}\n\n${mail.text.trim()}\n`);
  text.push(record.label, 'Runtime event: ' + record.scheduleKey, 'Timing: ' + record.timing, 'Audience: ' + record.audience, 'Relationship: ' + record.relationship, 'Subject: ' + mail.subject, 'Preview: ' + (mail.preheader || ''), '', mail.text, '', '---', '');
  cards.push(`<article id="${record.id}"><header><h2>${escape(record.label)}</h2><p><b>Subject:</b> ${escape(mail.subject)}<br><b>Timing:</b> ${escape(record.timing)}<br><b>Audience:</b> ${escape(record.audience)}</p><p>${escape(record.relationship)}</p><a href="${record.id}.html">Full email</a> · <a href="${record.id}.txt">Plain text</a></header><iframe title="${escape(record.label)}" src="${record.id}.html" loading="lazy"></iframe></article>`);
}
await writeFile(`${out}/drafts.txt`, text.join('\n').trim() + '\n');
await writeFile(`${out}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radar lifecycle schedule</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f1ec;color:#17181c;font:15px/1.5 Arial,sans-serif}main{max-width:1300px;margin:auto;padding:32px 20px}h1{font-size:32px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:24px;align-items:start}article{background:white;border:1px solid #d8d8d0;border-radius:12px;overflow:hidden;min-width:0}header{padding:22px;overflow-wrap:anywhere}header p{font-size:13px;color:#555}h2{font-size:20px}iframe{width:100%;height:1150px;border:0}a{color:#17181c}</style><main><h1>Seven drafts, placed in the lifecycle.</h1><p>Each message below maps to a runtime event or weekly lesson. This gallery uses the actual shared renderer with fictional data. Source is pending release; nothing is sent by generating or viewing these previews.</p><p><a href="drafts.txt">Read all seven</a></p><div class="grid">${cards.join('')}</div></main><script>for(const f of document.querySelectorAll('iframe'))f.addEventListener('load',()=>{try{f.style.height=f.contentDocument.documentElement.scrollHeight+'px'}catch{}})</script></html>`);
console.log(`Rendered ${nurtureDrafts.length} mapped lifecycle messages; no sends.`);
