import type { Article, ArticleBodyImage, ArticleImageDirections, Block, ImageIssueReason, RealCover } from './types';

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

/** The cover direction every article is created with, before there is any text to derive one from. */
export const defaultCoverDirection = (kw: string) => 'Calm, editorial image about ' + kw;

/** A person wrote this cover direction, so Radar never rewrites it. A blank direction is nobody's. */
export function coverDirectionIsOwners(img: Pick<Article['img'], 'prompt' | 'promptBy'>, kw: string): boolean {
  const p = (img.prompt || '').trim();
  if (!p) return false;
  if (img.promptBy) return img.promptBy === 'owner';
  return p !== defaultCoverDirection(kw); // an article saved before promptBy existed: anything but the creation default was typed
}

/** The cover after a generated or template render: url, urlKey, the placeholder mark set or removed, and no real-picture record. */
export function withCover(img: Article['img'], f: { url: string; placeholder?: ImageIssueReason }, at = new Date().toISOString()): Article['img'] {
  const { placeholder: _previous, real: _real, ...rest } = img;
  return { ...rest, url: f.url, urlKey: `${img.style}:${img.seed}`, ...(f.placeholder ? { placeholder: { reason: f.placeholder, at } } : {}) };
}

/** The real-picture record, when it describes the cover that is stored now. */
export function realCoverOf(img: Pick<Article['img'], 'url' | 'real'>): RealCover | null {
  return img.real && img.url && img.real.url === img.url ? img.real : null;
}

/** The cover after a real picture is stored. `alt` replaces the alt unless a person wrote it. */
export function withRealCover(img: Article['img'], url: string, real: Omit<RealCover, 'url'>, alt?: string): Article['img'] {
  const { placeholder: _previous, ...rest } = img;
  return { ...rest, url, urlKey: `${img.style}:${img.seed}`, real: { ...real, url }, ...(alt !== undefined && img.altBy !== 'owner' ? { alt } : {}) };
}

const oneLine = (s: string) => s.trim().replace(/\s+/g, ' ');
const unpunctuated = (s: string) => oneLine(s).replace(/[.!?]+$/, '');
/** Whole sentences of `s` that fit in `max` characters; a first sentence that is too long is cut at a word boundary. */
function lead(s: string, max: number): string {
  let out = '';
  for (const sentence of oneLine(s).split(/(?<=[.!?])\s+/)) {
    if (!sentence) continue;
    const next = out ? out + ' ' + sentence : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const text = oneLine(s);
  return text.length <= max ? text : text.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[\s,;:—–-]+$/, '');
}

/** Directions built without a model, from the title, the section headings and the section text. Used when the
 *  direction step fails or returns a slot that cannot be used, so an article image is still about its article. */
export function fallbackImageDirections(title: string, body: Block[], plans: ArticleBodyImagePlan[]): Pick<ArticleImageDirections, 'subject' | 'cover' | 'sections'> {
  const topic = unpunctuated(title);
  const firstHeading = body.findIndex(b => b[0] === 'h2');
  const opening = (firstHeading < 0 ? body : body.slice(0, firstHeading)).filter(useful);
  const intro = (opening.length ? opening : body.filter(useful).slice(0, 1)).map(content).join(' ');
  const scene = (start: string, text: string, max: number) => [start, lead(text, max)].filter(Boolean).join(' ');
  return {
    subject: null,
    cover: { prompt: scene(`A literal, realistic scene showing the subject of an article titled ${topic}.`, intro, 220), alt: `Illustration for ${topic}` },
    sections: plans.map(plan => {
      const subject = plan.heading || plan.context.slice(0, 140);
      return { prompt: scene(`A literal, realistic scene showing ${unpunctuated(plan.heading) || topic}, in an article titled ${topic}.`, plan.context, 240), alt: `Illustration of ${subject.replace(/[.!?]+$/, '')}`.slice(0, 300) };
    }),
  };
}
