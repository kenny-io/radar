import { reportFailure } from '@/server/observability/failures';
// The publisher: scheduled entry → payload → draft on the platform → publish (02-system.md §7, §12).
import { canRun } from '../autopilot/guard';
import { trackSoon } from '@/server/events';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { notify } from '@/server/notify';
import { bump, blogOf, connPublic, entryFromRow, getBiz, laterV, type BizRow } from '@/server/workspace';
import { renderImageFile } from '@/server/services/images';
import { readLocal, storedKey } from '@/server/services/storage';
import { platLabel } from '@/lib/constants';
import { slugify } from '@/lib/format';
import type { Article, ArticlePublishError, CalendarEntry, ConnType, Profile } from '@/lib/types';
import { blocksToHtml, blocksToMarkdown, sourcesList } from './render';
import { connectorFor } from './connectors';
import { publishAttemptMs } from './connectors/nextjs';
import { PublishError } from './http';
import { resolveRefreshUrl } from './refreshUrl';
import { ctxFromRow, type ConnRow } from './store';
import type { PublishPayload, RemoteDraft } from './types';
import { assertNoArticleWork, lockArticle } from '../drafting/guard';

const abs = (u: string) => (u.startsWith('/') ? env.appUrl + u : u);

/** Approved outbound links (backlinks area). Loaded at runtime so publishing works before/without that module. */
async function applyOutbound(bid: string, entryUrl: string | null, html: string): Promise<string> {
  try {
    const dir = path.join(process.cwd(), 'src/server/services/backlinks');
    const file = ['outbound.ts', 'outbound.js'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
    if (!file) return html;
    const spec = '../backlinks/outbound';
    let mod: any;
    try { mod = await import(/* webpackIgnore: true */ spec); } catch { mod = await import(/* webpackIgnore: true */ pathToFileURL(file).href); }
    return typeof mod?.applyApprovedOutboundLinks === 'function' ? await mod.applyApprovedOutboundLinks(bid, entryUrl, html) : html;
  } catch (e: any) {
    await reportFailure(e, { source: 'publishing', operation: 'publishing.outboundLinks', businessId: bid, degraded: true });
    console.error('[publish] outbound links skipped:', e?.message || e);
    return html;
  }
}

async function heroImage(b: BizRow, e: CalendarEntry, a: Article): Promise<string | null> {
  if (a.img?.url) return a.img.url;
  const p = b.profile as Profile;
  try {
    const { url, placeholder } = await renderImageFile({ bid: b.id, style: a.img?.style || 'branded', brand: { primary: p.brand.primary, secondary: p.brand.secondary }, headline: e.title, name: p.business.name || b.domain, seed: a.img?.seed ?? 1, prompt: a.img?.prompt, literal: a.img?.promptBy === 'radar', w: 1200, h: 628, kind: 'hero' });
    // Keep it on the article so the editor shows the same image that went live. A model style that fell back to the
    // brand template is published as it is, and marked in the same statement so the editor says so afterwards.
    const withUrl = sql`jsonb_set(${schema.articles.data}, '{img,url}', ${JSON.stringify(url)}::jsonb, true)`;
    const data = placeholder ? sql`jsonb_set(${withUrl}, '{img,placeholder}', ${JSON.stringify({ reason: placeholder, at: new Date().toISOString() })}::jsonb, true)` : withUrl;
    await db.update(schema.articles).set({ data, updatedAt: laterV() }).where(eq(schema.articles.entryId, e.id));
    return url;
  } catch (err: any) {
    await reportFailure(err, { source: 'publishing', operation: 'publishing.heroImage', businessId: b.id, ref: e.id, degraded: true });
    console.error('[publish] hero image failed:', err?.message || err); return null;
  }
}

export async function buildPayload(b: BizRow, e: CalendarEntry, a: Article): Promise<PublishPayload> {
  const refreshUrl = e.mode === 'refresh' ? resolveRefreshUrl(e.url, b.domain) : null;
  const p = b.profile as Profile;
  const meta = new Map((a.videoMeta || []).map(v => [v.id, v]));
  const videos = (a.videos || []).map(id => { const m = meta.get(id); return { id, title: m?.title || '', channel: m?.channel || '', url: `https://www.youtube.com/watch?v=${id}` }; });
  const sources = sourcesList(a.sources);
  const bodyImages = (a.bodyImages || []).map(image => {
    if (!storedKey(b.id, image.url)) throw new PublishError(422, 'An article body image is not stored for this business. Regenerate body images before publishing.', '', 'config');
    const url = abs(image.url.split(/[?#]/)[0]);
    if (!/^https?:\/\//i.test(url)) throw new PublishError(422, 'The article image URL is not publicly usable. Check the app and storage URL.', '', 'config');
    return { ...image, url };
  });
  const opts = { videos, sources, bodyImages };
  const slug = slugify(a.seo?.slug || e.kw || e.title) || slugify(e.title) || e.id;
  const imgUrl = await heroImage(b, e, a);
  const html = await applyOutbound(b.id, refreshUrl || e.url || null, blocksToHtml(a.body || [], opts));
  return {
    entryId: e.id, title: e.title, slug, html, markdown: blocksToMarkdown(a.body || [], opts), blocks: a.body || [], bodyImages, meta: a.seo?.meta || '', seoTitle: a.seo?.title?.trim() || e.title, keyword: e.kw, date: e.date,
    image: imgUrl ? {
      url: abs(imgUrl), alt: a.img?.alt || e.title,
      bytes: async () => {
        if (imgUrl.startsWith('/api/files/')) { const f = await readLocal(imgUrl.slice('/api/files/'.length)); if (f) return { buf: f.body, type: f.type, name: `${slug}.${f.type.split('/')[1] || 'png'}` }; }
        const r = await fetch(abs(imgUrl)); if (!r.ok) throw new PublishError(r.status, 'image fetch failed');
        const type = r.headers.get('content-type') || 'image/png';
        return { buf: Buffer.from(await r.arrayBuffer()), type, name: `${slug}.${type.split('/')[1] || 'png'}` };
      },
    } : null,
    canonical: refreshUrl, mode: e.mode, refreshUrl,
    sources: sources.map(s => ({ title: s.title, url: s.url })), videos, author: p.business?.name || b.domain,
  };
}

/** Resolve the connection for an entry: its destination, else the default (02-system §12). */
export async function connectionFor(b: BizRow, dest: string | null): Promise<ConnRow | null> {
  const rows = await db.select().from(schema.connections).where(eq(schema.connections.businessId, b.id)).orderBy(schema.connections.createdAt);
  if (!rows.length) return null;
  const bl = blogOf(b, rows.map(connPublic));
  return rows.find(r => r.id === dest) || rows.find(r => r.id === bl.defaultId) || rows[0];
}

export type PublishOutcome = { status: 'published'; url: string } | { status: 'failed'; error: ArticlePublishError } | { status: 'skipped'; reason: string } | { status: 'retry' };

/**
 * Publish one entry. Throws only for a transient failure that should be retried (the job queue backs off);
 * the final failure is recorded on the entry as `failed` + publishError.
 */
export async function publishEntry(entryId: string, o: { attempt: number; maxAttempts: number; manual?: boolean }): Promise<PublishOutcome> {
  const row = (await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, entryId)).limit(1))[0];
  if (!row) return { status: 'skipped', reason: 'missing' };
  if (row.status !== 'scheduled' && row.status !== 'publishing') return { status: 'skipped', reason: 'status ' + row.status };
  const b = await getBiz(row.businessId);
  const programAllowed = async () => !!o.manual || !row.autopilotActivationId || (await canRun(b.id, row.autopilotActivationId) && !(await getBiz(b.id)).blog?.paused);
  if (!(await programAllowed())) return { status: 'skipped', reason: 'autopilot_off' };
  if ((b.blog || {}).paused && !o.manual && row.status === 'scheduled') return { status: 'skipped', reason: 'paused' };
  // Read the publish snapshot under the same lock that admits generation, saving and approval.
  const admitted = await db.transaction(async tx => {
    const current = await lockArticle(tx, b.id, entryId);
    if (!['scheduled', 'publishing'].includes(current.status)) return null;
    await assertNoArticleWork(tx, b.id, entryId);
    const art = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, b.id))).limit(1))[0]?.data as Article | undefined;
    await tx.update(schema.calendarEntries).set({ status: 'publishing', publishError: null }).where(eq(schema.calendarEntries.id, entryId));
    return { row: current, art };
  });
  if (!admitted) return { status: 'skipped', reason: 'status changed' };
  const e = entryFromRow(admitted.row);
  const conn = await connectionFor(b, e.dest);
  const setEntry = async (v: Partial<typeof schema.calendarEntries.$inferInsert>) => { await db.update(schema.calendarEntries).set(v).where(eq(schema.calendarEntries.id, entryId)); await bump(b.id); };
  const fail = async (err: PublishError, type: string | null) => {
    await reportFailure(err, { source: 'publishing', operation: 'publishing.entry', businessId: b.id, ref: entryId, provider: type || undefined, status: err.http, attempt: o.attempt, maxAttempts: o.maxAttempts, retrying: false });
    const error = { http: err.http, message: err.line, platform: type ? platLabel(type) : '', ...(err.hint ? { hint: err.hint } : {}), ...(err.source ? { source: err.source, diagnostic: err.diagnostic } : {}) };
    await setEntry({ status: 'failed', publishError: error, publishAttempts: o.attempt });
    if (conn && (err.http === 401 || err.http === 403)) await db.update(schema.connections).set({ status: 'error', lastError: err.line }).where(eq(schema.connections.id, conn.id));
    console.error(`[publish] ${entryId} failed on ${type}:`, err.message);
    return { status: 'failed' as const, error };
  };
  if (!conn) return fail(new PublishError(0, 'No blog connection', '', 'config'), null);
  const art = admitted.art;
  if (!art || !(art.body || []).length) return fail(new PublishError(0, 'The article has no draft', '', 'config'), conn.type);

  const type = conn.type as ConnType;
  const c = ctxFromRow(b, conn);
  // One absolute deadline per attempt: 270 s for the planner, the sandbox budget when that engine is selected for this business.
  if (type === 'nextjs') c.publishDeadlineAt = Date.now() + publishAttemptMs(b.id);
  const connector = connectorFor(type);
  try {
    const payload = await buildPayload(b, e, art);
    let draft: RemoteDraft | null = admitted.row.publishRemote && admitted.row.publishRemote.connId === conn.id ? admitted.row.publishRemote : null;
    const holdProgram = async () => {
      if (await programAllowed()) return false;
      await db.update(schema.calendarEntries).set({ status: 'review' }).where(and(eq(schema.calendarEntries.id, entryId), eq(schema.calendarEntries.status, 'publishing')));
      await bump(b.id); return true;
    };
    if (!draft) {
      if (await holdProgram()) return { status: 'skipped', reason: 'autopilot_off' };
      draft = { ...(await connector.createDraft(c, payload)), connId: conn.id };
      await db.update(schema.calendarEntries).set({ publishRemote: draft }).where(eq(schema.calendarEntries.id, entryId));
    }
    if (await holdProgram()) return { status: 'skipped', reason: 'autopilot_off' };
    const { url } = await connector.publish(c, payload, draft);
    await setEntry({ status: 'published', publishedUrl: url, publishError: null, publishRemote: null, publishAttempts: o.attempt });
    if (conn.status !== 'ok') await db.update(schema.connections).set({ status: 'ok', lastError: null }).where(eq(schema.connections.id, conn.id));
    trackSoon('article.published', { bid: b.id, ref: entryId, props: { url, platform: type, title: e.title, keyword: (e as any).kw, attempt: o.attempt } });
    await notify(b.id, `Published to ${b.domain}`, { tone: 'ok' });
    return { status: 'published', url };
  } catch (err: any) {
    const pe = err instanceof PublishError ? err : new PublishError(0, String(err?.message || err), '', 'network');
    if (pe.retryable && o.attempt < o.maxAttempts) {
      await db.update(schema.calendarEntries).set({ publishAttempts: o.attempt }).where(and(eq(schema.calendarEntries.id, entryId)));
      throw pe;
    }
    return fail(pe, type);
  }
}
