// Daily Brief → Add visuals (UPDATE-2026-10-21-image-options §5): Radar makes 1–5 images for a feed post, in the chosen
// visual style, one at a time so they appear as they finish. Uses the image model when configured (each style key maps
// to a prompt template), else the brand template renderer.
import { defineJob, enqueue, type JobCtx } from '@/server/jobs/queue';
import { bump, getBiz } from '@/server/workspace';
import { renderImage } from '@/server/services/images';
import { imgSeed } from '@/lib/imageOptions';
import type { BriefItem, Profile } from '@/lib/types';
import { withDay } from './store';
import { clip } from './plan';

/** Generated at 16:9 and shown cropped to each platform's ratio (LinkedIn 1.91, X 16:9). */
export const BRIEF_IMG_W = 1200, BRIEF_IMG_H = 675;

interface VisualsPayload { date: string; id: string; seed: number }

defineJob<VisualsPayload>({ kind: 'brief.visuals', maxAttempts: 1, timeoutMs: 15 * 60e3, run: async (ctx: JobCtx<VisualsPayload>) => {
  const bid = ctx.businessId!; const { date, id, seed } = ctx.payload;
  const b = await getBiz(bid); const p = b.profile as Profile;
  const day = await withDay(bid, date, row => ({ ret: (row.items as BriefItem[]).find(i => i.id === id) || null }));
  const it = day; if (!it || !it.img || it.img.seed !== seed) return { skipped: true }; // removed or replaced since
  const text = (it.edits?.[it.pl || ''] ?? it.drafts[it.pl || ''] ?? Object.values(it.drafts)[0] ?? '');
  const prompt = `${it.title}. The post says: ${clip(text.replace(/\s+/g, ' '), 400)}`;
  let ok = 0;
  for (let i = 0; i < it.img.n; i++) {
    let url: string | null = null;
    try { url = await renderImage({ bid, kind: 'brief', style: it.img.style, brand: p.brand, headline: i ? '' : it.title, name: p.business.name, seed: imgSeed(seed, i), prompt, w: BRIEF_IMG_W, h: BRIEF_IMG_H }); ok++; }
    catch (e: any) { console.error('[brief.visuals] image failed', i, e?.message); }
    const last = i === it.img.n - 1;
    const still = await withDay(bid, date, row => {
      const items = row.items as BriefItem[]; const k = items.findIndex(x => x.id === id);
      const cur = k >= 0 ? items[k] : null; if (!cur?.img || cur.img.seed !== seed) return { ret: false };
      const urls = [...cur.img.urls]; urls[i] = url;
      const next = [...items]; next[k] = { ...cur, img: { ...cur.img, urls, status: last ? (ok ? 'ready' : 'failed') : 'generating' } };
      return { items: next, ret: true };
    });
    await bump(bid);
    if (!still) return { skipped: true };
    await ctx.progress({ done: i + 1, n: it.img.n });
  }
  return { made: ok };
} });

export const enqueueVisuals = (bid: string, date: string, id: string, seed: number) =>
  enqueue('brief.visuals', { date, id, seed }, { businessId: bid, ref: `${date}:${id}` });
