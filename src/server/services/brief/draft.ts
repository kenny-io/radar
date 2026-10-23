// Draft step (02-system §9.4–6): two variants per reply (help / mention-with-disclosure), feed posts per platform with a
// `why` citing real evidence from today's threads, and on-demand rewrites. Every output passes through rules.ts.
import { z } from 'zod';
import { ai, profileContext } from '@/server/ai';
import { BPLAT } from '@/lib/constants';
import type { BriefAccount, BriefItem, BriefPlatform, BriefSettings, Profile } from '@/lib/types';
import { clip, shortHash } from './plan';
import { cleanBrand, cleanPost, stripLinks, cleanReply, dropUnsupportedFigures, namesBusiness, X_LIMIT } from './rules';
import type { Scored } from './rank';

/** Tone sample approved by the owner: casual, typed-on-the-bus, still high quality. Copy the register, never the content. */
export const TONE_SAMPLE = `I think the hard part is figuring out which docs a change actually affects. Comparing an entire PR against entire pages could get noisy pretty quickly.

I'd start with specific things like endpoint names, config keys, env vars and CLI flags. If one changes, you have something concrete to check against wherever it's mentioned.

Then keep the flag really simple. Here's what the docs say, here's the code change, here's why they might disagree. If someone has to go digging to work out whether the flag is valid, they'll probably stop checking after a while.

This is actually what I'm building with Thally, I'm the founder. We use a knowledge graph to connect those pieces and open suggested updates as PRs with the evidence attached.

Also give each flag an owner. Dropping it in a shared channel is an easy way for everyone to assume someone else has it covered.

Are you thinking of putting the flags on the original PR or opening separate docs PRs?`;

const VOICE_RULES = (p: Profile) => `Language: ${p.brand.language || 'English (US)'}. The brand voice (${p.brand.voice || 'plain, warm and practical'}) guides word choice, but community writing must sound like a person, not a company.
Write like someone typing a reply on their phone on the bus: relaxed, conversational, short sentences, contractions ("I'd", "you'll"), plain everyday words, first person. Still genuinely useful and specific, never sloppy.
Avoid: corporate or consultant phrasing, words like "leverage", "robust", "streamline", "seamless", "crucial", "key takeaway"; openers like "Great question" or "In my experience"; sign-offs like "Hope this helps"; em dashes; bullet lists and headings; marketing language, superlatives, hashtags, emoji, calls to action.
Here is a sample with the right tone. Match its register and rhythm only; never reuse its content or wording:
"""
${TONE_SAMPLE}
"""`;

const PLAT_RULES: Record<BriefPlatform, string> = {
  reddit: 'Reddit: casual, like the sample. NEVER include links or URLs of any kind. Write like a regular member of the subreddit.',
  x: `X: casual and punchy, like a quick reply typed on your phone. Each variant must be ${X_LIMIT} characters or fewer, including the disclosure.`,
  linkedin: 'LinkedIn: this is the one platform to be a bit more polished and professional, still human and first person, never corporate. Two or three short paragraphs at most.',
  hn: 'Hacker News: casual and technical, like the sample. Substantive and precise, no fluff, no salesmanship. HN readers dislike promotion.',
  quora: 'Quora: conversational, like explaining it to a friend, and genuinely helpful.',
};

export const ReplyDraft = z.object({ tag: z.string(), why: z.string(), help: z.string(), mention: z.string() });

/** Starting variant from the user's mention policy (02-system §9.5). */
export const startMention = (policy: BriefSettings['mention'], asks: boolean, promoBanned?: boolean) => !promoBanned && (policy === 'relevant' || (policy === 'asked' && asks));

export async function draftReply(p: Profile, s: Scored, settings: BriefSettings, bid: string, fresh: boolean): Promise<BriefItem> {
  const name = p.business.name;
  const replyTo = s.replyToIdx != null && s.comments ? s.comments[s.replyToIdx] : null;
  const system = `You draft replies to public community threads for someone who works at ${name}. ${VOICE_RULES(p)}
Write TWO variants:
- "help": purely helpful. Do not mention ${name} or any product, and do not hint at one.
- "mention": the same help, plus a natural plug for ${name}. After the useful part, say in one or two sentences how ${name} handles exactly the problem in this thread, using what ${name} actually does (from the profile below), the way a peer mentions a tool they build. Name ${name} and disclose plainly that you work on it (e.g. "Full disclosure, I work on ${name}: …"). Lead with the help, not the plug; no hype, no calls to action.
${PLAT_RULES[s.plat]}
Never mention or praise competitors (${p.audience.competitors.join(', ') || 'none'}).
Also return "tag": a 2–6 word reason this thread is worth joining (e.g. "Looking for a better method"), and "why": one sentence telling the user why Radar picked it, grounded in the thread itself.

${profileContext(p)}`;
  const prompt = [
    `Platform: ${BPLAT[s.plat]} (${s.where})`,
    `Thread: ${s.title}`, s.body ? `Body: ${clip(s.body, 900)}` : '',
    replyTo ? `You are replying to ${replyTo.who}: ${replyTo.text}` : '',
    `Engagement: ${s.eng || 'unknown'}.`, s.asks ? 'They explicitly ask for a tool or recommendation.' : 'They are not asking for a tool.',
    s.promoBanned ? 'This community forbids self-promotion: make the "mention" variant identical to "help".' : `The "mention" variant must name ${name}.`,
  ].filter(Boolean).join('\n');
  const out = await ai.run('writing', { purpose: 'brief.reply', effort: 'low', system, prompt, schema: ReplyDraft, schemaName: 'reply', maxTokens: 1500, stubContext: { profile: p, cand: s, replyTo } }, { businessId: bid });
  const d = out.json!;
  const ctx = { plat: s.plat, name, domain: p.domain };
  const help = cleanReply(d.help, 'help', ctx);
  // Rule-violating communities (self-promotion forbidden): no plug variant is drafted.
  const mention = s.promoBanned ? help : plugOrFallback(cleanReply(d.mention, 'mention', ctx), help, p, s.plat);
  return {
    id: 'r' + shortHash(s.id), kind: 'reply', plat: s.plat, where: s.where, who: s.who, url: s.url, eng: s.eng, postedAt: s.postedAt || undefined,
    title: s.title, body: s.body ? clip(s.body, 600) : undefined, replyTo: replyTo ? { who: replyTo.who, text: replyTo.text } : null, asks: s.asks,
    ...(fresh ? { fresh: true } : {}), ...(s.promoBanned ? { noMention: true } : {}), ...(s.rulesUnknown ? { rulesUnknown: true } : {}),
    tag: clip(d.tag, 60), why: clip(d.why, 280), drafts: { help, mention }, edits: {}, mention: startMention(settings.mention, s.asks, s.promoBanned), st: 'open',
  };
}

/* ── Company account (UPDATE-2026-10-20b §2) ── */
/** Company voice: the official account, "we", useful first. Radar has no aggregated product data yet, so it never quotes figures. */
const CO_RULES = (p: Profile) => `Language: ${p.brand.language || 'English (US)'}. Brand voice: ${p.brand.voice || 'plain, warm and practical'}.
You write as the official ${p.business.name} company account. Speak as the company ("we"). Lead with something useful: a how-to, a clear answer, or what ${p.business.name} has learned from working on this problem. Name ${p.business.name} plainly when it answers the question. Help first, product second.
No hype, superlatives, hashtags, emoji, links or calls to action. No em dashes, bullet lists or headings.
Never quote numbers, percentages, customer names or customer results unless they appear in the business profile or the thread below. Radar has no product data to back them up, so leave figures out entirely rather than estimate.
Never write personal stories ("I"); those belong on the founder's feed.`;
const CO_PLAT_RULES: Partial<Record<BriefPlatform, string>> = {
  x: `X: short and direct. ${X_LIMIT} characters or fewer.`,
  linkedin: 'LinkedIn: professional and warm, two or three short paragraphs at most.',
};
/** Everything the company may quote figures from. */
const coAllowed = (p: Profile, extra = '') => `${profileContext(p)}
${extra}`;

export const BrandDraft = z.object({ tag: z.string(), why: z.string(), brand: z.string() });

export async function draftCompanyReply(p: Profile, s: Scored, bid: string, fresh: boolean): Promise<BriefItem> {
  const name = p.business.name;
  const replyTo = s.replyToIdx != null && s.comments ? s.comments[s.replyToIdx] : null;
  const system = `You draft replies to public threads from the official ${name} company account (${p.business.description}). ${CO_RULES(p)}
${CO_PLAT_RULES[s.plat] || ''}
Never mention or praise competitors (${p.audience.competitors.join(', ') || 'none'}).
Return "brand": the reply. Also "tag": a 2–6 word reason the company should reply (e.g. "Asking for your exact product"), and "why": one sentence telling the user why a reply from the company account fits here, grounded in the thread itself.

${profileContext(p)}`;
  const prompt = [
    `Platform: ${BPLAT[s.plat]} (${s.where})`,
    `Thread: ${s.title}`, s.body ? `Body: ${clip(s.body, 900)}` : '',
    replyTo ? `You are replying to ${replyTo.who}: ${replyTo.text}` : '',
    `Engagement: ${s.eng || 'unknown'}.`, s.asks ? 'They explicitly ask for a tool or recommendation.' : 'They are not asking for a tool; add something useful the company can speak to.',
  ].filter(Boolean).join('\n');
  const out = await ai.run('writing', { purpose: 'brief.brand', effort: 'low', system, prompt, schema: BrandDraft, schemaName: 'reply', maxTokens: 1000, stubContext: { profile: p, cand: s, replyTo } }, { businessId: bid });
  const d = out.json!;
  const allowed = coAllowed(p, `${s.title}\n${s.body || ''}\n${replyTo?.text || ''}`);
  const brand = cleanBrand(d.brand, { plat: s.plat, name, domain: p.domain }, allowed);
  if (!brand) throw new Error('empty company reply');
  return {
    id: 'c' + shortHash(s.id), acct: 'company', kind: 'reply', plat: s.plat, where: s.where, who: s.who, url: s.url, eng: s.eng, postedAt: s.postedAt || undefined,
    title: s.title, body: s.body ? clip(s.body, 600) : undefined, replyTo: replyTo ? { who: replyTo.who, text: replyTo.text } : null, asks: s.asks,
    ...(fresh ? { fresh: true } : {}),
    tag: clip(d.tag, 60), why: clip(dropUnsupportedFigures(d.why, allowed) || 'A reply from the company account fits here.', 280), drafts: { brand }, edits: {}, mention: false, st: 'open',
  };
}

/** The plug variant must actually name the business. If the model returned the help text (or never named it), add a
 *  short, factual plug built from the profile so the two variants are never identical. */
export function plugOrFallback(mention: string, help: string, p: Profile, plat: BriefPlatform): string {
  const name = p.business.name;
  if (mention && mention !== help && namesBusiness(mention, name)) return mention;
  const what = clip((p.business.description || '').replace(/\.$/, ''), 140);
  const line = `Full disclosure, I work on ${name}${what ? ` (${what.charAt(0).toLowerCase() + what.slice(1)})` : ''}, which was built for exactly this problem.`;
  return cleanReply(`${help}\n\n${line}`, 'mention', { plat, name, domain: p.domain });
}

/* ── Feed posts ── */
export interface Theme { theme: string; threads: Scored[]; comments: number; recurring: boolean }
const FEED_PLATS: BriefPlatform[] = ['linkedin', 'x'];

/** Topics recurring across today's threads (≥2 threads), else the single most-discussed one. */
export function feedThemes(scored: Scored[]): Theme[] {
  const ok = scored.filter(s => s.reject === 'none' && s.theme && s.fit >= 0.4);
  const by = new Map<string, Scored[]>();
  for (const s of ok) { const a = by.get(s.theme) || []; a.push(s); by.set(s.theme, a); }
  const themes = [...by.entries()].map(([theme, threads]) => ({ theme, threads, comments: threads.reduce((n, t) => n + t.engN, 0), recurring: threads.length >= 2 }));
  const rec = themes.filter(t => t.recurring).sort((a, b) => b.comments - a.comments);
  const trend = themes.filter(t => !t.recurring && t.comments >= 25).sort((a, b) => b.comments - a.comments);
  return [...rec, ...trend].slice(0, 2);
}

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numWord = (n: number) => (n < NUM_WORDS.length ? NUM_WORDS[n] : String(n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const roughly = (n: number) => (n >= 100 ? `over ${Math.floor(n / 100) * 100}` : String(n));

/** The evidence clause Radar can substantiate for a theme. */
export function evidenceWhy(t: Theme): string {
  if (t.recurring) return `${cap(numWord(t.threads.length))} threads in the last two days were about ${t.theme}, with ${roughly(t.comments)} comments between them. Post the answer on your own feed while the question is everywhere.`;
  return `${cap(t.theme)} is one of the most-discussed topics in your audience today, with ${roughly(t.comments)} comments on one thread. A short, clear take from you fits right in.`;
}
/** True when every number in `why` is one the evidence supports. */
export function whySupported(why: string, t: Theme): boolean {
  const allowed = new Set<string>([String(t.threads.length), numWord(t.threads.length), String(t.comments), roughly(t.comments).replace('over ', ''), String(Math.floor(t.comments / 100) * 100), String(Math.floor(t.comments / 50) * 50), '48', '24', 'two']);
  const nums = (why.toLowerCase().match(/\b\d[\d,]*\b/g) || []).map(x => x.replace(/,/g, ''));
  const words = (why.toLowerCase().match(new RegExp(`\\b(${NUM_WORDS.slice(2).join('|')})\\b`, 'g')) || []);
  return nums.length + words.length > 0 && [...nums, ...words].every(x => allowed.has(x));
}

const PostsSchema = z.object({ posts: z.array(z.object({
  theme: z.string(), title: z.string(), tag: z.string(), why: z.string(),
  drafts: z.array(z.object({ platform: z.enum(['linkedin', 'x', 'reddit', 'hn', 'quora']), text: z.string() })),
})) });

/** The company's "why" when the model's can't be substantiated. */
export function evidenceWhyCo(t: Theme, name: string): string {
  return t.recurring
    ? `${cap(numWord(t.threads.length))} threads in the last two days were about ${t.theme}, with ${roughly(t.comments)} comments between them. A clear how-to from ${name} answers it for everyone at once.`
    : `${cap(t.theme)} is one of the most-discussed topics in your audience today. The ${name} page can answer it with what the company knows.`;
}

export async function draftPosts(p: Profile, themes: Theme[], enabled: BriefPlatform[], bid: string, date: string, acct: BriefAccount = 'founder'): Promise<BriefItem[]> {
  if (!themes.length) return [];
  const co = acct === 'company';
  const feed = FEED_PLATS.filter(k => enabled.includes(k));
  const platsFor = (t: Theme) => {
    const ps = feed.length ? feed : FEED_PLATS;
    const lead = t.threads.find(x => ps.includes(x.plat))?.plat;
    return lead ? [lead, ...ps.filter(x => x !== lead)] : ps;
  };
  const system = co
    ? `You write posts for the official ${p.business.name} company page, answering what the audience is asking about today. ${CO_RULES(p)}
Good company angles: a practical how-to on the topic, what ${p.business.name} has learned building for this problem, or a product fact from the profile that answers it. Never personal stories.
For each topic return: "title" (a short headline, 4–9 words), "tag" (2–5 words, e.g. "How-to from the company" or "What the product answers"), "why" (one sentence on why the company page should post this, citing ONLY the evidence numbers given), and one draft per requested platform.
LinkedIn: a few short paragraphs. X: ${X_LIMIT} characters or fewer. Never mention competitors.

${profileContext(p)}`
    : `You write posts for the personal feed of the founder of ${p.business.name}, in first person, answering what the audience is asking about today. ${VOICE_RULES(p)}
Draw on personal experience and opinion: a founder's take lands better than a how-to from the brand. Keep anecdotes general; never invent specific figures, dates or events about the founder. ${p.business.name} may come up once, naturally, at most.
For each topic return: "title" (a short headline, 4–9 words), "tag" ("Answer what people keep asking" for a recurring question, or "Trending in your audience today"), "why" (one sentence that cites ONLY the evidence numbers given — never invent counts), and one draft per requested platform.
LinkedIn: a few short paragraphs, may end with a question. X: ${X_LIMIT} characters or fewer. Never mention competitors.

${profileContext(p)}`;
  const prompt = themes.map((t, i) => `Topic ${i + 1}: ${t.theme}
Evidence: ${t.threads.length} thread(s) in the last two days, ${t.comments} comments in total${t.recurring ? '' : ' (one thread)'}.
Threads: ${t.threads.slice(0, 5).map(x => `"${clip(x.title, 140)}" (${BPLAT[x.plat]}, ${x.eng || 'no count'})`).join('; ')}
Platforms: ${platsFor(t).join(', ')}`).join('\n\n');
  const out = await ai.run('writing', { purpose: 'brief.posts', effort: 'low', system, prompt, schema: PostsSchema, schemaName: 'posts', maxTokens: 2500, stubContext: { profile: p, acct, themes: themes.map(t => ({ ...t, plats: platsFor(t) })) } }, { businessId: bid });
  const items: BriefItem[] = [];
  (out.json?.posts || []).slice(0, themes.length).forEach((po, i) => {
    const t = themes[i]; const plats = platsFor(t);
    const drafts: Record<string, string> = {};
    const allowed = coAllowed(p, t.threads.map(x => `${x.title} ${x.body || ''}`).join('\n'));
    for (const k of plats) {
      const d = po.drafts.find(x => x.platform === k); if (!d || !d.text.trim()) continue;
      const txt = co ? cleanPost(stripLinksFor(dropUnsupportedFigures(d.text, allowed), p.domain), k) : cleanPost(d.text, k);
      if (txt) drafts[k] = txt;
    }
    const ps = plats.filter(k => drafts[k]); if (!ps.length) return;
    items.push({
      id: (co ? 'q' : 'p') + shortHash(date + t.theme), ...(co ? { acct: 'company' as const } : {}), kind: 'post', plats: ps, pl: ps[0], title: clip(co ? dropUnsupportedFigures(po.title, allowed) || po.title.replace(/\d[\d,.%]*/g, '').trim() : po.title, 90),
      tag: clip(po.tag || (co ? 'From the company' : t.recurring ? 'Answer what people keep asking' : 'Trending in your audience today'), 60),
      // Substantiation (README §2.5 #6): keep the model's why only if every number in it is real.
      why: whySupported(po.why, t) ? clip(po.why, 300) : co ? evidenceWhyCo(t, p.business.name) : evidenceWhy(t),
      drafts, edits: {}, mention: false, st: 'open',
    });
  });
  return items;
}

const stripLinksFor = (t: string, domain: string) => stripLinks(t, [domain]);

/* ── Rewrite (Brief detail → Rewrite) ── */
export async function rewriteItem(p: Profile, it: BriefItem, text: string, instruction: string, bid: string): Promise<string> {
  const n = p.business.name; const reply = it.kind === 'reply'; const mention = reply && it.mention && !it.noMention;
  const plat = (reply ? it.plat : it.pl) as BriefPlatform;
  const co = it.acct === 'company';
  const system = co
    ? `You write ${reply ? 'replies to public threads' : 'posts'} from the official ${n} company account (${p.business.description}). ${CO_RULES(p)}\n${CO_PLAT_RULES[plat] || ''}\n${plat === 'x' ? `Stay under ${X_LIMIT} characters.` : ''} Return only the new text.\n\n${profileContext(p)}`
    : `You write ${reply ? 'replies to public threads' : 'posts for their personal feed'} for the founder of ${n} (${p.business.description}), in first person. ${VOICE_RULES(p)}\n${PLAT_RULES[plat]}\nNo links. ${reply ? (mention ? `Keep a natural plug for ${n}: how it handles this exact problem, in one or two sentences after the help, with a plain disclosure that you work on it.` : `Do not mention ${n} or any product.`) : ''} ${plat === 'x' ? `Stay under ${X_LIMIT} characters.` : ''} Return only the new text.\n\n${profileContext(p)}`;
  const ctx = reply
    ? `Platform: ${BPLAT[plat]} (${it.where})\nThread: ${it.title}\n${it.body || ''}\n${it.replyTo ? `Replying to ${it.replyTo.who}: ${it.replyTo.text}` : ''}`
    : `Platform: ${BPLAT[plat]}\nTopic: ${it.title}`;
  const out = await ai.run('writing', { purpose: 'brief.rewrite', effort: 'low', system, prompt: `${ctx}\n\nCurrent draft:\n${text}\n\nWhat to change: ${instruction}`, maxTokens: 900, stubContext: { profile: p, item: it, text, instruction } }, { businessId: bid, retries: 1 });
  const raw = String(out.text || '').trim().replace(/^"|"$/g, '');
  if (!raw) throw new Error('empty rewrite');
  const rctx = { plat, name: n, domain: p.domain };
  const allowed = coAllowed(p, `${it.title}\n${it.body || ''}\n${it.replyTo?.text || ''}\n${text}`);
  const cleaned = co ? (reply ? cleanBrand(raw, rctx, allowed) : cleanPost(stripLinksFor(dropUnsupportedFigures(raw, allowed), p.domain), plat))
    : reply ? cleanReply(raw, mention ? 'mention' : 'help', rctx) : cleanPost(raw, plat);
  if (!cleaned) throw new Error('empty rewrite');
  return cleaned;
}
