// The reader when its calling process ends (AC8): no reader may outlive its caller by more than the document's limit
// plus two seconds when it is inside a document, or at all when it is idle. Each scenario is a fresh `tsx` process, the
// way the worker is started (tsx src/worker/main.ts).
// node .factory/bounded-page-parse/qa/life.mjs [scenario filter]      (from the root of the worktree)
import { spawn } from 'node:child_process';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const tsx = path.join(process.cwd(), 'node_modules/.bin/tsx');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const filter = process.argv[2] || '';

/** [scenario, what the driver does once the caller says it is ready, the longest the reader may live after the caller is gone (ms)] */
const SCENARIOS = [
  ['return-idle', null, 500], ['return-busy', null, 500],
  ['exit-idle', null, 500], ['exit-busy', null, 7000 + 500],
  ['throw-idle', null, 500], ['throw-busy', null, 7000 + 500],
  ['reject-idle', null, 500], ['reject-busy', null, 7000 + 500],
  ['wait-idle', 'SIGTERM', 500], ['wait-busy', 'SIGTERM', 7000 + 500],
  ['wait-idle', 'SIGKILL', 500], ['wait-busy', 'SIGKILL', 7000 + 500],
  ['wait-idle', 'SIGINT', 500], ['wait-busy', 'SIGHUP', 7000 + 500],
  ['cold-kill', 'SIGKILL', 7000 + 500], ['cold-exit', null, 7000 + 500],
];

for (const [scenario, signal, allowed] of SCENARIOS) {
  const name = scenario + (signal ? ':' + signal : '');
  if (filter && !name.includes(filter)) continue;
  const began = Date.now();
  const child = spawn(tsx, [path.join(here, 'life-child.mjs'), scenario], { stdio: ['ignore', 'pipe', 'pipe'] });
  let reader = 0, self = 0, busyAt = 0, out = '', err = '', signalled = false;
  const rows = [];
  child.stderr.on('data', d => { err += d; });
  child.stdout.on('data', d => {
    out += d; let nl;
    while ((nl = out.indexOf('\n')) >= 0) {
      let row; try { row = JSON.parse(out.slice(0, nl)); } catch { row = { text: out.slice(0, nl) }; } out = out.slice(nl + 1); rows.push(row);
      if (row.reader) reader = row.reader;
      if (row.self) self = row.self;
      if (row.busy) busyAt = row.t;
      const ready = scenario.includes('busy') || scenario.startsWith('cold') ? row.busy : row.waiting;
      if (signal && ready && !signalled) { signalled = true; setTimeout(() => { try { process.kill(self, signal); } catch { /* gone */ } }, scenario.startsWith('cold') ? 30 : 100); }
    }
  });
  // tsx runs the script in a node process of its own, which says its pid: that process is the caller. It is the one
  // signalled, and the caller is gone when that process is.
  const wrapper = new Promise(resolve => child.on('exit', (code, sig) => resolve({ code, sig })));
  while (!self && child.exitCode === null) await sleep(10);
  while (self && alive(self)) await sleep(5);
  const exit = { ...(await Promise.race([wrapper, sleep(3000).then(() => ({ code: 'wrapper still running' }))])), at: Date.now() };
  let readerGoneAfter = null;
  for (const end = exit.at + allowed + 6000; Date.now() < end;) { if (!reader || !alive(reader)) { readerGoneAfter = Date.now() - exit.at; break; } await sleep(25); }
  const leaked = reader && alive(reader);
  if (leaked) { try { process.kill(reader, 'SIGKILL'); } catch { /* */ } }
  console.log(JSON.stringify({ scenario: name, callerExit: exit.code ?? exit.sig, callerLivedMs: exit.at - began, reader, readerGoneMsAfterCaller: readerGoneAfter, readerLivedMsAfterItsDocumentBegan: busyAt && readerGoneAfter != null ? exit.at + readerGoneAfter - busyAt + 400 : undefined, allowedMs: allowed, verdict: leaked ? 'LEAKED (still running; killed by QA)' : readerGoneAfter <= allowed ? 'ok' : 'LATE', settled: rows.filter(r => r.settled).map(r => r.settled), stderr: err.split('\n').filter(l => /Error|rejection|exception/i.test(l)).slice(0, 2) }));
}
