// TEMP (content area QA) — start a draft for one entry and print streamed progress. Deleted after verification.
import { eq, and } from 'drizzle-orm';
import { db, pool, schema } from '../src/server/db';
import { getJob } from '../src/server/jobs/queue';
import { startDraft } from '../src/server/services/drafting/start';

const b = (await db.select().from(schema.businesses).limit(1))[0];
const e = (await db.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, b.id), eq(schema.calendarEntries.status, 'proposed'))).orderBy(schema.calendarEntries.date).limit(1))[0];
await db.update(schema.calendarEntries).set({ status: 'approved' }).where(eq(schema.calendarEntries.id, e.id));
const id = await startDraft(b.id, e.id, (process.argv[2] as any) || 'cron', { id: 'b_test' + Date.now(), ids: [e.id] });
let n = 0;
for (let i = 0; i < 900; i++) {
  const j = await getJob(id);
  if (j!.progress && n++ % 6 === 0) console.log(j!.status, j!.progress.stage, (j!.progress.blocks || []).length, JSON.stringify(j!.progress.partial || '').slice(0, 80));
  if (j!.status === 'done' || j!.status === 'failed') { console.log('result', JSON.stringify(j!.result), j!.error); break; }
  await new Promise(r => setTimeout(r, 400));
}
const a = (await db.select().from(schema.articles).where(eq(schema.articles.entryId, e.id)))[0];
const d: any = a.data;
console.log(JSON.stringify({ seo: d.seo, img: d.img, sources: d.sources.map((s: any) => s.title), claims: d.claims }, null, 1));
for (const bl of d.body) console.log(bl[0], Array.isArray(bl[1]) ? bl[1].join(' | ') : bl[1]);
const st = (await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, e.id)))[0].status;
console.log('status', st, (await db.select().from(schema.notifications)).slice(-1).map(x => x.payload));
await pool.end();
