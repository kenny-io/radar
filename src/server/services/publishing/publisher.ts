// The publisher: scheduled entry → payload → draft on the platform → publish (02-system.md §7, §12).
import { trackSoon } from '@/server/events';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { notify } from '@/server/notify';
import { bump, blogOf, connPublic, entryFromRow, getBiz, type BizRow } from '@/server/workspace';
import { renderImage } from '@/server/services/images';
import { readLocal } from '@/server/services/storage';
import { platLabel } from '@/lib/constants';
import { slugify } from '@/lib/format';
import type { Article, CalendarEntry, ConnType, Profile } from '@/lib/types';
import { blocksToHtml, blocksToMarkdown, sourcesList } from './render';
import { connectorFor } from './connectors';
import { PublishError } from './http';
import { ctxFromRow, type ConnRow } from './store';
import type { PublishPayload, RemoteDraft } from './types';

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
    console.error('[publish] outbound links skipped:', e?.message || e);
    return html;
  }
}

async function heroImage(b: BizRow, e: CalendarEntry, a: Article): Promise<string | null> {
  if (a.img?.url) return a.img.url;
  const p = b.profile as Profile;
  try {
    const url = await renderImage({ bid: b.id, style: a.img?.style || 'branded', brand: { primary: p.brand.primary, secondary: p.brand.secondary }, headline: e.title, name: p.business.name || b.domain, seed: a.img?.seed ?? 1, prompt: a.img?.prompt, w: 1200, h: 628, kind: 'hero' });
    // Keep it on the article so the editor shows the same image that went live.
    await db.update(schema.articles).set({ data: sql`jsonb_set(${schema.articles.data}, '{img,url}', ${JSON.stringify(url)}::jsonb, true)`, updatedAt: new Date() }).where(eq(schema.articles.entryId, e.id));
    return url;
  } catch (err: any) { console.error('[publish] hero image failed:', err?.message || err); return null; }
}

export async function buildPayload(b: BizRow, e: CalendarEntry, a: Article): Promise<PublishPayload> {
  const p = b.profile as Profile;
  const meta = new Map((a.videoMeta || []).map(v => [v.id, v]));
  const videos = (a.videos || []).map(id => { const m = meta.get(id); return { id, title: m?.title || '', channel: m?.channel || '', url: `https://www.youtube.com/watch?v=${id}` }; });
  const sources = sourcesList(a.sources);
  const opts = { videos, sources };
  const slug = slugify(a.seo?.slug || e.kw || e.title) || slugify(e.title) || e.id;
  const imgUrl = await heroImage(b, e, a);
  const canonical = e.mode === 'refresh' && e.url ? e.url : null;
  const html = await applyOutbound(b.id, e.url || null, blocksToHtml(a.body || [], opts));
  return {
    entryId: e.id, title: e.title, slug, html, markdown: blocksToMarkdown(a.body || [], opts), blocks: a.body || [], meta: a.seo?.meta || '', keyword: e.kw, date: e.date,
    image: imgUrl ? {
      url: abs(imgUrl), alt: a.img?.alt || e.title,
      bytes: async () => {
        if (imgUrl.startsWith('/api/files/')) { const f = await readLocal(imgUrl.slice('/api/files/'.length)); if (f) return { buf: f.body, type: f.type, name: `${slug}.${f.type.split('/')[1] || 'png'}` }; }
        const r = await fetch(abs(imgUrl)); if (!r.ok) throw new PublishError(r.status, 'image fetch failed');
        const type = r.headers.get('content-type') || 'image/png';
        return { buf: Buffer.from(await r.arrayBuffer()), type, name: `${slug}.${type.split('/')[1] || 'png'}` };
      },
    } : null,
    canonical, mode: e.mode, refreshUrl: e.mode === 'refresh' ? e.url : null,
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

export type PublishOutcome = { status: 'published'; url: string } | { status: 'failed'; error: { http: number; message: string; platform: string } } | { status: 'skipped'; reason: string } | { status: 'retry' };

/**
 * Publish one entry. Throws only for a transient failure that should be retried (the job queue backs off);
 * the final failure is recorded on the entry as `failed` + publishError.
 */
export async function publishEntry(entryId: string, o: { attempt: number; maxAttempts: number; manual?: boolean }): Promise<PublishOutcome> {
  const row = (await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, entryId)).limit(1))[0];
  if (!row) return { status: 'skipped', reason: 'missing' };
  if (row.status !== 'scheduled' && row.status !== 'publishing') return { status: 'skipped', reason: 'status ' + row.status };
  const b = await getBiz(row.businessId);
  if ((b.blog || {}).paused && !o.manual && row.status === 'scheduled') return { status: 'skipped', reason: 'paused' };
  const e = entryFromRow(row);
  const conn = await connectionFor(b, e.dest);
  const setEntry = async (v: Partial<typeof schema.calendarEntries.$inferInsert>) => { await db.update(schema.calendarEntries).set(v).where(eq(schema.calendarEntries.id, entryId)); await bump(b.id); };
  const fail = async (err: PublishError, type: string | null) => {
    const error = { http: err.http, message: err.line, platform: type ? platLabel(type) : '' };
    await setEntry({ status: 'failed', publishError: error, publishAttempts: o.attempt });
    if (conn && (err.http === 401 || err.http === 403)) await db.update(schema.connections).set({ status: 'error', lastError: err.line }).where(eq(schema.connections.id, conn.id));
    console.error(`[publish] ${entryId} failed on ${type}:`, err.message);
    return { status: 'failed' as const, error };
  };
  if (!conn) return fail(new PublishError(0, 'No blog connection', '', 'config'), null);
  const art = (await db.select().from(schema.articles).where(eq(schema.articles.entryId, entryId)).limit(1))[0]?.data as Article | undefined;
  if (!art || !(art.body || []).length) return fail(new PublishError(0, 'The article has no draft', '', 'config'), conn.type);

  if (row.status !== 'publishing') await setEntry({ status: 'publishing', publishError: null });
  const type = conn.type as ConnType;
  const c = ctxFromRow(b, conn);
  const connector = connectorFor(type);
  try {
    const payload = await buildPayload(b, e, art);
    let draft: RemoteDraft | null = row.publishRemote && row.publishRemote.connId === conn.id ? row.publishRemote : null;
    if (!draft) {
      draft = { ...(await connector.createDraft(c, payload)), connId: conn.id };
      await db.update(schema.calendarEntries).set({ publishRemote: draft }).where(eq(schema.calendarEntries.id, entryId));
    }
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
