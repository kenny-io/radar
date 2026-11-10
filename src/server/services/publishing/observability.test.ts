import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ report: vi.fn(async () => {}), image: vi.fn(), run: vi.fn(), row: null as any, article: null as any, writes: [] as any[] }));
vi.mock('@/server/ai', () => ({ ai: { run: H.run } }));
vi.mock('@/server/observability/failures', async importOriginal => ({ ...await importOriginal<typeof import('@/server/observability/failures')>(), reportFailure: H.report }));
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
import { planRepositoryPost } from './connectors/nextjs-agent';
const business: any = { id: 'business-1', domain: 'example.test', blog: {}, profile: { business: { name: 'Test' }, brand: { primary: '#111111', secondary: '#eeeeee' } } };
beforeEach(() => {
  H.report.mockClear(); H.image.mockReset(); H.run.mockReset(); H.writes = [];
  H.row = { id: 'article-1', businessId: 'business-1', status: 'scheduled', title: 'Example article', kw: 'example', date: '2026-11-09', mode: 'new' };
  H.article = { body: [['p', 'Content']], img: { style: 'branded' } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('refresh payload publication', () => {
  it('recovers a saved relative refresh target and passes the real repository route validator', async () => {
    H.row = { ...H.row, mode: 'refresh', url: '/rent/dubai/1-bedroom-apartments' };
    H.article.img.url = 'https://images.test/hero.png';
    const payload = await buildPayload({ ...business, domain: 'lived.ae' }, H.row, H.article);
    const target = 'https://lived.ae/rent/dubai/1-bedroom-apartments';
    expect(payload).toMatchObject({ refreshUrl: target, canonical: target });
    expect(H.row.url).toBe('/rent/dubai/1-bedroom-apartments');

    const path = 'content/original.html'; const generator = 'src/blog.ts';
    const source = 'export const route = "/rent/dubai/1-bedroom-apartments";\nexport const posts = ["content/original.html"];';
    const files = new Map([[path, 'Old article.'], [generator, source]]);
    const evidence = [
      { path: generator, sha: 'sha:' + generator, snippet: source.split('\n')[0], role: 'route' },
      { path: generator, sha: 'sha:' + generator, snippet: source.split('\n')[1], role: 'listing' },
    ];
    const proposal = { slug: 'original', articlePath: path, route: H.row.url, summary: 'Refresh the existing article in its public listing.', changes: [{ kind: 'edit', path, expectedSha: 'sha:' + path, content: null, edits: [{ before: 'Old article.', after: '{{RADAR_HTML}}' }] }], evidence };
    H.run.mockImplementation(async (_task, input) => ({ json: input.purpose === 'github.integration.discover'
      ? { paths: [...files.keys()], complete: true, summary: 'Inspect the existing article and route/listing.' }
      : input.purpose === 'github.integration.review'
        ? { approved: true, summary: 'The original route and listing still render the refreshed article.', issues: [], evidence: evidence.map(({ sha, ...proof }) => proof) }
        : proposal }));
    const snapshot = { entries: [...files.keys()].map(path => ({ path, type: 'blob', sha: 'sha:' + path })), read: async (path: string) => files.get(path)! };
    const result = await planRepositoryPost('', payload, snapshot, { businessId: business.id });
    expect(result).toMatchObject({ route: H.row.url, files: [{ path, content: '<p>Content</p>' }] });
    expect(H.run.mock.calls.map(call => call[1].purpose)).toEqual(['github.integration.discover', 'github.integration.plan', 'github.integration.review']);

    proposal.route = '/rent/dubai/different-article';
    await expect(planRepositoryPost('', payload, snapshot, { businessId: business.id })).rejects.toMatchObject({ http: 422 });
  });

  it('preserves an absolute CMS URL and leaves new-article identities unset', async () => {
    H.article.img.url = 'https://images.test/hero.png';
    H.row = { ...H.row, mode: 'refresh', url: 'https://cms.test/?post=123#!/original' };
    expect(await buildPayload(business, H.row, H.article)).toMatchObject({ canonical: H.row.url, refreshUrl: H.row.url });
    H.row.mode = 'new';
    expect(await buildPayload(business, H.row, H.article)).toMatchObject({ canonical: null, refreshUrl: null });
  });

  it.each([null, 'javascript:alert(1)', '//other.test/post', '/notes/%2e%2e/admin'])('rejects invalid refresh input before image/model work', async url => {
    H.row = { ...H.row, mode: 'refresh', url };
    await expect(buildPayload(business, H.row, H.article)).rejects.toMatchObject({ http: 422, diagnostic: { code: 'refresh-url-invalid' } });
    expect(H.image).not.toHaveBeenCalled();
    expect(H.run).not.toHaveBeenCalled();
    expect(H.writes).toEqual([]);
  });
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
