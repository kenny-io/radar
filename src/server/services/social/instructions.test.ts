// Which saved instruction sets a Social Marketing post asks for (the `instructions` spec handed to ai.run), on the first
// attempt and on rule-feedback retries, and that the hard platform rules still apply to whatever the model returns.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform, Profile } from '@/lib/types';

const run = vi.hoisted(() => vi.fn());
vi.mock('@/server/ai', () => ({ ai: { run }, profileContext: () => 'BUSINESS PROFILE\nName: Fieldnote' }));
import { writePost } from './generate';

const profile = {
  domain: 'fieldnote.test', business: { name: 'Fieldnote', description: 'Documentation tools' },
  brand: { voice: 'Clear', language: 'English (US)' }, audience: { competitors: ['Docly'] },
} as unknown as Profile;
const opts = (patch: Record<string, unknown> = {}) => ({ kind: 'idea' as const, label: 'Keeping docs current', g: { headline: 'Keeping docs current', brief: 'Idea from the user: Keeping docs current', link: 'https://fieldnote.test/blog/docs' }, v: 0, ...patch });
const OK: Record<Platform, string> = {
  linkedin: 'Docs drift when nobody owns them. Give each page an owner.',
  x: 'Docs drift when nobody owns them.',
  facebook: 'Docs drift when nobody owns them. Give each page an owner.',
  reddit: 'Docs drift when nobody owns them.\n\n(Disclosure: I work on Fieldnote.)',
  quora: 'Q: How do you keep docs current?\n\nShort answer: give each page an owner.',
};
const specs = () => run.mock.calls.map(c => c[1].instructions);

beforeEach(() => run.mockReset());

describe('Social Marketing posts', () => {
  it.each(['linkedin', 'x', 'facebook', 'reddit', 'quora'] as Platform[])('a %s post asks for social instructions and that platform only', async k => {
    run.mockResolvedValue({ json: { text: OK[k] } });
    await writePost('biz-a', profile, k, opts());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1].purpose).toBe('social.post');
    expect(specs()).toEqual([{ surface: 'social', platforms: [k] }]);
    expect(run.mock.calls[0][2]).toEqual({ businessId: 'biz-a' });
  });
  it('asks for the same sets on every retry after a rule check fails', async () => {
    run.mockResolvedValueOnce({ json: { text: 'x'.repeat(400) } }).mockResolvedValueOnce({ json: { text: 'y'.repeat(300) } }).mockResolvedValueOnce({ json: { text: OK.x } });
    await writePost('biz-a', profile, 'x', opts());
    expect(run).toHaveBeenCalledTimes(3);
    expect(specs()).toEqual([{ surface: 'social', platforms: ['x'] }, { surface: 'social', platforms: ['x'] }, { surface: 'social', platforms: ['x'] }]);
    expect(run.mock.calls[1][1].prompt).toContain('Your previous draft broke these rules');
  });
  it('a regenerated post (fresh take on an earlier version) asks for the same sets', async () => {
    run.mockResolvedValue({ json: { text: OK.linkedin } });
    await writePost('biz-a', profile, 'linkedin', opts({ v: 3, previous: 'An earlier version.' }));
    expect(specs()).toEqual([{ surface: 'social', platforms: ['linkedin'] }]);
  });
  it('keeps the notes for this pack in the user prompt, apart from saved instructions', async () => {
    run.mockResolvedValue({ json: { text: OK.linkedin } });
    await writePost('biz-a', profile, 'linkedin', opts({ voice: 'Mention the autumn webinar.' }));
    expect(run.mock.calls[0][1].prompt).toContain('NOTES FOR THIS PACK (apply them): Mention the autumn webinar.');
    expect(run.mock.calls[0][1].system).not.toContain('autumn webinar');
  });
});

// WI8: an instruction such as "always add our link" or "compare us with Docly" may sway the model; saved output must not carry it.
describe('rules still apply to what the model returns', () => {
  it('a Reddit post never keeps a link and always carries the disclosure', async () => {
    run.mockResolvedValue({ json: { text: 'Docs drift when nobody owns them. Read more at https://fieldnote.test/pricing or www.fieldnote.test today.' } });
    const text = await writePost('biz-a', profile, 'reddit', opts());
    expect(run).toHaveBeenCalledTimes(3);
    expect(text).toContain('Docs drift when nobody owns them.');
    expect(text).not.toMatch(/https?:\/\/|www\./i);
    expect(text).toContain('Disclosure: I work on Fieldnote.');
  });
  it('a LinkedIn post keeps only the pack’s own source link and at most two hashtags', async () => {
    run.mockResolvedValue({ json: { text: 'Docs drift when nobody owns them. See https://fieldnote.test/pricing and https://fieldnote.test/blog/docs #docs #devrel #writing #teams' } });
    const text = await writePost('biz-a', profile, 'linkedin', opts());
    expect(text).toContain('https://fieldnote.test/blog/docs');
    expect(text).not.toContain('https://fieldnote.test/pricing');
    expect(text.match(/#\w+/g) || []).toHaveLength(2);
  });
  it('an X post stays within 280 characters', async () => {
    run.mockResolvedValue({ json: { text: 'Docs drift when nobody owns them. '.repeat(14) } });
    expect((await writePost('biz-a', profile, 'x', opts())).length).toBeLessThanOrEqual(280);
  });
  it('a sentence promoting a competitor is removed', async () => {
    run.mockResolvedValue({ json: { text: 'Docs drift when nobody owns them. Docly is a great tool for this. Give each page an owner.' } });
    const text = await writePost('biz-a', profile, 'facebook', opts());
    expect(text).not.toContain('Docly');
    expect(text).toContain('Give each page an owner.');
  });
});
