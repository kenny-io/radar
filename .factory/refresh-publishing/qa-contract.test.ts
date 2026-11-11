import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ ai: vi.fn(), image: vi.fn(), dbUpdate: vi.fn(), connector: vi.fn() }));
vi.mock('@/server/ai', () => ({ ai: { run: H.ai } }));
vi.mock('@/server/db', () => ({ db: { update: H.dbUpdate }, schema: {} }));
vi.mock('@/server/workspace', () => ({ bump: vi.fn(), blogOf: vi.fn(), connPublic: vi.fn(), entryFromRow: vi.fn(), getBiz: vi.fn(), laterV: vi.fn() }));
vi.mock('@/server/services/images', () => ({ renderImage: H.image }));
vi.mock('@/server/services/storage', () => ({ storedKey: vi.fn(), readLocal: vi.fn() }));
vi.mock('@/server/notify', () => ({ notify: vi.fn() }));
vi.mock('@/server/events', () => ({ trackSoon: vi.fn() }));
vi.mock('@/server/services/autopilot/guard', () => ({ canRun: vi.fn() }));
vi.mock('@/server/services/drafting/guard', () => ({ lockArticle: vi.fn(), assertNoArticleWork: vi.fn() }));
vi.mock('@/server/services/publishing/connectors', () => ({ connectorFor: H.connector }));
vi.mock('node:fs', () => ({ default: { existsSync: () => false } }));
import { buildPayload } from '../../src/server/services/publishing/publisher';
import { planRepositoryPost, type RepoSnapshot } from '../../src/server/services/publishing/connectors/nextjs-agent';

const business: any = { id: 'qa-business', domain: 'business.example', profile: { business: { name: 'QA' }, brand: { primary: '#111111', secondary: '#eeeeee' } } };
const article: any = { body: [['p', 'Complete unchanged original body.']], img: { url: 'https://images.example/hero.png' }, seo: { slug: 'original' } };
const entry = (url: string | null, mode: 'refresh' | 'new' = 'refresh'): any => ({ id: 'qa-refresh', businessId: business.id, title: 'Original article', kw: 'original', date: '2026-11-10', mode, url });
const SOURCE = 'export const route = "/journal/original";\nexport const listing = ["content/original.html"];';
const ARTICLE_PATH = 'content/original.html';
const sourcePath = 'site/routes.js';
const snapshot: RepoSnapshot = { entries: [sourcePath, ARTICLE_PATH].map(path => ({ path, type: 'blob', sha: 'sha:' + path })), read: async path => path === sourcePath ? SOURCE : 'Previous article body.' };
const proofs = () => [
  { path: sourcePath, sha: 'sha:' + sourcePath, snippet: 'export const route = "/journal/original";', role: 'route' },
  { path: sourcePath, sha: 'sha:' + sourcePath, snippet: 'export const listing = ["content/original.html"];', role: 'listing' },
];
function model(route: string) {
  H.ai.mockImplementation(async (_task: unknown, input: any) => ({ json: input.purpose === 'github.integration.discover' ? { paths: [sourcePath, ARTICLE_PATH], complete: true, summary: 'Read existing route, listing and article.' } : input.purpose === 'github.integration.review' ? { approved: true, summary: 'Source route and listing remain intact.', issues: [], evidence: proofs().map(({ sha: _sha, ...proof }) => proof) } : { slug: 'original', articlePath: ARTICLE_PATH, route, summary: 'Refresh the existing article body.', changes: [{ kind: 'edit', path: ARTICLE_PATH, expectedSha: 'sha:' + ARTICLE_PATH, content: null, edits: [{ before: 'Previous article body.', after: '{{RADAR_HTML}}' }] }], evidence: proofs() } }));
}
beforeEach(() => { H.ai.mockReset(); H.image.mockReset(); H.dbUpdate.mockReset(); H.connector.mockReset(); });

describe('independent refresh acceptance checks', () => {
  it.each([
    ['/journal/original', 'business.example', 'https://business.example/journal/original'],
    ['/journal/original?post=123&view=full#/section/original', 'business.example', 'https://business.example/journal/original?post=123&view=full#/section/original'],
    ['/journal/original', 'http://business.example/site-base', 'http://business.example/journal/original'],
    ['https://cms.example/journal/original?post=123#/section/original', 'business.example', 'https://cms.example/journal/original?post=123#/section/original'],
  ])('retains original identity for %s', async (url, domain, expected) => {
    const input = entry(url); const before = JSON.stringify(input);
    const payload = await buildPayload({ ...business, domain }, input, article);
    expect(payload.canonical).toBe(expected); expect(payload.refreshUrl).toBe(expected);
    expect(payload.html).toBe('<p>Complete unchanged original body.</p>');
    expect(JSON.stringify(input)).toBe(before);
  });
  it('passes a normalized saved refresh through the real repository validator', async () => {
    model('/journal/original');
    const payload = await buildPayload(business, entry('/journal/original'), article);
    const plan = await planRepositoryPost('', payload, snapshot, { businessId: business.id });
    expect(plan.route).toBe('/journal/original'); expect(plan.files).toEqual([{ path: ARTICLE_PATH, content: payload.html }]);
    expect(H.ai.mock.calls.map(call => call[1].purpose)).toEqual(['github.integration.discover', 'github.integration.plan', 'github.integration.review']);
  });
  it.each([
    ['/journal/original', '/journal/changed'],
    ['/journal/original?post=123', '/journal/original?post=456'],
    ['/journal/original#/section/original', '/journal/original#/section/changed'],
  ])('continues rejecting a changed refresh identity from %s to %s', async (original, proposed) => {
    model(proposed);
    const payload = await buildPayload(business, entry(original), article);
    await expect(planRepositoryPost('', payload, snapshot, { businessId: business.id })).rejects.toMatchObject({ http: 422 });
    expect(H.ai.mock.calls.some(call => call[1].purpose === 'github.integration.review')).toBe(false);
  });
  it.each([null, '', '//evil.example/article', 'javascript:alert(1)', 'data:text/html,article', 'https://user:password@cms.example/article', '/journal/../original', '/journal/%2e%2e/original', '/journal/./original', '/journal/%2e/original', '/journal\\original', '/journal/\noriginal', 'relative/article', 'https://'])('fails invalid input %j before provider or storage work', async url => {
    await expect(buildPayload(business, entry(url), { ...article, img: {} })).rejects.toMatchObject({ http: 422, kind: 'config' });
    expect(H.image).not.toHaveBeenCalled(); expect(H.ai).not.toHaveBeenCalled(); expect(H.dbUpdate).not.toHaveBeenCalled(); expect(H.connector).not.toHaveBeenCalled();
  });
  it('keeps new-article publication independent of a stale source URL', async () => {
    const payload = await buildPayload(business, entry('javascript:ignored-for-new', 'new'), article);
    expect(payload.refreshUrl).toBeNull(); expect(payload.canonical).toBeNull();
  });
});
