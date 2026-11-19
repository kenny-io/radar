/** Trusted operator contact-deletion path. Default dry run; never prints provider identities, tokens or source content. */
import { pathToFileURL } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool, schema as S } from '../../src/server/db';
import { cleanupYouTube, youtubeRetentionReport } from '../../src/server/services/social/publish/youtubeRetention';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseYouTubeDeletionArgs(args: string[]) {
  const allowed = new Set(['--business', '--account', '--confirm', '--apply']); const values: Record<string, string> = {}; let apply = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (!allowed.has(key) || key in values || key === '--apply' && apply) throw new Error('Invalid or duplicate argument');
    if (key === '--apply') { apply = true; continue; }
    const value = args[++i]; if (!value || !uuid.test(value)) throw new Error('Expected a local UUID'); values[key] = value;
  }
  const bid = values['--business']; if (!bid) throw new Error('--business is required');
  if (apply && values['--confirm'] !== bid) throw new Error('--apply requires --confirm with the same business UUID');
  return { bid, acctId: values['--account'], apply };
}
export async function runYouTubeDeletion(args: string[], now = new Date()) {
  if (args.length === 1 && args[0] === '--report') return youtubeRetentionReport(now);
  const o = parseYouTubeDeletionArgs(args);
  const [business] = await db.select({ id: S.businesses.id }).from(S.businesses).where(eq(S.businesses.id, o.bid));
  if (!business) throw new Error('Local business does not exist');
  if (o.acctId) {
    const [account] = await db.select({ id: S.socialAccounts.id }).from(S.socialAccounts).where(and(eq(S.socialAccounts.id, o.acctId), eq(S.socialAccounts.businessId, o.bid), eq(S.socialAccounts.ch, 'youtube')));
    if (!account) throw new Error('Local YouTube account does not belong to this business');
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(S.socialPubs).where(and(eq(S.socialPubs.businessId, o.bid), eq(S.socialPubs.ch, 'youtube')));
  if (!o.apply) return { dryRun: true, localPublicationRows: count };
  const result = await cleanupYouTube({ bid: o.bid, acctId: o.acctId, reason: 'delete', now });
  const [{ remaining }] = await db.select({ remaining: sql<number>`count(*)::int` }).from(S.socialPubs).where(and(eq(S.socialPubs.businessId, o.bid), eq(S.socialPubs.ch, 'youtube'), sql`(remote_id IS NOT NULL OR remote_url IS NOT NULL OR payload ? 'providerRef' OR acct_label <> 'YouTube channel')`));
  const [{ accounts }] = await db.select({ accounts: sql<number>`count(*)::int` }).from(S.socialAccounts).where(and(eq(S.socialAccounts.businessId, o.bid), eq(S.socialAccounts.ch, 'youtube')));
  const [{ pending }] = await db.select({ pending: sql<number>`count(*)::int` }).from(S.oauthStates).where(and(eq(S.oauthStates.businessId, o.bid), eq(S.oauthStates.provider, 'social-pending:youtube')));
  const [{ events }] = await db.select({ events: sql<number>`count(*)::int` }).from(S.events).where(and(eq(S.events.businessId, o.bid), eq(S.events.kind, 'social.posted'), sql`(props->>'ch' = 'youtube' OR props->>'platform' = 'youtube')`));
  if (remaining || accounts || pending || events) throw new Error('YouTube cleanup verification failed');
  return { dryRun: false, ...result, remainingApiPublicationCopies: remaining };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runYouTubeDeletion(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => { console.error('YouTube data operation failed. Check local UUID scope, confirmation and operator access; no provider data was printed.'); process.exitCode = 1; }).finally(() => pool.end());
}
