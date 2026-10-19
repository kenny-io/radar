// One-time backfill of outcome events from data that existed before impact tracking (runs after migrations; a no-op once
// any backfilled event exists). Timestamps are the best available: creation, finish, collection or the brief's date.
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { JOB_OUTCOME, jobProducedOutcome, track } from './events';

export async function backfillEvents(): Promise<number> {
  // A marker row makes this run exactly once, even on an empty database (later live events must never be duplicated).
  const done = await db.select({ n: sql<number>`count(*)::int` }).from(schema.events).where(eq(schema.events.kind, 'system.backfilled'));
  if ((done[0]?.n || 0) > 0) return 0;
  await track('system.backfilled', {});
  let n = 0;
  const add = async (kind: Parameters<typeof track>[0], o: Parameters<typeof track>[1]) => { await track(kind, { ...o, props: { ...(o?.props || {}), backfilled: true } }); n++; };

  for (const u of await db.select().from(schema.users)) {
    if (u.email.endsWith('.invalid') || u.email.startsWith('network-partners')) continue;
    await add('user.signed_up', { uid: u.id, at: u.createdAt, props: { method: u.googleSub ? 'google' : 'password' } });
  }
  for (const b of await db.select().from(schema.businesses).where(eq(schema.businesses.status, 'active'))) {
    await add('business.onboarded', { bid: b.id, uid: b.ownerId, at: (b as any).createdAt || undefined });
  }
  for (const g of await db.select().from(schema.gscConnections).where(inArray(schema.gscConnections.status, ['connected', 'syncing', 'error']))) {
    await add('gsc.connected', { bid: g.businessId, at: g.updatedAt });
  }
  for (const d of await db.select().from(schema.briefDays)) {
    const at = new Date(`${d.date}T12:00:00Z`);
    for (const it of (d.items || []) as any[]) {
      const kind = it.st === 'posted' ? (it.kind === 'post' ? 'brief.post_posted' : 'brief.reply_posted') : it.st === 'copied' ? 'brief.reply_copied' : it.st === 'skipped' ? 'brief.skipped' : null;
      if (!kind) continue;
      if (it.st === 'posted' && it.kind === 'reply') await add('brief.reply_copied', { bid: d.businessId, ref: it.id, at, props: { plat: it.plat, implied: true } });
      await add(kind, { bid: d.businessId, ref: it.id, at, props: { date: d.date, kind: it.kind, plat: it.kind === 'post' ? it.pl : it.plat, plugged: it.kind === 'reply' ? !!it.mention : undefined, where: it.where, url: it.url, title: it.title } });
    }
  }
  for (const j of await db.select().from(schema.jobs).where(and(eq(schema.jobs.status, 'done'), inArray(schema.jobs.kind, Object.keys(JOB_OUTCOME))))) {
    if (!jobProducedOutcome(j.kind, j.result)) continue;
    await add(JOB_OUTCOME[j.kind], { bid: j.businessId, ref: j.ref, at: (j as any).finishedAt || j.createdAt, props: { ...(j.result && typeof j.result === 'object' ? j.result : {}) } });
  }
  for (const e of await db.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.status, 'published'), isNotNull(schema.calendarEntries.publishedUrl)))) {
    await add('article.published', { bid: e.businessId, ref: e.id, at: new Date(`${e.date}T12:00:00Z`), props: { url: e.publishedUrl, title: e.title, keyword: e.kw } });
  }
  for (const r of await db.select().from(schema.aiResults).where(isNotNull(schema.aiResults.collectedAt))) {
    if (r.status === 'not-collected') continue;
    await add('visibility.checked', { bid: r.businessId, ref: r.id, at: r.collectedAt!, props: { engine: r.engine, mentioned: r.status === 'mentioned', pos: r.pos } });
    if (r.status === 'mentioned') await add('visibility.mentioned', { bid: r.businessId, ref: r.id, at: r.collectedAt!, props: { engine: r.engine, pos: r.pos } });
  }
  for (const l of await db.select().from(schema.liveLinks)) {
    await add('backlinks.link_live', { bid: l.businessId, at: new Date(`${l.since}T12:00:00Z`), props: { from: l.fromUrl, to: l.toUrl, status: l.status } });
  }
  return n;
}
