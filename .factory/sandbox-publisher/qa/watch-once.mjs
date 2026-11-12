// QA-2: read-only. Prints the state of sandboxes labelled workload=radar-publisher whenever it changes, for about
// 150 seconds or until none is left.   node --env-file=.env.local .factory/sandbox-publisher/qa/watch-once.mjs
import { Daytona } from '@daytona/sdk';
const client = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: 'https://app.daytona.io/api' });
const end = Date.now() + 150_000; let last = '';
for (;;) {
  const rows = [];
  try { for await (const item of client.list({ labels: { workload: 'radar-publisher' } })) if (item.labels?.workload === 'radar-publisher') rows.push(`${item.id.slice(0, 8)} ${item.state}`); } catch { rows.push('list failed'); }
  const line = rows.sort().join(' | ') || 'none';
  if (line !== last) { console.log(new Date().toISOString().slice(11, 19), line); last = line; }
  if (line === 'none' || Date.now() > end) break;
  await new Promise(resolve => setTimeout(resolve, 15_000));
}
console.log(new Date().toISOString().slice(11, 19), 'end');
