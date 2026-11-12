// What one edit in the article workspace sends to `article.save`, and the key its debounced save waits under.
// Pure, so the rule can be tested without a browser.
import type { Article, Block } from '@/lib/types';

export type ArtPatch = { body?: Block[]; brief?: Article['brief']; seo?: Article['seo']; img?: Partial<Article['img']>; videos?: string[] };
export type SavePatch = { body?: Block[]; brief?: Article['brief']; seo?: Article['seo']; img?: Partial<Pick<Article['img'], 'style' | 'prompt' | 'alt'>>; videos?: string[] };
/** The cover fields a person can edit. Everything else on `img` is the server's. */
const IMG_FIELDS = ['style', 'prompt', 'alt'] as const;

/** `cur` is the article with the edit `p` already applied.
 *  Image fields: only the ones this edit changed are sent. A tab can be showing an article that was drafted while it
 *  was away (asleep, offline, across a deploy); sending the direction it still shows along with an alt-text edit would
 *  put the old default back over the direction Radar wrote. The key names the fields too, because a later save with
 *  the same key replaces the waiting one: an alt edit must not cancel a direction edit made just before it. */
export function articleSave(id: string, cur: Pick<Article, 'body' | 'brief' | 'seo' | 'img' | 'videos'>, p: ArtPatch): { key: string; patch: SavePatch } {
  const patch: SavePatch = {};
  if (p.body) patch.body = cur.body;
  if (p.brief) patch.brief = cur.brief;
  if (p.seo) patch.seo = cur.seo;
  if (p.videos) patch.videos = cur.videos;
  const edited = IMG_FIELDS.filter(field => p.img?.[field] !== undefined);
  if (edited.length) patch.img = Object.fromEntries(edited.map(field => [field, cur.img[field]]));
  const parts = Object.keys(patch).flatMap(name => (name === 'img' ? edited.map(field => 'img.' + field) : [name]));
  return { key: 'art:' + id + ':' + parts.join(','), patch };
}

/** The hint under "Describe your image". Before the first draft there is no article text for Radar to have read. */
export const coverDirectionHint = (generated: boolean) => (generated
  ? 'Radar writes this from your article. Edit it to describe the cover you want: your wording is used as written and also guides body images. Generated pictures are illustrations and may differ from the real subject.'
  : 'Radar writes this from your article when it drafts it. Edit it to describe the cover you want: your wording is used as written and also guides body images. Generated pictures are illustrations and may differ from the real subject.');
