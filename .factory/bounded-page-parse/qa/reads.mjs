// Every hostile document of docs.mjs through the reader functions directly, with the limit every document gets (5 s).
// npx tsx .factory/bounded-page-parse/qa/reads.mjs page|brand|sitemap [name filter]   → one JSON line per read
import { load, monitor, timed, describeError, watchMemory, children, mb, log, sleep, O } from './lib.mjs';
import { pages, sitemaps, invalidUtf8 } from './docs.mjs';

const [kind = 'page', filter = ''] = process.argv.slice(2);
const { reader } = await load();
const docs = kind === 'sitemap' ? { ...sitemaps, 'sitemap: 64,000 nested <div> page': pages['deep: 300,000 <div>'], 'sitemap: invalid UTF-8': () => invalidUtf8().toString('utf8') } : { ...pages, 'bytes: invalid UTF-8': () => invalidUtf8().toString('utf8') };
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e) }); }); process.on('uncaughtException', e => { unhandled++; log({ uncaughtException: String(e) }); });

for (const [name, make] of Object.entries(docs)) {
  if (filter && !name.includes(filter)) continue;
  const text = make(); const size = Buffer.byteLength(text);
  // The invalid bytes are 1.9 MB as fetched; decoded, each becomes U+FFFD.
  if (size > 2 * 1024 * 1024 && !name.includes('invalid UTF-8')) { log({ name, skipped: `over 2 MB: ${size}` }); continue; }
  await sleep(30);
  const before = children.length; const pidBefore = children[children.length - 1]?.pid;
  const mem = watchMemory(50); const watch = monitor();
  const r = await timed(() => kind === 'page' ? reader.readPage(text, O + '/p', O) : kind === 'brand' ? reader.readBrandPage(text, O) : reader.readSitemap(text, O + '/sitemap.xml', 'site.example'));
  await sleep(20); // whatever the caller does on the next turns belongs to the read too
  const loop = watch.stop(); const memory = await mem.stop();
  const answer = r.value ? JSON.stringify(r.value) : '';
  const shape = r.value ? Object.fromEntries(Object.entries(r.value).map(([k, v]) => [k, Array.isArray(v) ? `${v.length} entries, ${JSON.stringify(v).length} chars` : typeof v === 'string' ? (v.length > 60 ? `${v.length} chars` : v) : v])) : undefined;
  log({ kind, name, mb: mb(text), ms: r.ms, outcome: r.error ? describeError(r.error) : 'read', ...loop, answerMb: Math.round(answer.length / 10485.76) / 100, ...memory, newReader: children.length > before, shape });
}
log({ kind, done: true, unhandled, readersStarted: children.length });
