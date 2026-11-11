// Read-only initial-response head compatibility checks; no browser execution or page mutations.
import { load } from 'cheerio';
import { writeFile } from 'node:fs/promises';
const base = (process.env.BASE_URL || 'https://radar.thally.io').replace(/\/$/, '');
const paths = ['/', '/features/organic-search', '/features/ai-visibility', '/features/backlinks', '/privacy', '/terms', '/bot', '/signup', '/signin'];
const uas = ['Twitterbot/1.0', 'facebookexternalhit/1.1', 'LinkedInBot/1.0', 'Slackbot-LinkExpanding 1.0', 'Discordbot/2.0', 'WhatsApp/2.24.1', 'TelegramBot (like TwitterBot)', 'OAI-SearchBot/1.4', 'PerplexityBot/1.0', 'Claude-SearchBot/1.0', 'Googlebot/2.1'];
const selectors = ['link[rel="canonical"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[property="og:type"]', 'meta[property="og:image"]', 'meta[name="twitter:card"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]', 'meta[name="twitter:image"]'];
const rows = [];
for (const path of paths) for (const ua of uas) {
  try {
    const r = await fetch(base + path, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(20000) });
    const html = await r.text(), $ = load(html);
    rows.push({ path, ua, status: r.status, headEnd: html.indexOf('</head>'), canonicalOffset: html.indexOf('rel="canonical"'), missing: selectors.filter(selector => $('head ' + selector).length !== 1) });
  } catch (error) { rows.push({ path, ua, status: 0, error: error.message }); }
}
const output = { atUTC: new Date().toISOString(), revision: process.env.QA_REVISION || 'working-tree', base, checks: rows };
await writeFile(process.env.QA_OUTPUT || '.factory/seo-ai-discovery/qa/head-matrix.json', JSON.stringify(output, null, 2) + '\n');
const failed = rows.filter(row => row.status !== 200 || row.error || row.missing.length);
console.log(JSON.stringify({ base, passed: rows.length - failed.length, failed }, null, 2));
if (failed.length) process.exitCode = 1;
