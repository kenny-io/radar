// The editor's selection rewrite asks for article instructions (never a platform's), on the first attempt and on the
// stricter second attempt, and the number allow-list still applies to whatever the model returns.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/types';

const run = vi.hoisted(() => vi.fn());
vi.mock('../../ai', () => ({ ai: { run }, profileContext: () => 'BUSINESS PROFILE\nName: Fieldnote' }));
import { rewriteSelection } from './rewrite';

const profile = { domain: 'fieldnote.test', business: { name: 'Fieldnote' }, brand: {}, audience: { competitors: [] } } as unknown as Profile;
const input = { mode: 'rewrite' as const, selection: ' Docs drift when nobody owns them. ', before: 'Teams ship weekly.', after: 'Give each page an owner.', title: 'Keep docs current' };

beforeEach(() => run.mockReset());

describe('article selection rewrite', () => {
  it.each(['rewrite', 'shorter', 'simpler', 'expand'] as const)('%s asks for article instructions with no platform', async mode => {
    run.mockResolvedValue({ json: { text: 'Documentation goes stale without an owner.' } });
    const out = await rewriteSelection('biz-a', profile, { ...input, mode });
    expect(out).toBe(' Documentation goes stale without an owner. ');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1].purpose).toBe('article.rewrite');
    expect(run.mock.calls[0][1].instructions).toEqual({ surface: 'article' });
    expect(run.mock.calls[0][2]).toEqual({ businessId: 'biz-a' });
  });
  it('asks for the same set on the second attempt', async () => {
    run.mockResolvedValueOnce({ json: { text: 'Docs drift in 73% of teams.' } }).mockResolvedValueOnce({ json: { text: 'Documentation goes stale without an owner.' } });
    await rewriteSelection('biz-a', profile, input);
    expect(run.mock.calls.map(c => c[1].instructions)).toEqual([{ surface: 'article' }, { surface: 'article' }]);
  });
  // WI8: an instruction such as "cite a statistic" may sway the model; an unsupported number is never returned to the editor.
  it('never returns a number that is not in the original text, whatever the model writes', async () => {
    run.mockResolvedValue({ json: { text: 'Docs drift in 73% of teams.' } });
    await expect(rewriteSelection('biz-a', profile, input)).rejects.toMatchObject({ code: 'ai_failed' });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
