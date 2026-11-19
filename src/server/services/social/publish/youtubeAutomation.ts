import { todayIn } from '@/lib/format';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { RadarError } from '@/server/errors';
import { socialOn } from '@/server/flags';
import { bizAccess } from '@/server/billing/access';
import { eligibleYouTubeDefaults, automaticYouTubePostEligible, youtubeDefaultsState } from '@/lib/youtubeAutomation';
import { acctPublic } from './accounts';
import { authorized } from '../../autopilot/policy';
import type { RetentionTx } from './youtubeRetention';
import type { SocialPost, YouTubeAutoDefaults } from '@/lib/types';
export const YOUTUBE_AUTO_SETUP = 'YouTube will remain a draft until the owner chooses visibility and audience.';
export const clearedYouTubeDefaults = (auto: unknown) => ({ ...(auto && typeof auto === 'object' ? auto : {}), youtubeDefaults: null, youtubeDefaultsVersion: randomUUID() });
/** Lock business before account: identical saves preserve authorization; stale modal saves cannot undo reconnect/clear. */
export async function saveYouTubeDefaults(bid: string, expectedVersion: string | null, defaults: Omit<YouTubeAutoDefaults, 'version'> | null) {
  return db.transaction(async q => {
    const [b] = await q.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).for('update');
    if (!b || b.status !== 'active') throw new RadarError('This workspace is not active.', 403, 'forbidden');
    const state = youtubeDefaultsState(b.socialAuto);
    if ((state.youtubeDefaultsVersion || null) !== expectedVersion) throw new RadarError('YouTube settings changed. Reload settings and try again.', 409, 'settings_changed');
    if (defaults) {
      const [a] = await q.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.id, defaults.acctId), eq(schema.socialAccounts.businessId, bid), eq(schema.socialAccounts.ch, 'youtube'))).for('update');
      const account = a ? acctPublic(a) : null;
      if (!account || account.expired || account.verificationHold) throw new RadarError('Connect or reconnect your YouTube channel first.', 400, 'not_connected');
    }
    const previous = state.youtubeDefaults;
    const same = !!defaults && previous && previous.acctId === defaults.acctId && previous.privacy === defaults.privacy && previous.madeForKids === defaults.madeForKids;
    const version = same && state.youtubeDefaultsVersion ? state.youtubeDefaultsVersion : randomUUID();
    const next = { youtubeDefaultsVersion: version, youtubeDefaults: defaults ? { ...defaults, version } : null };
    await q.update(schema.businesses).set({ socialAuto: { ...(b.socialAuto || {}), ...next } }).where(eq(schema.businesses.id, bid));
    return next;
  });
}
export type YouTubeAuthorization = { defaultsVersion: string; acctId: string; mode: 'master' | 'standalone' };
/** Caller holds the business lock through queue write; source choices/provenance are reread under the pack lock. */
export async function youtubeAutomaticAuthorization(q: RetentionTx, bid: string, acctId: string, packId: string, activationId?: string | null, atQueue = false, expectedSettings?: { time?: string; timezone: string }): Promise<YouTubeAuthorization | null> {
  const [b] = await q.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).for('update');
  if (!b || b.status !== 'active' || !await socialOn(b) || !await bizAccess(b)) return null;
  const a = b.socialAuto || {};
  if (!a.platforms?.includes('youtube')) return null;
  if (activationId ? !authorized(b, activationId) : b.autopilot?.enabled || !a.on || a.post !== 'schedule') return null;
  const [account] = await q.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.id, acctId), eq(schema.socialAccounts.businessId, bid), eq(schema.socialAccounts.ch, 'youtube'))).for('update');
  const defaults = eligibleYouTubeDefaults(a, account ? acctPublic(account) : null);
  const [pack] = await q.select().from(schema.socialPacks).where(and(eq(schema.socialPacks.businessId, bid), eq(schema.socialPacks.id, packId))).for('update');
  const p = pack?.data as { auto?: boolean; posts?: { youtube?: SocialPost } } | undefined;
  if (atQueue) {
    if (expectedSettings && ((a.time || '08:00') !== (expectedSettings.time || '08:00') || b.timezone !== expectedSettings.timezone)) return null;
    const today = todayIn(b.timezone);
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: b.timezone }).format(new Date());
    if (packId !== `auto-${bid}-${today}` || (a.freq === 'custom' && !a.days?.includes(day))) return null;
  }
  if (!p?.auto || !p.posts?.youtube?.video || !automaticYouTubePostEligible(p.posts?.youtube, defaults)) return null;
  return { defaultsVersion: defaults!.version, acctId, mode: activationId ? 'master' : 'standalone' };
}
