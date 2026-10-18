// DEV-ONLY deterministic sources (RADAR_DEV_STUBS=1): realistic threads per platform built from the Business Profile.
// No network. Includes threads the ranker must reject (hostile, off-topic, competitor-owned, rule-violating), a third
// strong Reddit thread (to prove the 2-per-platform cap) and one fresh X ask that only appears on "Scan again".
// BRIEF_STUB_FAIL=x (comma list of platforms) makes that platform's source fail, to verify the failure UI.
import type { BriefPlatform, Profile } from '@/lib/types';
import { lcf } from '@/lib/format';
import { engLabel, type Candidate } from '../plan';
import { SourceError, type Source } from './types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function rng(seed: string) { let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
const singular = (s: string) => lcf(s).replace(/\s*\(.*?\)\s*/g, ' ').trim().replace(/ies$/, 'y').replace(/s$/, '');

type T = Omit<Candidate, 'postedAt' | 'eng' | 'plat'> & { age: number; late?: boolean };

export function stubThreads(p: Profile, plat: BriefPlatform, subs: string[]): T[] {
  const name = p.business.name;
  const needs = p.audience.needs.length ? p.audience.needs.map(lcf) : ['grow the business', 'spend less time on admin'];
  const need = (i: number) => needs[i % needs.length];
  const kws = p.keywords.list.filter(k => k.priority).map(k => k.kw);
  const kw = (i: number) => kws[i % Math.max(1, kws.length)] || lcf(p.business.offerings[0] || p.business.industry || 'tools');
  const comp = (i: number) => p.audience.competitors[i % Math.max(1, p.audience.competitors.length)] || 'the big incumbent';
  const seg = (i: number) => singular(p.audience.segments[i % Math.max(1, p.audience.segments.length)] || 'small business owner');
  const buyer = (i: number) => singular(p.audience.buyers[i % Math.max(1, p.audience.buyers.length)] || 'founder');
  const sub = (i: number) => subs[i % Math.max(1, subs.length)] || 'smallbusiness';
  if (plat === 'reddit') return [
    { id: `reddit:t3_${'a1'}`, where: 'r/' + sub(0), who: 'u/inkandoat', url: `https://www.reddit.com/r/${sub(0)}/comments/1g7a1x/`, age: 3, engN: 214, community: sub(0), promoBanned: false,
      title: `How do you ${need(0)} without it taking over your day?`,
      body: `I’ve tried ${comp(0)}, ${comp(1)} and a spreadsheet. Every system ends the same way: I keep it up for two weeks, then spend Friday rebuilding the week from memory and Slack. There has to be a better way.` },
    { id: 'reddit:t3_b2', where: 'r/' + sub(1), who: 'u/kestrel_draws', url: `https://www.reddit.com/r/${sub(1)}/comments/1g7b2k/`, age: 7, engN: 89, community: sub(1), promoBanned: true,
      title: `Client wants “just one more round” for the fourth time. How do you handle this?`, body: '',
      comments: [{ who: 'u/kestrel_draws', text: `I never know whether to push back, because honestly I don’t know how many billable hours I’ve already put into the project.` }, { who: 'u/plainpixel', text: 'Charge for it. Always.' }] },
    { id: 'reddit:t3_c3', where: 'r/' + sub(2), who: 'u/northfork_ops', url: `https://www.reddit.com/r/${sub(2)}/comments/1g7c3m/`, age: 30, engN: 23, community: sub(2), promoBanned: false,
      title: `Is ${kw(0)} worth setting up for a team of three?`, body: `We’re three people and everything lives in our heads. Is it worth the setup or is that overkill at our size?` },
    { id: 'reddit:t3_d4', where: 'r/' + sub(0), who: 'u/AutoModerator', url: `https://www.reddit.com/r/${sub(0)}/comments/1g7d4p/`, age: 11, engN: 340, community: sub(0), promoBanned: true,
      title: 'Weekly self-promotion thread: share what you’re building', body: 'Post your product, portfolio or service here. Self-promotion outside this thread will be removed.' },
    { id: 'reddit:t3_e5', where: 'r/' + sub(2), who: 'u/latte_and_lines', url: `https://www.reddit.com/r/${sub(2)}/comments/1g7e5q/`, age: 5, engN: 61, community: sub(2), promoBanned: false,
      title: 'What laptop are you all using in 2026?', body: 'Mine is six years old and the battery is gone. Mac or Windows?' },
  ];
  if (plat === 'x') return [
    { id: 'x:1849201', where: '@maradraws', who: '@maradraws', url: 'https://x.com/maradraws/status/1849201', age: 1, engN: 38,
      title: `Unpopular opinion: most advice on how to ${need(1)} is written by people who’ve never had to do it on a Friday night.`, body: '' },
    { id: 'x:1849202', where: '@grumpyfreelance', who: '@grumpyfreelance', url: 'https://x.com/grumpyfreelance/status/1849202', age: 4, engN: 12,
      title: `${comp(0)} support is a joke. Never again, absolute garbage.`, body: '' },
    { id: 'x:1849203', where: '@twopersonstudio', who: '@twopersonstudio', url: 'https://x.com/twopersonstudio/status/1849203', age: 0.33, engN: 12, late: true,
      title: `Any ${kw(0)} tool that actually works for a two-person team? What we use now isn’t working.`, body: '' },
  ];
  if (plat === 'linkedin') return [
    { id: 'linkedin:p1', where: `Priya Raman · ${cap(buyer(0))}, Northbound`, who: 'Priya Raman', url: 'https://www.linkedin.com/posts/priya-raman_activity-7251', age: 5, engN: 64,
      title: `We hit nine people this year and our process to ${need(0)} is a mess.`,
      body: `Half the team does it daily, half does it on Friday from memory. How do other ${buyer(0)}s handle this without becoming the police?` },
    { id: 'linkedin:p2', where: `Dana Whitfield · Independent ${seg(0)}`, who: 'Dana Whitfield', url: 'https://www.linkedin.com/posts/dana-whitfield_activity-7252', age: 2, engN: 41,
      title: `Six years in, and I still haven’t figured out how to ${need(1)}.`,
      body: `It isn’t the money conversation. It’s the hour I spend digging through my calendar and email to work out what I actually did.` },
    { id: 'linkedin:p3', where: `${comp(1)} · Company page`, who: comp(1), url: 'https://www.linkedin.com/posts/company_activity-7253', age: 6, engN: 18,
      title: `Introducing ${comp(1)} 4.0: the fastest way to ${need(0)}.`, body: '' },
  ];
  if (plat === 'hn') return [
    { id: 'hn:41800101', where: 'Ask HN', who: 'throwaway_pm', url: 'https://news.ycombinator.com/item?id=41800101', age: 9, engN: 156,
      title: `Ask HN: ${cap(seg(0))}s, what’s your stack to ${need(0)} in 2026?`,
      body: `Mostly curious how people get from the work itself to “${need(0)}” without three tools and a spreadsheet in between.` },
    { id: 'hn:41800102', where: 'Show HN', who: 'tmux_fan', url: 'https://news.ycombinator.com/item?id=41800102', age: 20, engN: 40,
      title: `Show HN: I built a tiny CLI for ${kw(0)}`, body: '' },
  ];
  return [
    { id: 'quora:q1', where: 'Quora', who: 'Marta Ellison', url: 'https://www.quora.com/What-is-the-best-way-to-' + need(0).replace(/\W+/g, '-'), age: 14, engN: 9,
      title: `What is the best way to ${need(0)} as a ${seg(0)}?`, body: '' },
    { id: 'quora:q2', where: 'Quora', who: 'Kenji Mori', url: 'https://www.quora.com/Is-' + kw(1).replace(/\W+/g, '-') + '-worth-it', age: 26, engN: 4,
      title: `Is ${kw(1)} worth it for a small team?`, body: '' },
  ];
  function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
}

export const stubSource = (plat: BriefPlatform): Source => async (ctx) => {
  const r = rng(ctx.bid + plat + new Date().toISOString().slice(0, 10));
  const fail = (process.env.BRIEF_STUB_FAIL || '').split(',').map(s => s.trim()).includes(plat);
  // Read for ~1.1s like a real source, reporting threads as they come in.
  const ticks = fail ? 8 : 12;
  for (let i = 0; i < ticks; i++) { await sleep(90); ctx.onRead(37 + Math.floor(r() * 40)); }
  if (fail) throw new SourceError(`${plat} (stub) failed on purpose (BRIEF_STUB_FAIL)`);
  const now = Date.now();
  return stubThreads(ctx.profile, plat, ctx.plan.subreddits)
    .filter(t => !t.late || ctx.mode === 'again')
    .map(({ age, late: _late, ...t }) => ({
      ...t, plat, postedAt: new Date(now - age * 3600e3).toISOString(),
      eng: t.engN ? engLabel(t.engN, plat === 'x' ? 'replies' : plat === 'quora' ? 'answers' : 'comments') : '',
    }));
};
