import { and, eq, sql } from 'drizzle-orm';
import { schema as S } from '../../../db';
import type { RetentionTx } from './youtubeRetention';
import { youtubeProfileStale } from '@/lib/youtubeLifecycle';
import { decrypt } from '../../../crypto';
import type { Tokens } from './api';
const P = S.socialPubs;
/** Every claim, scheduled upsert, recovery and attempt write uses these database predicates. */
export const youtubeMayResend = sql`(${P.ch} <> 'youtube' OR coalesce(${P.payload}#>>'{youtubeRetention,noResend}', 'false') = 'false')`;
export const youtubeMayInitialize = sql`(${P.ch} <> 'youtube' OR (coalesce(${P.payload}#>>'{youtubeRetention,noResend}', 'false') = 'false' AND ${P.remoteId} IS NULL AND NOT coalesce(${P.payload} ? 'providerRef', false) AND coalesce(${P.errCode}, '') <> 'unknown'))`;
export const youtubeApproved = sql`(${P.ch} <> 'youtube' OR coalesce(${P.payload}#>>'{youtubeRetention,needsApproval}', 'false') = 'false')`;
export const clearYouTubeApproval = sql`CASE WHEN ${P.ch} = 'youtube' AND ${P.payload} ? 'youtubeRetention' THEN jsonb_set(${P.payload}, '{youtubeRetention,needsApproval}', 'false'::jsonb) ELSE ${P.payload} END`;
/** Serialize fresh claims against disconnect/delete/hold, including new inserts with no prior pub row. */
export async function lockYouTubeAccount(q: RetentionTx, bid: string, acctId: string): Promise<boolean> {
  const [biz] = await q.select({ status: S.businesses.status }).from(S.businesses).where(eq(S.businesses.id, bid)).for('update');
  if (biz?.status !== 'active') return false;
  const [account] = await q.select().from(S.socialAccounts).where(and(eq(S.socialAccounts.id, acctId), eq(S.socialAccounts.businessId, bid), eq(S.socialAccounts.ch, 'youtube'))).for('update');
  let t: Tokens | null = null; try { t = decrypt(account?.tokensEnc); } catch {}
  return !!account && !account.expired && !!t && !t.youtube?.verificationHold && !youtubeProfileStale(account, t.youtube);
}
