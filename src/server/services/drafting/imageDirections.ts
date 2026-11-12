// What an article's pictures should show, read from the finished article: one small-model call returns a literal scene
// for the cover and for each planned body image, and names the one real-world thing the article is about, if any.
// Every slot is checked on its own and replaced by a direction built from the title, heading and section text when it
// cannot be used. Nothing here throws: an article is never held up by its picture directions.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ai } from '../../ai';
import { coverDirectionIsOwners, fallbackImageDirections, planArticleBodyImages, type ArticleBodyImagePlan } from '@/lib/articleImages';
import type { Article, ArticleImageDirections, Block, CalendarEntry, ImageDirection, Profile } from '@/lib/types';
import { tokens } from '../calendar/research';
import './stubs';

export const DirectionsOut = z.object({
  subject: z.string().max(120), // '' when the article is not about one named real-world thing
  subjectKind: z.enum(['none', 'building', 'place', 'product', 'organisation', 'other']),
  cover: z.object({ direction: z.string().max(400), alt: z.string().max(200) }),
  sections: z.array(z.object({ i: z.number().int(), direction: z.string().max(400), alt: z.string().max(200) })).max(3),
});
export type DirectionsAnswer = z.infer<typeof DirectionsOut>;

const SYSTEM = 'You are Radar’s picture editor. You read a finished blog article and say what its cover picture and each section picture should literally show, so an illustrator who has not read the article can draw them. You use only details the article states. You never invent what something looks like.';

const oneLine = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ');
/** Cut at a word boundary to fit `max` characters. */
const cut = (s: string, max: number) => { s = oneLine(s); if (s.length <= max) return s; const c = s.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[\s,;:—–-]+$/, ''); return c.length > 10 ? c : s.slice(0, max); };
/** The article as the model reads it: "## " and "### " headings, list items one per line. */
export const bodyText = (body: Block[]) => body.map(b => (b[0] === 'h2' ? '## ' + b[1] : b[0] === 'h3' ? '### ' + b[1] : b[0] === 'ul' ? b[1].map(item => '- ' + item).join('\n') : b[1])).join('\n\n');

export function directionsPrompt(o: { profile: Profile; e: Pick<CalendarEntry, 'title' | 'kw' | 'type'>; body: Block[]; plans: ArticleBodyImagePlan[]; ownerDirection?: string }): string {
  const { profile: p, e } = o;
  const owner = oneLine(o.ownerDirection || '');
  const language = p.brand?.language || 'English';
  return `Business: ${p.business.name} (${p.business.industry || 'not stated'}). Markets: ${(p.brand?.markets || []).join(', ') || 'not stated'}.
Article title: ${e.title}
Primary keyword: ${e.kw}
Type: ${e.type}
${owner ? `The owner has chosen this cover: ${owner}. Do not change it. Section pictures must be different scenes that fit with it.\n` : ''}
ARTICLE
${bodyText(o.body).slice(0, 12_000)}

PICTURES NEEDED
Cover: the picture at the top of the article.
${o.plans.map((plan, i) => `Section ${i}: ${[plan.heading, oneLine(plan.context).slice(0, 500)].filter(Boolean).join(' — ')}`).join('\n')}

Return:
- subject and subjectKind: if the whole article is about ONE specific real-world thing with a proper name (a named building or development, a place, a product, an organisation), give its name exactly as the article writes it, and its kind. Otherwise subject is "" and subjectKind is "none". A person is never the subject.
- cover: direction and alt.
- sections: one entry per section listed above, with its number as i.

RULES FOR EVERY DIRECTION
1. One or two plain sentences in English, at most 300 characters, describing one scene that could be photographed or drawn: the main thing shown, where it is, and one or two visible details.
2. Literal, never symbolic. No metaphors, abstract shapes, icons, collages or split screens.
3. Use only what the article states. Do not invent colours, materials, floor counts, views, surroundings or weather. Where the article gives no visual detail, stay generic ("a low-rise residential building") rather than guessing.
4. If there is a subject, the cover shows the subject itself and names it. For a building or development: its exterior in its setting, with its type and location as the article gives them, and only the physical facts the article states (for example how many buildings, a gated entrance, low-rise or high-rise).
5. Each section picture shows something specific to that section and to this article's subject. It is a clearly different scene from the cover and from the other sections: a different thing shown, or a different place or viewpoint.
6. Nothing that needs writing to make sense: no signs with wording, captions, labels, charts, graphs, screenshots, readable documents, logos or brand marks. Do not mention text at all.
7. No real, identifiable person. People, if any, are anonymous and incidental.
8. Do not name an art style, colours or mood. Those are added later.

RULES FOR ALT TEXT
One plain sentence in ${language}, at most 140 characters, saying what the picture shows, beginning with the words for "Illustration of" in that language. If there is a subject, the cover alt names it.`;
}

/** The direction asks for writing or a diagram, which an image model draws as garbled text. */
const ASKS_FOR_WRITING = /\b(captions?|labels?|lettering|typograph\w*|headlines?|logos?|watermarks?|infographics?|charts?|graphs?|diagrams?|screenshots?|speech bubbles?)\b|\b(text|words?|numbers?|signs?|banners?)\s+(reading|saying|that (says?|reads?)|with the (text|words?))\b|["“][^"”]{2,}["”]/i;
const SYMBOLIC = /\b(metaphor\w*|symboli[sz]\w*|abstract|conceptual)\b/i;
/** Number tokens with separators removed: "1,200" and "1200" are the same number, and a sentence-ending dot is not part of it. */
const numbersIn = (s: string) => (s.match(/\d[\d.,]*/g) || []).map(n => n.replace(/,/g, '').replace(/\.+$/, ''));
const jaccard = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let both = 0; for (const t of a) if (b.has(t)) both++; return both / (a.size + b.size - both); };

/** Why a direction cannot be used, or null. `accepted` are the token sets of the slots already kept. `subject` is the
 *  accepted subject's name: the wording and symbolic checks read the direction without it, so a building called
 *  "Chart House" or "The Abstract Hotel" is not refused for being named. Nothing else is excused. */
function refusal(direction: string, known: Set<string>, accepted: Set<string>[], subject: string): string | null {
  if (direction.length < 25) return 'too short';
  const wording = subject ? direction.replace(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'gi'), ' ') : direction;
  if (ASKS_FOR_WRITING.test(wording)) return 'asks for writing';
  if (SYMBOLIC.test(wording)) return 'symbolic';
  if (numbersIn(direction).some(n => !known.has(n))) return 'number not in the article';
  const mine = new Set(tokens(direction));
  if (accepted.some(other => jaccard(mine, other) >= 0.6)) return 'repeats another picture';
  return null;
}

export interface CleanDirections extends Pick<ArticleImageDirections, 'subject' | 'cover' | 'sections'> {
  /** Slots whose answer was replaced by the built-in direction: 'cover', 'section 0', … with the reason. */
  replaced: { slot: string; why: string }[];
}
/** Check the model's answer slot by slot against the article. A slot that fails gets the direction built from the
 *  title, heading and section text; the others are kept. Pure. */
export function cleanImageDirections(raw: DirectionsAnswer, ctx: { title: string; body: Block[]; plans: ArticleBodyImagePlan[] }): CleanDirections {
  const fallback = fallbackImageDirections(ctx.title, ctx.body, ctx.plans);
  const article = oneLine(ctx.title + '\n' + bodyText(ctx.body));
  const known = new Set(numbersIn(article));
  // The subject is settled first: it is kept only when the article itself names it.
  const name = oneLine(raw.subject || '');
  const stated = !!name && raw.subjectKind !== 'none' && article.toLowerCase().includes(name.toLowerCase());
  const subject = stated ? { name, kind: raw.subjectKind as Exclude<DirectionsAnswer['subjectKind'], 'none'> } : null;
  const accepted: Set<string>[] = []; const replaced: CleanDirections['replaced'] = [];
  const slot = (name: string, given: { direction: string; alt: string } | undefined, spare: ImageDirection): ImageDirection => {
    const direction = oneLine(given?.direction || '');
    const why = given ? refusal(direction, known, accepted, subject?.name || '') : 'missing';
    if (why) { replaced.push({ slot: name, why }); accepted.push(new Set(tokens(spare.prompt))); return spare; }
    accepted.push(new Set(tokens(direction)));
    const alt = oneLine(given!.alt);
    return { prompt: direction, alt: cut(alt.length < 8 ? spare.alt : alt, 200) };
  };
  let cover = slot('cover', raw.cover, fallback.cover);
  // The model numbers its sections; an entry for a section that was not asked for, or a second one for the same section, is ignored.
  const byIndex = new Map<number, { direction: string; alt: string }>();
  for (const s of raw.sections || []) if (Number.isInteger(s.i) && s.i >= 0 && s.i < ctx.plans.length && !byIndex.has(s.i)) byIndex.set(s.i, s);
  const sections = ctx.plans.map((_plan, i) => slot(`section ${i}`, byIndex.get(i), fallback.sections[i]));

  if (subject) {
    const has = (s: string) => s.toLowerCase().includes(subject.name.toLowerCase());
    cover = { prompt: has(cover.prompt) ? cover.prompt : `${cover.prompt} The subject shown is ${subject.name}.`, alt: has(cover.alt) ? cover.alt : cut(`Illustration of ${subject.name}`, 200) };
  }
  return { subject, cover, sections, replaced };
}

/** sha256 of the title, length and body the directions were derived from. The leading 1 is a version: bump it when the prompt changes. */
export function directionsKey(title: string, body: Block[], words: number): string {
  return createHash('sha256').update(JSON.stringify([1, title, words, body])).digest('hex').slice(0, 24);
}

/** Directions for this article's cover and planned body images. Reuses the article's cached set when it was made by
 *  the AI step from the same title, body and length. Never throws: on failure, timeout or an unusable answer it
 *  returns directions built from the title, headings and section text. */
export async function resolveImageDirections(
  bid: string, profile: Profile, e: Pick<CalendarEntry, 'title' | 'kw' | 'type'>,
  a: Pick<Article, 'body' | 'brief' | 'img' | 'imageDirections'>,
  o: { budgetMs?: number; fresh?: boolean } = {},
): Promise<ArticleImageDirections> {
  const body = a.body || [];
  const plans = planArticleBodyImages(body, a.brief.words);
  const key = directionsKey(e.title, body, a.brief.words);
  const cached = a.imageDirections;
  if (!o.fresh && cached?.key === key && cached.source === 'ai' && cached.sections.length === plans.length) return cached;
  const at = new Date().toISOString();
  const builtIn = (): ArticleImageDirections => ({ ...fallbackImageDirections(e.title, body, plans), key, source: 'fallback', at });
  if (!body.length) return builtIn(); // nothing to read
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = ai.run('writing', {
      purpose: 'article.imageDirections',
      schema: DirectionsOut, schemaName: 'directions', maxTokens: 900, temperature: 0.2, timeoutMs: 30_000,
      system: SYSTEM, prompt: directionsPrompt({ profile, e, body, plans, ownerDirection: coverDirectionIsOwners(a.img, e.kw) ? a.img.prompt : '' }),
      stubContext: { title: e.title, kw: e.kw, plans },
    }, { businessId: bid, retries: 0 }).then(out => out.json);
    // ai.run cannot be cancelled: an answer that arrives after the budget is discarded, and its failure is not unhandled.
    call.catch(() => {});
    const LATE = Symbol('late');
    const late = new Promise<typeof LATE>(done => { timer = setTimeout(() => done(LATE), o.budgetMs ?? 90_000); });
    const answer = await Promise.race([call, late]);
    if (answer === LATE) { console.warn('[images] directions took too long, using the article’s title and sections'); return builtIn(); }
    if (!answer) return builtIn();
    const clean = cleanImageDirections(answer, { title: e.title, body, plans });
    // An answer with no usable slot is the built-in set under another name: say so, and try the model again next time.
    if (clean.replaced.length === plans.length + 1) return builtIn();
    return { key, source: 'ai', subject: clean.subject, cover: clean.cover, sections: clean.sections, at };
  } catch (err: any) {
    console.error('[images] directions failed, using the article’s title and sections', err?.message);
    return builtIn();
  } finally { if (timer) clearTimeout(timer); }
}
