// Dev stubs for X and LinkedIn (RADAR_DEV_STUBS=1 only; no network). Deterministic identities, tokens and outcomes so every
// state can be exercised through the UI (architecture.md §7 "Dev stubs"). Text markers in the post decide the outcome:
//   [[radar:reject]]    the platform refuses it              → failed / rejected
//   [[radar:ratelimit]] 429                                  → retried with backoff, then failed / rate_limit
//   [[radar:down]]      unavailable before anything was sent → retried (transient), then failed / unavailable
//   [[radar:timeout]]   unknown outcome at the create stage  → X reads back and finds nothing; LinkedIn can't → failed / unknown
//   [[radar:lost]]      published, but the response was lost → X reads it back → posted; LinkedIn → failed / unknown
//   [[radar:quota]]     X credits depleted / usage cap (402) → failed / quota, never retried
import { slugify } from '@/lib/format';
import { normForMatch } from '@/lib/socialPublish';
import type { SocialChannel, SocialPage } from '@/lib/types';
import { type Adapter, type Identity, type Tokens, SendError, TokenError } from './api';

const H = 3600e3, D = 24 * H;
interface StubPost { id: string; text: string; at: number }
const g = globalThis as unknown as { __radarSocialStub?: { seq: number; posts: Map<string, StubPost[]>; creates: number } };
/** Posts the stub "published", per remote account (read back by verify). In-memory: a restarted process forgets them. */
export const stubState = (g.__radarSocialStub ??= { seq: 0, posts: new Map(), creates: 0 });
const next = () => `${Date.now()}${String(++stubState.seq % 1000).padStart(3, '0')}`;

/** Fresh stub tokens shaped like the real app's: X 2 h + rotating refresh; profile 60 days, no refresh; page 60 days + 365-day refresh. */
export function stubTokens(ch: SocialChannel, now = Date.now()): Tokens {
  const n = next();
  if (ch === 'x') return { stub: true, access_token: `stub-x-at-${n}`, refresh_token: `stub-x-rt-${n}`, expires_at: now + 2 * H, scope: 'tweet.read tweet.write users.read media.write offline.access' };
  if (ch === 'li_profile') return { stub: true, access_token: `stub-li-at-${n}`, refresh_token: null, expires_at: now + 60 * D, scope: 'openid profile w_member_social' };
  return { stub: true, access_token: `stub-lp-at-${n}`, refresh_token: `stub-lp-rt-${n}`, expires_at: now + 60 * D, refresh_expires_at: now + 365 * D, scope: 'w_organization_social rw_organization_admin r_basicprofile' };
}
/** Who the stub signs in as. `as: 'other'` (start param `stub_as=other`) signs in as a different remote account. */
export function stubIdentity(ch: SocialChannel, o: { businessName: string; userName: string; userId: string; as?: string | null }): Identity {
  const other = o.as === 'other';
  if (ch === 'x') {
    const s = other ? 'other' : slugify(o.businessName || 'radar').replace(/-/g, '').slice(0, 11) || 'radar';
    return { remoteId: `stub-x-${s}`, name: other ? 'Other Account' : o.businessName || 'Radar', handle: `@${s}app` };
  }
  if (ch === 'li_profile') return { remoteId: other ? 'stub-li-other' : `stub-li-${o.userId.slice(0, 8)}`, name: other ? 'Alex Other' : o.userName };
  return { remoteId: other ? 'stub-lm-other' : `stub-lm-${o.userId.slice(0, 8)}`, name: other ? 'Alex Other' : o.userName };
}
export const stubPages = (businessName: string, userName: string): SocialPage[] =>
  [{ id: 'stub-pg1', name: businessName || 'Your business', followers: 1204 }, { id: 'stub-pg2', name: `${userName} Studio`, followers: 312 }];

const urlFor = (ch: SocialChannel, handle: string | null, id: string) =>
  ch === 'x' ? `https://x.com/${(handle || '@radar').replace(/^@/, '')}/status/${id}` : `https://www.linkedin.com/feed/update/urn:li:share:${id}/`;

export function stubAdapter(ch: SocialChannel): Adapter {
  const a: Adapter = {
    async refresh(t) {
      if (t.refreshFails) throw new TokenError(true, 'stub refresh 400 invalid_grant');
      if (!t.refresh_token || (t.refresh_expires_at && t.refresh_expires_at <= Date.now())) throw new TokenError(true, 'stub: no usable refresh token');
      const fresh = stubTokens(ch);
      return { ...fresh, refresh_expires_at: t.refresh_expires_at ?? fresh.refresh_expires_at, refresh_token: fresh.refresh_token };
    },
    async revoke() { /* nothing to revoke */ },
    async upload() { return `stub-media-${next()}`; },
    async create(acct, p) {
      const m = /\[\[radar:(\w+)\]\]/.exec(p.text)?.[1];
      if (m === 'reject') throw new SendError('definitive', 'rejected', 'stub 400 rejected');
      if (m === 'ratelimit') throw new SendError('transient', 'rate_limit', 'stub 429');
      if (m === 'down') throw new SendError('transient', 'unavailable', 'stub network ECONNREFUSED');
      if (m === 'quota') throw new SendError('definitive', 'quota', 'stub 402 usage-capped');
      if (m === 'timeout') throw new SendError('unknown', 'unknown', 'stub network timeout');
      stubState.creates++;
      const id = next();
      const list = stubState.posts.get(acct.remoteId) || []; list.unshift({ id, text: p.text, at: Date.now() }); stubState.posts.set(acct.remoteId, list.slice(0, 50));
      if (m === 'lost') throw new SendError('unknown', 'unknown', 'stub network reset after send');
      return { remoteId: id, url: urlFor(ch, acct.handle, id) };
    },
  };
  if (ch === 'x') {
    a.verify = async (acct, p) => {
      const hit = (stubState.posts.get(acct.remoteId) || []).find((x: StubPost) => x.at >= p.sinceMs && normForMatch(x.text) === normForMatch(p.text));
      return hit ? { remoteId: hit.id, url: urlFor(ch, acct.handle, hit.id) } : null;
    };
    a.verifyDelayMs = 0;
  }
  return a;
}
