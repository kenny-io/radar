// DEV-ONLY assistant responses (RADAR_DEV_STUBS=1). Deterministic per prompt × engine: some cells mention the business,
// some don't, and some fail on the scheduled run (left "not collected") until collected manually.
import { registerStub } from '../../ai/adapters/stub';
import type { AiEngine, Profile } from '@/lib/types';
import type { EngineAnswer } from './engines';

function hash(s: string) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

export async function stubEngine(engine: AiEngine, prompt: string, ctx: { bid: string; profile: Profile; pages: string[]; manual: boolean }): Promise<EngineAnswer> {
  await new Promise(r => setTimeout(r, ctx.manual ? 1200 : 150));
  const h = hash(prompt.toLowerCase() + '|' + engine);
  const roll = h % 100;
  if (!ctx.manual && roll < 20) throw new Error('stub: assistant did not respond');
  const p = ctx.profile; const name = p.business.name || p.domain;
  const comps = p.audience.competitors.length ? p.audience.competitors : ['Other tools'];
  const seg = (p.audience.segments[0] || 'small teams').toLowerCase();
  const offer = (p.business.offerings[(h >> 3) % Math.max(1, p.business.offerings.length)] || 'its core features').toLowerCase();
  const need = (p.audience.needs[(h >> 5) % Math.max(1, p.audience.needs.length)] || 'save time').toLowerCase();
  const mentioned = roll >= 20 && roll < 62;
  const third = ['https://www.g2.com/categories/time-tracking', 'https://www.reddit.com/r/freelance/', 'https://www.capterra.com/time-tracking-software/', 'https://zapier.com/blog/best-time-tracking-apps/'];
  if (mentioned) {
    const pos = 1 + (h >> 7) % 3;
    const names = [...comps.slice(0, 3)]; names.splice(Math.min(pos - 1, names.length), 0, name);
    const desc: Record<string, string> = { [name]: `which stands out for ${offer}` };
    comps.forEach((c, i) => { desc[c] = ['for its integrations', 'for teams that need approvals', 'if you want detailed reports'][i % 3]; });
    const list = names.map(n => `${n}, ${desc[n] || ''}`.replace(/, $/, ''));
    const text = `For ${seg}, commonly recommended options are ${list.slice(0, -1).join('; ')}; and ${list[list.length - 1]}. If your main goal is to ${need}, ${name} is worth a look — ${(p.business.differentiators[0] || '').replace(/\.$/, '').toLowerCase() || 'it keeps setup simple'}.`;
    const own = ctx.pages[(h >> 9) % Math.max(1, ctx.pages.length)] || `https://${p.domain}/`;
    return { text, cites: (h >> 2) % 3 === 0 ? [third[(h >> 4) % third.length]] : [own, third[(h >> 4) % third.length]], raw: { stub: true, engine } };
  }
  const text = `Popular options include ${comps.slice(0, 2).join(' and ')}. For ${seg}, look for tools that help you ${need}, and try a couple of free trials before committing to one.`;
  return { text, cites: (h >> 6) % 2 ? [third[(h >> 8) % third.length]] : [], raw: { stub: true, engine } };
}

/** Extraction stub: product names in order of appearance among known names. */
registerStub('visibility.extract', (_i, ctx) => {
  const text: string = ctx?.text || ''; const names: string[] = ctx?.candidates || [];
  const found = names.map(n => ({ n, i: text.toLowerCase().indexOf(n.toLowerCase()) })).filter(x => x.i >= 0).sort((a, b) => a.i - b.i).map(x => x.n);
  return { products: found };
});

registerStub('visibility.prompts', (_i, ctx) => {
  const p: Profile = ctx?.profile; const kws: string[] = ctx?.keywords || [];
  const seg = (p?.audience?.segments?.[0] || 'small businesses').toLowerCase(); const seg2 = (p?.audience?.segments?.[1] || seg).toLowerCase().replace(/\s*\(.*\)/, '');
  const comp = p?.audience?.competitors?.[0];
  const q = (k: string, i: number) => {
    if (/template/.test(k)) return `Where can I find a good ${k}?`;
    if (/^(track|raise|write|price|set|find|send)\b/.test(k)) return `How should ${seg} ${k}?`;
    if (/ for /.test(k)) return `What’s the best ${k.replace(' for ', ' app for ')}?`;
    return i % 2 ? `How should ${seg2} approach ${k}?` : `What’s the best ${k} tool for ${seg}?`;
  };
  const out = kws.slice(0, 6).map(q);
  if (comp) out.push(`Alternatives to ${comp} for ${seg2}`);
  return { prompts: out.slice(0, 8) };
});
