// Round 2: do the engineer's new tests fail without the fixes for D1 to D4? Each mutant undoes one part of a fix in a
// scratch copy of the branch (never the worktree), and the three test files that cover the fixes are run against it.
// node mutate2.mjs <scratch checkout of the branch, with node_modules> [name filter]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const root = process.argv[2]; const only = process.argv[3] || ''; const dir = 'src/server/services/analysis';
const M = (defect, file, from, to, name) => ({ defect, file, from, to, name });
const R = 'pageReader.ts', C = 'crawl.ts';
const MUTANTS = [
  M('D1', R, "flight.backstop = setInterval(() => { if (--ticks > 0) return;", "const deadline = Date.now() + flight.request.timeoutMs + READER_GRACE_MS; flight.backstop = setInterval(() => { if (--ticks > 0 && Date.now() < deadline) return;", 'the backstop goes by the clock again, not by turns of the event loop'),
  M('D1', R, "  if (!r.closed || current?.reader !== r) return;\n  const flight = current;", "  if (current?.reader !== r) return;\n  const flight = current;", 'a failure is decided on exit alone, before the channel has closed'),
  M('D1', R, "setTimeout(() => process.kill(process.pid, '${WATCHDOG_SIGNAL}'), ms)", "setTimeout(() => process.kill(process.pid, 'SIGKILL'), ms)", 'the watchdog ends the reader with SIGKILL, like anyone else'),
  M('D1', R, "setTimeout(() => process.kill(process.pid, '${WATCHDOG_SIGNAL}'), ms)", "setTimeout(() => {}, ms)", 'the watchdog never ends the reader (only the backstop does)'),
  M('D1', R, "flight.backstop = null; r.late = true; if (reader === r) reader = null; kill(r); }, BACKSTOP_TICK_MS);", "flight.backstop = null; }, BACKSTOP_TICK_MS);", 'no backstop: a frozen reader is never killed'),
  M('D1', R, "watchdog.postMessage(m.limit > 0 ? m.limit : ${PAGE_READ_MS});", "watchdog.postMessage((m.limit > 0 ? m.limit : ${PAGE_READ_MS}) + 2000);", 'the watchdog gives two seconds more than the limit'),
  M('D1', R, "  process.send(answer);\n  watchdog.postMessage(0);", "  process.send(answer);", 'the watchdog is not told the document is done'),
  M('D4', R, "else if (flight.tries < 2) { flight.tries++; give(flight); }", "else if (flight.tries < 1) { flight.tries++; give(flight); }", 'no second try'),
  M('D4', R, "else if (flight.tries < 2) { flight.tries++; give(flight); }", "else if (flight.tries < 50) { flight.tries++; give(flight); }", 'fifty tries'),
  M('D4', R, "if (r.ended.signal === WATCHDOG_SIGNAL || r.late) settle(", "if (r.late) settle(", 'a reader its watchdog ended is tried again'),
  M('D2', R, "if (n.length > MAX_ADDRESS_CHARS || links.has(n)) return; if (linksChars", "if (links.has(n)) return; if (linksChars", 'a link of any length'),
  M('D2', R, "if (linksChars + n.length > MAX_LINKS_CHARS) return false;", "if (linksChars + n.length > MAX_LINKS_CHARS) return;", 'links past the total are skipped, not the end of the list'),
  M('D2', R, "if (linksChars + n.length > MAX_LINKS_CHARS) return false;", "", 'no total for a page\'s links'),
  M('D2', R, "if (loc.length > MAX_ADDRESS_CHARS || sitemaps.has(loc)) return;", "if (sitemaps.has(loc)) return;", 'a child sitemap address of any length'),
  M('D2', R, "sitemaps.add(loc); if (sitemaps.size >= MAX_CHILD_SITEMAPS) return false;", "sitemaps.add(loc);", 'any number of child sitemaps'),
  M('D2', R, "if (n.length > MAX_ADDRESS_CHARS) return; if (outChars + n.length > MAX_SITEMAP_URLS_CHARS) return false;", "if (outChars + n.length > MAX_SITEMAP_URLS_CHARS) return false;", 'a sitemap entry of any length'),
  M('D2', R, "if (outChars + n.length > MAX_SITEMAP_URLS_CHARS) return false;", "", 'no total for a sitemap\'s addresses'),
  M('D2', R, "logoCandidates($, origin).slice(0, MAX_LOGO_CANDIDATES)", "logoCandidates($, origin)", 'every logo candidate is sent'),
  M('D2', R, "if (Buffer.byteLength(JSON.stringify(answer.data)) > MAX_ANSWER_BYTES) answer = { id: m.id, error: 'answer too large' };", "", 'an answer of any size is sent'),
  M('D2', R, "export const MAX_ANSWER_BYTES = 8 * 1024 * 1024;", "export const MAX_ANSWER_BYTES = 16 * 1024 * 1024;", 'answers up to 16 MB'),
  M('D3', C, "reading.unreadable >= MAX_UNREADABLE || reading.ms >= reading.mayUse;", "reading.unreadable >= MAX_UNREADABLE;", 'the crawl has no time allowance'),
  M('D3', C, "export const CRAWL_READ_MS = 60_000;", "export const CRAWL_READ_MS = 600_000;", 'ten minutes instead of sixty seconds'),
  M('D3', R, "settle(new PageUnreadable('timed_out'), undefined, flight.request.timeoutMs);", "settle(new PageUnreadable('timed_out'));", 'a timed-out document counts for nothing'),
  M('D3', R, "else settle(null, m.data, m.ms);", "else settle(null, m.data, 0);", 'a document that is read counts for nothing'),
  M('D3', C, "const extract = (html: string, url: string, origin: string, reading: Reading): Promise<PageRead> => readPage(html, url, origin, timed(reading));", "const extract = (html: string, url: string, origin: string, _reading: Reading): Promise<PageRead> => readPage(html, url, origin);", 'pages are not counted, only sitemaps'),
  M('life', R, "  if (done.reader) { done.reader.child.unref(); done.reader.child.channel?.unref(); }", "", 'the reader keeps this process alive after its document'),
  M('life', R, "    r.child.ref(); r.child.channel?.ref();\n", "", 'the reader does not keep this process alive while it has a document'),
];
const FILES = [`${dir}/pageReader.busy.test.ts`, `${dir}/pageReader.test.ts`, `${dir}/unreadable.test.ts`];
const run = () => spawnSync('npx', ['vitest', 'run', ...FILES], { cwd: root, encoding: 'utf8', timeout: 900_000 });
const rows = [];
for (const m of MUTANTS) {
  if (only && !m.name.includes(only)) continue;
  const file = path.join(root, dir, m.file); const original = fs.readFileSync(file, 'utf8');
  if (original.split(m.from).length !== 2) { rows.push({ mutant: m.name, error: `the text to change occurs ${original.split(m.from).length - 1} times` }); console.log(JSON.stringify(rows.at(-1))); continue; }
  fs.writeFileSync(file, original.replace(m.from, m.to));
  try {
    const r = run(); const failed = [...r.stdout.matchAll(/^ (?:FAIL|×) +(.*)$/gm)].map(x => x[1]);
    const byFile = f => (r.stdout.match(new RegExp(`${f.replace(/[.]/g, '\\.')} \\((\\d+) tests?(?: \\| (\\d+) failed)?`)) || [])[2] || '0';
    const row = { defect: m.defect, mutant: m.name, verdict: r.status === 0 ? 'NOT NOTICED' : 'noticed', failedTests: { 'pageReader.busy': byFile('pageReader.busy.test.ts'), pageReader: byFile('pageReader.test.ts'), unreadable: byFile('unreadable.test.ts') }, timedOut: r.error ? String(r.error.message).slice(0, 80) : undefined };
    rows.push(row); console.log(JSON.stringify(row));
  } finally { fs.writeFileSync(file, original); }
  // A mutant may leave a reader behind (that is what some of them are). Only readers started from the scratch copy are
  // ended here: other readers on this machine belong to other runs.
  try {
    for (const pid of execFileSync('/usr/bin/pgrep', ['-f', 'max-old-space-size=384'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)) {
      let cwd = ''; try { cwd = execFileSync('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-p', pid, '-Fn'], { encoding: 'utf8' }).split('\n').find(l => l.startsWith('n'))?.slice(1) || ''; } catch { /* gone */ }
      if (cwd && fs.realpathSync(cwd) === fs.realpathSync(root)) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ } }
    }
  } catch { /* none running */ }
}
console.log(JSON.stringify({ mutants: rows.length, noticed: rows.filter(r => r.verdict === 'noticed').length, notNoticed: rows.filter(r => r.verdict === 'NOT NOTICED').map(r => r.mutant), couldNotApply: rows.filter(r => r.error).map(r => r.mutant) }));
console.log(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }) || 'scratch checkout clean');
