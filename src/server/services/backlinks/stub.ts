// DEV ONLY (RADAR_DEV_STUBS=1). Synthetic network partners with crawled pages, so matching, approval, live-link checks and
// removal can be exercised end to end without other real businesses in the network. Never runs in production.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import { addDays, slugify, todayIn } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { metaOf, patchMeta, type BizRow } from './network';
import type { HostPage, TargetPage } from './matching';

const STUB_OWNER = 'network-partners@radar.local';

interface SynthPartner { domain: string; name: string; description: string; industry: string; offerings: string[]; segments: string[]; needs: string[]; pages: { path: string; title: string; h1?: string; text: string }[] }

const PARTNERS: SynthPartner[] = [
  { domain: 'paperandpixel.co', name: 'Paper & Pixel', description: 'Newsletter and blog for independent illustrators', industry: 'Publishing · Creative business', offerings: ['Newsletter for illustrators', 'Pricing guides', 'Client templates'], segments: ['Freelance illustrators', 'Independent designers'], needs: ['Price work confidently', 'Get paid on time'],
    pages: [
      { path: '/notes/pricing-your-first-commission', title: 'Pricing your first commission', text: 'Pricing your first commission is mostly about confidence. Start from the hours you expect to spend, then add a buffer for revisions. Once you’ve agreed on a price, send a clear invoice. A simple freelance invoice template saves you from chasing payments later. Keep a record of every change the client asks for, because small requests add up quickly.' },
      { path: '/notes/rates', title: 'How illustrators set rates', text: 'Setting rates is the hardest part of going independent. Most illustrators undercharge in their first year because they forget about admin time. Raising your rates once a year keeps your income in line with your experience.' },
    ] },
  { domain: 'studioledger.com', name: 'Studio Ledger', description: 'Accounting guides for creative agencies', industry: 'Accounting · Creative agencies', offerings: ['Bookkeeping for agencies', 'Profitability reviews', 'Tax planning'], segments: ['Small design studios', 'Creative agencies'], needs: ['Know which projects are profitable', 'Spend less time on admin'],
    pages: [
      { path: '/guides/agency-profitability', title: 'The agency profitability checklist', h1: 'Is your agency still profitable?', text: 'Most agencies only find out a project lost money after the final invoice goes out. Profitability starts with knowing where hours go, and tracking time from your calendar is one low-effort way to get there. Compare budgeted and actual hours every week, not at the end of the project.' },
    ] },
  { domain: 'brightlinetax.com', name: 'Brightline Tax', description: 'Tax prep for freelancers', industry: 'Tax services', offerings: ['Tax returns for freelancers', 'Quarterly estimates'], segments: ['Freelancers', 'Independent consultants'], needs: ['Stay organized for tax season', 'Spend less time on admin'],
    pages: [
      { path: '/blog/1099-checklist', title: 'Your 1099 checklist', text: 'Tax season is easier when your records are in one place. Keep records of every invoice you send, so your invoicing tool can export them in one file. Set aside a share of every payment for quarterly estimates.' },
    ] },
  { domain: 'quietops.io', name: 'Quiet Ops', description: 'Operations playbooks for small studios', industry: 'Consulting · Operations', offerings: ['Ops playbooks', 'Tool audits'], segments: ['Small design studios', 'Studio owners'], needs: ['Spend less time on admin'],
    pages: [
      { path: '/blog/tools', title: 'The small-studio tool stack', text: 'A small studio needs fewer tools than you think. Pick one place for projects, one for files and one for billing. Flat-priced tools are easier to budget for than per-seat plans as the team grows.' },
    ] },
  { domain: 'makersmonthly.com', name: 'Makers Monthly', description: 'A monthly magazine about independent makers', industry: 'Publishing', offerings: ['Monthly magazine', 'Maker interviews'], segments: ['Independent makers', 'Freelance designers'], needs: ['Find good tools'],
    pages: [
      { path: '/issues/48', title: 'Issue 48: The admin issue', text: 'This month we asked twelve designers how they handle admin. Almost all of them said the same thing: the less time spent on invoices, the more time for actual work. Several of them track time straight from their calendar instead of running timers.' },
    ] },
];

let ensured = false;
export async function ensureSyntheticPartners() {
  if (!env.devStubs || ensured) return;
  let owner = (await db.select().from(schema.users).where(eq(schema.users.email, STUB_OWNER)).limit(1))[0];
  if (!owner) [owner] = await db.insert(schema.users).values({ name: 'Network partners (dev)', email: STUB_OWNER }).returning();
  for (const p of PARTNERS) {
    let b = (await db.select().from(schema.businesses).where(and(eq(schema.businesses.domain, p.domain), eq(schema.businesses.ownerId, owner.id))).limit(1))[0];
    if (!b) {
      const profile: Profile = { domain: p.domain, business: { name: p.name, description: p.description, offerings: p.offerings, industry: p.industry, positioning: '', differentiators: [] }, audience: { segments: p.segments, buyers: [], needs: p.needs, competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#2F5BD3', secondary: '#E8E2D4', voice: '', language: 'English (US)', markets: ['United States'] } };
      // status 'onboarding' keeps other areas' crons (brief, calendar, publishing…) from treating these as real customers.
      [b] = await db.insert(schema.businesses).values({ ownerId: owner.id, domain: p.domain, status: 'onboarding', profile, backlinks: { joined: true, synthetic: true, prefs: { outbound: true, qualify: true, max: 8 } } }).returning();
      await db.insert(schema.members).values({ businessId: b.id, userId: owner.id, email: 'editor@' + p.domain, role: 'Owner', status: 'active' }).onConflictDoNothing();
    }
    for (const pg of p.pages) {
      await db.insert(schema.crawlPages).values({ businessId: b.id, url: 'https://' + p.domain + pg.path, path: pg.path, title: pg.title, kind: 'article', h1: pg.h1 || pg.title, description: '', text: pg.text, links: [] }).onConflictDoNothing();
    }
  }
  ensured = true;
}

/** Stub target pages on the user's own site when it hasn't been crawled (keyword-derived paths). Not persisted. */
export function stubTargetPages(b: BizRow): TargetPage[] {
  const p = b.profile as Profile;
  return (p?.keywords?.list || []).slice(0, 8).map(k => ({ url: `${b.domain}/blog/${slugify(k.kw.replace(/^(free|best)\s+/i, ''))}`, title: k.kw.charAt(0).toUpperCase() + k.kw.slice(1), about: k.kw }));
}
/** Stub host page on the user's own site for outbound requests. Not persisted. */
export function stubHostPages(b: BizRow): HostPage[] {
  const p = b.profile as Profile;
  const kw = (p?.keywords?.list || []).find(k => k.intent === 'Informational')?.kw || 'notes';
  return [{ url: `${b.domain}/blog/${slugify(kw)}`, title: kw.charAt(0).toUpperCase() + kw.slice(1), text: `${kw.charAt(0).toUpperCase() + kw.slice(1)} rarely announces itself. If a project overruns, check whether your agency is still profitable before agreeing to more work. Write the change down and price it before you start.`, links: [] }];
}

/** A few live links (incl. Editorial and one lost) the first time a business joins in stub mode. */
export async function seedStubLiveLinks(a: BizRow) {
  if (!env.devStubs || metaOf(a).stubSeeded) return;
  const today = todayIn(a.timezone);
  const p = a.profile as Profile;
  const kw = (p?.keywords?.list || []).find(k => k.intent === 'Informational')?.kw || 'notes';
  const off = String(p?.business?.offerings?.[0] || 'your product').toLowerCase();
  const rows = [
    { fromUrl: 'makersmonthly.com/issues/48', toUrl: a.domain, anchor: p?.business?.name || a.domain, rel: 'Editorial', since: addDays(today, -78), status: 'live' as const },
    { fromUrl: `${a.domain}/blog/${slugify(kw)}`, toUrl: 'paperandpixel.co/notes/rates', anchor: 'how illustrators set rates', rel: 'Editorial', since: addDays(today, -38), status: 'live' as const },
    { fromUrl: 'quietops.io/blog/tools', toUrl: `${a.domain}/pricing`, anchor: `flat-priced ${off}`, rel: 'sponsored', since: addDays(today, -92), status: 'lost' as const },
  ];
  for (const r of rows) {
    const exists = await db.select({ id: schema.liveLinks.id }).from(schema.liveLinks).where(and(eq(schema.liveLinks.businessId, a.id), eq(schema.liveLinks.fromUrl, r.fromUrl), eq(schema.liveLinks.toUrl, r.toUrl))).limit(1);
    if (!exists[0]) await db.insert(schema.liveLinks).values({ businessId: a.id, ...r, lastCheckedAt: new Date() });
  }
  await patchMeta(a.id, { stubSeeded: true });
}
