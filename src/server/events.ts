// Impact tracking: an append-only log of everything Radar does for a founder, for reporting ("briefs posted, articles
// published, mentions found…"). Writing an event never throws and never blocks the user's request on failure.
//
// Two layers:
//  - Automatic: every successful write action (`action.<name>`) and every finished background job (`job.<kind>`), with a
//    scalar-only summary of its input/result. Nothing is missed when features are added.
//  - Outcomes: named events for the moments that matter in a report (IMPACT below), with clean props.
import { db, schema } from '@/server/db';

/** Outcome events used in reports. Add new ones here so the metrics endpoint picks them up. */
export const IMPACT = {
  'user.signed_up': 'Founders signed up',
  'business.onboarded': 'Businesses onboarded',
  'gsc.connected': 'Search Console connected',
  'brief.scanned': 'Daily Brief scans',
  'brief.reply_copied': 'Brief replies copied',
  'brief.reply_posted': 'Brief replies posted',
  'brief.post_posted': 'Brief feed posts posted',
  'brief.skipped': 'Brief items skipped',
  'calendar.generated': 'Content calendars generated',
  'calendar.approved': 'Topics approved',
  'article.drafted': 'Articles drafted',
  'article.approved': 'Articles approved',
  'article.published': 'Articles published',
  'social.pack_generated': 'Social packs generated',
  'social.copied': 'Social posts copied',
  'visibility.checked': 'AI answers checked',
  'visibility.mentioned': 'AI answers mentioning the business',
  'backlinks.joined': 'Joined the link network',
  'backlinks.link_live': 'Backlinks gone live',
  'suggestions.accepted': 'Search Console suggestions accepted',
  'team.invited': 'Teammates invited',
} as const;
export type ImpactKind = keyof typeof IMPACT;

/** Write actions whose success is itself an outcome. */
export const ACTION_OUTCOME: Record<string, ImpactKind> = {
  'onboarding.finish': 'business.onboarded',
  'gsc.connect': 'gsc.connected',
  'calendar.approve': 'calendar.approved',
  'calendar.approveAll': 'calendar.approved',
  'article.approve': 'article.approved',
  'social.copied': 'social.copied',
  'backlinks.join': 'backlinks.joined',
  'suggestions.accept': 'suggestions.accepted',
  'team.invite': 'team.invited',
};
/** Background jobs whose successful completion is an outcome (skipped/empty results excluded). */
export const JOB_OUTCOME: Record<string, ImpactKind> = {
  'brief.scan': 'brief.scanned',
  'calendar.generate': 'calendar.generated',
  'article.draft': 'article.drafted',
  'social.generate': 'social.pack_generated',
  'social.autoRun': 'social.pack_generated',
};
/** A finished job's result that represents real work (not a skip, a no-op or a handled failure). */
export const jobProducedOutcome = (kind: string, result: any) =>
  !!JOB_OUTCOME[kind] && !(result && (result.skipped || result.failed || (('packId' in result) && !result.packId)));

export interface TrackOpts { bid?: string | null; uid?: string | null; ref?: string | null; props?: Record<string, unknown>; /** Backfill only */ at?: Date }

export async function track(kind: ImpactKind | `action.${string}` | `job.${string}` | `system.${string}`, o: TrackOpts = {}): Promise<void> {
  try {
    await db.insert(schema.events).values({ kind, businessId: o.bid || null, userId: o.uid || null, ref: o.ref ? String(o.ref).slice(0, 200) : null, props: summarize(o.props || {}) as Record<string, any>, ...(o.at ? { createdAt: o.at } : {}) });
  } catch (e: any) {
    console.warn('[events] track failed', kind, e?.message || e);
  }
}

/** Fire-and-forget variant for hot paths. */
export const trackSoon = (kind: Parameters<typeof track>[0], o: TrackOpts = {}) => { void track(kind, o); };

const SECRET = /pass(word)?|secret|token|key|auth|cookie|credential/i;
const TEXT = /^(text|body|html|content|markdown|draft|drafts|edits?|prompt|instruction|resp|response|blocks|description|bio|notes?)$/i;

/** Keep only small, non-sensitive scalars: numbers, booleans, short strings (ids, enums, platforms, URLs), and
 *  shallow arrays/objects of them. Drafted text, credentials and long strings are dropped; arrays become counts. */
export function summarize(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length <= 200 ? v : undefined;
  if (Array.isArray(v)) {
    if (depth >= 2 || !v.every(x => x == null || ['string', 'number', 'boolean'].includes(typeof x))) return { count: v.length };
    const out = v.map(x => summarize(x, depth + 1)).filter(x => x !== undefined).slice(0, 20);
    return out;
  }
  if (typeof v === 'object') {
    if (depth >= 2) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET.test(k) || TEXT.test(k)) continue;
      const s = summarize(x, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined;
}
