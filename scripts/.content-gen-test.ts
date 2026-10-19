// TEMP (content area QA) — enqueue calendar.generate and print progress. Deleted after verification.
import { eq, desc } from 'drizzle-orm';
import { db, pool, schema } from '../src/server/db';
import { enqueue, getJob } from '../src/server/jobs/queue';
import { calendarSettingsOf } from '../src/server/workspace';

const b = (await db.select().from(schema.businesses).limit(1))[0];
const settings = calendarSettingsOf(b);
const id = await enqueue('calendar.generate', { settings, keep: process.argv[2] === 'keep' }, { businessId: b.id, ref: b.id, singletonKey: 'cal-gen:' + b.id });
let last = '';
for (let i = 0; i < 600; i++) {
  const j = await getJob(id);
  const s = JSON.stringify({ st: j!.status, p: j!.progress });
  if (s !== last) { console.log(s); last = s; }
  if (j!.status === 'done' || j!.status === 'failed') { console.log('result', JSON.stringify(j!.result).slice(0, 300), j!.error); break; }
  await new Promise(r => setTimeout(r, 500));
}
const es = await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.businessId, b.id)).orderBy(schema.calendarEntries.date);
for (const e of es.slice(0, 40)) console.log(e.date, e.status, e.type, '|', e.title, '|', e.kw, e.vol, e.kd, '|', e.relevance, '|', e.audience);
const n = await db.select().from(schema.notifications).orderBy(desc(schema.notifications.createdAt)).limit(2);
console.log(n.map(x => x.payload));
await pool.end();
