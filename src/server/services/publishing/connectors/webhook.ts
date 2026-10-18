// Webhook — POST signed JSON to the user's https endpoint. Signature header (Stripe-style):
//   Radar-Signature: t={unix seconds},v1={hex HMAC-SHA256(secret, "{t}.{raw body}")}
// Payload and verification are documented in docs/webhook.md.
import { hmacSha256, randomToken } from '@/server/crypto';
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { PublishError, req } from '../http';

export const newWebhookSecret = () => 'whsec_' + randomToken(24);
/** "whsec_7Kq2…f91A" — the read-only display form (first 4 and last 4 characters after the prefix). */
export const maskSecret = (s: string | null | undefined) => (s && s.startsWith('whsec_') && s.length > 16 ? `whsec_${s.slice(6, 10)}…${s.slice(-4)}` : s ? 'whsec_…' : null);

export function signature(secret: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  return `t=${ts},v1=${hmacSha256(secret, `${ts}.${body}`)}`;
}

export function articleJson(p: PublishPayload) {
  return {
    id: p.entryId, title: p.title, slug: p.slug, html: p.html, markdown: p.markdown, meta_description: p.meta, keyword: p.keyword,
    publish_date: p.date, canonical_url: p.canonical, mode: p.mode, refresh_url: p.refreshUrl, author: p.author,
    featured_image: p.image ? { url: p.image.url, alt: p.image.alt } : null, videos: p.videos, sources: p.sources,
  };
}

async function send(c: ConnCtx, type: string, data: any, idem: string) {
  const url = (c.fields.hook || '').trim();
  if (!url.startsWith('https://')) throw new PublishError(400, 'Endpoint must use https', '', 'config');
  if (!c.secret) throw new PublishError(401, 'Missing signing secret');
  const body = JSON.stringify({ id: 'evt_' + randomToken(12), type, created: new Date().toISOString(), data });
  const res = await req(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'user-agent': 'Radar-Webhooks/1.0', 'radar-event': type, 'radar-signature': signature(c.secret, body), 'idempotency-key': idem }, timeoutMs: 20000 });
  let j: any = null; try { j = await res.json(); } catch { /* receivers may reply with an empty body */ }
  return j;
}

export const webhook: Connector = {
  async test(c) {
    await send(c, 'radar.test', { business: { domain: c.domain, name: c.businessName }, test: true }, 'test-' + randomToken(8));
  },
  async createDraft() { return { id: 'webhook' }; },
  async publish(c, p) {
    const j = await send(c, 'article.published', { business: { domain: c.domain, name: c.businessName }, article: articleJson(p) }, p.entryId);
    const u = j && (j.url || j.data?.url);
    return { url: typeof u === 'string' && /^https?:\/\//.test(u) ? u : p.canonical || `https://${c.domain}/blog/${p.slug}` };
  },
};
