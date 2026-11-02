import type { Metadata } from 'next';
import { FEE_CENTS, PRICE_CENTS, TRIAL_DAYS } from './billing';

/** Public, fixed-origin facts only. Never derive crawler content from sessions, request hosts or customer data. */
export const SITE_ORIGIN = 'https://radar.thally.io';
export const SITE_NAME = 'Radar by Thally';
export const PRICING = {
  currency: 'USD', monthly: PRICE_CENTS / 100, confirmation: FEE_CENTS / 100,
  firstInvoice: (PRICE_CENTS - FEE_CENTS) / 100, trialDays: TRIAL_DAYS,
} as const;
export const PRICING_SUMMARY = `$${PRICING.confirmation} card-confirmation payment, credited toward the first month; ${PRICING.trialDays}-day trial; $${PRICING.firstInvoice} first monthly invoice after the credit, then $${PRICING.monthly}/month. Cancel before the trial ends to avoid the monthly subscription charge.`;

export const SEO_PAGES = [
  { path: '/', slug: 'home', index: true, title: 'Radar — Search, AI visibility and social marketing', description: 'Grow beyond your network with Radar by Thally: researched articles, AI visibility checks, social content and relevant conversations. One plan, $50/month.', cardTitle: ['Get found by people.', 'And AI.'], cardDescription: 'Search, AI visibility and social marketing for your business.', label: 'Search · AI answers · Social' },
  { path: '/features/organic-search', slug: 'organic-search', index: true, title: 'Organic search and content marketing · Radar', description: 'Plan, research and publish articles for keywords your site can realistically win. Review every draft or enable blog autopilot in Radar by Thally.', cardTitle: ['Articles built', 'to be discovered.'], cardDescription: 'Research, plan and publish where your website already lives.', label: 'Organic search' },
  { path: '/features/ai-visibility', slug: 'ai-visibility', index: true, title: 'AI visibility tracking across five assistants · Radar', description: 'Track whether ChatGPT, Perplexity, Gemini, Claude and Grok mention your business. See cited sites and turn missing answers into content with Radar.', cardTitle: ['Know what AI says', 'about your business.'], cardDescription: 'Five assistants. Nightly checks. Clear next steps.', label: 'AI visibility' },
  { path: '/features/backlinks', slug: 'backlinks', index: true, title: 'Optional, approved backlinks network · Radar', description: 'Join Radar’s optional backlinks network. Review relevant matches, approve placements and keep links disclosed. Joining is free; rankings are never guaranteed.', cardTitle: ['Relevant connections.', 'Approved by you.'], cardDescription: 'An optional backlinks network with disclosed, reviewed links.', label: 'Backlinks network' },
  { path: '/privacy', slug: 'privacy', index: true, title: 'Privacy Policy — Radar by Thally', description: 'How Radar, a Thally product operated by Fairspleet LLC, collects and uses account, business, billing and connected-service data, and your privacy choices.', cardTitle: ['Your data.', 'Your choices.'], cardDescription: 'How Radar collects, uses and protects your information.', label: 'Privacy policy' },
  { path: '/terms', slug: 'terms', index: true, title: 'Terms of Service — Radar by Thally', description: 'Read Radar’s terms for accounts, the three-day trial, card confirmation, subscriptions, publishing and cancellation. Operated by Fairspleet LLC.', cardTitle: ['Clear terms.', 'Before you begin.'], cardDescription: 'Accounts, subscriptions, publishing and your responsibilities.', label: 'Terms of service' },
  { path: '/bot', slug: 'bot', index: true, title: 'RadarBot crawler information — Radar by Thally', description: 'Learn why RadarBot visits customer websites, how it identifies itself, respects robots.txt and crawl delays, and how to control or report its access.', cardTitle: ['Meet RadarBot.'], cardDescription: 'What our crawler reads, why it visits and how to control access.', label: 'Crawler information' },
  { path: '/signup', slug: 'signup', index: false, title: 'Create your account · Radar', description: 'Create your Radar account to plan content, track AI visibility and manage search and social marketing. Review the trial and pricing terms before subscribing.', cardTitle: ['Your next customers', 'are looking.'], cardDescription: 'Create your Radar account and start with your website.', label: 'Create an account' },
  { path: '/signin', slug: 'signin', index: false, title: 'Sign in · Radar', description: 'Sign in to Radar by Thally to manage your business profile, content calendar, search performance, AI visibility, social posts and subscription.', cardTitle: ['Welcome back', 'to Radar.'], cardDescription: 'Your content, visibility and next steps in one place.', label: 'Sign in' },
] as const;
export type SeoPath = typeof SEO_PAGES[number]['path'];
export const INDEXABLE_PAGES = SEO_PAGES.filter(page => page.index);
export function absoluteUrl(path: string): string { return new URL(path, SITE_ORIGIN).href; }
export function metadataFor(path: SeoPath): Metadata {
  const page = SEO_PAGES.find(p => p.path === path)!;
  const url = absoluteUrl(page.path);
  const image = { url: absoluteUrl(`/social/${page.slug}.png`), width: 1200, height: 630, type: 'image/png', alt: `${SITE_NAME}: ${page.cardTitle.join(' ')} ${page.cardDescription}` };
  return {
    title: page.title, description: page.description,
    alternates: { canonical: url }, robots: { index: page.index, follow: true },
    openGraph: { type: 'website', locale: 'en_US', siteName: SITE_NAME, url, title: page.title, description: page.description, images: [image] },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: [{ url: image.url, alt: image.alt }] },
  };
}

export const ROOT_METADATA: Metadata = {
  metadataBase: new URL(SITE_ORIGIN), title: SITE_NAME,
  description: 'Search, AI visibility and social marketing for your business, from Radar by Thally.',
  // Public routes explicitly opt in. New account/workspace routes remain non-indexable by default.
  robots: { index: false, follow: true },
};

export function publicStructuredData() {
  const organization = `${SITE_ORIGIN}/#organization`;
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'Organization', '@id': organization, name: 'Thally', legalName: 'Fairspleet LLC', url: 'https://thally.io', contactPoint: [
      { '@type': 'ContactPoint', contactType: 'customer support', email: 'support@thally.io' },
      { '@type': 'ContactPoint', contactType: 'legal and privacy', email: 'team@thally.io' },
    ] },
    { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, name: SITE_NAME, url: absoluteUrl('/'), inLanguage: 'en', publisher: { '@id': organization } },
    { '@type': 'SoftwareApplication', '@id': `${SITE_ORIGIN}/#software`, name: 'Radar', url: absoluteUrl('/'), applicationCategory: 'BusinessApplication', operatingSystem: 'Web', publisher: { '@id': organization }, description: 'Search and social marketing software for small businesses: researched articles, AI visibility tracking, social content and relevant conversations.', offers: { '@type': 'Offer', url: absoluteUrl('/#pricing'), priceCurrency: PRICING.currency, price: PRICING.monthly, description: PRICING_SUMMARY } },
  ] };
}
/** Escape script-breaking input even though the current graph contains only static public facts. */
export function jsonLd(value: unknown): string { return JSON.stringify(value).replace(/</g, '\\u003c'); }

export function llmsText(): string {
  return `# Radar by Thally\n\n> Radar is search, AI visibility and social marketing software for small businesses. It is a product of Fairspleet LLC, the company behind Thally.\n\nRadar learns from a business website, researches and drafts articles, tracks mentions across five AI assistants, prepares social posts and finds relevant conversations. Review-first is the default; automatic publishing requires separate opt-ins. Rankings and AI recommendations are not guaranteed.\n\n## Product and features\n\n${INDEXABLE_PAGES.filter(p => p.path === '/' || p.path.startsWith('/features/')).map(p => `- [${p.title}](${absoluteUrl(p.path)}): ${p.description}`).join('\n')}\n\n## Pricing\n\n${PRICING_SUMMARY} One account subscription covers all businesses the account owns. Joining the optional backlinks network is free.\n\n- [Pricing and trial details](${absoluteUrl('/pricing.md')})\n- [Visible pricing](${absoluteUrl('/#pricing')})\n\n## Policies and contact\n\n- [Privacy policy](${absoluteUrl('/privacy')})\n- [Terms of service](${absoluteUrl('/terms')})\n- [RadarBot crawler information](${absoluteUrl('/bot')})\n- [Thally](https://thally.io): Parent product brand, operated by Fairspleet LLC.\n\nSupport and billing: support@thally.io. Legal and privacy: team@thally.io.\n\n## Optional\n\n- [Expanded product context](${absoluteUrl('/llms-full.txt')})\n- [Public page sitemap](${absoluteUrl('/sitemap.xml')})\n`;
}
export function pricingMarkdown(): string {
  return `# Radar pricing\n\nRadar by Thally is operated by Fairspleet LLC. Currency: ${PRICING.currency} (US dollars).\n\n## One monthly plan\n\n- Subscription: $${PRICING.monthly} per month.\n- Card confirmation: a $${PRICING.confirmation} payment to begin the trial; this is credited toward the first month.\n- Trial: ${PRICING.trialDays} days after the card-confirmation payment succeeds.\n- First monthly invoice: $${PRICING.firstInvoice} after applying the $${PRICING.confirmation} credit to the $${PRICING.monthly} subscription price.\n- Subsequent monthly invoices: $${PRICING.monthly}.\n- Cancel before the trial ends to avoid the monthly subscription charge. The confirmation payment is a payment, not an authorization hold; refund terms are in the Terms of Service.\n- One account subscription covers all businesses you own. A business joined as a teammate can be covered by its owner.\n\n## Included\n\nContent Calendar and researched articles; AI visibility checks; Daily Brief conversations and draft replies; social posts and visuals; Search Console performance; supported blog publishing; team invitations; and the optional backlinks network. Joining the backlinks network is free.\n\nReview-first is the default. Blog autopilot and social automatic scheduling are separate opt-ins. Social publishing to X and LinkedIn is available where enabled in the workspace; other community replies are reviewed and posted by the user. No rankings or AI citations are guaranteed.\n\n## Manage billing\n\nUse Settings → Billing in your signed-in account for the Stripe billing portal, invoices, payment methods and cancellation.\n\n- [Visible pricing](${absoluteUrl('/#pricing')})\n- [Terms and refund policy](${absoluteUrl('/terms')})\n- [Privacy policy](${absoluteUrl('/privacy')})\n- [Product overview](${absoluteUrl('/')})\n\nSupport and billing: support@thally.io. Legal and privacy: team@thally.io.\n`;
}
export function llmsFullText(): string {
  return `${llmsText()}\n# Product details\n\n## Organic search and articles\n\nRadar reads the public website supplied by a customer and creates an editable Business Profile. It researches topics and drafts articles for a Content Calendar. Articles wait for approval by default. Blog autopilot requires an explicit opt-in, a connected publishing destination and a schedule. Supported destinations include Framer, Ghost, GitHub, Notion, Shopify, Webflow, Wix, WordPress, WordPress.com and signed webhooks. The GitHub connector opens a pull request; the customer merges it to publish.\n\n## AI visibility\n\nRadar checks prompts across ChatGPT, Perplexity, Gemini, Claude and Grok with web search enabled. It reports mentions, position and cited sites. A missing or failed collection is not proof of zero visibility. No one can guarantee an assistant will recommend a product.\n\n## Social and conversations\n\nDaily Brief finds relevant conversations and drafts replies for human review and posting. It does not automatically post community replies. Social Marketing prepares posts and visuals; automatic generation and scheduling are separate opt-ins. Publishing to connected X and LinkedIn accounts is available where enabled. Facebook, Reddit and Quora content remains copy-and-paste.\n\n## Search performance and links\n\nAn optional read-only Google Search Console connection supplies actual search performance. The optional backlinks network uses approved, disclosed links with sponsored or nofollow attributes; it does not promise higher rankings.\n\n${pricingMarkdown()}\n## Scope of this document\n\nThis file contains public product facts only. Account data, customer websites, drafts, tokens and billing records are private and are not included. The linked public product pages and policies remain authoritative.\n`;
}
export function textResponse(body: string, markdown = false): Response {
  return new Response(body, { headers: { 'Content-Type': `${markdown ? 'text/markdown' : 'text/plain'}; charset=utf-8`, 'X-Robots-Tag': 'noindex, follow', 'Cache-Control': 'public, max-age=3600' } });
}
