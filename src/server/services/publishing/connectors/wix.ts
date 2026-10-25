// Wix — app installed on a site (OAuth). Access tokens come from the app's client credentials + the site's instanceId.
// Blog API v3: create a draft post (HTML converted to Ricos rich content), then publish it. Contract (dev.wix.com/docs/…):
//  - POST /oauth2/token {grant_type: client_credentials, client_id, client_secret, instance_id} → access_token (4 h); sent as a bare
//    Authorization header. A 4xx here means the app is no longer installed on the site (or was never) → reconnect.
//  - GET /apps/v1/instance → {instance, site{siteId, url (published sites only), siteDisplayName, ownerInfo{email}}}
//  - POST /members/v1/members/query: third-party apps must send draftPost.memberId (a site member, not a Wix user)
//  - POST /ricos/v1/ricos-document/convert/to-ricos {html (≤ 30,000 chars), options{plugins}} → {document{nodes}}
//  - POST /site-media/v1/files/import {url, mediaType, displayName} → {file{id}}; a PENDING file can be used right away
//  - POST /blog/v3/draft-posts {draftPost} · PATCH /blog/v3/draft-posts/{id} {draftPost, action} · POST …/{id}/publish → {postId}
//  - GET /blog/v3/posts/slugs/{slug} (404 = no such post) · GET /blog/v3/posts/{id}?fieldsets=URL → post.url{base, path}
//  - DELETE /blog/v3/draft-posts/{id}?permanent=true bypasses the trash bin
import { env } from '@/server/env';
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';

const API = 'https://www.wixapis.com';
const HOST = 'www.wixapis.com';

/** Tokens live 4 h; reuse one for a few minutes so a publish mints one, not one per request. */
const TOKEN_TTL_MS = 10 * 60e3;
const tokens = new Map<string, { token: string; at: number }>();
export const resetWixTokens = () => tokens.clear();
export async function wixToken(instanceId: string, fresh = false): Promise<string> {
  const hit = tokens.get(instanceId);
  if (!fresh && hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
  if (!env.wixClientId || !env.wixClientSecret) throw new PublishError(400, 'Wix app credentials are not configured', '', 'config');
  let r: { access_token?: string };
  try {
    r = await reqJson(`${API}/oauth2/token`, { method: 'POST', ...jsonBody({ grant_type: 'client_credentials', client_id: env.wixClientId, client_secret: env.wixClientSecret, instance_id: instanceId }) });
  } catch (e) {
    if (e instanceof PublishError && e.http >= 400 && e.http < 500 && ![408, 429].includes(e.http)) throw new PublishError(401, 'app not installed on the site: ' + e.detail, e.host, 'auth-expired');
    throw e;
  }
  if (!r.access_token) throw new PublishError(401, 'No access token', HOST, 'auth-expired');
  tokens.set(instanceId, { token: r.access_token, at: Date.now() });
  return r.access_token;
}
/** A Wix API call as the app on this site. A 401 mints a fresh token once; a second 401 means reconnect. */
async function wx<T = any>(c: ConnCtx, path: string, init: RequestInit = {}, again = false): Promise<T> {
  const inst = c.creds.instanceId; if (!inst) throw new PublishError(401, 'Missing site instance', '', 'auth-expired');
  const authorization = await wixToken(inst, again);
  try {
    return await reqJson<T>(`${API}${path}`, { ...init, headers: { ...((init.headers as Record<string, string>) || {}), authorization } });
  } catch (e) {
    if (e instanceof PublishError && e.http === 401) {
      if (!again) return wx(c, path, init, true);
      throw new PublishError(401, e.detail, e.host, 'auth-expired');
    }
    throw e;
  }
}
const post = (body: any): RequestInit => ({ method: 'POST', ...jsonBody(body) });

/** The draft-posts endpoints only 404 when the site has no Wix Blog. */
const NO_BLOG = 'Wix Blog isn’t installed on this site. Add the Blog app to your Wix site, then try again.';
async function blog<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    if (e instanceof PublishError && (e.http === 404 || /blog.*not installed|not installed.*blog|APP_NOT_INSTALLED/i.test(e.detail))) throw new PublishError(422, NO_BLOG, HOST, 'config');
    throw e;
  }
}

/** Ricos conversion takes ≤ 30,000 characters of HTML, so long articles are converted in block-sized chunks and joined. */
const RICOS_MAX = 30000;
const PLUGINS = ['HEADING', 'LINK', 'IMAGE', 'VIDEO', 'HTML', 'DIVIDER'];
export function htmlChunks(html: string, max = RICOS_MAX): string[] {
  const out: string[] = []; let cur = '';
  const push = (s: string) => { if (cur && cur.length + 1 + s.length > max) { out.push(cur); cur = s; } else cur = cur ? cur + '\n' + s : s; };
  for (let line of html.split('\n')) {
    while (line.length > max) { const cut = line.lastIndexOf('>', max - 1) + 1 || max; push(line.slice(0, cut)); line = line.slice(cut); }
    push(line);
  }
  if (cur) out.push(cur);
  return out;
}
async function ricos(c: ConnCtx, html: string) {
  const docs: any[] = [];
  for (const chunk of htmlChunks(html)) docs.push((await wx<{ document: any }>(c, '/ricos/v1/ricos-document/convert/to-ricos', post({ html: chunk, options: { plugins: PLUGINS } }))).document || {});
  return { ...docs[0], nodes: docs.flatMap(d => d.nodes || []) };
}

/** Posts are attributed to the site owner's member profile (third-party apps must send one; a Wix user id isn't accepted). */
const NO_MEMBER = 'Radar publishes to Wix Blog as the site owner, but the owner has no member profile on this site yet. Sign in to your live site once as the owner (or add yourself as a site member), then try again.';
async function memberId(c: ConnCtx): Promise<string> {
  if (c.creds.memberId) return c.creds.memberId;
  const inst = await wx<{ site?: { ownerInfo?: { email?: string } } }>(c, '/apps/v1/instance');
  const email = inst.site?.ownerInfo?.email;
  if (email) {
    const r = await wx<{ members?: { id: string }[] }>(c, '/members/v1/members/query', post({ query: { filter: { loginEmail: { $eq: email } }, paging: { limit: 1 } } }));
    if (r.members?.[0]?.id) return r.members[0].id;
  }
  throw new PublishError(422, NO_MEMBER, HOST, 'config');
}

/** Import the hero into the Media Manager. An image Wix can't fetch is left off the post; auth and transient errors still throw. */
async function importImage(c: ConnCtx, p: PublishPayload): Promise<string | null> {
  if (!p.image || !/^https:/.test(p.image.url)) return null;
  try {
    const r = await wx<{ file?: { id: string } }>(c, '/site-media/v1/files/import', post({ url: p.image.url, mediaType: 'IMAGE', displayName: p.slug + '.png' }));
    return r.file?.id || null;
  } catch (e) {
    if (e instanceof PublishError && !e.retryable && e.kind !== 'auth-expired') { console.warn('[wix] hero image import refused:', e.message); return null; }
    throw e;
  }
}
const slugOf = (u: string) => { const s = u.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || ''; try { return decodeURIComponent(s); } catch { return s; } };
/** The published post with this slug, or null on a real 404 (other errors are rethrown, so a blip can't create a duplicate). */
async function postBySlug(c: ConnCtx, slug: string): Promise<{ id: string } | null> {
  try { return (await wx<{ post?: { id: string } }>(c, `/blog/v3/posts/slugs/${encodeURIComponent(slug)}`)).post || null; } catch (e) {
    if (e instanceof PublishError && e.http === 404) return null;
    throw e;
  }
}

async function body(c: ConnCtx, p: PublishPayload) {
  const img = await importImage(c, p);
  return {
    title: p.title, richContent: await ricos(c, p.html), excerpt: p.meta.slice(0, 500),
    seoData: { tags: [{ type: 'title', children: p.seoTitle || p.title }, { type: 'meta', props: { name: 'description', content: p.meta } }] },
    ...(img ? { media: { wixMedia: { image: { id: img } }, displayed: true, custom: true, ...(p.image?.alt ? { altText: p.image.alt.slice(0, 1000) } : {}) } } : {}),
  };
}

export const wix: Connector = {
  async targets(c) {
    const r = await wx<{ site?: { siteDisplayName?: string; url?: string; siteId?: string } }>(c, '/apps/v1/instance');
    const s = r.site || {};
    return [{ id: s.siteId || c.creds.instanceId, name: (s.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || s.siteDisplayName || c.domain, url: s.url || null }];
  },
  async test(c) {
    const r = await blog(wx<{ draftPost: { id: string } }>(c, '/blog/v3/draft-posts', post({ draftPost: { title: TEST_TITLE, memberId: await memberId(c), richContent: await ricos(c, TEST_HTML) } })));
    await wx(c, `/blog/v3/draft-posts/${r.draftPost.id}?permanent=true`, { method: 'DELETE' });
  },
  async createDraft(c, p) {
    // A refresh updates the published post's draft (the post stays live) and publishing pushes it; same id and URL.
    if (p.mode === 'refresh' && p.refreshUrl) {
      const ex = await blog(postBySlug(c, slugOf(p.refreshUrl)));
      if (ex) {
        await wx(c, `/blog/v3/draft-posts/${ex.id}`, { method: 'PATCH', ...jsonBody({ draftPost: { id: ex.id, ...(await body(c, p)) }, action: 'UPDATE_PUBLICATION' }) });
        return { id: ex.id, extra: { refresh: true } };
      }
    }
    // A slug another post already has is never reused: the next free "-2", "-3"… is asked for.
    let slug = p.slug;
    for (let i = 2; await blog(postBySlug(c, slug)); i++) {
      if (i > 10) throw new PublishError(422, `Every slug from “${p.slug}” to “${p.slug}-10” is taken on this blog. Change the article’s slug and try again.`, HOST, 'config');
      slug = `${p.slug}-${i}`;
    }
    // An unpublished draft with our title and slug is our own earlier attempt whose response was lost: reuse it, don't duplicate.
    const q = await blog(wx<{ draftPosts?: { id: string; seoSlug?: string }[] }>(c, '/blog/v3/draft-posts/query', post({ query: { filter: { title: { $eq: p.title }, status: { $eq: 'UNPUBLISHED' } }, cursorPaging: { limit: 20 } } })));
    const mine = q.draftPosts?.find(x => x.seoSlug === slug)?.id;
    const member = mine ? null : await memberId(c);
    const draftPost = { ...(await body(c, p)), seoSlug: slug };
    if (mine) {
      await wx(c, `/blog/v3/draft-posts/${mine}`, { method: 'PATCH', ...jsonBody({ draftPost: { id: mine, ...draftPost }, action: 'UPDATE' }) });
      return { id: mine };
    }
    const r = await wx<{ draftPost: { id: string } }>(c, '/blog/v3/draft-posts', post({ draftPost: { ...draftPost, memberId: member } }));
    return { id: r.draftPost.id };
  },
  async publish(c, p, d) {
    const r = await wx<{ postId: string }>(c, `/blog/v3/draft-posts/${d.id}/publish`, post({}));
    const got = await wx<{ post: { url?: { base: string; path: string } } }>(c, `/blog/v3/posts/${r.postId || d.id}?fieldsets=URL`).catch(() => null);
    const u = got?.post?.url;
    return { url: u ? u.base.replace(/\/$/, '') + u.path : `https://${c.target || c.domain}/post/${p.slug}` };
  },
};
