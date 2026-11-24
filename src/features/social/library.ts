import { PLAT, plat } from '@/lib/constants';
import { isCustomPack } from '@/lib/customPost';
import { mediaGenerationPending } from '@/lib/socialPublish';
import { isVideoStyle, legacyVideoStyle, videoStylePreset } from '@/lib/videoStyles';
import type { Platform, SocialPack, SocialPost } from '@/lib/types';

export const LIBRARY_STATUSES = ['draft', 'scheduled', 'posted', 'mixed'] as const;
export type LibraryStatus = typeof LIBRARY_STATUSES[number];
export interface LibraryQuery { q: string; status?: LibraryStatus }
/** urlToRoute encodes literal query "1" as true; do not change that global contract. */
export function libraryQuery(raw: unknown): LibraryQuery {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const q = p.q === true ? '1' : typeof p.q === 'string' ? p.q.slice(0, 120) : '';
  return { q, ...(typeof p.status === 'string' && LIBRARY_STATUSES.includes(p.status as LibraryStatus) ? { status: p.status as LibraryStatus } : {}) };
}
export function libraryParams(query: LibraryQuery): { q?: string; status?: LibraryStatus } {
  return { ...(query.q ? { q: query.q.slice(0, 120) } : {}), ...(query.status ? { status: query.status } : {}) };
}
export function packParams(id: string, query: LibraryQuery = { q: '' }, platform?: Platform) {
  return { ...libraryParams(query), pack: id, ...(platform ? { plat: platform } : {}) };
}
/** Platforms in their saved order, then known platforms omitted from the order. */
export function packKeys(pack: SocialPack): Platform[] {
  const has = PLAT.map(p => p.k).filter(key => !!pack.posts?.[key]);
  const order: unknown[] = Array.isArray((pack as SocialPack & { order?: unknown }).order) ? (pack as SocialPack & { order: unknown[] }).order : [];
  return [...new Set([...order.filter((key): key is Platform => has.includes(key as Platform)), ...has])];
}
export interface PackSummary { draft: number; scheduled: number; posted: number; failed: number; sending: number; total: number; kind: LibraryStatus }
export function packSummary(pack: SocialPack): PackSummary {
  const counts = { draft: 0, scheduled: 0, posted: 0, failed: 0, sending: 0, total: 0 };
  for (const key of packKeys(pack)) {
    const status = pack.posts[key]?.pub?.status; counts.total++;
    if (status === 'posted') counts.posted++;
    else if (status === 'scheduled' || status === 'sending') { counts.scheduled++; if (status === 'sending') counts.sending++; }
    else { counts.draft++; if (status === 'failed') counts.failed++; }
  }
  const buckets = (['draft', 'scheduled', 'posted'] as const).filter(key => counts[key]);
  return { ...counts, kind: buckets.length > 1 ? 'mixed' : buckets[0] || 'draft' };
}
export function matchesStatus(summary: PackSummary, status?: LibraryStatus) { return !status || (status === 'mixed' ? summary.kind === 'mixed' : summary[status] > 0); }
const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/** Searchable text of a custom pack: what the user wrote, at most 2,000 characters per post. Generated packs: none. */
export const CUSTOM_SEARCH_CHARS = 2000;
const customText = (pack: SocialPack) => isCustomPack(pack) ? packKeys(pack).map(key => (pack.posts[key]?.text || '').slice(0, CUSTOM_SEARCH_CHARS)) : [];
export function filterPacks(packs: SocialPack[], query: LibraryQuery, publishing = true): SocialPack[] {
  const search = normalized(query.q);
  return packs.filter(pack => (!publishing || matchesStatus(packSummary(pack), query.status)) && (!search || normalized([pack.name, pack.source?.label, (pack as SocialPack & { headline?: string }).headline, ...packKeys(pack).map(key => plat(key).l), ...customText(pack)].filter(Boolean).join(' ')).includes(search)));
}
export function statusCounts(packs: SocialPack[]) {
  const summaries = packs.map(packSummary);
  return Object.fromEntries(LIBRARY_STATUSES.map(status => [status, summaries.filter(summary => matchesStatus(summary, status)).length])) as Record<LibraryStatus, number>;
}
/** `text`: a custom pack with no media; `text` holds the start of what the user wrote (never a Radar template visual). */
export type LibraryCover = { kind: 'video' | 'carousel' | 'image' | 'placeholder' | 'text'; platform?: Platform; post?: SocialPost; url?: string; alt?: string; slides?: number; duration?: number; style?: string; text?: string; state?: 'Preparing replacement' | 'Preparing media' | 'Media needs attention' | 'Media cancelled' };
export const TEXT_COVER_CHARS = 140;
export function packCover(pack: SocialPack): LibraryCover {
  const keys = packKeys(pack);
  const key = keys.find(key => { const post = pack.posts[key]!; return !!(post.video?.url || post.slides?.[0]?.url || post.imageUrl); }) || keys[0];
  if (!key) return isCustomPack(pack) ? { kind: 'text', text: '' } : { kind: 'placeholder' };
  const post = pack.posts[key]!;
  if (isCustomPack(pack) && !(post.video?.url || post.slides?.[0]?.url || post.imageUrl)) {
    const first = keys.map(k => pack.posts[k]?.text?.trim() || '').find(Boolean) || '';
    const chars = [...first.replace(/\s+/g, ' ')];
    return { kind: 'text', text: chars.length > TEXT_COVER_CHARS ? chars.slice(0, TEXT_COVER_CHARS - 1).join('').trimEnd() + '…' : chars.join('') };
  }
  const kind = post.video?.url ? 'video' : post.slides?.[0]?.url ? 'carousel' : post.imageUrl ? 'image' : 'placeholder';
  const savedStyle = post.generatedMedia?.videoStyle;
  const style = post.generatedMedia && (savedStyle == null || isVideoStyle(savedStyle)) ? videoStylePreset(legacyVideoStyle(savedStyle)).label : undefined;
  const state = mediaGenerationPending(post) ? kind === 'placeholder' ? 'Preparing media' : 'Preparing replacement' : post.mediaGeneration && ['failed', 'needs_attention'].includes(post.mediaGeneration.status) ? 'Media needs attention' : kind === 'placeholder' && post.mediaGeneration?.status === 'cancelled' ? 'Media cancelled' : undefined;
  return { kind, platform: key, post, style, state, ...(kind === 'video' ? { url: post.video!.url, duration: post.video!.durationSec } : kind === 'carousel' ? { url: post.slides![0].url, alt: post.slides![0].alt, slides: post.slides!.length } : kind === 'image' ? { url: post.imageUrl! } : {}) };
}
