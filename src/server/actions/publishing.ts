// Actions for the "publishing" area (CONTRACTS.md): blog connections, mode, schedule, publish now / retry.
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { action, type ActionMap, type ActCtx } from './define';
import { db, schema } from '../db';
import { RadarError, notFound } from '../errors';
import { encrypt } from '../crypto';
import { blogOf, connPublic, entryFromRow } from '../workspace';
import { platOf, platLabel } from '@/lib/constants';
import type { ConnType } from '@/lib/types';
import { connectorFor } from '../services/publishing/connectors';
import { PublishError, statusLine } from '../services/publishing/http';
import { newWebhookSecret, maskSecret } from '../services/publishing/connectors/webhook';
import { normFolder, parseRepo, unsafeFolder } from '../services/publishing/connectors/nextjs';
import { shopDomain } from '../services/publishing/connectors/shopify';
import { retimePubs } from '../services/social/publish/pubs';
import { assertNoArticleWork, lockArticle } from '../services/drafting/guard';
import { bizInfo, connCreds, connRow, connSecret, ctxOf, deletePending, readPending, savePending, splitFields } from '../services/publishing/store';

const TYPES = ['wordpress', 'ghost', 'webflow', 'notion', 'wix', 'shopify', 'wpcom', 'webhook', 'framer', 'nextjs'] as const;
const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const TZ = z.string().min(1).max(64).refine(validTz, 'Unknown timezone');
const EXPIRED = 'The authorization expired. Reconnect and try again.';

const connInput = z.object({
  type: z.enum(TYPES),
  id: z.string().uuid().nullish(),
  fields: z.record(z.string(), z.string().max(2000)).default({}),
  target: z.string().max(300).nullish(),
  targetId: z.string().max(300).nullish(),
  oauthRef: z.string().max(100).nullish(),
});
type ConnInput = z.infer<typeof connInput>;

/** User-facing copy for a failed test (01-screens §12). */
export function failCopy(type: string, e: PublishError): string {
  const P = platOf(type);
  if (e.hint) return e.hint;
  if (e.kind === 'auth-expired' || (P.oauth && !P.fields && (e.http === 401 || e.http === 403))) return EXPIRED;
  if (!e.http) return `Couldn’t reach ${e.host || 'the site'} — check the URL`;
  // An OAuth platform's 404 means the site/database was unshared or deleted, not a bad credential.
  if (P.oauth && e.http === 404) return `Radar can’t see that ${P.pick?.toLowerCase() || (type === 'nextjs' ? 'repository' : 'site')} anymore. Reconnect and share it again.`;
  if (e.http >= 300 && e.http < 400) return `${statusLine(e.http)} — check the URL`;
  // A credential platform's 404 means the URL isn't the blog's API (wrong address, or the REST API is off), not a bad password.
  if (!P.oauth && e.http === 404) return `${statusLine(e.http)} — check the URL`;
  return `${statusLine(e.http)} — check the credentials`;
}

/** Validate the platform's fields and collect public fields, secrets and OAuth tokens (stored ones are kept when left blank). */
async function resolveConn(ctx: ActCtx, input: ConnInput) {
  const existing = input.id ? await connRow(ctx.bid, input.id) : null;
  if (input.id && !existing) throw notFound('Connection');
  if (existing && existing.type !== input.type) throw new RadarError('Some fields aren’t valid.', 400, 'invalid');
  const type = input.type as ConnType; const P = platOf(type);
  const { pub, sec } = splitFields(input.fields);
  const fields: Record<string, string> = {};
  for (const [k, , , ty] of P.fields || []) {
    if (ty === 'password') continue;
    const v = (pub[k] ?? '').trim();
    if (v.length < 3) throw new RadarError('Some fields aren’t valid.', 400, 'invalid');
    fields[k] = v;
  }
  if (type === 'webhook' && !fields.hook.startsWith('https://')) throw new RadarError('Some fields aren’t valid.', 400, 'invalid');
  let target = input.target || null; let targetId = input.targetId || null;
  // Next.js: the picked repository (owner/repo) is stored as fields.repo, which publishing reads. A connection saved
  // before the picker has no targetId and keeps its fields.repo.
  if (type === 'nextjs') {
    const r = parseRepo(input.targetId || existing?.fields?.repo || '');
    if (!r) throw new RadarError('Some fields aren’t valid.', 400, 'invalid');
    fields.repo = target = targetId = `${r.owner}/${r.repo}`;
    fields.path = normFolder(fields.path);
    if (unsafeFolder(fields.path)) throw new RadarError('Some fields aren’t valid.', 400, 'invalid');
  }
  if (type === 'shopify') fields.store = shopDomain(fields.store);
  let creds: Record<string, any> = { ...connCreds(existing) };
  for (const [k, , , ty] of P.fields || []) if (ty === 'password') { if (sec[k]) creds[k] = sec[k]; if (!creds[k]) throw new RadarError('Some fields aren’t valid.', 400, 'invalid'); }
  let secret = connSecret(existing);
  if (input.oauthRef) {
    const pend = await readPending(ctx.bid, input.oauthRef, type);
    if (!pend) throw new PublishError(401, 'pending authorization missing', '', 'auth-expired');
    if (type === 'webhook') secret = pend.secret;
    else creds = { ...Object.fromEntries(Object.entries(creds).filter(([k]) => (P.fields || []).some(f => f[0] === k))), ...pend };
  }
  if (P.oauth && !creds.access_token && !creds.instanceId) throw new PublishError(401, 'not authorized', '', 'auth-expired');
  if (type === 'webhook' && !secret) throw new PublishError(401, 'no signing secret', '', 'auth-expired');
  if (P.pick && !targetId) throw new RadarError('Some fields aren’t valid.', 400, 'invalid');
  return { type, P, fields, creds, secret, existing, target, targetId };
}

async function setBlog(bid: string, patch: Record<string, any>) {
  await db.update(schema.businesses).set({ blog: sql`coalesce(${schema.businesses.blog}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` }).where(eq(schema.businesses.id, bid));
}
/** Mode change (README principle #2: autopilot needs an explicit choice + the acknowledgment). */
async function applyMode(ctx: ActCtx, m: { mode: 'review' | 'autopilot'; ack?: boolean | null; time?: string | null; tz?: string | null }) {
  if (m.mode === 'autopilot' && m.ack !== true) throw new RadarError('Tick the acknowledgment to turn on autopilot.', 400, 'ack_required');
  const cur = ctx.biz.blog || {};
  await setBlog(ctx.bid, {
    mode: m.mode,
    autopilotAckAt: m.mode === 'autopilot' ? (cur.mode === 'autopilot' && cur.autopilotAckAt ? cur.autopilotAckAt : new Date().toISOString()) : null,
    ...(m.time ? { time: m.time } : {}),
  });
  if (m.tz) await setTz(ctx, m.tz);
}
/** Business time zone. Scheduled social posts keep their wall-clock time, so their send instants move (architecture.md A14). */
async function setTz(ctx: ActCtx, tz: string) {
  await db.update(schema.businesses).set({ timezone: tz }).where(eq(schema.businesses.id, ctx.bid));
  if (tz !== ctx.biz.timezone) await retimePubs(ctx.bid, tz);
}

async function conns(bid: string) { return db.select().from(schema.connections).where(eq(schema.connections.businessId, bid)).orderBy(schema.connections.createdAt); }

export const actions: ActionMap = {
  /** Picker options for an authorization (oauthRef) or a saved connection (id); Framer lists collections from its token. */
  'blog.targets': action({ read: true, role: 'Editor', input: connInput.partial({ fields: true }).extend({ fields: z.record(z.string(), z.string()).default({}) }), run: async (ctx, input) => {
    try {
      const existing = input.id ? await connRow(ctx.bid, input.id) : null;
      const type = input.type as ConnType;
      let creds: Record<string, any> = { ...connCreds(existing) };
      const { pub, sec } = splitFields(input.fields || {});
      Object.assign(creds, sec);
      if (input.oauthRef) { const pend = await readPending(ctx.bid, input.oauthRef, type); if (!pend) throw new PublishError(401, '', '', 'auth-expired'); Object.assign(creds, pend); }
      const fields = { ...(existing?.fields || {}), ...Object.fromEntries(Object.entries(pub).filter(([, v]) => v)) };
      const conn = connectorFor(type);
      if (!conn.targets) return { targets: [] };
      const targets = await conn.targets(ctxOf(ctx.biz, { type, fields, creds }));
      return { targets };
    } catch (e: any) {
      if (e instanceof PublishError) return { targets: [], error: failCopy(input.type, e) };
      throw e;
    }
  } }),

  /** A new webhook signing secret, shown once while the connection is being created. */
  'blog.newSecret': action({ read: true, role: 'Editor', input: z.object({}).default({}), run: async ctx => {
    const secret = newWebhookSecret();
    const oauthRef = await savePending(ctx.bid, ctx.user.id, 'webhook', { secret });
    return { oauthRef, secret, masked: maskSecret(secret) };
  } }),

  /** Test connection: create a draft post on the platform, then delete it. */
  'blog.test': action({ read: true, role: 'Editor', input: connInput, run: async (ctx, input) => {
    try {
      const r = await resolveConn(ctx, input);
      await connectorFor(r.type).test(ctxOf(ctx.biz, r));
      if (r.existing && r.existing.status !== 'ok') { await db.update(schema.connections).set({ status: 'ok', lastError: null }).where(eq(schema.connections.id, r.existing.id)); }
      return { ok: true };
    } catch (e: any) {
      if (e instanceof PublishError) { console.warn('[blog.test]', input.type, e.message); return { ok: false, http: e.http, message: failCopy(input.type, e) }; }
      throw e;
    }
  } }),

  'blog.saveConnection': action({
    input: connInput.extend({ mode: z.enum(['review', 'autopilot']).nullish(), ack: z.boolean().nullish(), time: HM.nullish(), tz: TZ.nullish() }),
    run: async (ctx, input) => {
      let r;
      try { r = await resolveConn(ctx, input); }
      catch (e: any) { if (e instanceof PublishError) throw new RadarError(EXPIRED, 400, 'auth_expired'); throw e; }
      if (input.mode) await applyMode(ctx, { mode: input.mode, ack: input.ack, time: input.time, tz: input.tz });
      const f = r.fields; const { domain } = bizInfo(ctx.biz);
      const targetHost = (r.type === 'wpcom' || r.type === 'wix') && r.target ? 'https://' + r.target.replace(/ \(staging\)$/, '') : null;
      const url = f.url || f.hook || (f.store ? 'https://' + f.store : '') || (f.repo ? 'github.com/' + (parseRepo(f.repo)!.owner + '/' + parseRepo(f.repo)!.repo) : '') || targetHost || 'https://' + domain;
      const values = { type: r.type, url, target: r.target, targetId: r.targetId, fields: f, credentialsEnc: Object.keys(r.creds).length ? encrypt(r.creds) : null, secretEnc: r.secret ? encrypt(r.secret) : null, status: 'ok' as const, lastError: null };
      let row;
      if (r.existing) row = (await db.update(schema.connections).set(values).where(eq(schema.connections.id, r.existing.id)).returning())[0];
      else row = (await db.insert(schema.connections).values({ ...values, businessId: ctx.bid }).returning())[0];
      await deletePending(input.oauthRef);
      const all = await conns(ctx.bid);
      const bl = ctx.biz.blog || {};
      await setBlog(ctx.bid, { defaultId: bl.defaultId && all.some(c => c.id === bl.defaultId) ? bl.defaultId : all[0].id, paused: false });
      return { connection: connPublic(row) };
    },
  }),

  /** Remove a connection. Scheduled entries that pointed at it move to the default. */
  'blog.disconnect': action({ input: z.object({ id: z.string().uuid() }), run: async (ctx, { id }) => {
    const row = await connRow(ctx.bid, id);
    if (!row) throw notFound('Connection');
    await db.delete(schema.connections).where(eq(schema.connections.id, id));
    await db.update(schema.calendarEntries).set({ dest: null }).where(and(eq(schema.calendarEntries.businessId, ctx.bid), eq(schema.calendarEntries.dest, id)));
    const rest = await conns(ctx.bid);
    const bl = ctx.biz.blog || {};
    await setBlog(ctx.bid, { defaultId: bl.defaultId && bl.defaultId !== id && rest.some(c => c.id === bl.defaultId) ? bl.defaultId : rest[0]?.id || null });
    return { ok: true, platform: platLabel(row.type) };
  } }),

  'blog.setDefault': action({ input: z.object({ id: z.string().uuid() }), run: async (ctx, { id }) => {
    if (!(await connRow(ctx.bid, id))) throw notFound('Connection');
    await setBlog(ctx.bid, { defaultId: id });
    return { ok: true };
  } }),

  'blog.pause': action({ input: z.object({ paused: z.boolean() }), run: async (ctx, { paused }) => {
    await setBlog(ctx.bid, { paused });
    return { ok: true };
  } }),

  'blog.setMode': action({ input: z.object({ mode: z.enum(['review', 'autopilot']), ack: z.boolean().nullish(), time: HM.nullish(), tz: TZ.nullish() }), run: async (ctx, input) => {
    await applyMode(ctx, input);
    return { ok: true };
  } }),

  /** Settings → Publishing → Schedule */
  'blog.schedule': action({ input: z.object({ time: HM.nullish(), tz: TZ.nullish() }), run: async (ctx, { time, tz }) => {
    if (time) await setBlog(ctx.bid, { time });
    if (tz) await setTz(ctx, tz);
    return { ok: true };
  } }),

  /** Publish a queued entry immediately. */
  'publish.now': action({ input: z.object({ entryId: z.string().min(1).max(100) }), run: async (ctx, { entryId }) => {
    const e = await entryFor(ctx, entryId);
    if (e.status !== 'scheduled') throw new RadarError('Approve the article before publishing it.', 400, 'not_scheduled');
    return startPublish(ctx, entryId);
  } }),

  /** Retry a failed publish. */
  'publish.retry': action({ input: z.object({ entryId: z.string().min(1).max(100) }), run: async (ctx, { entryId }) => {
    const e = await entryFor(ctx, entryId);
    if (e.status !== 'failed') throw new RadarError('This article isn’t waiting for a retry.', 400, 'not_failed');
    return startPublish(ctx, entryId);
  } }),
};

async function entryFor(ctx: ActCtx, entryId: string) {
  const r = (await db.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.id, entryId), eq(schema.calendarEntries.businessId, ctx.bid))).limit(1))[0];
  if (!r) throw notFound('Article');
  return entryFromRow(r);
}
async function startPublish(ctx: ActCtx, entryId: string) {
  const all = await conns(ctx.bid);
  if (!all.length || !blogOf(ctx.biz, all.map(connPublic)).defaultId) throw new RadarError('Connect your blog first.', 400, 'no_connection');
  return db.transaction(async tx => {
    const row = await lockArticle(tx, ctx.bid, entryId);
    await assertNoArticleWork(tx, ctx.bid, entryId);
    if (!['scheduled', 'failed'].includes(row.status)) throw new RadarError('Approve the article before publishing it.', 400, 'not_scheduled');
    await tx.update(schema.calendarEntries).set({ status: 'publishing', publishError: null }).where(and(eq(schema.calendarEntries.id, entryId), eq(schema.calendarEntries.businessId, ctx.bid)));
    const [job] = await tx.insert(schema.jobs).values({ kind: 'publish.entry', payload: { entryId, manual: true }, businessId: ctx.bid, ref: entryId, singletonKey: 'publish:' + entryId, maxAttempts: 4 }).returning({ id: schema.jobs.id });
    return { jobId: job.id };
  });
}
