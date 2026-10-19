// DEV-ONLY AI stubs for Social Marketing (RADAR_DEV_STUBS=1). Deterministic, profile-aware, and rule-abiding,
// so the whole flow (packs, regenerate, Suggest ideas angles + tie verification) runs without API keys.
import { registerStub } from '../../ai/adapters/stub';
import { lcf, shortHead } from '@/lib/format';
import type { Platform, Profile } from '@/lib/types';
import { factOverlaps, overlap, tokens, type Fact } from './ideas-core';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unq = (s: string) => s.replace(/[.?!…:]+$/, '').trim();
function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); }
const tag = (s: string) => '#' + s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function stubPost(k: Platform, topic: string, p: Profile, v = 0): string {
  const n = p.business.name || 'our team';
  const seg = lcf(p.audience.segments[0] || 'small teams');
  const need0 = lcf(unq(p.audience.needs[0] || 'spend less time on admin'));
  const need1 = unq(p.audience.needs[1] || 'Keep the process simple enough to stick with');
  const d0 = unq(p.business.differentiators[0] || p.business.offerings[0] || 'A simpler way to do it');
  const h = unq(shortHead(topic, 120));
  const kws = (p.keywords?.list || []).filter(x => x.priority).concat(p.keywords?.list || []);
  const tags = [...new Set([...kws].sort((a, b) => a.kw.length - b.kw.length).map(x => tag(x.kw)))].slice(0, 2);
  const T: Record<Platform, string[]> = {
    linkedin: [
      `${h}.\n\nMost ${seg} we talk to want the same thing: to ${need0}. The usual tools make that harder, not easier — they ask you to remember everything.\n\nWhat helps:\n→ Decide on one simple system and keep it\n→ ${cap(lcf(need1))}\n→ Review once a week, not once a quarter\n\nWhat’s worked for you?${tags.length ? '\n\n' + tags.join(' ') : ''}`,
      `A question we hear from ${seg} almost every week: “${h}?”\n\nThe honest answer: it depends less on willpower and more on the system around you.\n\nAt ${n}, one idea shapes what we build: “${d0}.” It’s a small change that makes it realistic to ${need0}.\n\nHow do you handle it today?`,
    ],
    x: [
      `${h}.\n\nPick one simple system. Review it weekly. ${cap(need0)}.\n\nThat’s most of it.`,
      `For ${seg}: ${lcf(h)} is a systems problem, not a discipline problem.`,
    ],
    facebook: [
      `${h} — a question we hear a lot.\n\nHere’s the short version: the easier it is to ${need0}, the more likely you’ll keep doing it. That’s the thinking behind ${n}: “${d0}.” Tell us how you handle it!`,
      `Quick question for the ${seg} here: how do you handle this? ${h}.\n\nWe’ve collected a few ideas that have worked for people we work with, and we’d love to hear yours too.`,
    ],
    reddit: [
      `Title: ${h} — what’s worked for you?\n\nI’ve spent a lot of time talking with ${seg} about this, and the pattern I keep seeing is people trying to ${need0} with willpower instead of a simple system. Curious what others here actually do day to day.\n\n(Disclosure: I work on ${n}. Not linking anything — genuinely interested in other approaches.)`,
      `Title: Lessons from ${seg} on “${lcf(h)}”\n\nSharing a few patterns we’ve seen. Happy to answer questions.\n\n- Write down how you do it today before changing anything\n- Change one thing at a time\n- Check back after a month and keep what stuck\n\n(Disclosure: I work at ${n}.)`,
    ],
    quora: [
      `Q: ${h}?\n\nShort answer: pick a simple system you’ll actually keep, and review it regularly.\n\nLonger answer: most ${seg} don’t struggle with this for lack of effort. The details that slip through — a quick call, a small change, an email thread — add up. A short weekly review catches most of it, and makes it far easier to ${need0}.\n\nI work on ${n}, which takes this approach, but the method works with any tool.`,
      `Q: ${h}?\n\nShort answer: three habits make the biggest difference — plan it, name it, review it.\n\nPlan the work before it starts, keep names consistent so you can find things later, and set aside ten minutes a week to look back. Disclosure: I work at ${n}.`,
    ],
  };
  return T[k][v % 2];
}

/** Angle titles for idea candidates + a proposed profile fact (verified afterwards by ideas.ts). */
function stubAngle(text: string, kind: string, intent: string | undefined): string | null {
  const h = hash(text); const t = text.trim();
  if (kind === 'keyword' && h % 5 === 0) return null; // no good social angle → priority keywords fall back
  const A = intent === 'Commercial'
    ? [`What to look for in ${t}, from people who use it daily`, `${cap(t)}: the questions to ask before you choose`, `Why “${t}” is harder than it looks`]
    : [`${cap(t)}: what actually works`, `The ${t} mistakes we see most often`, `${cap(t)}, explained in three minutes`];
  return A[h % A.length];
}

const SYN = [['bill', 'invoic', 'billabl'], ['pric', 'rat', 'fee'], ['budget', 'profit', 'margin', 'overrun', 'scop', 'profitabl'], ['calendar', 'schedul', 'timer', 'track', 'hour'], ['client', 'customer', 'portal']];
function semantic(a: string, b: string): boolean {
  if (factOverlaps(a, b, '')) return true;
  const ta = tokens(a, { minLen: 3 }), tb = tokens(b, { minLen: 3 });
  return SYN.some(g => [...ta].some(x => g.some(s => x.startsWith(s))) && [...tb].some(x => g.some(s => x.startsWith(s))));
}

registerStub('social.post', (_i, c: { platform: Platform; topic: string; profile: Profile; v: number }) => ({ text: stubPost(c.platform, c.topic, c.profile, c.v || 0) }));

registerStub('social.angles', (_i, c: { cands: { id: string; kind: string; text: string; intent?: string }[]; facts: Fact[] }) => ({
  angles: c.cands.map(x => {
    const title = stubAngle(x.text, x.kind, x.intent);
    if (!title) return { id: x.id, title: null, factRef: null };
    // Best overlap; otherwise propose a fact anyway (so verification is exercised — unsupported ones get dropped).
    const tt = tokens(title + ' ' + x.text, { minLen: 4 });
    let best: Fact | null = null, bestN = 0;
    for (const f of c.facts) { const n = overlap(tt, tokens(f.text, { minLen: 4 })).length; if (n > bestN) { best = f; bestN = n; } }
    const f = best || (c.facts.length ? c.facts[hash(x.text) % c.facts.length] : null);
    return { id: x.id, title, factRef: f ? f.ref : null };
  }),
}));

registerStub('social.tieCheck', (_i, c: { pairs: { id: string; angle: string; topic: string; fact: string }[] }) => ({
  results: c.pairs.map(p => ({ id: p.id, supports: semantic(p.fact, p.angle + ' ' + p.topic) })),
}));
