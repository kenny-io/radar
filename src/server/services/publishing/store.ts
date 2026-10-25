// Connection storage helpers: encrypted credentials, pending OAuth authorizations ("oauthRef"), connector contexts.
import { and, eq, gte } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { decrypt, encrypt, randomToken } from '@/server/crypto';
import type { BizRow } from '@/server/workspace';
import type { ConnType, Profile } from '@/lib/types';
import { SECRET_FIELDS } from '@/lib/constants';
import type { ConnCtx } from './types';

export type ConnRow = typeof schema.connections.$inferSelect;
const PENDING = 'blog-pending:';
const PENDING_TTL_MS = 3600e3; // maintenance prunes oauth_states after an hour

/** OAuth provider name for a connector type. */
export const oauthProviderOf = (type: string) => (type === 'nextjs' ? 'github' : type);

/** Store freshly obtained credentials (OAuth tokens, a new webhook secret) until the connection is saved. Returns the oauthRef. */
export async function savePending(bid: string, userId: string | null, type: string, creds: Record<string, any>): Promise<string> {
  const ref = 'pend_' + randomToken(18);
  await db.insert(schema.oauthStates).values({ state: ref, userId, businessId: bid, provider: PENDING + type, data: { enc: encrypt(creds) } });
  return ref;
}
export async function readPending(bid: string, ref: string | null | undefined, type: string): Promise<Record<string, any> | null> {
  if (!ref || !ref.startsWith('pend_')) return null;
  const r = (await db.select().from(schema.oauthStates).where(and(eq(schema.oauthStates.state, ref), eq(schema.oauthStates.businessId, bid), gte(schema.oauthStates.createdAt, new Date(Date.now() - PENDING_TTL_MS)))).limit(1))[0];
  if (!r || r.provider !== PENDING + type) return null;
  try { return decrypt(r.data?.enc) || null; } catch { return null; }
}
export async function deletePending(ref: string | null | undefined) { if (ref) await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, ref)); }

export async function connRow(bid: string, id: string): Promise<ConnRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db.select().from(schema.connections).where(and(eq(schema.connections.id, id), eq(schema.connections.businessId, bid))).limit(1))[0] || null;
}
export const connCreds = (r: ConnRow | null): Record<string, any> => { try { return (r && decrypt(r.credentialsEnc)) || {}; } catch { return {}; } };
export const connSecret = (r: ConnRow | null): string | null => { try { return (r && decrypt<string>(r.secretEnc)) || null; } catch { return null; } };

/** Split what the client typed into public fields and secret fields. Blank secrets mean "keep the stored one". */
export function splitFields(fields: Record<string, string>) {
  const pub: Record<string, string> = {}; const sec: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const val = String(v ?? '').trim();
    if (SECRET_FIELDS.includes(k)) { if (val) sec[k] = val; } else pub[k] = val;
  }
  return { pub, sec };
}

export function bizInfo(b: BizRow) { const p = b.profile as Profile; return { domain: b.domain, businessName: p?.business?.name || b.domain }; }

export function ctxOf(b: BizRow, x: { type: ConnType; fields: Record<string, string>; creds: Record<string, any>; target?: string | null; targetId?: string | null; secret?: string | null }): ConnCtx {
  return { type: x.type, fields: x.fields, creds: x.creds, target: x.target ?? null, targetId: x.targetId ?? null, secret: x.secret ?? null, bid: b.id, ...bizInfo(b) };
}
export function ctxFromRow(b: BizRow, r: ConnRow): ConnCtx {
  const c = ctxOf(b, { type: r.type as ConnType, fields: r.fields || {}, creds: connCreds(r), target: r.target, targetId: r.targetId, secret: connSecret(r) });
  return { ...c, saveCreds: async creds => { await db.update(schema.connections).set({ credentialsEnc: encrypt(creds) }).where(eq(schema.connections.id, r.id)); } };
}
