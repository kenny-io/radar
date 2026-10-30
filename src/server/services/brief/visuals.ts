// Daily Brief → Add visuals (UPDATE-2026-10-21-image-options §5): Radar makes 1–4 images for a feed post, in the chosen
// visual style, one at a time so they appear as they finish. Uses the image model when configured (each style key maps
// to a prompt template), else the brand template renderer.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { RadarError } from '@/server/errors';
import { assertArticleJobOwned } from '../drafting/guard';
import { pubState } from '../social/publish/guards';
import { briefSid } from '@/lib/socialPublish';
import { isLive } from '@/features/brief/model';
import { defineJob, enqueue, type JobCtx } from '@/server/jobs/queue';
import { bump, getBiz } from '@/server/workspace';
import { renderImageFile } from '@/server/services/images';
import { imgSeed } from '@/lib/imageOptions';
import type { BriefItem, Profile } from '@/lib/types';
import { withDay } from './store';
import { clip } from './plan';

/** Generated at 16:9 and shown cropped to each platform's ratio (LinkedIn 1.91, X 16:9). */
export const BRIEF_IMG_W = 1200, BRIEF_IMG_H = 675;

interface VisualsPayload { date: string; id: string; seed: number; request?: string }

defineJob<VisualsPayload>({ kind: 'brief.visuals', maxAttempts: 1, timeoutMs: 15 * 60e3, run: async (ctx: JobCtx<VisualsPayload>) => {
  const bid = ctx.businessId!; const { date, id, seed, request } = ctx.payload;
  const b = await getBiz(bid); const p = b.profile as Profile;
  const day = await withDay(bid, date, row => ({ ret: (row.items as BriefItem[]).find(i => i.id === id) || null }));
  const it = day; if (!it?.img || it.img.request !== request || (it.img.pending?.seed ?? it.img.seed) !== seed) return { skipped: true };
  const settings = it.img.pending || it.img;
  const custom = settings.prompt?.trim();
  const text = (it.edits?.[it.pl || ''] ?? it.drafts[it.pl || ''] ?? Object.values(it.drafts)[0] ?? '');
  const prompt = custom || `${it.title}. The post says: ${clip(text.replace(/\s+/g, ' '), 400)}`;
  let failure: RadarError | null = null;
  const urls: (string | null)[] = [], metas: ({ bytes: number; type: string } | null)[] = [];
  // The day lock protects text/status merges; the job lock excludes output from a timed-out worker attempt.
  const commit = async (finished: boolean, ok: number) => db.transaction(async tx => {
    await assertArticleJobOwned(tx, ctx.job);
    const ps = await pubState(b, briefSid(date, id));
    if (ps?.locked || ps?.pub.status === 'scheduled') return false;
    const row = (await tx.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date))).for('update').limit(1))[0];
    const items = (row?.items || []) as BriefItem[]; const k = items.findIndex(x => x.id === id); const cur = items[k];
    if (!cur?.img || !isLive(cur) || cur.img.request !== request || (cur.img.pending?.seed ?? cur.img.seed) !== seed) return false;
    const img = custom ? (!finished ? cur.img : ok === settings.n ? {
      style: settings.style, seed, request, jobId: ctx.job.id, n: settings.n, prompt: custom, urls, meta: metas, status: 'ready' as const,
    } : { ...cur.img, status: 'failed' as const, error: failure?.userMessage || 'Radar couldn’t generate the new images. Your previous images are kept. Try again.' }) : {
      ...cur.img, urls: Array.from({ length: settings.n }, (_, i) => urls[i] ?? null), meta: Array.from({ length: settings.n }, (_, i) => metas[i] ?? null), status: finished ? (ok ? 'ready' as const : 'failed' as const) : 'generating' as const,
    };
    const next = [...items]; next[k] = { ...cur, img };
    await tx.update(schema.briefDays).set({ items: next }).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date)));
    return true;
  });
  let ok = 0;
  for (let i = 0; i < settings.n; i++) {
    let url: string | null = null; let meta: { bytes: number; type: string } | null = null;
    try { const f = await renderImageFile({ bid, kind: 'brief', style: settings.style, brand: p.brand, headline: i ? '' : it.title, name: p.business.name, seed: imgSeed(seed, i), prompt, modelRequired: !!custom, w: BRIEF_IMG_W, h: BRIEF_IMG_H }); url = f.url; meta = { bytes: f.bytes, type: f.type }; ok++; }
    catch (e: any) { console.error('[brief.visuals] image failed', i, e?.message); if (e instanceof RadarError) failure = e; }
    urls.push(url); metas.push(meta);
    const last = i === settings.n - 1;
    const still = await commit(last, ok);
    await bump(bid);
    if (!still) return { skipped: true };
    await ctx.progress({ done: i + 1, n: settings.n });
  }
  if (custom && ok !== settings.n) { if (failure) throw failure; throw new RadarError('Radar couldn’t generate these images. Your previous images are kept. Try again.', 502, 'image_failed'); }
  return { made: ok };
} });

export const enqueueVisuals = (bid: string, date: string, id: string, seed: number, request?: string) =>
  enqueue('brief.visuals', { date, id, seed, request }, { businessId: bid, ref: `${date}:${id}` });
