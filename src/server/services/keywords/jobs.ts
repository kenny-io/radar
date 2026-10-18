// Job + cron definitions for "keywords". Imported by src/server/jobs/all.ts.
//   keywords.estimate (payload {}, businessId) — fills vol/kd (and intent for new keywords) on profile keywords that are null.
//   keywords.suggest  (ref = businessId)       — recomputes B.kwSuggestions.
//   cron 'keywords.afterGscSync'               — refreshes suggestions whenever a Search Console sync lands new data.
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '../../db';
import { defineJob, once } from '../../jobs/queue';
import { defineCron } from '../../jobs/cron';
import { bump } from '../../workspace';
import { estimate } from './provider';
import { classifyIntent } from './intent';
import { computeSuggestions, refreshKeywordSuggestions } from './suggest';
import type { Keyword, Profile } from '@/lib/types';

defineJob({
  kind: 'keywords.estimate', maxAttempts: 3, backoffMs: a => 4000 * a,
  run: async ctx => {
    const bid = ctx.businessId!; if (!bid) return null;
    const load = async () => (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0];
    const b = await load(); if (!b) return null;
    const p = b.profile as Profile; const list: Keyword[] = p.keywords?.list || [];
    const todo = list.filter(k => k.vol == null || k.kd == null);
    if (!todo.length) return { filled: 0 };
    await ctx.progress({ total: todo.length });
    const market = p.brand?.markets?.[0] || 'United States'; const lang = p.brand?.language || 'English (US)';
    const [data, intents] = await Promise.all([
      estimate(todo.map(k => k.kw), market, lang),
      classifyIntent(bid, todo.filter(k => k.vol == null && k.src === 'user').map(k => k.kw), `Business: ${p.business?.name} — ${p.business?.description}`),
    ]);
    // Re-read right before writing so concurrent profile edits aren't lost; apply by keyword.
    const fresh = await load(); if (!fresh) return null;
    const fp = fresh.profile as Profile; let filled = 0;
    const next = (fp.keywords?.list || []).map(k => {
      const d = data[k.kw.toLowerCase()]; const out = { ...k };
      if (d) { if (out.vol == null && d.vol != null) { out.vol = d.vol; filled++; } if (out.kd == null && d.kd != null) out.kd = d.kd; }
      if (intents[k.kw]) out.intent = intents[k.kw];
      return out;
    });
    await db.update(schema.businesses).set({ profile: { ...fp, keywords: { list: next } } }).where(eq(schema.businesses.id, bid));
    await bump(bid);
    return { filled };
  },
});

defineJob({
  kind: 'keywords.suggest', maxAttempts: 2,
  run: async ctx => {
    const bid = ctx.businessId!; if (!bid) return null;
    const out = await computeSuggestions(bid);
    await bump(bid);
    return { count: out.length };
  },
});

defineCron('keywords.afterGscSync', async () => {
  const rows = await db.select({ bid: schema.gscConnections.businessId, through: schema.gscConnections.lastSyncedThrough })
    .from(schema.gscConnections).where(and(inArray(schema.gscConnections.status, ['connected']), isNotNull(schema.gscConnections.lastSyncedThrough)));
  for (const r of rows) if (await once(`kw-sugg:${r.bid}:${r.through}`)) await refreshKeywordSuggestions(r.bid);
});
