import { describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => ({ report: vi.fn(async () => ({ delivered: true, reference: 'safe-reference' })) }));
vi.mock('../services/publishing/reportIssue', () => ({ reportPublishingIssue: M.report }));
import { actions } from './publishing';

describe('explicit report action contract', () => {
  const action = actions['publish.reportIssue'];
  it('accepts only an article ID, authorizes Viewer members and retains normal retry authorization', async () => {
    expect(action.role).toBe('Viewer'); expect(action.read).not.toBe(true);
    expect(actions['publish.retry'].role).not.toBe('Viewer'); expect(actions['publish.retry'].read).not.toBe(true);
    const ctx: any = { bid: 'business-1', user: { id: 'member' }, role: 'Viewer' };
    const input = action.input!.parse({ entryId: 'entry-1' });
    expect(await action.run(ctx, input)).toEqual({ delivered: true, reference: 'safe-reference' });
    expect(M.report).toHaveBeenCalledWith(ctx, 'entry-1');
  });
  it.each([{ to: 'attacker@test' }, { subject: 'Forged' }, { diagnostics: 'Forged' }, { user: 'Forged' }, { text: 'Forged' }, { entryId: '' }, { entryId: 'x'.repeat(101) }])('rejects forged report input %j', extra => {
    expect(() => action.input!.parse({ entryId: 'entry-1', ...extra })).toThrow();
  });
});
