import { and, eq, inArray } from 'drizzle-orm';
import { coverDirectionIsOwners, fallbackImageDirections, planArticleBodyImages } from '@/lib/articleImages';
import type { Article, ArticleBodyImage, ArticleImageDirections, CalendarEntry, Profile } from '@/lib/types';
import { db, schema } from '@/server/db';
import { shortId } from '@/server/crypto';
import { RadarError } from '@/server/errors';
import type { JobCtx } from '@/server/jobs/queue';
import { renderImage } from '../images';
import { assertArticleEditable, assertNoArticleWork, lockArticle } from './guard';

export interface BodyImagesPayload { entryId: string }
/** One strict, literal image per planned section. `directions` come from resolveImageDirections; absent or of the wrong
 *  length, they are built from the title, heading and section text (no AI call happens here). A body image is never
 *  the brand template: any failure throws, and nothing partial is returned. */
export async function generateArticleBodyImages(ctx: Pick<JobCtx, 'businessId' | 'progress'>, e: CalendarEntry, a: Article, profile: Profile, directions?: Pick<ArticleImageDirections, 'sections'>): Promise<ArticleBodyImage[]> {
  const plans = planArticleBodyImages(a.body, a.brief.words);
  if (!plans.length) throw new RadarError('Add article content before generating body images.', 400, 'empty_article');
  const sections = directions?.sections?.length === plans.length ? directions.sections : fallbackImageDirections(e.title, a.body, plans).sections;
  // A cover direction a person typed also guides the body images; one Radar wrote describes the cover's own scene only.
  const owner = coverDirectionIsOwners(a.img, e.kw) ? a.img.prompt.trim() : '';
  const images: ArticleBodyImage[] = [];
  const baseSeed = Math.max(a.img.seed || 1, ...(a.bodyImages || []).map(i => i.seed)) + 1;
  await ctx.progress({ stage: 'images', completed: 0, total: plans.length });
  for (const [i, plan] of plans.entries()) {
    const d = sections[i];
    const seed = baseSeed + i;
    const url = await renderImage({ bid: ctx.businessId!, style: a.img.style, brand: profile.brand, headline: plan.heading || e.title, name: profile.business.name, seed, prompt: owner ? `${d.prompt} Overall look the owner asked for: ${owner}` : d.prompt, literal: true, modelRequired: true, w: 1200, h: 675, kind: 'article-body' });
    if (!url) throw new RadarError('Radar couldn’t save the article images. Try again.', 502, 'image_failed');
    images.push({ id: shortId('abi_'), after: plan.after, url, alt: d.alt, prompt: d.prompt, seed });
    await ctx.progress({ stage: 'images', completed: i + 1, total: plans.length });
  }
  return images;
}

export async function startBodyImages(bid: string, entryId: string): Promise<string> {
  return db.transaction(async tx => {
    const row = await lockArticle(tx, bid, entryId);
    assertArticleEditable(row.status, row.publishRemote);
    const existing = (await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.ref, entryId), eq(schema.jobs.kind, 'article.bodyImages'), inArray(schema.jobs.status, ['queued', 'running']))).limit(1))[0];
    if (existing) return existing.id;
    if (!['draft', 'review', 'approved', 'failed'].includes(row.status)) throw new RadarError('Finish drafting this article before generating body images.', 409, 'article_busy');
    await assertNoArticleWork(tx, bid, entryId);
    const a = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid))).limit(1))[0]?.data as Article | undefined;
    if (!a?.generated || !a.body?.length) throw new RadarError('Draft this article before adding body images.', 400, 'not_generated');
    if (!planArticleBodyImages(a.body, a.brief.words).length) throw new RadarError('Add article content before generating body images.', 400, 'empty_article');
    return (await tx.insert(schema.jobs).values({ kind: 'article.bodyImages', payload: { entryId }, businessId: bid, ref: entryId, singletonKey: 'body-images:' + entryId, maxAttempts: 2, progress: { stage: 'images', completed: 0, total: planArticleBodyImages(a.body, a.brief.words).length } }).returning({ id: schema.jobs.id }))[0].id;
  });
}
