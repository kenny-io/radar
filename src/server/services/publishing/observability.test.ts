import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ report: vi.fn(async () => {}), image: vi.fn(), row: null as any, article: null as any, writes: [] as any[] }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: H.report }));
vi.mock('@/server/db', async () => {
  const schema = await import('@/server/db/schema');
  const reader = (table: any) => {
    const rows = () => table === schema.calendarEntries ? [H.row] : table === schema.articles ? [{ data: H.article }] : [];
    const q: any = { where: () => q, limit: async () => rows(), orderBy: async () => rows(), then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
    return q;
  };
  const db: any = {
    select: () => ({ from: reader }),
    update: () => ({ set: (value: any) => { H.writes.push(value); return { where: async () => [] }; } }),
    transaction: (fn: any) => fn(db),
  };
  return { db, schema };
});
vi.mock('@/server/workspace', () => ({ getBiz: async () => business, bump: vi.fn(async () => {}), entryFromRow: (row: any) => row, blogOf: () => ({}), connPublic: vi.fn() }));
vi.mock('@/server/services/images', () => ({ renderImage: H.image }));
vi.mock('@/server/services/storage', () => ({ storedKey: vi.fn(), readLocal: vi.fn() }));
vi.mock('@/server/notify', () => ({ notify: vi.fn() }));
vi.mock('@/server/events', () => ({ trackSoon: vi.fn() }));
vi.mock('../autopilot/guard', () => ({ canRun: vi.fn(async () => true) }));
vi.mock('../drafting/guard', () => ({ lockArticle: async () => H.row, assertNoArticleWork: vi.fn() }));
vi.mock('node:fs', () => ({ default: { existsSync: () => false } }));

import { buildPayload, publishEntry } from './publisher';
const business: any = { id: 'business-1', domain: 'example.test', blog: {}, profile: { business: { name: 'Test' }, brand: { primary: '#111111', secondary: '#eeeeee' } } };
beforeEach(() => {
  H.report.mockClear(); H.image.mockReset(); H.writes = [];
  H.row = { id: 'article-1', businessId: 'business-1', status: 'scheduled', title: 'Example article', kw: 'example', date: '2026-11-09', mode: 'new' };
  H.article = { body: [['p', 'Content']], img: { style: 'branded' } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('handled article publication failures', () => {
  it('alerts on a returned terminal publication failure without converting it to a retry', async () => {
    await expect(publishEntry('article-1', { attempt: 1, maxAttempts: 4 })).resolves.toMatchObject({ status: 'failed' });
    expect(H.report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('No blog connection') }), expect.objectContaining({ source: 'publishing', operation: 'publishing.entry', businessId: 'business-1', ref: 'article-1', attempt: 1, retrying: false }));
    expect(H.writes).toContainEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('alerts on a missing hero while preserving the publishable article payload', async () => {
    const failure = new Error('image provider unavailable'); H.image.mockRejectedValue(failure);
    const payload = await buildPayload(business, H.row, H.article);
    expect(payload).toMatchObject({ entryId: 'article-1', image: null, html: '<p>Content</p>' });
    expect(H.report).toHaveBeenCalledWith(failure, { source: 'publishing', operation: 'publishing.heroImage', businessId: 'business-1', ref: 'article-1', degraded: true });
  });
});
