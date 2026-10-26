// Regression tests for defects found running the WordPress / Ghost / webhook connectors against real software
// (see connectors/*.live.test.ts). These use a local HTTP server that imitates the failure, so they always run.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { env } from '@/server/env';
import { connectorFor, stubbed } from './connectors';
import { wordpress, wpContent } from './connectors/wordpress';
import { ghost } from './connectors/ghost';
import { webhook } from './connectors/webhook';
import { notion } from './connectors/notion';
import { parseRepo } from './connectors/nextjs';
import { PublishError, req } from './http';
import { failCopy } from '@/server/actions/publishing';
import { publishFailParts } from '@/lib/constants';
import { blocksToHtml } from './render';
import { ctx, payload } from './connectors/live-fixtures';

type Handler = (r: http.IncomingMessage, body: string, res: http.ServerResponse) => void;
let handler: Handler = (_r, _b, res) => { res.writeHead(500); res.end(); };
const seen: { method: string; url: string; auth?: string }[] = [];
let server: http.Server; let base = '';
beforeAll(async () => {
  server = http.createServer((r, res) => { let b = ''; r.on('data', c => (b += c)); r.on('end', () => { seen.push({ method: r.method!, url: r.url!, auth: r.headers.authorization }); handler(r, b, res); }); });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(ok => server.close(() => ok())));
afterEach(() => { seen.length = 0; });
const json = (res: http.ServerResponse, status: number, body: any) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const err = async (p: Promise<any>) => { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a PublishError'); };
const GHOST_KEY = '0123456789abcdef01234567:' + 'ab'.repeat(32);

describe('RADAR_REAL_CONNECTORS (dev-only switch)', () => {
  const saved = { devStubs: env.devStubs, real: env.realConnectors };
  afterEach(() => { env.devStubs = saved.devStubs; env.realConnectors = saved.real; });

  it('with dev stubs on, listed types use the real connector and the rest stay stubbed', () => {
    env.devStubs = true; env.realConnectors = ['wordpress', 'ghost', 'webhook'];
    expect(connectorFor('wordpress')).toBe(wordpress);
    expect(connectorFor('ghost')).toBe(ghost);
    expect(connectorFor('webhook')).toBe(webhook);
    expect(stubbed('notion')).toBe(true);
    expect(connectorFor('notion')).not.toBe(notion);
  });
  it('with dev stubs on and no list, every connector is a stub', () => {
    env.devStubs = true; env.realConnectors = [];
    expect(connectorFor('wordpress')).not.toBe(wordpress);
    expect(stubbed('ghost')).toBe(true);
  });
  it('the Next.js stub lists real-looking owner/repo targets (id = name = fields.repo) and publishes to that repo', async () => {
    env.devStubs = true; env.realConnectors = [];
    const c = { type: 'nextjs' as const, fields: { path: 'content/posts' }, creds: { access_token: 'stub-github-token', login: 'fieldnote' }, target: null, targetId: null, bid: 'b1', domain: 'www.acme.co', businessName: 'Acme' };
    const t = await connectorFor('nextjs').targets!(c);
    expect(t).toEqual([{ id: 'fieldnote/acme-website', name: 'fieldnote/acme-website', url: 'https://github.com/fieldnote/acme-website', suggested: true }, { id: 'fieldnote/blog', name: 'fieldnote/blog', url: 'https://github.com/fieldnote/blog' }]);
    expect(t.every(x => parseRepo(x.id))).toBe(true);
    const r = await connectorFor('nextjs').publish({ ...c, fields: { ...c.fields, repo: t[0].id } }, payload({ slug: 'hello' }), { id: 'stub-x' });
    expect(r.url).toMatch(/^https:\/\/github\.com\/fieldnote\/acme-website\/pull\/\d+$/);
  });
  it('without dev stubs (production) every connector is real, whatever the list says', () => {
    env.devStubs = false; env.realConnectors = [];
    expect(connectorFor('wordpress')).toBe(wordpress);
    expect(stubbed('notion')).toBe(false);
  });
});

describe('writes never follow redirects', () => {
  it('a POST that gets a 301 fails readably instead of being replayed as a GET', async () => {
    handler = (r, _b, res) => { if (r.method === 'POST') { res.writeHead(301, { location: base + '/elsewhere' + r.url }); res.end(); } else json(res, 200, [{ id: 7 }]); };
    const e = await err(req(base + '/wp-json/wp/v2/posts', { method: 'POST', body: '{}' }));
    expect(e.http).toBe(301);
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('redirected to ' + base + '/elsewhere');
    expect(seen.map(s => s.method)).toEqual(['POST']); // never followed
  });
  it('a same-origin 307/308 on a write is still followed with its method, body and credentials', async () => {
    handler = (r, b, res) => { if (r.url === '/old') { res.writeHead(308, { location: '/new' }); res.end(); } else json(res, 201, { method: r.method, body: b }); };
    const r = await req(base + '/old', { method: 'POST', body: '{"a":1}', headers: { authorization: 'Basic x' } });
    expect(await r.json()).toEqual({ method: 'POST', body: '{"a":1}' });
    expect(seen.map(s => [s.method, s.url, s.auth])).toEqual([['POST', '/old', 'Basic x'], ['POST', '/new', 'Basic x']]);
  });
  it('a cross-origin 307 on a write fails instead of sending the body elsewhere without credentials', async () => {
    handler = (_r, _b, res) => { res.writeHead(307, { location: 'http://localhost:1/x' }); res.end(); };
    const e = await err(req(base + '/a', { method: 'PUT', body: '{}' }));
    expect(e.http).toBe(307);
    expect(seen).toHaveLength(1);
  });
  it('GETs still follow redirects', async () => {
    handler = (r, _b, res) => { if (r.url === '/a') { res.writeHead(302, { location: '/b' }); res.end(); } else json(res, 200, { ok: r.url }); };
    expect(await (await req(base + '/a')).json()).toEqual({ ok: '/b' });
  });
  it('WordPress behind a redirecting URL: no "undefined" draft id is ever stored (was: GET list → id undefined)', async () => {
    handler = (r, _b, res) => { if (r.method === 'POST') { res.writeHead(301, { location: base + r.url }); res.end(); } else json(res, 200, [{ id: 1, link: base + '/hello' }]); };
    const c = ctx('wordpress', { url: base, user: 'u' }, { pass: 'p' });
    const e = await err(wordpress.createDraft(c, payload({ slug: 's', withImage: false })));
    expect(e.http).toBe(301);
    expect(failCopy('wordpress', e)).toBe('301 Moved Permanently — check the URL');
  });
  it('Ghost behind a redirecting URL fails before touching any existing post', async () => {
    handler = (r, _b, res) => { if (r.method !== 'GET') { res.writeHead(308, { location: base + r.url }); res.end(); } else json(res, 200, { posts: [{ id: 'someone-elses-post', url: base + '/x/' }] }); };
    const e = await err(ghost.createDraft(ctx('ghost', { url: base }, { key: GHOST_KEY }), payload({ slug: 's', withImage: false })));
    expect(e.http).toBe(308);
    expect(seen.some(s => s.method === 'PUT')).toBe(false);
  });
});

describe('responses without an id are errors, not "undefined"', () => {
  it('WordPress createDraft', async () => {
    handler = (_r, _b, res) => json(res, 200, {});
    expect((await err(wordpress.createDraft(ctx('wordpress', { url: base, user: 'u' }, { pass: 'p' }), payload({ slug: 's', withImage: false })))).message).toContain('No post id returned');
  });
  it('Ghost createDraft', async () => {
    handler = (_r, _b, res) => json(res, 200, { posts: [] });
    expect((await err(ghost.createDraft(ctx('ghost', { url: base }, { key: GHOST_KEY }), payload({ slug: 's', withImage: false })))).message).toContain('No post id returned');
  });
});

describe('a refresh never turns into a second post when the lookup fails', () => {
  const refresh = () => payload({ slug: 'new-slug', mode: 'refresh', refreshUrl: base + '/old-post/', canonical: base + '/old-post/', withImage: false });
  it('WordPress: a 503 on the slug lookup propagates (retryable) and nothing is created', async () => {
    handler = (r, _b, res) => (r.method === 'GET' ? json(res, 503, { code: 'down' }) : json(res, 201, { id: 99, link: base + '/new-slug/' }));
    const e = await err(wordpress.createDraft(ctx('wordpress', { url: base, user: 'u' }, { pass: 'p' }), refresh()));
    expect(e.http).toBe(503);
    expect(e.retryable).toBe(true);
    expect(seen.filter(s => s.method === 'POST')).toHaveLength(0);
  });
  it('WordPress: an empty lookup (post deleted) creates a new draft', async () => {
    handler = (r, _b, res) => (r.method === 'GET' ? json(res, 200, []) : json(res, 201, { id: 99, link: base + '/new-slug/' }));
    expect(await wordpress.createDraft(ctx('wordpress', { url: base, user: 'u' }, { pass: 'p' }), refresh())).toEqual({ id: '99', url: base + '/new-slug/' });
  });
  it('WordPress: a post this account can\'t edit (hidden from context=edit) is still found, so no second post is made', async () => {
    let created = 0;
    handler = (r, _b, res) => {
      if (r.method === 'GET') return json(res, 200, r.url!.includes('context=edit') ? [] : [{ id: 42, link: base + '/old-post/' }]);
      if (r.url!.endsWith('/posts')) created++;
      json(res, 403, { code: 'rest_cannot_edit' });
    };
    const c = ctx('wordpress', { url: base, user: 'author' }, { pass: 'p' });
    const d = await wordpress.createDraft(c, refresh());
    expect(d).toMatchObject({ id: '42', extra: { refresh: true } });
    const e = await err(wordpress.publish(c, refresh(), d));
    expect(e.http).toBe(403);
    expect(created).toBe(0);
  });
  it('Ghost: a 503 on the slug lookup propagates and nothing is created', async () => {
    handler = (r, _b, res) => (r.method === 'GET' ? json(res, 503, { errors: [] }) : json(res, 201, { posts: [{ id: 'n', url: base + '/p/' }] }));
    const e = await err(ghost.createDraft(ctx('ghost', { url: base }, { key: GHOST_KEY }), refresh()));
    expect(e.http).toBe(503);
    expect(seen.filter(s => s.method === 'POST')).toHaveLength(0);
  });
  it('Ghost: a 404 lookup (post deleted) creates a new draft', async () => {
    handler = (r, _b, res) => (r.method === 'GET' ? json(res, 404, { errors: [] }) : json(res, 201, { posts: [{ id: 'n', url: base + '/p/' }] }));
    expect((await ghost.createDraft(ctx('ghost', { url: base }, { key: GHOST_KEY }), refresh())).id).toBe('n');
  });
});

describe('Ghost meta title', () => {
  it('uses the article\'s SEO title, not the post title', async () => {
    let sent: any = null;
    handler = (r, b, res) => { if (r.method === 'POST') sent = JSON.parse(b); json(res, 201, { posts: [{ id: 'n', url: base + '/p/' }] }); };
    await ghost.createDraft(ctx('ghost', { url: base }, { key: GHOST_KEY }), payload({ slug: 's', seoTitle: 'Short SEO title', withImage: false }));
    expect(sent.posts[0].meta_title).toBe('Short SEO title');
    expect(sent.posts[0].title).toBe('How to price a freelance design project');
  });
});

describe('WordPress video embeds', () => {
  const html = blocksToHtml([['p', 'Intro'], ['h2', 'Next'], ['p', 'More']], { videos: [{ id: 'dQw4w9WgXcQ', title: 'A "talk" & more', channel: 'Chan' }] });
  it('turns each Radar iframe into a core Embed block (WordPress strips iframes for Authors)', () => {
    const out = wpContent(html);
    expect(out).not.toContain('<iframe');
    expect(out).toContain('<!-- wp:embed {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","type":"video","providerNameSlug":"youtube"');
    expect(out).toContain('<div class="wp-block-embed__wrapper">\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n</div>');
    expect(out).toContain('<figcaption class="wp-element-caption">A &quot;talk&quot; &amp; more · YouTube · Chan — <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" rel="noopener">Watch on YouTube</a></figcaption>');
    expect(out).toContain('<!-- /wp:embed -->');
    expect(out.startsWith('<p>Intro</p>')).toBe(true);
  });
  it('leaves HTML without videos untouched', () => {
    const plain = blocksToHtml([['p', 'Intro'], ['ul', ['a', 'b']]], {});
    expect(wpContent(plain)).toBe(plain);
  });
});

describe('article failed banner copy', () => {
  // Regression: the banner ran the stored label ("Ghost") through platLabel(), which only knows type keys, so every
  // failure read "WordPress returned …", and it prefixed the status line with the code again ("503 503 Service Unavailable").
  it('names the real platform and shows the status line once', () => {
    expect(publishFailParts({ http: 503, message: '503 Service Unavailable', platform: 'Ghost' }, 'ghost')).toEqual({ platform: 'Ghost', detail: '503 Service Unavailable' });
    expect(publishFailParts({ http: 401, message: '401 Unauthorized', platform: 'Webhook' }, 'webhook')).toEqual({ platform: 'Webhook', detail: '401 Unauthorized' });
  });
  it('network failures read "no response from {host}"', () => {
    expect(publishFailParts({ http: 0, message: 'no response from localhost:2381', platform: 'Ghost' }, 'ghost').detail).toBe('no response from localhost:2381');
  });
  it('falls back to the destination platform, and accepts a type key', () => {
    expect(publishFailParts(null, 'ghost')).toEqual({ platform: 'Ghost', detail: 'an error' });
    expect(publishFailParts({ http: 404, platform: 'wpcom' }, null)).toEqual({ platform: 'WordPress.com', detail: '404' });
  });
});

describe('test-connection copy points at the real fix', () => {
  const e = (http: number) => new PublishError(http, 'x');
  it('a 404 on WordPress, Ghost or a webhook says to check the URL; 401/403 still say credentials', () => {
    for (const t of ['wordpress', 'ghost', 'webhook']) expect(failCopy(t, e(404))).toBe('404 Not Found — check the URL');
    expect(failCopy('wordpress', e(401))).toBe('401 Unauthorized — check the credentials');
    expect(failCopy('ghost', e(403))).toBe('403 Forbidden — check the credentials');
  });
  it('a 404 on an OAuth platform says the site or database is no longer shared', () => {
    expect(failCopy('notion', e(404))).toBe('Radar can’t see that database anymore. Reconnect and share it again.');
    expect(failCopy('nextjs', e(404))).toBe('Radar can’t see that repository anymore. Reconnect and share it again.');
  });
  it('a setup problem (config 422/403) shows the connector’s sentence, in the test copy and on the article banner', () => {
    const s = 'Publish your Webflow site once in the Designer, then try again.';
    const x = new PublishError(422, s, 'api.webflow.com', 'config');
    expect(x.hint).toBe(s);
    expect(failCopy('webflow', x)).toBe(s);
    expect(failCopy('nextjs', new PublishError(403, 'Your GitHub account can’t push to that repository.', 'api.github.com', 'config'))).toBe('Your GitHub account can’t push to that repository.');
    expect(publishFailParts({ http: 422, message: '422 Unprocessable Entity', platform: 'Webflow', hint: s }, 'webflow')).toEqual({ platform: 'Webflow', detail: '422 Unprocessable Entity', hint: s });
    // Other config errors (redirects, a missing target) and plain 422s keep the approved status copy.
    expect(new PublishError(422, 'x').hint).toBeNull();
    expect(new PublishError(308, 'redirected to …', 'h', 'config').hint).toBeNull();
    expect(failCopy('webflow', new PublishError(404, 'No CMS collection chosen', '', 'config'))).toBe('Radar can’t see that cms collection anymore. Reconnect and share it again.');
  });
});
