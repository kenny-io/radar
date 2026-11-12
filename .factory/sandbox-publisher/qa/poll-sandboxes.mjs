// QA-2: read-only watcher. Lists sandboxes labelled workload=radar-publisher once a minute and prints their id, entry
// and state, until none is left or the time is up. Deletes nothing.
//   node --env-file=.env.local .factory/sandbox-publisher/qa/poll-sandboxes.mjs [minutes]
import { Daytona } from '@daytona/sdk';
const client = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: 'https://app.daytona.io/api' });
const minutes = Number(process.argv[2] || 30);
const until = Date.now() + minutes * 60_000;
let last = '';
for (;;) {
  const rows = [];
  try { for await (const item of client.list({ labels: { workload: 'radar-publisher' } })) if (item.labels?.workload === 'radar-publisher') rows.push(`${item.id.slice(0, 8)} ${item.labels.entry} ${item.state}`); } catch (error) { rows.push(`list failed: ${error?.name}`); }
  const line = rows.sort().join(' | ') || 'none';
  if (line !== last) { console.log(new Date().toISOString().slice(11, 19), line); last = line; }
  if (!rows.length || Date.now() > until) break;
  await new Promise(resolve => setTimeout(resolve, 60_000));
}
console.log(new Date().toISOString().slice(11, 19), 'done');
