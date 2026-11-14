// Round 2, D1: no reader is running; a document is asked for and the calling process is busy for 8 s from that same
// turn, so the reader is started, and the document handed over, by a process that cannot attend to either.
//   npx tsx .factory/bounded-page-parse/qa/busy-cold.mjs
import path from 'node:path';
import { load, children, log, O, describeError, timed, ROOT } from './lib.mjs';
const { reader } = await load();
const fx = await import(path.join(ROOT, 'src/server/services/analysis/stalling.fixtures.ts'));
const busyFor = ms => { const until = Date.now() + ms; while (Date.now() < until) { /* busy */ } };
const BLOG = fx.ordinary.blogIndex(); const STALLS = fx.stalling.nestedDivs();
for (const [what, text, expect] of [['a 100-byte page', '<title>Small</title>', 'read'], ['the 1.5 MB blog index', BLOG, 'read'], ['a stalling page', STALLS, 'timed_out']]) {
  const before = children.length; const r = timed(() => reader.readPage(text, O + '/p', O, { idleMs: 1 })); busyFor(8000); const done = await r;
  log({ what: `${what}; no reader running, the caller busy 8 s from the turn it asks in`, outcome: done.error ? describeError(done.error).replace('The document could not be read: ', '') : `read (${done.value.links.length} links)`, expected: expect, ms: done.ms, readersStarted: children.length - before });
  await new Promise(resolve => setTimeout(resolve, 300)); // the reader stops itself (idle 1 ms): the next case starts cold again
}
