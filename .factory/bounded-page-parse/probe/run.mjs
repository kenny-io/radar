// Runs a steps script over a list of pages, each page in its own child process with a time limit (default 30 s).
//   node run.mjs <steps script> <out.json> [limit seconds] [filter]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const [script, outFile, limitArg, filter] = process.argv.slice(2); const limit = (+limitArg || 30) * 1000;
export const cases = [
  ['style elements', 100_000], ['images in a header', 60_000], ['header svg nested deep', 64_000], ['nested divs then images', 16_000], ['nested divs', 64_000], ['stylesheet links', 45_000],
  ['links', 100_000], ['a long class on an ancestor of n images', 150_000], ['k open font elements, then n paragraphs (each paragraph rebuilds the k fonts)', 3_000], ['k open font elements, then n paragraphs (each paragraph rebuilds the k fonts)', 30_000],
  ['nested divs then time elements', 16_000], ['nested spans with text between', 100_000],
  ['ordinary: blog index of n cards', 500], ['ordinary: blog index of n cards', 4_000], ['ordinary: shop home page of n products', 300], ['ordinary: shop home page of n products', 2_500],
];
const rows = [];
for (const [name, n] of cases) {
  if (filter && !name.includes(filter)) continue;
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.resolve(here, script), name, String(n)], { encoding: 'utf8', timeout: limit, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  const lines = r.stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
  const head = lines.find(l => 'bytes' in l) || {}; const steps = lines.filter(l => 'step' in l); const done = lines.some(l => l.done);
  const stopped = r.error?.code === 'ETIMEDOUT';
  const row = { page: name, n, bytes: head.bytes, totalMs: steps.reduce((s, x) => s + x.ms, 0), wallMs: Date.now() - t, ended: done ? 'finished' : stopped ? `stopped at the ${limit / 1000} s limit, in the step after "${steps.at(-1)?.step ?? 'start'}"` : `process ended: ${r.signal || 'exit ' + r.status} ${String(r.stderr).split('\n').find(l => /Error|FATAL/.test(l)) || ''}`.trim(), slow: steps.filter(s => s.ms >= 200 || s.threw), steps };
  rows.push(row);
  console.log(`${name} | n=${n} | ${row.bytes} B | steps ${row.totalMs} ms | ${row.ended}${row.slow.length ? ' | ' + row.slow.map(s => `${s.step}: ${s.ms} ms${s.threw ? ' THREW ' + s.threw : ''}`).join('; ') : ''}`);
}
fs.writeFileSync(outFile, JSON.stringify({ script, node: process.version, platform: process.platform + ' ' + process.arch, limitSeconds: limit / 1000, rows }, null, 1));
