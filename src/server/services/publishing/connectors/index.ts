// Connector registry. With RADAR_DEV_STUBS=1 every connector is replaced by a deterministic local stub (dev/test only).
import type { ConnType } from '@/lib/types';
import { slugify } from '@/lib/format';
import { env } from '@/server/env';
import type { Connector, ConnCtx, PublishPayload, Target } from '../types';
import { PublishError, siteBase } from '../http';
import { wordpress } from './wordpress';
import { ghost } from './ghost';
import { webflow } from './webflow';
import { notion } from './notion';
import { wix } from './wix';
import { shopify, shopDomain } from './shopify';
import { wpcom } from './wpcom';
import { webhook } from './webhook';
import { framer } from './framer';
import { nextjs, parseRepo } from './nextjs';

const REAL: Record<ConnType, Connector> = { wordpress, ghost, webflow, notion, wix, shopify, wpcom, webhook, framer, nextjs };

/* ── Dev stubs ── */
const STUB_TARGETS: Partial<Record<ConnType, string[]>> = {
  webflow: ['Blog Posts', 'Resources', 'Changelog'], notion: ['Blog', 'Content calendar', 'Marketing wiki'], wix: ['{domain}', '{domain} (staging)'],
  shopify: ['News', 'Journal'], wpcom: ['{domain}', 'notes.{domain}'], framer: ['Blog', 'Articles'],
  // Next.js targets are real owner/repo names (the id is the repository, stored as fields.repo).
  nextjs: ['{login}/{label}-website', '{login}/blog'],
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/** DEV-ONLY test hook: a field or credential containing "fail" makes the stub answer 401 Unauthorized. */
function stubGate(c: ConnCtx) {
  const vals = [...Object.values(c.fields || {}), ...Object.values(c.creds || {}).map(v => (typeof v === 'string' ? v : JSON.stringify(v ?? '')))];
  if (vals.some(v => /fail/i.test(String(v)))) throw new PublishError(401, 'dev stub: credential contains "fail"', 'stub');
}
/** DEV-ONLY: "unavailable" in a field makes publishing answer 503 (exercises retries + backoff). */
function stubGatePublish(c: ConnCtx) {
  stubGate(c);
  if (Object.values(c.fields || {}).some(v => /unavailable/i.test(String(v)))) throw new PublishError(503, 'dev stub: field contains "unavailable"', 'stub');
}
let prN = 40;
function stubUrl(c: ConnCtx, p: PublishPayload): string {
  const d = c.domain; const s = p.slug;
  switch (c.type) {
    case 'wordpress': case 'ghost': return `${siteBase(c.fields.url || d)}/${s}/`;
    case 'wpcom': { const [y, m, dd] = p.date.split('-'); return `https://${c.target || d}/${y}/${m}/${dd}/${s}/`; }
    case 'wix': return `https://${(c.target || d).replace(/ \(staging\)$/, '')}/post/${s}`;
    case 'shopify': return `https://${shopDomain(c.fields.store) || d}/blogs/${slugify(c.target || 'news')}/${s}`;
    case 'notion': return `https://www.notion.so/${slugify(p.title).slice(0, 60)}-${Buffer.from(p.entryId).toString('hex').padEnd(32, '0').slice(0, 32)}`;
    case 'nextjs': { const r = parseRepo(c.fields.repo); return `https://github.com/${r ? r.owner + '/' + r.repo : 'owner/repo'}/pull/${++prN}`; }
    default: return `https://${d}/blog/${s}`;
  }
}
function stub(type: ConnType): Connector {
  return {
    ...(STUB_TARGETS[type] ? { targets: async (c: ConnCtx): Promise<Target[]> => {
      await wait(250); stubGate(c);
      const vars: Record<string, string> = { domain: c.domain, login: slugify(String(c.creds?.login || 'fieldnote')) || 'fieldnote', label: slugify(c.domain.replace(/^www\./, '').split('.')[0]) || 'site' };
      return STUB_TARGETS[type]!.map(n => {
        const name = n.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
        if (type === 'nextjs') return { id: name, name, url: 'https://github.com/' + name };
        return { id: 'stub-' + slugify(name), name, url: type === 'wix' || type === 'wpcom' ? 'https://' + name.replace(/ \(staging\)$/, '') : null };
      });
    } } : {}),
    async test(c) { await wait(900); stubGate(c); },
    async createDraft(c, p) { await wait(400); stubGatePublish(c); return { id: 'stub-' + p.slug }; },
    async publish(c, p) { await wait(500); stubGatePublish(c); return { url: stubUrl(c, p) }; },
  };
}

/** DEV ONLY: with dev stubs on, RADAR_REAL_CONNECTORS lists the types that run for real (e.g. against local Docker instances).
 * Without dev stubs every connector is real anyway, so the switch has no effect in production. */
export const stubbed = (type: ConnType) => env.devStubs && !env.realConnectors.includes(type);

export function connectorFor(type: ConnType): Connector {
  const real = REAL[type];
  if (!real) throw new PublishError(400, 'Unknown platform', '', 'config');
  return stubbed(type) ? stub(type) : real;
}
