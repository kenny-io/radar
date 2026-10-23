// X and LinkedIn adapters against a mocked fetch: error mapping (status and X's response text), unknown vs transient network
// failures, made_with_ai, LinkedIn media processing, page roles, granted-scope checks. No database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SendError, call, mapCommon, type Res } from './api';
import { xAdapter, xError } from './x';
import { LI_MEDIA, liAdapter, liCreateError, liPages } from './linkedin';
import { scopesOk } from './oauth';

const res = (status: number, body: any = '', headers: Record<string, string> = {}): Res => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status, text, json, headers: new Headers(headers) };
};
const A = { ch: 'x' as const, remoteId: '42', handle: '@fieldnoteapp', token: 'at' };
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const reply = (status: number, body: any = {}, headers: Record<string, string> = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
function mockFetch(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { calls.push({ url: String(url), init }); return fn(String(url), init); }));
}
beforeEach(() => { calls = []; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('X error mapping (status and response text)', () => {
  it('402 and usage-capped are quota, never retried, with an operator log', () => {
    expect(xError(res(402, { title: 'CreditsDepleted' }), 'create', 'x')).toMatchObject({ kind: 'definitive', code: 'quota' });
    expect(xError(res(429, { title: 'UsageCapExceeded', type: 'https://api.x.com/2/problems/usage-capped' }), 'create', 'x')).toMatchObject({ kind: 'definitive', code: 'quota' });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[social] X quota'));
  });
  it('both duplicate wordings → duplicate; suspended/locked → auth; invalid media ids → media', () => {
    expect(xError(res(403, { detail: 'You are not allowed to create a Tweet with duplicate content.' }), 'create', 'x').code).toBe('duplicate');
    expect(xError(res(400, { errors: [{ message: 'duplicate-rules' }] }), 'create', 'x').code).toBe('duplicate');
    expect(xError(res(403, { detail: 'user-suspended' }), 'create', 'x').code).toBe('auth');
    expect(xError(res(403, { detail: 'This account is temporarily locked.' }), 'create', 'x').code).toBe('auth');
    expect(xError(res(400, { detail: 'Your media IDs are invalid.' }), 'create', 'x').code).toBe('media');
  });
  it('cashtag / crypto / invalid URL refusals keep X’s own short message', () => {
    const e = xError(res(400, { detail: 'Tweets can contain a maximum of one cashtag' }), 'create', 'x');
    expect(e).toMatchObject({ kind: 'definitive', code: 'rejected', userMsg: 'Tweets can contain a maximum of one cashtag.' });
  });
  it('status rules: 429 retries at the reset time, 503 is transient, other 5xx after create is unknown, 401 refreshes', () => {
    const rl = xError(res(429, { title: 'Too Many Requests' }, { 'x-rate-limit-reset': '1800000000' }), 'create', 'x');
    expect(rl).toMatchObject({ kind: 'transient', code: 'rate_limit', retryAt: 1800000000 * 1000 });
    expect(xError(res(503, 'Service Unavailable'), 'create', 'x')).toMatchObject({ kind: 'transient', code: 'unavailable' });
    expect(xError(res(500, 'oops'), 'create', 'x')).toMatchObject({ kind: 'unknown', code: 'unknown' });
    expect(xError(res(500, 'oops'), 'media', 'x')).toMatchObject({ kind: 'transient' }); // nothing was published at the media stage
    expect(xError(res(401, { title: 'Unauthorized' }), 'create', 'x').kind).toBe('auth');
    expect(xError(res(400, { detail: 'Text is too long' }), 'create', 'x').code).toBe('too_long');
    expect(xError(res(404, 'nope'), 'create', 'x').code).toBe('rejected');
    expect(mapCommon(res(400, 'bad image'), 'media', 'x').code).toBe('media');
  });
});

describe('network failures', () => {
  it('a refused connection is transient even at create; a timeout or reset after sending is unknown', async () => {
    mockFetch(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
    await expect(call('https://api.x.com/2/tweets', { method: 'POST' }, 'create')).rejects.toMatchObject({ kind: 'transient', code: 'unavailable' });
    mockFetch(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
    await expect(call('https://api.x.com/2/tweets', { method: 'POST' }, 'create')).rejects.toMatchObject({ kind: 'unknown' });
    await expect(call('https://api.x.com/2/media/upload', { method: 'POST' }, 'media')).rejects.toMatchObject({ kind: 'transient' });
    mockFetch((_u, init) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    await expect(call('https://api.x.com/2/tweets', { method: 'POST' }, 'create', 20)).rejects.toMatchObject({ kind: 'unknown' });
  });
});

describe('X create', () => {
  it('sends made_with_ai only for image-model media, and builds the status URL', async () => {
    mockFetch(() => reply(201, { data: { id: '1850000000000000001', text: 'hi' } }));
    const c = await xAdapter.create(A, { text: 'hi', mediaIds: ['m1'], aiMedia: true });
    expect(c).toEqual({ remoteId: '1850000000000000001', url: 'https://x.com/fieldnoteapp/status/1850000000000000001' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: 'hi', media: { media_ids: ['m1'] }, made_with_ai: true });
    await xAdapter.create(A, { text: 'hi', mediaIds: ['m1'], aiMedia: false });
    expect(JSON.parse(String(calls[1].init.body))).not.toHaveProperty('made_with_ai');
    expect((calls[0].init.headers as any).authorization).toBe('Bearer at');
  });
  it('read-back matches the sent text even when X rewrote the link', async () => {
    mockFetch(() => reply(200, { data: [{ id: '9', text: 'Other post' }, { id: '7', text: 'Billing tips https://t.co/abc' }] }));
    expect(await xAdapter.verify!(A, { text: 'Billing tips https://fieldnote.app/blog/billing', sinceMs: 0 })).toEqual({ remoteId: '7', url: 'https://x.com/fieldnoteapp/status/7' });
    expect(calls[0].url).toContain('/2/users/42/tweets?');
    mockFetch(() => reply(200, { meta: { result_count: 0 } }));
    expect(await xAdapter.verify!(A, { text: 'Billing tips', sinceMs: 0 })).toBeNull();
  });
  it('refresh: 400 invalid_grant is definitive, 503 is transient, success rotates the refresh token', async () => {
    mockFetch(() => reply(400, { error: 'invalid_grant' }));
    await expect(xAdapter.refresh({ access_token: 'a', refresh_token: 'r1' })).rejects.toMatchObject({ definitive: true });
    mockFetch(() => reply(503, 'down'));
    await expect(xAdapter.refresh({ access_token: 'a', refresh_token: 'r1' })).rejects.toMatchObject({ definitive: false });
    mockFetch(() => reply(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 7200 }));
    const t = await xAdapter.refresh({ access_token: 'a', refresh_token: 'r1' });
    expect(t).toMatchObject({ access_token: 'a2', refresh_token: 'r2' });
    expect((calls[0].init.headers as any).authorization).toMatch(/^Basic /); // X rejects client_secret_post
  });
});

describe('LinkedIn', () => {
  const page = { ch: 'li_page' as const, remoteId: '123', handle: null, token: 'lt' };
  it('426 NONEXISTENT_VERSION → unavailable with an operator log naming LINKEDIN_API_VERSION', () => {
    const e = liCreateError(res(426, { code: 'NONEXISTENT_VERSION', message: 'Requested version 20261001 is not active' }));
    expect(e).toMatchObject({ kind: 'definitive', code: 'unavailable' });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('LINKEDIN_API_VERSION'));
    expect(liCreateError(res(422, { message: 'Content is a duplicate of urn:li:share:1' })).code).toBe('duplicate');
    expect(liCreateError(res(422, { code: 'FIELD_LENGTH_TOO_LONG' })).code).toBe('too_long');
    expect(liCreateError(res(400, { message: 'Image urn:li:image:1 is still PROCESSING' })).kind).toBe('transient');
  });
  it('a page polls its images until AVAILABLE; FAILED → media', async () => {
    const was = { ...LI_MEDIA }; Object.assign(LI_MEDIA, { pollMs: 1, capMs: 2000, profileWaitMs: 1 });
    try {
      let n = 0;
      mockFetch(() => reply(200, { status: ++n < 3 ? 'PROCESSING' : 'AVAILABLE' }));
      await liAdapter('page').awaitMedia!(page, ['urn:li:image:1']);
      expect(n).toBe(3);
      expect(calls[0].url).toBe('https://api.linkedin.com/rest/images/urn%3Ali%3Aimage%3A1');
      expect((calls[0].init.headers as any)['linkedin-version']).toBe('202610');
      mockFetch(() => reply(200, { status: 'PROCESSING_FAILED' }));
      await expect(liAdapter('page').awaitMedia!(page, ['urn:li:image:1'])).rejects.toMatchObject({ code: 'media' });
      calls = []; mockFetch(() => reply(403, {}));
      await liAdapter('page').awaitMedia!(page, ['urn:li:image:1']); // falls back to the fixed wait
      expect(calls).toHaveLength(1);
      calls = []; mockFetch(() => reply(200, {}));
      await liAdapter('profile').awaitMedia!({ ...page, ch: 'li_profile' }, ['urn:li:image:1']); // profiles can't poll: wait only
      expect(calls).toHaveLength(0);
    } finally { Object.assign(LI_MEDIA, was); }
  });
  it('lists pages for administrators and content administrators only', async () => {
    mockFetch(url => {
      if (url.includes('organizationAcls')) return reply(200, { elements: [
        { organization: 'urn:li:organization:1', role: 'ADMINISTRATOR', state: 'APPROVED' },
        { organization: 'urn:li:organization:2', role: 'CONTENT_ADMINISTRATOR', state: 'APPROVED' },
        { organization: 'urn:li:organization:3', role: 'ANALYST', state: 'APPROVED' },
      ] });
      if (url.includes('/organizations/')) return reply(200, { localizedName: 'Org ' + url.split('/').pop() });
      return reply(500, {});
    });
    expect(await liPages('lt')).toEqual([{ id: '1', name: 'Org 1', followers: null }, { id: '2', name: 'Org 2', followers: null }]);
    expect(calls[0].url).not.toContain('role=');
  });
  it('posts escape little-text commentary and attach one image as media', async () => {
    mockFetch(() => reply(201, '', { 'x-restli-id': 'urn:li:share:77' }));
    const c = await liAdapter('page').create(page, { text: 'Hi (team) #launch', mediaIds: ['urn:li:image:1'] });
    expect(c.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:77/');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ author: 'urn:li:organization:123', commentary: 'Hi \\(team\\) #launch', content: { media: { id: 'urn:li:image:1' } }, lifecycleState: 'PUBLISHED' });
  });
});

describe('OAuth granted scopes', () => {
  it('requires every scope Radar asks for', () => {
    expect(scopesOk('x', 'tweet.read tweet.write users.read media.write offline.access')).toBe(true);
    expect(scopesOk('x', 'tweet.read users.read offline.access')).toBe(false);
    expect(scopesOk('li_profile', 'openid,profile,w_member_social')).toBe(true);
    expect(scopesOk('li_profile', 'openid,profile')).toBe(false);
    expect(scopesOk('li_page', 'r_basicprofile,rw_organization_admin,w_organization_social')).toBe(true);
    expect(scopesOk('li_page', undefined)).toBe(true);
  });
});

it('SendError carries the kind and code the sender acts on', () => {
  const e = new SendError('transient', 'rate_limit', 'x 429', 5);
  expect([e.kind, e.code, e.retryAt]).toEqual(['transient', 'rate_limit', 5]);
});
