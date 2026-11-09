// Compatibility entry point. All copy is rendered by the shared, current catalogue.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
const folder = '.factory/lifecycle-emails/previews';
if (process.argv.includes('--output')) throw new Error('Use preview-radar-emails.ts for a custom output directory');
process.argv.push('--output', folder);
await import('./preview-radar-emails');
await mkdir(folder, { recursive: true });
for (const ext of ['html', 'txt']) await rm(`${folder}/workspace_ready.${ext}`, { force: true });
const aliases: Record<string, string> = {
  work_update: 'work-combined', work_brief_reply: 'work-brief_reply', work_calendar_review: 'work-calendar_review',
  work_article_social: 'work-article_social', work_social_publish: 'work-social_publish',
};
for (const [old, current] of Object.entries(aliases)) for (const ext of ['html', 'txt']) {
  await writeFile(`${folder}/${old}.${ext}`, await readFile(`${folder}/${current}.${ext}`));
}
const catalogue = JSON.parse(await readFile(`${folder}/catalogue.json`, 'utf8')) as { entries: { id: string; subject: string; primary: boolean }[] };
await writeFile(`${folder}/README.md`, ['# Radar email previews', '', 'Actual current source, fictional sample details, no sends. The full catalogue includes triggers, timing and access/role variants.', '', ...catalogue.entries.filter(x => x.primary).map(x => `- [${x.subject}](${x.id}.html)`), '', 'The workspace-ready message remains retired.', ''].join('\n'));
