import { and, eq, inArray } from 'drizzle-orm';
import { planArticleBodyImages } from '@/lib/articleImages';
import type { Article, ArticleBodyImage, CalendarEntry, Profile } from '@/lib/types';
import { db, schema } from '@/server/db';
import { shortId } from '@/server/crypto';
import { RadarError } from '@/server/errors';
import type { JobCtx } from '@/server/jobs/queue';
import { renderImage } from '../images';
import { assertArticleEditable, assertNoArticleWork, lockArticle } from './guard';

export interface BodyImagesPayload { entryId: string }
export async function generateArticleBodyImages(ctx: Pick<JobCtx, 'businessId' | 'progress'>, e: CalendarEntry, a: Article, profile: Profile): Promise<ArticleBodyImage[]> {
  const plans = planArticleBodyImages(a.body, a.brief.words);
  if (!plans.length) throw new RadarError('Add article content before generating body images.', 400, 'empty_article');
  const images: ArticleBodyImage[] = [];
  const baseSeed = Math.max(a.img.seed || 1, ...(a.bodyImages || []).map(i => i.seed)) + 1;
  await ctx.progress({ stage: 'images', completed: 0, total: plans.length });
  for (const [i, plan] of plans.entries()) {
    const subject = plan.heading || plan.context.slice(0, 140);
    const prompt = `Create a useful editorial visual explaining “${subject}” in the article “${e.title}”. Section context: ${plan.context}. Visual direction: ${a.img.prompt || 'Clear, calm editorial imagery'}. Show a concrete visual metaphor specific to this section, with a distinct composition. Do not repeat the article cover. No text, labels, logos, invented charts or statistics.`;
    const alt = `Illustration of ${subject.replace(/[.!?]+$/, '')}`.slice(0, 300);
    const seed = baseSeed + i;
    // Legacy requests keep provider→template fallback. Explicit custom directions require a model; a partial set is never saved.
    const url = await renderImage({ bid: ctx.businessId!, style: a.img.style, brand: profile.brand, headline: subject, name: profile.business.name, seed, prompt, modelRequired: a.img.modelRequired, w: 1200, h: 675, kind: 'article-body' });
    if (!url) throw new RadarError('Radar couldn’t save the article images. Try again.', 502, 'image_failed');
    images.push({ id: shortId('abi_'), after: plan.after, url, alt, prompt, seed });
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
