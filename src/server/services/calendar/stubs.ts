// DEV-ONLY AI stubs for the calendar pipeline (RADAR_DEV_STUBS=1). Deterministic and grounded in the same facts the real
// prompts receive, so the UI shows realistic titles and relevance lines without API keys.
import { registerStub } from '../../ai/adapters/stub';
import type { EntryType, Profile } from '@/lib/types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const STOP = new Set('a an and are as at be by for from how in is it of on or the to vs what with you your'.split(' '));
const toks = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/(ing|es|s)$/, ''));

export function stubType(kw: string): EntryType {
  if (/\btemplates?\b|\bchecklist\b/.test(kw)) return 'Template';
  if (/\bvs\b|alternative|compar/.test(kw)) return 'Comparison';
  if (/\bbest\b|\btools?\b|\bapps?\b|\bexamples\b|\btips\b/.test(kw)) return 'Listicle';
  if (/^how to\b|\bhow to\b/.test(kw)) return 'How-to';
  if (/^what\b|\bmeaning\b|\bexplained\b|\bcost\b/.test(kw)) return 'Explainer';
  return 'Guide';
}
function stubTitle(kw: string, type: EntryType, seg: string, pageTitle?: string | null): string {
  if (pageTitle) return pageTitle;
  const k = kw.replace(/\b(how to|best|template|guide|tips|examples|checklist)\b/g, '').replace(/\s+/g, ' ').trim() || kw;
  const s = seg.toLowerCase().replace(/\s*\(.*\)/, '');
  const forS = /\bfor\b/.test(k) ? '' : ` for ${s}`;
  switch (type) {
    case 'How-to': return /^how to/.test(kw) ? cap(kw) : `How to get ${k} right`;
    case 'Template': return `${cap(k)} template: a ready-to-use starting point`;
    case 'Comparison': return /\bvs\b/.test(kw) ? `${cap(kw)}: an honest comparison` : `${cap(k)}: options compared${forS}`;
    case 'Listicle': return `The best ${k} options${forS}`;
    case 'Explainer': return `${cap(k)}, explained`;
    default: return `A practical guide to ${k}${forS}`;
  }
}
const AUD_TAIL: Record<EntryType, string> = { 'How-to': 'who need a quick, practical answer', Guide: 'making a pricing or process decision', Comparison: 'evaluating tools or approaches side by side', Listicle: 'shortlisting tools', Explainer: 'learning the vocabulary', Template: 'who need something ready to use today' };
const OUTLINE: Record<EntryType, (k: string) => string[]> = {
  'How-to': k => [`Why ${k} trips people up`, 'A simple process that works', 'Mistakes to avoid'],
  Guide: k => [`What ${k} really involves`, 'How to decide what’s right for you', 'Putting it into practice'],
  Comparison: k => ['What to compare', `The main options for ${k}`, 'Which one fits your work'],
  Listicle: k => ['How we chose', `The options for ${k}`, 'How to pick one'],
  Explainer: k => [`What ${k} means`, 'Why it matters', 'How to apply it'],
  Template: k => [`What a good ${k} includes`, 'The template', 'How to adapt it'],
};

registerStub('calendar.ideas', (_i, ctx: { profile: Profile }) => {
  const p = ctx.profile; const out: string[] = [];
  const seg = (p.audience.segments[0] || 'small business').toLowerCase().replace(/\s*\(.*\)/, '').replace(/s$/, '');
  for (const o of p.business.offerings) { const k = o.toLowerCase(); out.push(`${k} for ${seg}s`, `how does ${k} work`, `${k} tips`); }
  for (const n of p.audience.needs) { const w = n.toLowerCase(); out.push(`how to ${w}`); }
  for (const s of p.audience.segments) out.push(`${s.toLowerCase().replace(/\s*\(.*\)/, '')} pricing guide`);
  return { keywords: out };
});

registerStub('calendar.cluster', (_i, ctx: { cands: { kw: string }[]; profile: Profile }) => {
  const p = ctx.profile;
  const vocab = new Set(toks([p.business.description, p.business.industry, p.business.positioning, ...p.business.offerings, ...p.business.differentiators, ...p.audience.segments, ...p.audience.needs, ...(p.keywords?.list || []).map(k => k.kw)].join(' ')));
  const comp = p.audience.competitors.map(c => c.toLowerCase());
  const offTopic: number[] = []; const groups = new Map<string, number[]>();
  ctx.cands.forEach((c, i) => {
    const t = toks(c.kw);
    if (!t.some(x => vocab.has(x)) || (comp.some(n => c.kw.includes(n)) && !/alternative|\bvs\b/.test(c.kw))) { offTopic.push(i); return; }
    const MOD = new Set(['best', 'tip', 'example', 'guide', 'template', 'checklist', 'cost', 'how', 'work', 'doe']);
    const key = [...new Set(t.filter(x => !MOD.has(x)))].sort().join(' ') + '|' + stubType(c.kw);
    groups.set(key, [...(groups.get(key) || []), i]);
  });
  const duplicates = [...groups.values()].filter(g => g.length > 1).map(g => ({ keep: g[0], drop: g.slice(1) }));
  return { offTopic, duplicates };
});

registerStub('calendar.topics', (_i, ctx: { cands: { kw: string; mode: string; facts: string[]; pageTitle: string | null; measured: any }[]; profile: Profile }) => {
  const segs = ctx.profile.audience.segments.length ? ctx.profile.audience.segments : ['Small business owners'];
  return {
    topics: ctx.cands.map((c, i) => {
      const type = stubType(c.kw); const seg = segs[i % segs.length];
      const f = c.facts[0] || '';
      const relevance = c.mode === 'refresh'
        ? (c.measured && c.measured.pos > 10 ? 'You already rank on page 2 for this. A refresh is the fastest path to page 1.' : 'You already rank for this, but few searchers click. A refresh is the fastest way to earn more of them.')
        : /Search Console/.test(f) ? f.replace('Search Console shows', 'Search Console already shows') + '. A dedicated article can turn that into clicks.'
          : /buyer need/.test(f) ? 'Matches a stated buyer need in your Business Profile.'
            : /priority/.test(f) ? 'Builds directly on one of your priority keywords.'
              : /offerings/.test(f) ? 'Ties to a core offering in your Business Profile.'
                : 'Expands on a target keyword in your Business Profile.';
      return { i, title: stubTitle(c.kw, type, seg, c.pageTitle), type, audience: `${seg} ${AUD_TAIL[type]}`, relevance, outline: OUTLINE[type](c.kw) };
    }),
  };
});
