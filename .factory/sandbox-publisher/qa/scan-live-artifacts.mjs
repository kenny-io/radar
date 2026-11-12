// QA-1: search what the live runs left on this machine (run transcripts, kept files, records, PR bodies, logs) for
// secrets, and summarise which paths the agent's tools touched. Prints counts and path prefixes only.
//   node --env-file=.env.local .factory/sandbox-publisher/qa/scan-live-artifacts.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
const roots = ['.data/sandbox-publisher', '.factory/sandbox-publisher/qa'];
const token = (() => { try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } })();
const needles = { DAYTONA_API_KEY: process.env.DAYTONA_API_KEY, RADAR_PUBLISH_CAPABILITY_SECRET: process.env.RADAR_PUBLISH_CAPABILITY_SECRET, 'GitHub token': token };
const patterns = { 'capability (rdrcap1.<claims>.<signature>)': /rdrcap1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'provider key': /sk-ant-[A-Za-z0-9_-]{20,}/, 'GitHub token shape': /\bgh[pousr]_[A-Za-z0-9]{30,}/, 'database URL with password': /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/ };
const files = []; const walk = dir => { for (const name of readdirSync(dir)) { const file = path.join(dir, name); const stat = statSync(file); if (stat.isDirectory()) { if (name !== 'pgdata') walk(file); } else files.push(file); } };
for (const root of roots) try { walk(root); } catch { /* absent */ }
const findings = []; const tools = { calls: 0, byTool: {}, prefixes: {}, denied: 0, outside: [] };
const allowed = ['/workspace/repo', '/workspace/input', '/output'];
for (const file of files) {
  let text;
  try { const raw = readFileSync(file); text = file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('latin1'); } catch { continue; }
  for (const [name, value] of Object.entries(needles)) if (value && value.length >= 8 && text.includes(value)) findings.push(`${name} in ${file}`);
  // The fixtures in the QA tests are placeholders written for those tests; real values are what the needles above look for.
  if (!/\.qa\.test\.ts$|helpers\.ts$|scan-live-artifacts\.mjs$|browser-setup\.mjs$/.test(file)) for (const [name, pattern] of Object.entries(patterns)) if (pattern.test(text)) findings.push(`${name} in ${file}`);
  if (!file.endsWith('.jsonl.gz')) continue;
  for (const line of text.split('\n')) {
    let message; try { message = JSON.parse(line); } catch { continue; }
    for (const block of Array.isArray(message?.message?.content) ? message.message.content : []) {
      if (block?.type === 'tool_use') {
        tools.calls++; tools.byTool[block.name] = (tools.byTool[block.name] || 0) + 1;
        for (const key of ['file_path', 'path']) { const value = block.input?.[key]; if (typeof value !== 'string') continue; const absolute = value.startsWith('/') ? value : '/workspace/repo/' + value; const prefix = allowed.find(root => absolute === root || absolute.startsWith(root + '/')) || 'OUTSIDE'; tools.prefixes[prefix] = (tools.prefixes[prefix] || 0) + 1; if (prefix === 'OUTSIDE') tools.outside.push(`${block.name} ${absolute.split('/').slice(0, 3).join('/')}`); }
      }
      if (block?.type === 'tool_result' && /limited to|not available/.test(JSON.stringify(block.content || '').slice(0, 400))) tools.denied++;
    }
  }
}
console.log(JSON.stringify({ filesScanned: files.length, transcripts: files.filter(file => file.endsWith('.jsonl.gz')).length, secretFindings: findings, agentToolCalls: tools }, null, 1));
