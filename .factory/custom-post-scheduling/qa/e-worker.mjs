// C1/C3/C6 worker proof. The real worker process (src/worker/main.ts, dev stubs) is already running.
// Method: posts were scheduled through the UI for tomorrow; this script (1) shows a full minute tick leaves them untouched,
// (2) moves ONLY due_at in the test DB to a few minutes from now (wall-clock date/time untouched), (3) records the timeline.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { check, finish, db, runtime, fixture, results, browser } from './lib.mjs';
const H = JSON.parse(await fs.readFile(runtime + '/headline-pack.json', 'utf8')).packId; const { T, E } = JSON.parse(await fs.readFile(runtime + '/worker-packs.json', 'utf8'));
const snap = async () => (await db.query("SELECT sid,status,due_at,posted_at,remote_url,err_code,attempts FROM social_pubs WHERE business_id=$1 ORDER BY sid", [fixture.businessId])).rows;
const sleep = ms => new Promise(r => setTimeout(r, ms)); const timeline = [];
await check('Worker leaves posts due tomorrow untouched across a minute tick', async () => {
  const a = await snap(); assert.equal(a.length, 6); assert(a.every(r => r.status === 'scheduled'));
  await sleep(75_000); const b = await snap(); assert(b.every(r => r.status === 'scheduled' && r.attempts === 0)); return { rows: b.length };
});
const t0 = Date.now(); const due = { [`s:${H}:x`]: 80, [`s:${H}:linkedin`]: 200, [`s:${T}:x`]: 80, [`s:${T}:linkedin`]: 80, [`s:${E}:x`]: 80, [`s:${E}:linkedin`]: 80 };
for (const [sid, s] of Object.entries(due)) await db.query('UPDATE social_pubs SET due_at=$3 WHERE business_id=$1 AND sid=$2', [fixture.businessId, sid, new Date(t0 + s * 1000)]);
await check('Worker sends each post at its own due time (X first, LinkedIn later), never early', async () => {
  const seen = {};
  for (;;) {
    const rows = await snap(); const now = Date.now();
    for (const r of rows) { if (seen[r.sid] !== r.status) { seen[r.sid] = r.status; timeline.push({ tSec: Math.round((now - t0) / 1000), sid: r.sid.replace(H, 'HEADLINE').replace(T, 'TEXTONLY').replace(E, 'EDITED'), status: r.status, dueSec: due[r.sid], err: r.err_code }); }
      if (r.status !== 'scheduled') assert(new Date(r.due_at).getTime() <= now + 500, 'sent before due: ' + r.sid); }
    if (rows.every(r => r.status === 'posted' || r.status === 'failed')) break;
    if (now - t0 > 420_000) throw Error('timeout: ' + JSON.stringify(seen)); await sleep(3000);
  }
  const rows = await snap(); const get = sid => rows.find(r => r.sid === sid);
  const hx = get(`s:${H}:x`), hl = get(`s:${H}:linkedin`);
  assert.equal(hx.status, 'posted'); assert.equal(hl.status, 'posted'); assert(/^https:\/\/x\.com\//.test(hx.remote_url)); assert(/^https:\/\/www\.linkedin\.com\//.test(hl.remote_url));
  assert(new Date(hx.posted_at) < new Date(hl.posted_at), 'X before LinkedIn'); assert(new Date(hx.posted_at) >= new Date(hx.due_at)); assert(new Date(hl.posted_at) >= new Date(hl.due_at));
  const lagX = (new Date(hx.posted_at) - new Date(hx.due_at)) / 1000, lagL = (new Date(hl.posted_at) - new Date(hl.due_at)) / 1000; assert(lagX < 90 && lagL < 90, `lag ${lagX}/${lagL}`);
  return { timeline, lagSeconds: { x: lagX, linkedin: lagL } };
});
const payload = async sid => (await db.query('SELECT status,payload,err,err_code,remote_url FROM social_pubs WHERE business_id=$1 AND sid=$2', [fixture.businessId, sid])).rows[0];
const strip = v => JSON.parse(JSON.stringify(v).replaceAll(fixture.businessId, '<bid>'));
await check('Headline pack sent with the user text verbatim and the uploaded image per platform', async () => {
  const x = await payload(`s:${H}:x`), l = await payload(`s:${H}:linkedin`);
  assert.equal(x.payload.text, 'Thally is live: calendar-based time tracking for designers. https://thally.test/launch'); assert(l.payload.text.startsWith('Thally launch day.\n\nWe built'));
  assert.equal(x.payload.media.length, 1); assert.equal(x.payload.media[0].type, 'image/png'); assert(/social-upload/.test(x.payload.media[0].url));
  assert.equal(l.payload.media.length, 1); assert.equal(l.payload.media[0].type, 'image/jpeg'); assert(/social-upload/.test(l.payload.media[0].url));
  return strip({ x: x.payload, linkedin: l.payload });
});
await check('Text-only custom post is sent with NO image and no rendered/AI image is attached to the pack', async () => {
  const x = await payload(`s:${T}:x`), l = await payload(`s:${T}:linkedin`); assert.equal(x.status, 'posted'); assert.equal(l.status, 'posted');
  assert.deepEqual(x.payload.media, []); assert.deepEqual(l.payload.media, []);
  const data = (await db.query('SELECT data FROM social_packs WHERE id=$1', [T])).rows[0].data;
  for (const k of ['x', 'linkedin']) { assert.equal(data.posts[k].imageUrl, null); assert(!data.posts[k].photo); assert(!data.posts[k].generatedMedia); assert.equal(data.posts[k].author, 'user'); }
  return strip({ x: x.payload, linkedin: l.payload });
});
await check('Edited-after-scheduling: LinkedIn sends the edited text and replaced image; over-limit X fails, nothing sent, not truncated', async () => {
  const x = await payload(`s:${E}:x`), l = await payload(`s:${E}:linkedin`);
  assert.equal(l.status, 'posted'); assert.equal(l.payload.text, 'LinkedIn AFTER edit — this is what must be sent.'); assert.equal(l.payload.media[0].type, 'image/png');
  assert.equal(x.status, 'failed'); assert.equal(x.remote_url, null);
  const data = (await db.query('SELECT data FROM social_packs WHERE id=$1', [E])).rows[0].data; assert.equal([...data.posts.x.text].length, 308, 'text not truncated in the pack');
  return strip({ xFail: { err: x.err, code: x.err_code, payload: x.payload }, linkedin: l.payload });
});
await check('No job or AI image generation ran for custom packs', async () => {
  const jobs = (await db.query('SELECT kind,status FROM jobs WHERE business_id=$1', [fixture.businessId])).rows; const ev = (await db.query("SELECT kind,count(*)::int n FROM events WHERE business_id=$1 GROUP BY kind ORDER BY kind", [fixture.businessId])).rows;
  assert(!jobs.some(j => /generate|image|media/.test(j.kind)), JSON.stringify(jobs)); return { jobs, events: ev };
});
await finish('e-worker-results.json');
