import type { ArticleBodyImage, Block } from './types';

const normalized = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const content = (b: Block) => b[0] === 'ul' ? b[1].join(' ') : b[1];
const useful = (b: Block) => (b[0] === 'p' || b[0] === 'ul') && !!content(b).trim();

/** Resolve against the current body so edits before a section do not move its illustration to another section. */
export function articleBodyImageAnchor(body: Block[], image: Pick<ArticleBodyImage, 'after'>): number | null {
  const { heading, occurrence, block } = image.after;
  if (!Number.isInteger(occurrence) || occurrence < 0 || !Number.isInteger(block) || block < 0) return null;
  if (!heading) return body[block] && useful(body[block]) ? block : null;
  let seen = 0;
  let start = body.findIndex(b => b[0] === 'h2' && normalized(b[1]) === normalized(heading) && seen++ === occurrence);
  if (start < 0 && body[block]?.[0] === 'h2') start = block;
  if (start < 0) return null;
  let end = start + 1;
  while (end < body.length && body[end][0] !== 'h2') end++;
  // Hide images belonging to a deleted/empty section instead of placing them immediately under its heading.
  for (let i = end - 1; i > start; i--) if (useful(body[i])) return i;
  return null;
}

export interface ArticleBodyImagePlan {
  after: ArticleBodyImage['after']; heading: string; context: string;
}
/** Two illustrations for short/standard, three for long; spread them over meaningful sections. */
export function planArticleBodyImages(body: Block[], words: number): ArticleBodyImagePlan[] {
  const sections: ArticleBodyImagePlan[] = [];
  const seen = new Map<string, number>();
  body.forEach((b, block) => {
    if (b[0] !== 'h2') return;
    const key = normalized(b[1]); const occurrence = seen.get(key) || 0; seen.set(key, occurrence + 1);
    const after = { heading: key, occurrence, block };
    const anchor = articleBodyImageAnchor(body, { after });
    if (anchor == null) return;
    sections.push({ after, heading: b[1], context: body.slice(block + 1, anchor + 1).map(content).join(' ').slice(0, 1000) });
  });
  const candidates = sections.length ? sections : body.flatMap((b, block) => useful(b) ? [{ after: { heading: '', occurrence: 0, block }, heading: '', context: content(b).slice(0, 1000) }] : []);
  const count = Math.min(words >= 2200 ? 3 : 2, candidates.length);
  return Array.from({ length: count }, (_, i) => candidates[Math.floor((i + 0.5) * candidates.length / count)]);
}
