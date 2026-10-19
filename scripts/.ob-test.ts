import { eq } from 'drizzle-orm';
import { db, pool, schema } from '../src/server/db';
import '../src/server/services/analysis/jobs';
import '../src/server/services/keywords/jobs';
import { enqueue, runJobNow, getJob } from '../src/server/jobs/queue';
async function main() { console.log('main');
  const domain = process.argv[2] || 'fieldnote.app';
  const u = (await db.select().from(schema.users).limit(1))[0];
  const [b] = await db.insert(schema.businesses).values({ ownerId: u.id, domain, status: 'onboarding', profile: { domain, business: {}, audience: {}, keywords: { list: [] }, brand: {} } }).returning();
  const id = await enqueue('analysis.site', { keepEdits: false }, { businessId: b.id, ref: b.id });
  console.log('enqueued', id); await runJobNow(id);
  const j = await getJob(id);
  console.log(j?.status, j?.error, JSON.stringify(j?.progress));
  const bb = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, b.id)))[0];
  console.log(JSON.stringify(bb.profile.brand), JSON.stringify(bb.site), bb.profile.keywords?.list?.length);
  const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.businessId, b.id));
  for (const x of jobs) if (x.id !== id) { await runJobNow(x.id); const y = await getJob(x.id); console.log(x.kind, y?.status, JSON.stringify(y?.result)); }
  const bb2 = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, b.id)))[0];
  console.log(JSON.stringify(bb2.kwSuggestions));
  await db.delete(schema.businesses).where(eq(schema.businesses.id, b.id));
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
