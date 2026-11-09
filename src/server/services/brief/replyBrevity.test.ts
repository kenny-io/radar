import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanBrand, cleanPost, cleanReply, hasDisclosure, namesBusiness } from './rules';
import type { BriefItem, BriefPlatform, Profile } from '@/lib/types';
import type { Scored } from './rank';

const run = vi.hoisted(() => vi.fn());
vi.mock('@/server/ai', () => ({ ai: { run }, profileContext: () => 'Thally keeps docs current.' }));
import { draftCompanyReply, draftReply, plugOrFallback, rewriteItem, TONE_SAMPLE } from './draft';

const ctx = { plat: 'reddit' as const, name: 'Thally', domain: 'thally.io' };
const advice = 'Check the current page against the source and give the mismatch an owner.';
const longParagraph = Array.from({ length: 8 }, () => advice).join(' ');
const longReply = Array.from({ length: 6 }, () => longParagraph).join('\n\n');
const plug = 'Full disclosure, I work on Thally. It connects changes to the docs they affect.';
const paragraphs = (text: string) => text.trim().split(/\n\s*\n/);
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const expectConcise = (text: string) => {
  expect(text.trim().length).toBeGreaterThan(0);
  expect(paragraphs(text).length).toBeLessThanOrEqual(3);
  expect(wordCount(text)).toBeLessThanOrEqual(150);
  for (const paragraph of paragraphs(text)) expect(wordCount(paragraph)).toBeLessThanOrEqual(50);
};
const expectMention = (text: string) => {
  expectConcise(text);
  expect(namesBusiness(text, ctx.name)).toBe(true);
  expect(hasDisclosure(text)).toBe(true);
};

const profile = {
  domain: 'thally.io', business: { name: 'Thally', description: 'Keeps docs in sync with code.' },
  brand: {}, audience: { competitors: [] },
} as unknown as Profile;
const candidate = {
  id: 'reddit:t3_abc', plat: 'reddit', title: 'How do you keep docs current?', where: 'r/webdev',
  asks: true, replyToIdx: null,
} as Scored;
const item = (patch: Partial<BriefItem> = {}): BriefItem => ({
  id: 'rabc', kind: 'reply', plat: 'reddit', title: candidate.title, where: candidate.where,
  tag: 'Useful advice', why: 'They asked about docs.', drafts: { help: advice, mention: plug }, edits: {}, mention: false, st: 'open', ...patch,
});

beforeEach(() => run.mockReset());

describe('generated reply brevity', () => {
  it('leaves a short, compliant reply unchanged rather than padding it', () => {
    const text = `${advice}\n\nStart with the pages people use most.`;
    expect(cleanReply(text, 'help', ctx)).toBe(text);
  });
  it('caps oversized help at three short paragraphs and keeps useful complete sentences', () => {
    const text = cleanReply(longReply, 'help', ctx);
    expectConcise(text);
    expect(text.startsWith(advice)).toBe(true);
    expect(text.endsWith('.')).toBe(true);
  });
  it('shortens a single overlong paragraph at sentence boundaries', () => expectConcise(cleanReply(longParagraph, 'help', ctx)));
  it('keeps a disclosure in the sixth paragraph and useful advice before it', () => {
    const text = cleanReply(`${longReply}\n\n${plug}`, 'mention', ctx);
    expectMention(text);
    expect(text.startsWith(advice)).toBe(true);
    expect(paragraphs(text).at(-1)).toContain('I work on Thally');
  });
  it('keeps a product relationship at the end of one long paragraph', () => expectMention(cleanReply(`${longParagraph} ${plug}`, 'mention', ctx)));
  it('adds a missing disclosure inside the same limits', () => expectMention(cleanReply(longReply, 'mention', ctx)));
  it('restores a disclosure truncated from an unusually long product sentence', () => {
    const text = cleanReply(`${advice}\n\n${'Thally checks the docs and '.repeat(30)}I work on Thally.`, 'mention', ctx);
    expectMention(text);
  });
  it('keeps generated fallback plugs within the same limit', () => expectMention(plugOrFallback('', cleanReply(longReply, 'help', ctx), profile, 'reddit')));
  it.each(['linkedin', 'hn', 'quora'] as BriefPlatform[])('applies the cap to %s community replies too', plat => expectConcise(cleanReply(longReply, 'help', { ...ctx, plat })));
  it('caps company replies while keeping existing unsupported-figure cleanup', () => {
    const text = cleanBrand(`We improved results by 85%. ${longReply}`, ctx, '');
    expectConcise(text);
    expect(text).not.toContain('85%');
  });
  it('does not apply the reply cap to feed posts', () => expect(paragraphs(cleanPost(longReply, 'linkedin')).length).toBe(6));
  it('retains X character limits and mention disclosure after shortening', () => {
    const text = cleanReply(`${longReply}\n\n${plug}`, 'mention', { ...ctx, plat: 'x' });
    expect(text.length).toBeLessThanOrEqual(280);
    expectMention(text);
    expect(cleanBrand(longReply, { ...ctx, plat: 'x' }, '').length).toBeLessThanOrEqual(280);
  });
  it('uses a concise tone sample', () => expectConcise(TONE_SAMPLE));
});

describe('generation and rewrite integration', () => {
  it('bounds both founder variants after a verbose model response', async () => {
    run.mockResolvedValue({ json: { tag: 'Docs', why: 'Useful advice.', help: longReply, mention: `${longReply}\n\n${plug}` } });
    const result = await draftReply(profile, candidate, { platforms: ['reddit'], time: '08:00', mention: 'relevant' }, 'local-test', false);
    expectConcise(result.drafts.help);
    expectMention(result.drafts.mention);
    expect(run.mock.calls[0][1].system).toContain('Never exceed three paragraphs or 150 words');
  });
  it('keeps help and mention identical where promotion is banned', async () => {
    run.mockResolvedValue({ json: { tag: 'Docs', why: 'Useful advice.', help: longReply, mention: plug } });
    const result = await draftReply(profile, { ...candidate, promoBanned: true }, { platforms: ['reddit'], time: '08:00', mention: 'relevant' }, 'local-test', false);
    expectConcise(result.drafts.help);
    expect(result.drafts.mention).toBe(result.drafts.help);
    expect(result.noMention).toBe(true);
  });
  it('bounds a generated company reply', async () => {
    run.mockResolvedValue({ json: { tag: 'Docs', why: 'Useful advice.', brand: longReply } });
    const result = await draftCompanyReply(profile, { ...candidate, plat: 'linkedin' }, 'local-test', false);
    expectConcise(result.drafts.brand);
    expect(run.mock.calls[0][1].system).toContain('Never exceed three paragraphs or 150 words');
  });
  it.each([{ mention: false }, { mention: true }, { acct: 'company' as const }])('bounds an AI rewrite for %j', async patch => {
    run.mockResolvedValue({ text: `${longReply}\n\n${plug}` });
    const result = await rewriteItem(profile, item(patch), advice, 'Make it more detailed', 'local-test');
    expectConcise(result);
    if (patch.mention) expectMention(result);
    expect(run.mock.calls[0][1].system).toContain('Never exceed three paragraphs or 150 words');
  });
  it('leaves user-provided source text intact and feed rewrites outside the reply cap', async () => {
    run.mockResolvedValue({ text: longReply });
    const original = item({ edits: { help: longReply } });
    const result = await rewriteItem(profile, { ...original, kind: 'post', pl: 'linkedin' }, longReply, 'Keep this detail', 'local-test');
    expect(paragraphs(result).length).toBe(6);
    expect(original.edits.help).toBe(longReply);
    expect(run.mock.calls[0][1].system).not.toContain('Never exceed three paragraphs or 150 words');
  });
});
