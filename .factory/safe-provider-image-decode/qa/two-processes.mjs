// The one-at-a-time queue is a variable inside one process. The web process and the worker each have their own, so a
// web request and a worker job that crop at the same moment run two children at once. This shows it: two Node
// processes (standing in for web and worker) each ask for crops of a picture on the pixel limit through the real
// decodeInChild, while this script samples the process table.
//   node .factory/safe-provider-image-decode/qa/two-processes.mjs <corpus dir>
// Run from the worktree root. Role "one" (internal) is a process that crops; without a role this is the observer.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [corpus, role] = process.argv.slice(2);
// The crop program, copied from CROP in src/server/services/images.ts (0d2739c1).
const CROP = `
    const c = createCanvas(o.w, o.h); const ctx = c.getContext('2d');
    const s = Math.max(o.w / img.width, o.h / img.height); const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (o.w - dw) / 2, (o.h - dh) / 2, dw, dh);
    reply({}, c.toBuffer('image/png'));
`;
if (role === 'one') {
  const { decodeInChild } = await import('../../../src/server/services/untrustedImage.ts');
  const raw = fs.readFileSync(corpus + '/limits/real-5000x5000.png');
  // 12 crops asked for at once inside this process: its own queue runs them one after another.
  await Promise.all(Array.from({ length: 12 }, () => decodeInChild(raw, CROP, { w: 1200, h: 628 }, { timeoutMs: 20_000, maxOutput: 32 * 1024 * 1024 })));
  process.exit(0);
}
const workers = [0, 1].map(() => spawn(process.execPath, ['--import', 'tsx', new URL(import.meta.url).pathname, corpus, 'one'], { stdio: 'inherit' }));
const pids = new Set(workers.map(w => String(w.pid))); let done = 0; const perParent = {}; let most = 0, mostRss = 0, samples = 0;
workers.forEach(w => w.on('close', () => { done++; }));
while (done < 2) {
  // Only the decoder's children: `node -e <program>`. (tsx keeps a helper process of its own under each worker.)
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { maxBuffer: 64 * 1024 * 1024 }).toString().trim().split('\n').map(l => l.trim().split(/\s+/)).filter(r => pids.has(r[1]) && r[4] === '-e');
  const by = {}; for (const r of rows) by[r[1]] = (by[r[1]] || 0) + 1;
  for (const [p, n] of Object.entries(by)) perParent[p] = Math.max(perParent[p] || 0, n);
  most = Math.max(most, rows.length); mostRss = Math.max(mostRss, rows.reduce((a, r) => a + Number(r[2]), 0)); samples++;
  await new Promise(r => setTimeout(r, 15));
}
console.log(JSON.stringify({ processes: 2, cropsAskedAtOncePerProcess: 12, picture: '5000x5000 PNG (on the pixel limit)', samples, mostChildrenOfOneProcessAtOnce: Math.max(0, ...Object.values(perParent)), mostChildrenAtOnceOverall: most, mostChildMemoryAtOnceMb: Math.round(mostRss / 1024) }));
