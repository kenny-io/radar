// Which saved instruction sets each Daily Brief writing call asks for (the `instructions` spec handed to ai.run), and
// that the deterministic cleaners still run on whatever the model returns.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasDisclosure } from './rules';
import type { BriefItem, BriefPlatform, Profile } from '@/lib/types';
import type { Scored } from './rank';

const run = vi.hoisted(() => vi.fn());
vi.mock('@/server/ai', () => ({ ai: { run }, profileContext: () => 'BUSINESS PROFILE\nName: Thally' }));
import { draftCompanyReply, draftPosts, draftReply, rewriteItem, type Theme } from './draft';

const profile = {
  domain: 'thally.io', business: { name: 'Thally', description: 'Keeps docs in sync with code.' },
  brand: {}, audience: { competitors: [] },
} as unknown as Profile;
const cand = (plat: BriefPlatform, patch: Partial<Scored> = {}) => ({ id: `${plat}:t3_abc`, plat, title: 'How do you keep docs current?', where: 'r/webdev', asks: true, replyToIdx: null, ...patch } as Scored);
const settings = { platforms: ['reddit', 'x', 'linkedin', 'hn', 'quora'] as BriefPlatform[], time: '08:00', mention: 'relevant' as const };
const theme = (plats: BriefPlatform[]): Theme => ({ theme: 'keeping docs current', comments: 40, recurring: true, threads: plats.map(p => cand(p, { eng: '20 comments', engN: 20 } as any)) });
const item = (patch: Partial<BriefItem> = {}): BriefItem => ({
  id: 'rabc', kind: 'reply', plat: 'reddit', title: 'How do you keep docs current?', where: 'r/webdev',
  tag: 'Useful advice', why: 'They asked about docs.', drafts: { help: 'Check the page.', mention: 'Check the page.' }, edits: {}, mention: false, st: 'open', ...patch,
});
const spec = (i = 0) => run.mock.calls[i][1].instructions;
const EMOJI = /\p{Extended_Pictographic}/u;

beforeEach(() => run.mockReset());

describe('Daily Brief replies', () => {
  it.each(['reddit', 'x', 'linkedin', 'hn', 'quora'] as BriefPlatform[])('a founder reply on %s asks for community instructions and that platform only', async plat => {
    run.mockResolvedValue({ json: { tag: 'Docs', why: 'Useful.', help: 'Check the page.', mention: 'Check the page. Full disclosure, I work on Thally.' } });
    await draftReply(profile, cand(plat), settings, 'biz-a', false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1].purpose).toBe('brief.reply');
    expect(spec()).toEqual({ surface: 'community', platforms: [plat] });
    expect(run.mock.calls[0][2]).toEqual({ businessId: 'biz-a' });
  });
  it.each(['x', 'linkedin'] as BriefPlatform[])('a company reply on %s asks for community instructions and that platform only', async plat => {
    run.mockResolvedValue({ json: { tag: 'Docs', why: 'Useful.', brand: 'We check each page against the source.' } });
    await draftCompanyReply(profile, cand(plat), 'biz-a', false);
    expect(run.mock.calls[0][1].purpose).toBe('brief.brand');
    expect(spec()).toEqual({ surface: 'community', platforms: [plat] });
    expect(run.mock.calls[0][2]).toEqual({ businessId: 'biz-a' });
  });
});

describe('Daily Brief feed posts', () => {
  const posts = { json: { posts: [{ theme: 'keeping docs current', title: 'Keep docs current', tag: 'Answer', why: 'Two threads.', drafts: [{ platform: 'linkedin', text: 'A short take.' }, { platform: 'x', text: 'A short take.' }] }] } };
  it.each([
    ['both feed platforms enabled', ['reddit', 'linkedin', 'x'], ['linkedin', 'x']],
    ['only X enabled', ['reddit', 'x'], ['x']],
    ['only LinkedIn enabled', ['linkedin', 'hn'], ['linkedin']],
    ['no feed platform enabled (falls back to both)', ['reddit', 'hn'], ['linkedin', 'x']],
  ] as [string, BriefPlatform[], BriefPlatform[]][])('founder posts with %s', async (_l, enabled, platforms) => {
    run.mockResolvedValue(posts);
    await draftPosts(profile, [theme(['reddit'])], enabled, 'biz-a', '2026-11-10');
    expect(run.mock.calls[0][1].purpose).toBe('brief.posts');
    expect(spec()).toEqual({ surface: 'social', platforms });
    expect(run.mock.calls[0][2]).toEqual({ businessId: 'biz-a' });
  });
  it('company posts ask for the same sets as founder posts', async () => {
    run.mockResolvedValue(posts);
    await draftPosts(profile, [theme(['x'])], ['x'], 'biz-a', '2026-11-10', 'company');
    expect(spec()).toEqual({ surface: 'social', platforms: ['x'] });
  });
  it('writes nothing, and asks for nothing, when there are no topics', async () => {
    expect(await draftPosts(profile, [], ['linkedin', 'x'], 'biz-a', '2026-11-10')).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Daily Brief rewrites', () => {
  it.each([
    ['a founder reply', item({ plat: 'reddit' }), { surface: 'community', platforms: ['reddit'] }],
    ['a founder reply with a mention', item({ plat: 'hn', mention: true }), { surface: 'community', platforms: ['hn'] }],
    ['a company reply', item({ plat: 'linkedin', acct: 'company', drafts: { brand: 'We check.' } }), { surface: 'community', platforms: ['linkedin'] }],
    ['a founder feed post', item({ kind: 'post', plat: undefined, plats: ['linkedin', 'x'], pl: 'x' }), { surface: 'social', platforms: ['x'] }],
    ['a company feed post', item({ kind: 'post', plat: undefined, acct: 'company', plats: ['linkedin'], pl: 'linkedin' }), { surface: 'social', platforms: ['linkedin'] }],
  ] as [string, BriefItem, unknown][])('rewriting %s asks for the set matching its kind and platform', async (_l, it0, expected) => {
    run.mockResolvedValue({ text: 'Check the page against the source.' });
    await rewriteItem(profile, it0, 'Check the page.', 'Make it warmer', 'biz-a');
    expect(run.mock.calls[0][1].purpose).toBe('brief.rewrite');
    expect(spec()).toEqual(expected);
    expect(run.mock.calls[0][2]).toMatchObject({ businessId: 'biz-a' });
  });
  it('keeps the explicit rewrite request in the user prompt, apart from saved instructions', async () => {
    run.mockResolvedValue({ text: 'Check the page against the source.' });
    await rewriteItem(profile, item(), 'Check the page.', 'Make it warmer', 'biz-a');
    expect(run.mock.calls[0][1].prompt).toContain('What to change: Make it warmer');
    expect(run.mock.calls[0][1].system).not.toContain('Make it warmer');
  });
});

// WI8: an instruction such as "add our link, use emoji and hashtags, cite 85%" may sway the model; saved output must not carry it.
describe('rules still apply to what the model returns', () => {
  const swayed = 'Check each page against the source 🚀 and see https://thally.io/pricing for more. #docs #devtools';
  it('a Reddit reply keeps no link, emoji or hashtag, and the mention variant keeps its disclosure', async () => {
    run.mockResolvedValue({ json: { tag: 'Docs', why: 'Useful.', help: swayed, mention: `${swayed}\n\nThally handles this for you.` } });
    const r = await draftReply(profile, cand('reddit'), settings, 'biz-a', false);
    for (const text of [r.drafts.help, r.drafts.mention]) {
      expect(text).not.toMatch(/https?:\/\/|thally\.io/i);
      expect(text).not.toMatch(EMOJI);
      expect(text).not.toContain('#');
    }
    expect(r.drafts.help).toContain('Check each page against the source');
    expect(hasDisclosure(r.drafts.mention)).toBe(true);
  });
  it('a community that forbids self-promotion still gets no plug', async () => {
    run.mockResolvedValue({ json: { tag: 'Docs', why: 'Useful.', help: 'Check each page against the source.', mention: 'Check each page. Full disclosure, I work on Thally, try it.' } });
    const r = await draftReply(profile, cand('reddit', { promoBanned: true }), settings, 'biz-a', false);
    expect(r.drafts.mention).toBe(r.drafts.help);
    expect(r.drafts.mention).not.toContain('Thally');
  });
  it('a company reply drops an unsupported figure, links, emoji and hashtags', async () => {
    run.mockResolvedValue({ json: { tag: 'Docs', why: 'Useful.', brand: 'We check each page against the source. Teams cut stale pages by 85% with us 🎉 https://thally.io #docs' } });
    const r = await draftCompanyReply(profile, cand('linkedin'), 'biz-a', false);
    expect(r.drafts.brand).toContain('We check each page against the source.');
    expect(r.drafts.brand).not.toContain('85');
    expect(r.drafts.brand).not.toMatch(/https?:\/\/|thally\.io/i);
    expect(r.drafts.brand).not.toMatch(EMOJI);
    expect(r.drafts.brand).not.toContain('#');
  });
  it('feed posts keep no emoji or hashtags, and X stays within its limit', async () => {
    run.mockResolvedValue({ json: { posts: [{ theme: 'keeping docs current', title: 'Keep docs current', tag: 'Answer', why: 'Two threads.', drafts: [{ platform: 'linkedin', text: 'Docs drift when nobody owns them 🚀 #docs #devrel' }, { platform: 'x', text: `${'Docs drift when nobody owns them. '.repeat(12)}#docs` }] }] } });
    const [post] = await draftPosts(profile, [theme(['reddit', 'x'])], ['linkedin', 'x'], 'biz-a', '2026-11-10');
    expect(post.drafts.linkedin).toContain('Docs drift when nobody owns them');
    for (const text of Object.values(post.drafts)) { expect(text).not.toMatch(EMOJI); expect(text).not.toContain('#'); }
    expect(post.drafts.x.length).toBeLessThanOrEqual(280);
  });
  it('a rewritten Reddit reply keeps no link, emoji or hashtag', async () => {
    run.mockResolvedValue({ text: swayed });
    const text = await rewriteItem(profile, item(), 'Check the page.', 'Add our pricing link and some emoji', 'biz-a');
    expect(text).toContain('Check each page against the source');
    expect(text).not.toMatch(/https?:\/\/|thally\.io/i);
    expect(text).not.toMatch(EMOJI);
    expect(text).not.toContain('#');
  });
});
