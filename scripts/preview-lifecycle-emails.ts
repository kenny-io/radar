// Local preview only. Does not enqueue or send emails and uses fictional sample details.
import { mkdir, writeFile } from 'node:fs/promises';
import { LIFECYCLE_TYPES, renderLifecycle, type LifecycleData } from '../src/server/services/lifecycle/templates';
const folder = '.factory/lifecycle-emails/previews';
const data: LifecycleData = { name: 'Alex', businessName: 'Fieldnote', profileAnalyzed: true, businessId: '00000000-0000-4000-8000-000000000000', trialEnd: '2026-11-07T12:00:00Z', periodEnd: '2026-12-07T12:00:00Z',
  amountCents: 4900, currency: 'usd', invoiceNumber: 'RADAR-DEMO-0001', status: 'canceled', resetUrl: 'https://radar.thally.io/reset-password#token=preview-only-not-a-real-token' };
await mkdir(folder, { recursive: true });
const catalogue: string[] = ['# Radar email previews', '', 'Fictional sample data; no email is sent by this script.', ''];
for (const type of LIFECYCLE_TYPES) {
  const mail = renderLifecycle(type, data, { appUrl: 'https://radar.thally.io', unsubscribeUrl: 'https://radar.thally.io/email-preferences?token=preview-only' });
  await writeFile(`${folder}/${type}.html`, mail.html);
  await writeFile(`${folder}/${type}.txt`, `${mail.subject}\nReply to: ${mail.replyTo}\n\n${mail.text}\n`);
  catalogue.push(`- [${type}](${type}.html): ${mail.subject}`);
}
await writeFile(`${folder}/README.md`, catalogue.join('\n') + '\n');
console.log(`Rendered${LIFECYCLE_TYPES.length} local lifecycle previews (no sends).`);
