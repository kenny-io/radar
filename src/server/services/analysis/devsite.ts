// DEV ONLY (RADAR_DEV_STUBS=1). Synthesizes a small, realistic website for any domain so the real crawler,
// extractor and brand detection run end to end without touching the network.
//   fieldnote.app            → the Fieldnote sample (prototype/radar-data.js)
//   *unreachable*            → every request fails (crawl-failure state)
//   *nologo*                 → no icons, header logo or og:image (logo-not-found state)
//   anything else            → a generic plausible small-business site (one of three verticals, chosen by domain)
import type { Profile } from '@/lib/types';

export interface DevProfile {
  business: Profile['business']; audience: Profile['audience'];
  brand: { primary: string; secondary: string; voice: string; language: string; markets: string[] };
  keywords: { kw: string; intent: 'Commercial' | 'Informational' }[];
  needsKeywords: { kw: string; need: string }[];
  /** Keywords the competitors rank for and the site doesn't (dev stub for competitor gaps). */
  gapKeywords?: string[];
  pages: { path: string; title: string; h1: string; desc: string; body: string; article?: boolean }[];
  htmlLang: string;
}

const FIELDNOTE: DevProfile = {
  business: { name: 'Fieldnote', description: 'Time tracking and invoicing for independent designers and small studios.', offerings: ['Calendar-based time tracking', 'Project budgets', 'One-click invoicing', 'Client portal'], industry: 'B2B software · Productivity', positioning: 'The calm alternative to enterprise time trackers — built for people who bill by the hour, not managers who monitor them.', differentiators: ['Tracks time from your calendar, no timers', 'Invoices straight from tracked hours', 'Flat pricing with no per-seat fees'] },
  audience: { segments: ['Freelance designers', 'Small design studios (2–15 people)', 'Independent consultants'], buyers: ['Studio owner', 'Solo freelancer'], needs: ['Bill accurately without micromanaging', 'Spend less time on admin', 'Know which projects are profitable'], competitors: ['Tallyhour', 'Billable', 'Hourwise'] },
  brand: { primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain-spoken and warm. Practical over clever. Talks to designers as peers, never down to them.', language: 'English (US)', markets: ['United States', 'United Kingdom', 'Canada'] },
  keywords: [
    { kw: 'calendar time tracking', intent: 'Commercial' }, { kw: 'time tracking for designers', intent: 'Commercial' }, { kw: 'track billable hours', intent: 'Informational' },
    { kw: 'freelance invoice template', intent: 'Commercial' }, { kw: 'freelance design rates', intent: 'Informational' }, { kw: 'scope creep', intent: 'Informational' },
    { kw: 'project profitability', intent: 'Informational' }, { kw: 'billable vs non-billable hours', intent: 'Informational' }, { kw: 'tallyhour alternative', intent: 'Commercial' },
    { kw: 'raise freelance rates', intent: 'Informational' }, { kw: 'design invoice template', intent: 'Commercial' }, { kw: 'client portal for designers', intent: 'Commercial' },
  ],
  gapKeywords: ['time tracking for freelancers', 'invoice software for designers', 'timesheet template'],
  needsKeywords: [{ kw: 'studio utilization rate', need: 'Know which projects are profitable' }, { kw: 'how to bill clients hourly', need: 'Bill accurately without micromanaging' }],
  htmlLang: 'en-US',
  pages: [
    { path: '/', title: 'Fieldnote — Time tracking for designers who bill by the hour', h1: 'Track time from your calendar. Invoice in one click.', desc: 'Time tracking and invoicing for independent designers and small studios.', body: 'Fieldnote turns your calendar into timesheets, so you never start a timer again. Set project budgets, see which clients are profitable, and send invoices straight from tracked hours. Built for freelance designers and small design studios. Flat pricing, no per-seat fees. The calm alternative to enterprise time trackers.' },
    { path: '/features', title: 'Features — Fieldnote', h1: 'Everything you need to bill accurately', desc: 'Calendar tracking, budgets, invoicing and a client portal.', body: 'Calendar-based time tracking. Project budgets with burn alerts. One-click invoicing from tracked hours. A client portal where clients see progress and pay invoices.' },
    { path: '/features/calendar-tracking', title: 'Calendar-based time tracking — Fieldnote', h1: 'Your calendar is already your timesheet', desc: 'Fieldnote reads your Google or Outlook calendar and turns events into billable time.', body: 'Connect your calendar and Fieldnote suggests time entries from your events. No timers, no reminders, no guesswork at the end of the week.' },
    { path: '/features/budgets', title: 'Project budgets — Fieldnote', h1: 'Know when a project is going over', desc: 'Set budgets in hours or money and see burn as you go.', body: 'Budgets in hours or currency. See burn rate by week. Get a heads-up before scope creep eats your margin.' },
    { path: '/features/invoicing', title: 'Invoicing — Fieldnote', h1: 'Invoices straight from tracked hours', desc: 'Turn tracked time into a clean invoice in one click.', body: 'Pick a client, pick a date range, send. Fieldnote fills line items from tracked hours and your rates. Accept card and bank payments.' },
    { path: '/features/client-portal', title: 'Client portal — Fieldnote', h1: 'A calm place for clients to check in', desc: 'Clients see progress, approve hours and pay invoices.', body: 'Share a link. Clients see hours against budget, approve timesheets and pay invoices without a login.' },
    { path: '/pricing', title: 'Pricing — Fieldnote', h1: 'Flat pricing. No per-seat fees.', desc: 'One price for your whole studio.', body: 'Solo: $12/month. Studio: $39/month for up to 15 people. No per-seat fees. Prices in USD, GBP and CAD.' },
    { path: '/about', title: 'About — Fieldnote', h1: 'Made by designers who hated timers', desc: 'Fieldnote is a small, independent team.', body: 'We ran a design studio for ten years and never found a time tracker that respected how designers work. So we built one. We are a small team in Portland, London and Toronto.' },
    { path: '/customers', title: 'Customers — Fieldnote', h1: 'Studios that bill with Fieldnote', desc: 'Freelancers and small studios across the US, UK and Canada.', body: 'From solo illustrators to 12-person brand studios, Fieldnote customers bill more accurately and spend less time on admin.' },
    { path: '/customers/northwind-studio', title: 'Northwind Studio — Fieldnote customer story', h1: 'Northwind Studio recovered 11% of unbilled time', desc: 'A 9-person brand studio in Chicago.', body: 'Northwind switched from timers to calendar tracking and found 11% more billable time in the first quarter.' },
    { path: '/customers/ada-park', title: 'Ada Park — Fieldnote customer story', h1: 'How Ada Park invoices in five minutes', desc: 'A freelance product designer in London.', body: 'Ada used to spend Friday afternoons on invoices. Now it takes five minutes.' },
    { path: '/customers/fold-and-co', title: 'Fold & Co — Fieldnote customer story', h1: 'Fold & Co found its most profitable clients', desc: 'A packaging studio in Toronto.', body: 'Project budgets showed Fold & Co which retainers were losing money.' },
    { path: '/integrations', title: 'Integrations — Fieldnote', h1: 'Works with the tools you already use', desc: 'Google Calendar, Outlook, Stripe and QuickBooks.', body: 'Connect your calendar, payments and accounting.' },
    { path: '/integrations/google-calendar', title: 'Google Calendar integration — Fieldnote', h1: 'Google Calendar', desc: 'Turn Google Calendar events into time entries.', body: 'Read-only access. Choose which calendars count as work.' },
    { path: '/integrations/outlook', title: 'Outlook integration — Fieldnote', h1: 'Outlook', desc: 'Turn Outlook events into time entries.', body: 'Works with Microsoft 365 and Outlook.com.' },
    { path: '/integrations/stripe', title: 'Stripe integration — Fieldnote', h1: 'Stripe', desc: 'Get paid by card from every invoice.', body: 'Clients pay invoices by card or bank transfer.' },
    { path: '/integrations/quickbooks', title: 'QuickBooks integration — Fieldnote', h1: 'QuickBooks', desc: 'Sync invoices and payments to QuickBooks.', body: 'Invoices and payments sync automatically.' },
    { path: '/security', title: 'Security — Fieldnote', h1: 'Security', desc: 'How we protect your data.', body: 'Encrypted at rest and in transit. Read-only calendar access.' },
    { path: '/changelog', title: 'Changelog — Fieldnote', h1: 'What’s new', desc: 'Product updates.', body: 'Budget alerts, CAD invoices, client approvals.' },
    { path: '/contact', title: 'Contact — Fieldnote', h1: 'Talk to us', desc: 'We answer every email.', body: 'hello@fieldnote.app' },
    { path: '/help', title: 'Help center — Fieldnote', h1: 'Help center', desc: 'Guides and answers.', body: 'Getting started, calendars, invoices, billing.' },
    { path: '/legal/terms', title: 'Terms — Fieldnote', h1: 'Terms of service', desc: 'Terms of service.', body: 'Terms.' },
    { path: '/legal/privacy', title: 'Privacy — Fieldnote', h1: 'Privacy policy', desc: 'Privacy policy.', body: 'Privacy.' },
    { path: '/blog', title: 'Blog — Fieldnote', h1: 'Field notes', desc: 'Writing about running a design practice.', body: 'Pricing, invoicing, time tracking and running a studio.' },
    ...[
      ['/blog/invoice-template', 'Free invoice template for freelancers'], ['/blog/calendar-tracking', 'Why we track time from your calendar'], ['/blog/scope-creep', 'Scope creep: a field guide'],
      ['/blog/raising-rates', 'Raising your rates'], ['/blog/billable-vs-non-billable', 'Billable vs. non-billable hours'], ['/blog/project-profitability', 'How to calculate project profitability'],
      ['/blog/design-retainers', 'What to include in a design retainer'], ['/blog/late-invoices', 'Late invoice emails that get you paid'], ['/blog/hourly-vs-project', 'Hourly vs. project pricing'],
      ['/blog/estimating-projects', 'How to estimate design projects'], ['/blog/net-30', 'Net 30 vs. upfront deposits'], ['/blog/multiple-clients', 'Tracking time across multiple clients'],
      ['/blog/quarterly-taxes', 'A freelancer’s guide to quarterly taxes'], ['/blog/weekly-review', 'How to run a weekly studio review'], ['/blog/value-pricing', 'Value-based pricing for designers'],
      ['/blog/burn-rate', 'What is budget burn rate?'], ['/blog/statement-of-work', 'Writing a statement of work'], ['/blog/year-end-review', 'A year-end review for independent designers'],
    ].map(([path, t]) => ({ path, title: `${t} — Fieldnote`, h1: t, desc: `${t}. Practical advice for freelance designers and small studios.`, body: `${t}. A practical guide from the Fieldnote team for freelance designers and small studios who bill by the hour.`, article: true })),
  ],
};

interface Vertical { match: RegExp; make: (name: string, domain: string) => DevProfile }
const VERTICALS: Vertical[] = [
  { match: /coffee|roast|cafe|bean|brew/, make: (name) => ({
    business: { name, description: 'Small-batch specialty coffee, roasted weekly and shipped fresh to homes and offices.', offerings: ['Single-origin coffee', 'Coffee subscriptions', 'Office coffee', 'Brewing gear'], industry: 'Food & beverage · Specialty coffee', positioning: 'A neighborhood roaster that ships — fresh, traceable coffee without the subscription-box gimmicks.', differentiators: ['Roasted to order every Monday', 'Direct-trade farms named on every bag', 'Pause or skip deliveries anytime'] },
    audience: { segments: ['Home coffee enthusiasts', 'Small offices', 'Gift buyers'], buyers: ['Home brewer', 'Office manager'], needs: ['Fresh coffee delivered on a schedule', 'Know where their coffee comes from', 'Easy gifting'], competitors: ['Trade Coffee', 'Blue Bottle', 'Counter Culture'] },
    brand: { primary: '#5B3A29', secondary: '#E9C46A', voice: 'Friendly and knowledgeable, never snobby. Explains coffee in plain words.', language: 'English (US)', markets: ['United States'] },
    keywords: [{ kw: 'coffee subscription', intent: 'Commercial' }, { kw: 'single origin coffee', intent: 'Commercial' }, { kw: 'fresh roasted coffee beans', intent: 'Commercial' }, { kw: 'office coffee delivery', intent: 'Commercial' }, { kw: 'how to brew pour over', intent: 'Informational' }, { kw: 'light vs dark roast', intent: 'Informational' }, { kw: 'coffee gift box', intent: 'Commercial' }, { kw: 'best coffee grinder', intent: 'Commercial' }],
    gapKeywords: ['coffee beans subscription', 'best espresso beans'],
    needsKeywords: [{ kw: 'direct trade coffee', need: 'Know where their coffee comes from' }],
    htmlLang: 'en-US', pages: [] }) },
  { match: /tax|account|cpa|book|ledger|finance/, make: (name) => ({
    business: { name, description: 'Bookkeeping, tax preparation and advisory for small businesses and self-employed professionals.', offerings: ['Monthly bookkeeping', 'Tax preparation', 'Payroll', 'Financial advisory'], industry: 'Professional services · Accounting', positioning: 'A modern accounting practice for owners who want clear numbers and a real person to call.', differentiators: ['Fixed monthly fees', 'A dedicated accountant', 'Books closed by the 10th of every month'] },
    audience: { segments: ['Small business owners', 'Self-employed professionals', 'Early-stage startups'], buyers: ['Business owner', 'Founder'], needs: ['Stay compliant without the stress', 'Understand cash flow', 'Save time on admin'], competitors: ['Bench', 'Pilot', 'Local CPA firms'] },
    brand: { primary: '#1D3557', secondary: '#A8DADC', voice: 'Calm, clear and reassuring. Explains money matters without jargon.', language: 'English (US)', markets: ['United States'] },
    keywords: [{ kw: 'small business bookkeeping', intent: 'Commercial' }, { kw: 'tax preparation for self employed', intent: 'Commercial' }, { kw: 'outsourced accounting', intent: 'Commercial' }, { kw: 'quarterly estimated taxes', intent: 'Informational' }, { kw: 'cash flow forecast template', intent: 'Commercial' }, { kw: 'bookkeeping vs accounting', intent: 'Informational' }, { kw: 'payroll services for small business', intent: 'Commercial' }, { kw: 'business tax deductions', intent: 'Informational' }],
    gapKeywords: ['online bookkeeping service', 'small business tax accountant'],
    needsKeywords: [{ kw: 'how to read a cash flow statement', need: 'Understand cash flow' }],
    htmlLang: 'en-US', pages: [] }) },
  { match: /./, make: (name) => ({
    business: { name, description: 'Brand and website design for small businesses that have outgrown their first website.', offerings: ['Brand identity', 'Website design', 'Website care plans', 'Copywriting'], industry: 'Creative services · Design agency', positioning: 'A small studio that gives growing businesses a brand and website they can run themselves.', differentiators: ['Fixed-price projects', 'Sites you can edit without a developer', 'Launch in six weeks'] },
    audience: { segments: ['Small business owners', 'Professional services firms', 'Local service businesses'], buyers: ['Owner', 'Marketing lead'], needs: ['Look credible online', 'Get more enquiries from the website', 'Update the site without help'], competitors: ['Local agencies', 'Squarespace experts', 'Freelance designers'] },
    brand: { primary: '#2F5BD3', secondary: '#F4A261', voice: 'Confident and approachable. Short sentences, concrete examples, no buzzwords.', language: 'English (US)', markets: ['United States', 'Canada'] },
    keywords: [{ kw: 'small business website design', intent: 'Commercial' }, { kw: 'brand identity design', intent: 'Commercial' }, { kw: 'website redesign cost', intent: 'Informational' }, { kw: 'website care plan', intent: 'Commercial' }, { kw: 'how to write a website brief', intent: 'Informational' }, { kw: 'webflow vs squarespace', intent: 'Commercial' }, { kw: 'brand guidelines template', intent: 'Commercial' }, { kw: 'what makes a good homepage', intent: 'Informational' }],
    gapKeywords: ['web design agency for small business'],
    needsKeywords: [{ kw: 'website that generates leads', need: 'Get more enquiries from the website' }],
    htmlLang: 'en-US', pages: [] }) },
];

function titleCase(domain: string) {
  const base = domain.split('.')[0].replace(/nologo|unreachable/g, ' ').replace(/[-_]+/g, ' ').trim() || 'Northbeam';
  return base.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function genericPages(p: DevProfile): DevProfile['pages'] {
  const n = p.business.name;
  const pages: DevProfile['pages'] = [
    { path: '/', title: `${n} — ${p.business.description.split(',')[0]}`, h1: p.business.positioning, desc: p.business.description, body: `${p.business.description} ${p.business.differentiators.join('. ')}. ${p.business.offerings.join(', ')}.` },
    { path: '/about', title: `About — ${n}`, h1: `About ${n}`, desc: `The team behind ${n}.`, body: `${n} is an independent business serving ${p.audience.segments.join(', ').toLowerCase()}. ${p.business.positioning}` },
    { path: '/pricing', title: `Pricing — ${n}`, h1: 'Simple, clear pricing', desc: `Plans and pricing for ${n}.`, body: `Transparent pricing. ${p.business.differentiators[0]}.` },
    { path: '/contact', title: `Contact — ${n}`, h1: 'Get in touch', desc: `Contact ${n}.`, body: 'We reply within one business day.' },
    { path: '/faq', title: `FAQ — ${n}`, h1: 'Frequently asked questions', desc: 'Answers to common questions.', body: p.audience.needs.join('. ') },
    ...p.business.offerings.map(o => ({ path: '/services/' + o.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: `${o} — ${n}`, h1: o, desc: `${o} from ${n}.`, body: `${o} for ${p.audience.segments[0].toLowerCase()}. ${p.business.differentiators.join('. ')}.` })),
    { path: '/blog', title: `Journal — ${n}`, h1: 'Journal', desc: `Notes from ${n}.`, body: 'Guides and stories.' },
  ];
  const posts = p.keywords.slice(0, 6).map(k => k.kw);
  for (const t of posts) { const h = t.charAt(0).toUpperCase() + t.slice(1); pages.push({ path: '/blog/' + t.replace(/[^a-z0-9]+/g, '-'), title: `${h}: a practical guide — ${n}`, h1: `${h}: a practical guide`, desc: `Everything you need to know about ${t}.`, body: `A practical guide to ${t} for ${p.audience.segments[0].toLowerCase()}.`, article: true }); }
  return pages;
}

export function devProfileFor(domain: string): DevProfile {
  if (domain === 'fieldnote.app') return FIELDNOTE;
  const name = titleCase(domain);
  const v = VERTICALS.find(x => x.match.test(domain))!;
  const p = v.make(name, domain);
  p.pages = genericPages(p);
  return p;
}

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function logoSvg(p: DevProfile) {
  const letter = esc(p.business.name.charAt(0).toUpperCase() || 'R');
  if (p.business.name === 'Fieldnote') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="17" fill="${p.brand.primary}"/><path d="M21 17h24M21 17v30M21 32h17" stroke="${p.brand.secondary}" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="17" fill="${p.brand.primary}"/><circle cx="46" cy="18" r="7" fill="${p.brand.secondary}"/><text x="32" y="44" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" fill="#FFFFFF">${letter}</text></svg>`;
}

function pageHtml(domain: string, p: DevProfile, pg: DevProfile['pages'][number], noLogo: boolean) {
  const nav = p.pages.filter(x => !x.article && x.path.split('/').length <= 2).map(x => `<a href="${x.path}">${esc(x.h1.split(' ').slice(0, 3).join(' '))}</a>`).join(' ');
  const related = p.pages.filter(x => x.path !== pg.path).slice(0, 60).map(x => `<li><a href="https://${domain}${x.path}">${esc(x.title)}</a></li>`).join('');
  const head = noLogo ? '' : `<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/logo.svg" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.svg" sizes="180x180"><meta property="og:image" content="https://${domain}/og.png">`;
  const headerLogo = noLogo ? `<span class="wordmark">${esc(p.business.name)}</span>` : `<a href="/" class="logo"><img src="/brand/logo.svg" alt="${esc(p.business.name)} logo"></a>`;
  return `<!doctype html><html lang="${p.htmlLang}"><head><meta charset="utf-8"><title>${esc(pg.title)}</title><meta name="description" content="${esc(pg.desc)}">${pg.article ? '<meta property="og:type" content="article">' : '<meta property="og:type" content="website">'}<meta name="theme-color" content="${p.brand.primary}">${head}<link rel="stylesheet" href="/assets/site.css"><style>:root{--brand-primary:${p.brand.primary};--brand-accent:${p.brand.secondary}}</style></head>
<body><header>${headerLogo}<nav>${nav}</nav></header><main>${pg.article ? `<article><h1>${esc(pg.h1)}</h1><time datetime="2026-09-${String(10 + (pg.path.length % 18)).padStart(2, '0')}">Sep 2026</time><p>${esc(pg.body)}</p></article>` : `<h1>${esc(pg.h1)}</h1><p>${esc(pg.body)}</p>`}<ul>${related}</ul></main><footer>© 2026 ${esc(p.business.name)} · <a href="/legal/privacy">Privacy</a></footer></body></html>`;
}

export class DevFetchError extends Error { constructor(public code: string) { super(code); } }

/** Fetch-like response for the dev site. Throws DevFetchError('ECONNREFUSED') for unreachable domains. */
export async function devFetch(url: string): Promise<{ status: number; type: string; body: Buffer; url: string }> {
  const u = new URL(url);
  const domain = u.hostname.replace(/^www\./, '');
  if (domain.includes('unreachable')) { await new Promise(r => setTimeout(r, 400)); throw new DevFetchError('ECONNREFUSED'); }
  const p = devProfileFor(domain); const noLogo = domain.includes('nologo');
  const txt = (s: string, type = 'text/html; charset=utf-8') => ({ status: 200, type, body: Buffer.from(s), url });
  const path = u.pathname.replace(/\/$/, '') || '/';
  if (path === '/robots.txt') return txt(`User-agent: *\nDisallow: /admin\nDisallow: /cart\n\nSitemap: https://${domain}/sitemap.xml\n`, 'text/plain');
  if (path === '/sitemap.xml') return txt(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${p.pages.map(x => `<url><loc>https://${domain}${x.path === '/' ? '/' : x.path}</loc></url>`).join('')}</urlset>`, 'application/xml');
  if (path === '/assets/site.css') return txt(`:root{--color-primary:${p.brand.primary};--color-secondary:${p.brand.secondary};--ink:#17181C}body{font-family:system-ui;color:var(--ink)}a{color:var(--color-primary)}`, 'text/css');
  if (!noLogo && (path === '/brand/logo.svg' || path === '/apple-touch-icon.svg')) return txt(logoSvg(p), 'image/svg+xml');
  if (path === '/admin') return txt('<html><body>admin</body></html>');
  const pg = p.pages.find(x => x.path === path);
  if (!pg) return { status: 404, type: 'text/html', body: Buffer.from('<html><body><h1>Not found</h1></body></html>'), url };
  return txt(pageHtml(domain, p, pg, noLogo));
}
