// Social pack generation (02-system.md §8.1): per-platform copy with the writing model + on-brand visuals at exact sizes.
// Radar never posts anything (README §2.5 #1): packs are only stored for the user to copy and download.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ai, profileContext } from '../../ai';
import { getBiz, bizToday } from '../../workspace';
import { renderImageFile, imageModelConfigured } from '../images';
import { randomToken } from '../../crypto';
import { IMG_SIZES, plat } from '@/lib/constants';
import { shortHead } from '@/lib/format';
import type { ImageStyle, MediaMeta, PackStyle, Platform, Profile, SocialPack, SocialPost } from '@/lib/types';
import { check, enforce, rulesFor } from './rules';
import { readArticle, readUrl, type Grounding } from './source';
import './stubs';

export type SourceKind = SocialPack['source']['kind'];
export interface IdeaContext { metric?: string; why?: string; tie?: string | null; page?: string | null; q?: string }
export interface PackInput {
  source: { kind: SourceKind; label: string; ref?: string | null };
  platforms: Platform[]; style: PackStyle; custom?: string; voice?: string; auto?: boolean; idea?: IdeaContext | null;
}
/** Stored with the pack (jsonb) so Regenerate stays grounded in the same source. */
export interface PackExtra { headline: string; order: Platform[]; grounding: { brief: string; link: string | null; idea?: IdeaContext | null } }
export type StoredPack = SocialPack & Partial<PackExtra>;

const KIND_L: Record<SourceKind, string> = { idea: 'an idea from the user', url: 'an article URL', article: 'one of the business’s own Radar articles', suggest: 'a Radar suggestion backed by search data' };

export async function groundingFor(bid: string, src: PackInput['source'], idea?: IdeaContext | null): Promise<Grounding> {
  if (src.kind === 'url') return readUrl(src.label);
  if (src.kind === 'article' && src.ref) return readArticle(bid, src.ref);
  if (src.kind === 'suggest') {
    const brief = [
      `Post angle: ${src.label}`, idea?.q && `Search topic: ${idea.q}`, idea?.metric && `Search data: ${idea.metric}`, idea?.why && `Why now: ${idea.why}`,
      idea?.tie && `Relevant profile fact: ${idea.tie}`, idea?.page && `Related page on the site: ${idea.page}`,
    ].filter(Boolean).join('\n');
    return { headline: src.label, brief, link: null };
  }
  return { headline: src.label, brief: `Idea from the user: ${src.label}`, link: null };
}

const PostSchema = z.object({ text: z.string().min(1).max(6000) });

/** Write one platform's copy, checking the rules and retrying with feedback, then enforcing hard rules. */
export async function writePost(bid: string, p: Profile, k: Platform, o: { kind: SourceKind; label: string; g: Grounding; voice?: string; v: number; previous?: string }): Promise<string> {
  const name = p.business.name;
  const system = [
    `You write social media posts for ${name || 'a small business'} (${p.domain}). The user copies and posts them manually; you never claim anything was published.`,
    `Write for real people on the platform, in the brand voice. Be specific and useful.`,
    `Hard rules: never promote, praise or recommend a competitor. Never invent statistics, survey results, customer counts, quotes, testimonials or outcomes that are not in the source or the profile. No emojis unless the brand voice calls for them.`,
    `Return JSON: {"text": "<the post exactly as it should be pasted>"}.`,
  ].join('\n');
  const allowedLink = k === 'reddit' ? null : o.g.link;
  const base = [
    profileContext(p),
    `\nBRAND VOICE: ${p.brand.voice || 'Clear and friendly.'}`,
    o.voice?.trim() ? `NOTES FOR THIS PACK (apply them): ${o.voice.trim()}` : '',
    `LANGUAGE: write in ${p.brand.language || 'English (US)'}.`,
    `\nPLATFORM: ${plat(k).l}\n${rulesFor(k, name)}`,
    allowedLink ? `You may include this link once if it helps: ${allowedLink}. No other links.` : `Do not include any links or URLs.`,
    `\nSOURCE (${KIND_L[o.kind]}): ${o.label}\n${o.g.brief}`,
    o.previous ? `\nWrite a fresh take (variation ${o.v}). Don’t reuse the structure or opening of this earlier version:\n"""${o.previous.slice(0, 1500)}"""` : '',
  ].filter(Boolean).join('\n');
  let text = ''; let feedback: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt = feedback.length ? `${base}\n\nYour previous draft broke these rules — fix them:\n- ${feedback.join('\n- ')}\n\nPrevious draft:\n"""${text}"""` : base;
    const r = await ai.run('writing', { purpose: 'social.post', system, prompt, schema: PostSchema, schemaName: 'post', maxTokens: 1200, temperature: 0.8, stubContext: { platform: k, topic: o.g.headline || o.label, profile: p, v: o.v + attempt } }, { businessId: bid });
    text = r.json!.text.trim();
    const c = check(k, text, p, { sourceLabel: o.label + ' ' + o.g.headline });
    if (c.ok) break;
    feedback = c.problems;
  }
  return enforce(k, text, p, { allowedLink, sourceLabel: o.label + ' ' + o.g.headline });
}

/** Image style actually rendered: "Custom direction" renders as an illustration guided by the custom text. */
export const renderStyle = (s: PackStyle): ImageStyle => (s === 'custom' ? 'illustration' : s);

/** Renders the post's visual to a real file. `meta` (size, type) is stored as the post's imageMeta for the posting checks. */
export async function renderPostImage(bid: string, p: Profile, k: Platform, post: Pick<SocialPost, 'style' | 'seed' | 'imagePrompt'>, headline: string, custom?: string): Promise<{ url: string; photo: boolean; meta: MediaMeta }> {
  const [w, h] = IMG_SIZES[k];
  const style = renderStyle(post.style);
  const { url, bytes, type } = await renderImageFile({ bid, kind: 'social', style, brand: p.brand, headline, name: p.business.name, seed: post.seed, prompt: post.imagePrompt || (custom?.trim() ? `${custom.trim()}. Topic: ${headline}` : headline), modelRequired: !!post.imagePrompt, w, h });
  return { url, photo: (!!post.imagePrompt || style === 'photography' || style === 'illustration') && imageModelConfigured(), meta: { bytes, type } };
}

/** Build and save a pack. `onProgress(done)` fires after each platform finishes (copy + visual). */
export async function createPack(bid: string, input: PackInput, onProgress?: (done: number) => Promise<void> | void): Promise<string> {
  const b = await getBiz(bid); const p = { ...(b.profile as Profile), domain: b.domain };
  const g = await groundingFor(bid, input.source, input.idea);
  const style: PackStyle = input.style === 'custom' ? 'illustration' : input.style; // prototype: custom → illustration + custom text
  const seed0 = Math.floor(Math.random() * 50);
  const posts: Partial<Record<Platform, SocialPost & { photo?: boolean }>> = {};
  const headline = input.source.kind === 'url' ? g.headline : input.source.label;
  let i = 0;
  for (const k of input.platforms) {
    const text = await writePost(bid, p, k, { kind: input.source.kind, label: input.source.label, g, voice: input.voice, v: seed0 + i });
    const post: SocialPost & { photo?: boolean } = { text, style, seed: seed0 * 7 + i, imageUrl: null, copiedAt: null, v: 0 };
    try { const r = await renderPostImage(bid, p, k, post, headline, input.custom); post.imageUrl = r.url; post.photo = r.photo; post.imageMeta = r.meta; }
    catch (e: any) { console.error('[social] image render failed', e?.message); } // the live template shows while imageUrl is missing
    posts[k] = post; i++;
    await onProgress?.(i);
  }
  const id = 'p' + Date.now().toString(36) + randomToken(4);
  const pack: StoredPack = {
    id, name: shortHead(input.source.label, input.source.kind === 'suggest' ? 120 : 64), source: { kind: input.source.kind, label: input.source.label, ref: input.source.ref ?? null },
    created: bizToday(b), style, custom: input.custom || '', voice: input.voice || '', auto: !!input.auto, posts, order: input.platforms,
    headline, grounding: { brief: g.brief.slice(0, 2500), link: g.link, idea: input.idea || null },
  };
  await db.insert(schema.socialPacks).values({ id, businessId: bid, data: pack });
  return id;
}

/** Read-modify-write one pack under a row lock (autosave, copy and regenerate can overlap). */
export async function updatePack(bid: string, packId: string, fn: (p: StoredPack) => StoredPack | Promise<StoredPack>): Promise<StoredPack> {
  return db.transaction(async tx => {
    const r = (await tx.select().from(schema.socialPacks).where(and(eq(schema.socialPacks.businessId, bid), eq(schema.socialPacks.id, packId))).for('update').limit(1))[0];
    if (!r) throw Object.assign(new Error('pack'), { notFound: true });
    const next = await fn({ ...(r.data as StoredPack), id: r.id });
    await tx.update(schema.socialPacks).set({ data: next }).where(eq(schema.socialPacks.id, packId));
    return next;
  });
}
export async function getPack(bid: string, packId: string): Promise<StoredPack | null> {
  const r = (await db.select().from(schema.socialPacks).where(and(eq(schema.socialPacks.businessId, bid), eq(schema.socialPacks.id, packId))).limit(1))[0];
  return r ? { ...(r.data as StoredPack), id: r.id } : null;
}
