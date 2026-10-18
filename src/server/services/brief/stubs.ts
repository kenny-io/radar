// DEV-ONLY AI stubs for the Daily Brief (RADAR_DEV_STUBS=1). Deterministic, built from the Business Profile, and they
// honor every rule the real prompts ask for (no links on Reddit, ≤280 on X, disclosure on mention, no hashtags/emoji).
// BRIEF_STUB_FAIL=rewrite makes Rewrite fail, to verify its error toast.
import { registerStub } from '@/server/ai/adapters/stub';
import type { BriefItem, Profile } from '@/lib/types';
import { lcf } from '@/lib/format';
import { relevance, tokenize, type Candidate, type Plan } from './plan';
import type { RankRow, Scored } from './rank';
import type { Theme } from './draft';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const noDot = (s: string) => (s || '').trim().replace(/[.。]+$/, '');
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const ASKS_RE = /\b(any (?:\w+ )*(?:tool|app|software)|recommend|alternative to|which (?:tool|app)|what(?:’|')?s your stack|your stack|worth it|worth setting up|best way)\b/i;
const HOSTILE_RE = /\b(joke|garbage|scam|never again|worst|hate)\b/i;
const RULE_RE = /self-promotion thread|share what you(?:’|')re building|promo thread/i;

function needsOf(p: Profile) { return p.audience.needs.length ? p.audience.needs.map(lcf) : ['grow the business']; }
function themeFor(text: string, p: Profile): string {
  const t = new Set(tokenize(text));
  let best = '', n = 0;
  for (const need of needsOf(p)) { const k = tokenize(need).filter(w => t.has(w)).length; if (k > n) { n = k; best = need; } }
  return best ? `how to ${best}` : (p.keywords.list.find(k => k.priority)?.kw || '').toLowerCase();
}

registerStub('brief.rank', async (_i, ctx: { profile: Profile; plan: Plan; cands: Candidate[] }) => {
  await sleep(1500);
  const results: RankRow[] = ctx.cands.map(c => {
    const comments = (c.comments || []).map(x => x.text).join(' ');
    const text = `${c.title} ${c.body} ${comments}`;
    const fit = +relevance(text, ctx.plan).toFixed(3);
    const asks = ASKS_RE.test(`${c.title} ${c.body}`);
    const reject: RankRow['reject'] = HOSTILE_RE.test(text) ? 'hostile' : RULE_RE.test(text) ? 'rule-violation'
      : ctx.plan.competitors.some(x => c.where.toLowerCase().includes(x.toLowerCase())) ? 'competitor-owned' : /^show hn/i.test(c.title) && fit < 0.3 ? 'promotional' : fit < 0.2 ? 'off-topic' : 'none';
    const intent: RankRow['intent'] = asks ? 'asks-for-tool' : /\?|how do|best way|how to/i.test(text) ? 'asks-for-help' : /opinion|agree|debate|change my mind/i.test(text) ? 'discussion' : 'other';
    const replyTo = (c.comments || []).findIndex(x => relevance(x.text, ctx.plan) >= 0.25);
    return { id: c.id, fit, canHelp: fit >= 0.3 ? 0.85 : 0.5, intent, asks, reject, replyTo: replyTo >= 0 ? replyTo : null, theme: themeFor(text, ctx.profile) };
  });
  return { results };
});

registerStub('brief.reply', async (_i, ctx: { profile: Profile; cand: Scored; replyTo: { who: string; text: string } | null }) => {
  await sleep(900);
  const p = ctx.profile; const c = ctx.cand; const N = p.business.name;
  const need = needsOf(p)[0];
  const diff = lcf(noDot(p.business.differentiators[0] || 'fits the way you already work'));
  const desc = lcf(noDot(p.business.description || p.business.industry));
  const buyer = lcf((p.audience.buyers[0] || 'founder').replace(/\s*\(.*?\)/, ''));
  const x = c.plat === 'x';
  const themeNeed = c.theme?.replace(/^how to /, '') || need;
  if (c.asks) return x
    ? { tag: 'Asking for your exact product', why: `They’re describing what ${N} does, and asking for a recommendation.`,
        help: `Look for one that ${diff}, then add a two-minute daily review. That catches what any tool misses.`,
        mention: `That’s what we built ${N} for. It ${diff}, and you review it in a couple of minutes a day. (I work there.) Happy to answer questions.` }
    : { tag: 'Asking for tools directly', why: `They’re asking for recommendations, so mentioning ${N} with a disclosure is welcome here.`,
        help: `Whatever you pick, make sure it ${diff}. That’s the part that decides whether you still use it in month three.\n\nPair it with a two-minute review at the end of each day. That habit catches what any tool misses.`,
        mention: `Whatever you pick, make sure it ${diff}. That’s the part that decides whether you still use it in month three.\n\nDisclosure: I work on ${N} (${desc}). If you’d rather not add a tool, a two-minute daily review gets you most of the way.` };
  if (ctx.replyTo) return {
    tag: 'The real problem is in a comment', why: `The commenter’s real problem is the part you can help with, not the thread title.`,
    help: `This is what makes the conversation so hard. Once you can point to real numbers, it stops being awkward and becomes a simple choice for the client: approve more work at your rate, or ship what you have.\n\nEven a rough daily log gets you there.`,
    mention: `This is what makes the conversation so hard. Once you can point to real numbers, it stops being awkward and becomes a simple choice for the client.\n\nEven a rough daily log gets you there. (Disclosure: I work on ${N}, which does this automatically, but a spreadsheet works too.)` };
  if (c.intent === 'discussion' || x) return {
    tag: 'Debate, moving fast', why: 'Your audience is arguing about this right now. An early, useful reply gets seen.',
    help: `Agree, with one catch: you still need to ${themeNeed} either way. That’s what keeps the next decision honest.`,
    mention: `Agree, with one catch: you still need to ${themeNeed} either way. It’s why we built ${N}, and I work on it.` };
  if (c.plat === 'linkedin' && /team|people/i.test(`${c.title} ${c.body}`)) return {
    tag: 'Peer with your exact problem', why: `A ${buyer} asking peers for advice. Replies here are seen by others in the same role.`,
    help: `We went through the same thing at about that size. Two things helped more than any policy.\n\nFirst, make it come from something people already do every day, so it isn’t a second job. Second, review it together for ten minutes on Monday instead of chasing it on Friday.\n\nOnce the review is useful to the team, people stop seeing it as policing.`,
    mention: `We went through the same thing at about that size. Two things helped more than any policy.\n\nFirst, make it come from something people already do every day, so it isn’t a second job. Second, review it together for ten minutes on Monday instead of chasing it on Friday.\n\nDisclosure: I work on ${N}, and we built it around exactly this. Happy to share how other teams set up the Monday review if it’s useful.` };
  return {
    tag: 'Looking for a better method', why: 'They want a method, not a sales pitch. A practical answer from someone who does the work stands out.',
    help: `What finally worked for me was making it a small daily habit instead of a Friday project. A few minutes at the end of each day, while it’s still fresh, beats an hour of reconstruction later.\n\nThe habit matters more than the tool. A spreadsheet works fine if you look at it every day.`,
    mention: `What finally worked for me was making it a small daily habit instead of a Friday project. A few minutes at the end of each day, while it’s still fresh, beats an hour of reconstruction later.\n\nDisclosure: I work on ${N} (${desc}). The habit works with any tool, though.` };
});

registerStub('brief.posts', async (_i, ctx: { profile: Profile; themes: (Theme & { plats: string[] })[] }) => {
  await sleep(1100);
  const p = ctx.profile;
  const d0 = noDot(p.business.differentiators[0] || 'Make it part of something you already do');
  const seg = lcf((p.audience.segments[0] || 'small teams').replace(/\s*\(.*?\)/, ''));
  return { posts: ctx.themes.map((t, i) => {
    const need = t.theme.replace(/^how to /, '');
    const n = t.threads.length, cm = t.comments, rough = cm >= 100 ? `over ${Math.floor(cm / 100) * 100}` : String(cm);
    const first = i === 0;
    const drafts = t.plats.map(k => ({ platform: k as any, text: k === 'x'
      ? (first ? `You don’t need a new system to ${need}.\n\nA few minutes at the end of each day, while it’s still fresh, beats an hour of reconstruction on Friday.`
               : `The fastest way to ${need}: do a little of it, often.\n\nTen minutes a day beats a lost Friday.`)
      : (first ? `You don’t need a new system to ${need}.\n\nMost ${seg} we talk to don’t struggle because they’re careless. They struggle because their tools expect them to remember one more thing.\n\nWhat works instead:\n→ ${d0}\n→ A few minutes at the end of each day to fix what drifted\n→ A short weekly look back, before anything goes out\n\nHow do you handle it?`
               : `“How do you ${need}?” comes up on my feed every week.\n\nThe advice is usually a new tool. What actually works is smaller: ten minutes at the end of each day, before the details are gone.\n\nThe people who struggle most aren’t using the “wrong” tool. They’re trying to do it all at once.`) }));
    return t.recurring
      ? { theme: t.theme, title: first ? `You don’t need a new system to ${need}` : cap(`${need}, ten minutes at a time`), tag: 'Answer what people keep asking',
          why: `${cap(NUMW[n] || String(n))} threads in the last two days asked how to ${need}, with ${rough} comments between them. Post the answer on your own feed while the question is everywhere.`, drafts }
      : { theme: t.theme, title: cap(`${need}, ten minutes at a time`), tag: 'Trending in your audience today',
          why: `This is one of the most-discussed topics in your audience today, with ${rough} comments on one thread. A short, clear take from you fits right in.`, drafts };
  }) };
});

registerStub('brief.rewrite', async (_i, ctx: { profile: Profile; item: BriefItem; text: string; instruction: string }) => {
  await sleep(700);
  if ((process.env.BRIEF_STUB_FAIL || '').split(',').map(s => s.trim()).includes('rewrite')) throw new Error('rewrite stub failed on purpose (BRIEF_STUB_FAIL)');
  const { text, instruction } = ctx; const need = needsOf(ctx.profile)[0];
  const sentences = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  if (/short/i.test(instruction)) return sentences.slice(0, Math.max(2, Math.ceil(sentences.length / 2))).join(' ');
  if (/question/i.test(instruction)) return `${text}\n\nWhat’s worked for you so far?`;
  if (/casual|friend|warm|relax/i.test(instruction) || !/example/i.test(instruction)) {
    let t = text.replace(/^What finally worked for me/, 'Honestly, what fixed it for me').replace(/\bHowever\b/g, 'But').replace(/\bdo not\b/g, 'don’t').replace(/\bI have\b/g, 'I’ve').replace(/\bIt is\b/g, 'It’s').replace(/\bThat is\b/g, 'That’s');
    if (t === text) t = 'Honestly? ' + text.charAt(0).toLowerCase() + text.slice(1);
    return t;
  }
  return `${text}\n\nFor example: one person I know set a reminder for 5:30 every day to ${need}. Five minutes, and Friday stopped being a problem.`;
});

export {};
