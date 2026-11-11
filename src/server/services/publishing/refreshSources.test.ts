import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ pages: [] as any[], suggestion: null as any, inserted: [] as any[], run: vi.fn() }));
vi.mock('@/server/db', async () => {
  const schema = await import('@/server/db/schema');
  const db: any = {
    select: () => ({ from: (table: any) => ({ where: () => ({ limit: async () => table === schema.suggestions ? [H.suggestion] : [] }) }) }),
    transaction: async (fn: any) => fn(db),
    insert: (table: any) => ({ values: async (value: any) => { H.inserted.push({ table, value }); } }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  return { db, schema };
});
vi.mock('@/server/workspace', () => ({ getBiz: async () => ({ id: 'business-1', domain: 'business.test', profile: { business: { name: 'Test' }, brand: { language: 'English' }, keywords: { list: [] } } }), bizToday: () => '2026-11-10' }));
vi.mock('@/server/ai', () => ({ ai: { run: H.run, profileContext: () => '' }, profileContext: () => '' }));
vi.mock('@/server/services/gsc/metrics', () => ({ topPages: async () => H.pages, topQueries: async () => [], normKw: (value: string) => value.toLowerCase() }));
vi.mock('@/server/services/keywords/provider', () => ({ estimate: vi.fn(), related: vi.fn(), keywordProviderIssue: () => null }));
import { schema } from '@/server/db';
import { refreshCandidates } from '../calendar/research';
import { acceptSuggestion } from '../gsc/refresh';

const fullUrl = 'https://cms.business.test/?post=123#!/original';
beforeEach(() => {
  H.inserted = []; H.run.mockReset();
  H.pages = [{ path: '/', url: fullUrl, title: 'Original article', pos: 12, impr: 1000, clicks: 1, ctr: 0.001 }];
  H.suggestion = { id: 'suggestion-1', state: 'open', data: { title: 'Refresh “Original article”', page: '/', url: fullUrl, diff: { title: null, meta: null, blocks: [] }, queries: [], measured: null, why: 'Low click-through rate' } };
});

describe('refresh source identity retention', () => {
  it('keeps the complete Search Console URL in calendar refresh candidates', async () => {
    expect(await refreshCandidates('business-1')).toMatchObject([{ mode: 'refresh', url: fullUrl }]);
  });

  it('keeps the complete suggestion URL when creating a refresh calendar entry', async () => {
    H.run.mockResolvedValue({ json: { angle: 'Update the article.', outline: ['Original section'], blocks: [{ type: 'p', text: 'Original section updated.' }] } });
    const result = await acceptSuggestion('business-1', 'suggestion-1');
    expect(H.inserted.find(item => item.table === schema.calendarEntries)?.value).toMatchObject({ id: result.entryId, mode: 'refresh', url: fullUrl });
  });
});
