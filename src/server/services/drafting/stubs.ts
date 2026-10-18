// DEV-ONLY AI stubs for drafting, rewrites and video lines (RADAR_DEV_STUBS=1). Deterministic, profile-aware prose so
// the full flow (research → streaming → validation → review) runs without API keys. Never used in production.
import { registerStub } from '../../ai/adapters/stub';
import type { Article, CalendarEntry, Profile, Source } from '@/lib/types';

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const seg = (p: Profile, i = 0) => (p.audience.segments[i % Math.max(1, p.audience.segments.length)] || 'small business owners').replace(/\s*\(.*\)/, '');

registerStub('article.research', (_i, ctx: { e: CalendarEntry; profile: Profile }) => ({
  sources: [
    { title: 'Independent Work Report 2026 (dev stub)', url: 'https://example.org/independent-work-report-2026', use: 'How often independents underbill', notes: ['38% of independent professionals say they underbill at least one project a month', 'Respondents who reviewed their time weekly reported fewer billing disputes'] },
    { title: `Small business guide to ${ctx.e.kw} (dev stub)`, url: 'https://example.com/guides/' + ctx.e.kw.replace(/\s+/g, '-'), use: `Background on ${ctx.e.kw}`, notes: [`${ctx.e.kw.charAt(0).toUpperCase() + ctx.e.kw.slice(1)} works best when it is part of a weekly routine`] },
  ],
}));

registerStub('article.draft', (_i, ctx: { e: CalendarEntry; a: Article; profile: Profile; sources: Source[] }) => {
  const { e, a, profile: p } = ctx; const n = p.business.name; const k = e.kw;
  const outline = a.brief.outline.length ? a.brief.outline : [`What ${k} really involves`, 'A simple way to start', 'Where tools help'];
  const need = p.audience.needs[0] ? lc(p.audience.needs[0]) : 'spend less time on admin';
  const diff = p.business.differentiators[0] ? lc(p.business.differentiators[0]) : 'keeps things simple';
  const parts: string[] = [];
  parts.push(`If you’re one of the ${lc(seg(p))} who has looked into ${k}, you’ve probably found advice written for much bigger teams. The trade-offs are different when you do the work yourself — and simpler than they look.`);
  parts.push(`This guide covers what matters, what to skip, and how to make ${k} a habit you’ll keep on a busy week.`);
  outline.forEach((h, i) => {
    parts.push('## ' + h);
    if (i === 0) {
      parts.push(`At its core, ${k} is about making a decision once so you don’t have to make it every week. Start with what your clients already expect, then decide what you’re willing to change.`);
      parts.push(`It matters more than most people think: 38% of independent professionals say they underbill at least one project a month [1]. Most of that isn’t a pricing problem — it’s a tracking problem.`);
    } else if (i === 1) {
      parts.push(`You don’t need a new system to get started. Pick the smallest change that would help you ${need}, and try it for a month.`);
      parts.push(`- Write down how you handle it today\n- Pick one change to try for four weeks\n- Review the results with real numbers, not memory`);
      parts.push(`A weekly review is where this pays off. Teams that review weekly save 12 hours a month on admin, and respondents who reviewed their time weekly reported fewer billing disputes [1].`);
    } else {
      parts.push(`Tools help most when they remove a step you’d otherwise skip. ${n} ${diff}, so the decision is based on what actually happened rather than on what you remember on Friday afternoon.`);
      parts.push(`Whatever you use, keep the process light enough that you’ll still follow it when the week gets busy. ${k.charAt(0).toUpperCase() + k.slice(1)} works best when it is part of a weekly routine [2].`);
    }
  });
  return parts.join('\n\n');
});

registerStub('article.destat', (_i, ctx: { bad: { sentence: string }[] }) => ({
  sentences: ctx.bad.map((b, i) => ({ i, text: b.sentence.replace(/(about |around |roughly )?[$€£]?\d[\d,.]*\s?(%|percent|x)?\s?(hours?|minutes?|days?)?/gi, (_m, _a, _b, unit) => (unit ? 'hours' : 'many')).replace(/\bsave hours a month\b/, 'save real time every month') })),
}));

registerStub('article.meta', (_i, ctx: { e: CalendarEntry; profile: Profile; style: string }) => {
  const t = ctx.e.title;
  return {
    seoTitle: t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, '') : t,
    meta: `${t}. A practical guide for ${lc(seg(ctx.profile))}, from ${ctx.profile.business.name}.`.slice(0, 155),
    alt: `${({ branded: 'Branded graphic', illustration: 'Illustration', photography: 'Photograph', infographic: 'Infographic' } as Record<string, string>)[ctx.style] || 'Image'} for “${t}”`,
  };
});

registerStub('article.rewrite', (_i, ctx: { mode: string; text: string; profile: Profile }) => {
  const s = ctx.text.trim(); const sent = s.split(/(?<=[.!?])\s+/);
  if (ctx.mode === 'shorter') { if (sent.length > 1) return { text: sent[0] }; const w = s.split(' '); return { text: w.length > 8 ? w.slice(0, Math.ceil(w.length * 0.6)).join(' ').replace(/[,;:—-]+$/, '') + '.' : s }; }
  if (ctx.mode === 'simpler') return { text: s.replace(/\butili[sz]e\b/gi, 'use').replace(/\bapproximately\b/gi, 'about').replace(/\bin order to\b/gi, 'to').replace(/ — (\w)/, (_m, c) => '. ' + c.toUpperCase()) };
  if (ctx.mode === 'expand') return { text: s.replace(/[.!?]?$/, '.') + ` That’s especially true for ${lc(seg(ctx.profile))}.` };
  return { text: 'Put simply, ' + lc(s) };
});

registerStub('article.videoWhy', (_i, ctx: { top: { title: string; published: string }[]; outline: string[] }) => ({
  why: ctx.top.map((v, i) => i === 0 && ctx.outline[1] ? `Covers the same steps as “${ctx.outline[1]}”` : Date.now() - new Date(v.published).getTime() < 60 * 864e5 ? 'Popular with your audience · recent' : 'Answers a question searchers ask'),
}));
