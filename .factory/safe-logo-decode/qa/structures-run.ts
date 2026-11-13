// The page structures of structures.ts through detectBrand on a checkout, each step in its own process with a time
// limit (a stalled step is stopped, and larger steps of that ladder are not attempted).
//   node --import tsx .factory/safe-logo-decode/qa/structures-run.ts <checkout> <work dir> <out.json> [limit seconds]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { structures } from './structures';
const [checkout, work, outFile, limitArg] = process.argv.slice(2); const limit = (+limitArg || 20) * 1000;
fs.mkdirSync(work, { recursive: true });
const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'detect-once.ts');
const rows: any[] = [];
for (const s of structures) for (const n of s.sizes) {
  const html = s.html(n); if (html.length > 2 * 1024 * 1024) { rows.push({ name: s.name, n, skipped: 'over the 2 MB the fetch allows' }); continue; }
  const caseFile = path.join(work, 'structure.json'); fs.writeFileSync(caseFile, JSON.stringify({ html, files: {} }));
  const r = spawnSync(process.execPath, ['--import', 'tsx', script, checkout, caseFile], { cwd: checkout, encoding: 'utf8', timeout: limit, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH, QA_ALSO_PARSE: '1', STORAGE_DIR: path.relative(checkout, path.join(work, 'storage')) } as any });
  const lines = r.stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
  const parse = lines.find(l => 'parseMs' in l && !('settled' in l)), answer = lines.find(l => 'settled' in l);
  const stopped = (r.error as any)?.code === 'ETIMEDOUT';
  const row: any = { name: s.name, n, bytes: html.length, parseAloneMs: parse?.parseMs ?? null, detectMs: answer?.ms ?? null, settled: answer?.settled ?? (stopped ? `no answer in ${limit / 1000} s: stopped (${parse ? 'the parse alone had finished' : 'still inside the parse alone'})` : `process ended: ${r.signal || 'exit ' + r.status}`), logo: answer?.result?.logo ?? undefined, primary: answer?.result?.primary, error: answer?.error };
  rows.push(row); console.log([row.name, 'n=' + n, row.bytes + ' B', 'parse alone ' + row.parseAloneMs + ' ms', 'detectBrand ' + row.detectMs + ' ms', row.settled, row.error || ''].join(' | '));
  if (stopped || (answer?.ms ?? 0) > 3000) { rows.push({ name: s.name, n: 'larger', skipped: 'not attempted after the step above' }); break; }
}
fs.writeFileSync(outFile, JSON.stringify({ checkout, limitSeconds: limit / 1000, rows }, null, 1));
