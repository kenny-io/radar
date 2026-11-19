import { automaticMediaReady } from './socialPublish';
import type { SocialAccount, SocialAuto, SocialPost, YouTubeAutoDefaults } from './types';
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function youtubeDefaultsState(value: unknown): { youtubeDefaults: YouTubeAutoDefaults | null; youtubeDefaultsVersion?: string } {
  const a = (value && typeof value === 'object' ? value : {}) as SocialAuto;
  const version = uuid(a.youtubeDefaultsVersion) ? a.youtubeDefaultsVersion : undefined;
  const d = a.youtubeDefaults;
  const valid = d && uuid(d.acctId) && d.version === version && !!version && ['private', 'unlisted', 'public'].includes(d.privacy) && typeof d.madeForKids === 'boolean';
  return { youtubeDefaults: valid ? { acctId: d.acctId, privacy: d.privacy, madeForKids: d.madeForKids, version: version! } : null, youtubeDefaultsVersion: version };
}
export function eligibleYouTubeDefaults(value: unknown, account: Pick<SocialAccount, 'id' | 'ch' | 'expired' | 'verificationHold'> | null | undefined): YouTubeAutoDefaults | null {
  const d = youtubeDefaultsState(value).youtubeDefaults;
  return d && account?.ch === 'youtube' && !account.expired && !account.verificationHold && d.acctId === account.id ? d : null;
}
export const generatedYouTubeTitle = (topic: string) => topic.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100).trim();
/** Only called for a new pack. An unset owner choice never turns into an inferred boolean or visibility. */
export function initialYouTubePost(post: SocialPost, topic: string, defaults: YouTubeAutoDefaults | null): SocialPost {
  if (post.publishOptions || post.pub || post.youtubeAutomation) return post;
  const title = generatedYouTubeTitle(topic);
  return { ...post, publishOptions: { title, ...(defaults ? { privacy: defaults.privacy, madeForKids: defaults.madeForKids } : {}) }, youtubeGeneratedTitle: title, publishOptionsRevision: 0, ...(defaults ? { youtubeAutomation: { defaultsVersion: defaults.version, acctId: defaults.acctId } } : {}) };
}
export function finishYouTubeTitle(post: SocialPost, topic: string, revision: number | undefined): SocialPost {
  if ((post.publishOptionsRevision && !post.youtubeGeneratedTitle) || (post.publishOptionsRevision || 0) !== (revision || 0) || (post.publishOptions?.title && post.publishOptions.title !== post.youtubeGeneratedTitle)) return post;
  const title = generatedYouTubeTitle(topic);
  return { ...post, publishOptions: { ...post.publishOptions, title }, youtubeGeneratedTitle: title };
}
export function automaticYouTubePostEligible(post: SocialPost | undefined, defaults: YouTubeAutoDefaults | null): boolean {
  return !!post && automaticMediaReady(post) && !!defaults && post.youtubeAutomation?.defaultsVersion === defaults.version && post.youtubeAutomation.acctId === defaults.acctId && post.publishOptions?.privacy === defaults.privacy && post.publishOptions.madeForKids === defaults.madeForKids && !!post.publishOptions.title?.trim();
}
