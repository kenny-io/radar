// Business Profile actions (CONTRACTS.md · onboarding area).
//   profile.update    { profile, editedKeys } — saves, marks keys edited, uploads logo data URLs, enqueues keywords.estimate.
//   profile.reanalyze {} → { jobId }         — re-runs analysis keeping edited fields (and any uploaded logo).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { RadarError } from '../errors';
import { enqueue } from '../jobs/queue';
import { putDataUrl } from '../services/storage';
import { HEX_RE } from '@/lib/format';
import { PROFILE_FIELDS } from '@/lib/constants';
import type { Edited, Keyword, Profile } from '@/lib/types';

const str = (n: number) => z.string().transform(s => s.slice(0, n)).catch('');
const list = (n: number, max = 40) => z.array(z.string().transform(s => s.slice(0, n))).transform(a => a.slice(0, max)).catch([]);
const KeywordIn = z.object({ kw: z.string().min(1).max(120), intent: z.enum(['Commercial', 'Informational']).catch('Informational'), vol: z.number().int().nonnegative().nullable().catch(null), kd: z.number().min(0).max(100).nullable().catch(null), src: z.enum(['site', 'gsc', 'competitor', 'user']).catch('user'), priority: z.boolean().catch(false) });
export const ProfileIn = z.object({
  domain: z.string().optional(),
  business: z.object({ name: str(120), description: str(1000), offerings: list(200), industry: str(120), positioning: str(1000), differentiators: list(300) }),
  audience: z.object({ segments: list(200), buyers: list(200), needs: list(300), competitors: list(120) }),
  keywords: z.object({ list: z.array(KeywordIn).max(200) }),
  brand: z.object({ logo: z.string().max(8 * 1024 * 1024).nullable(), logoUploaded: z.boolean().optional(), primary: z.string(), secondary: z.string(), voice: str(1000), language: str(80), markets: list(80) }),
});
const VALID_KEYS = new Set(Object.entries(PROFILE_FIELDS).flatMap(([g, ks]) => ks.map(k => `${g}.${k}`)));

/** Shared by profile.update and onboarding review edits. */
export async function saveProfile(bid: string, cur: Profile, curEdited: Edited, domain: string, input: z.infer<typeof ProfileIn>, editedKeys: string[]) {
  const p = input as unknown as Profile;
  p.domain = domain;
  // Colors: keep the previous value if the new one isn't #RRGGBB (ColorField validates client-side too).
  if (!HEX_RE.test(p.brand.primary)) p.brand.primary = cur.brand.primary; else p.brand.primary = p.brand.primary.toUpperCase();
  if (!HEX_RE.test(p.brand.secondary)) p.brand.secondary = cur.brand.secondary; else p.brand.secondary = p.brand.secondary.toUpperCase();
  // Logo: data URL → storage (user upload). Otherwise only "unchanged" or "removed" are accepted.
  const logo = p.brand.logo;
  if (logo && logo.startsWith('data:')) {
    if (!/^data:image\/(png|jpe?g|svg\+xml|webp|gif);base64,/i.test(logo)) throw new RadarError('Use an SVG or PNG image for your logo.');
    try { p.brand.logo = await putDataUrl(bid, 'logo', logo); } catch (e: any) { throw new RadarError(/large/i.test(e?.message) ? 'That image is over 5 MB. Use a smaller logo.' : 'Radar couldn’t save that image. Try again.'); }
    p.brand.logoUploaded = true;
  } else if (logo == null) { p.brand.logo = null; p.brand.logoUploaded = false; }
  else if (logo !== cur.brand.logo) { p.brand.logo = cur.brand.logo; p.brand.logoUploaded = !!cur.brand.logoUploaded; }
  else p.brand.logoUploaded = !!cur.brand.logoUploaded;
  // Keywords: dedupe, max 3 priorities, keep estimates the server filled meanwhile (the client may send stale nulls).
  const prev = new Map((cur.keywords?.list || []).map(k => [k.kw, k]));
  const seen = new Set<string>(); let pri = 0;
  p.keywords = { list: (p.keywords?.list || []).map((k): Keyword | null => {
    const kw = k.kw.trim().toLowerCase(); if (!kw || seen.has(kw)) return null; seen.add(kw);
    const o = prev.get(kw);
    const priority = !!k.priority && pri < 3; if (priority) pri++;
    return { kw, intent: k.intent, src: k.src, priority, vol: k.vol ?? o?.vol ?? null, kd: k.kd ?? o?.kd ?? null };
  }).filter(Boolean) as Keyword[] };
  const edited: Edited = { ...curEdited };
  for (const k of editedKeys) if (VALID_KEYS.has(k)) edited[k] = true;
  await db.update(schema.businesses).set({ profile: p, edited }).where(eq(schema.businesses.id, bid));
  if (p.keywords.list.some(k => k.vol == null || k.kd == null)) await enqueue('keywords.estimate', {}, { businessId: bid, singletonKey: 'kw-est:' + bid });
  return { edited };
}

export async function startAnalysis(bid: string, keepEdits: boolean) {
  const jobId = await enqueue('analysis.site', { keepEdits }, { businessId: bid, ref: bid, singletonKey: 'analysis:' + bid });
  return { jobId };
}

export const actions: ActionMap = {
  'profile.update': action({
    role: 'Editor',
    input: z.object({ profile: ProfileIn, editedKeys: z.array(z.string()).max(100).default([]) }),
    run: async (ctx, { profile, editedKeys }) => {
      await saveProfile(ctx.bid, ctx.biz.profile as Profile, ctx.biz.edited || {}, ctx.biz.domain, profile, editedKeys);
      return { ok: true };
    },
  }),
  'profile.reanalyze': action({
    role: 'Editor', input: z.object({}).passthrough(),
    run: async ctx => startAnalysis(ctx.bid, true),
  }),
};
