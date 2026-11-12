// Synthetic repositories for the two refresh failures: a page addressed by a root-relative URL (9 Nov), and a page that
// is a typed hub record rather than a blog post (10 Nov). All content is generated.
import type { PublishPayload } from '../../types';
import { paragraph, phrase, seeded, sentence } from './article';
import type { AgentOutput } from './tree';

// --- Standalone HTML guides, refreshed by a root-relative URL -----------------------------------------------------------

export const GUIDE_SLUG = 'renting-checklist';
export const GUIDE_PATH = `site/guides/${GUIDE_SLUG}.html`;
export const GUIDE_ROUTE = `/guides/${GUIDE_SLUG}`;
/** What the calendar historically stored for a refresh: a path on the business site, here with a trailing slash. */
export const GUIDE_REFRESH_URL = `/guides/${GUIDE_SLUG}/`;

const guide = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <link rel="stylesheet" href="/assets/site.css" />
  </head>
  <body>
    <header class="site-header"><a href="/">Home</a> <a href="/guides/">Guides</a></header>
    <main id="guide-body">
${body}
    </main>
    <footer class="site-footer">Example Rentals. All guides are reviewed twice a year.</footer>
  </body>
</html>
`;
const oldBody = (seed: number) => { const random = seeded(seed); return Array.from({ length: 3 }, () => `      <h2>${phrase(random)}</h2>\n      <p>${paragraph(random)}</p>\n      <p>${paragraph(random)}</p>`).join('\n'); };

export function guideRepository(): Map<string, string> {
  return new Map([
    [GUIDE_PATH, guide('Renting checklist', oldBody(8100))],
    ['site/guides/moving-day.html', guide('Moving day', oldBody(8101))],
    ['site/guides/index.html', guide('Guides', `      <ul>\n        <li><a href="${GUIDE_ROUTE}/">Renting checklist</a></li>\n        <li><a href="/guides/moving-day/">Moving day</a></li>\n      </ul>`)],
  ]);
}
/** Good: the body inside <main> is replaced with the supplied HTML; head, header, footer and the route stay. */
export function guideRefreshed(original: string, payload: PublishPayload): AgentOutput {
  const start = original.indexOf('<main id="guide-body">\n') + '<main id="guide-body">\n'.length; const end = original.indexOf('    </main>');
  const body = payload.html.split('\n').map(line => '      ' + line).join('\n') + '\n';
  return { files: { [GUIDE_PATH]: original.slice(0, start) + body + original.slice(end) }, articlePath: GUIDE_PATH, route: GUIDE_ROUTE, slug: GUIDE_SLUG };
}

// --- Typed hub records --------------------------------------------------------------------------------------------------

export const HUBS_PATH = 'apps/web/lib/area-hubs.ts';
export const HUB_SLUG = 'larkfield';
export const HUB_ROUTE = `/areas/${HUB_SLUG}`;
export const HUB_COUNT = 24;

const q = (text: string) => "'" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
function hub(slug: string, seed: number): string {
  const random = seeded(seed);
  const body = Array.from({ length: 3 }, () => `<h2>${phrase(random)}</h2><p>${paragraph(random)}</p><p>${paragraph(random)}</p>`).join('');
  return [
    '  {', `    slug: ${q(slug)},`, `    name: ${q(phrase(random, 2))},`, `    updatedAt: '2025-0${1 + (seed % 9)}-20',`, `    summary: ${q(sentence(random))},`, `    bodyHtml: ${q(body)},`,
    '    faqs: [', `      { question: ${q(phrase(random, 5) + '?')}, answer: ${q(sentence(random))} },`, `      { question: ${q(phrase(random, 5) + '?')}, answer: ${q(sentence(random))} },`, '    ],', '  },',
  ].join('\n');
}
const HUBS_HEADER = `// Area hub pages. /areas/[slug] renders one record; the areas directory lists them all.
export interface AreaHub {
  slug: string;
  name: string;
  updatedAt: string;
  summary: string;
  /** Trusted, statically authored HTML rendered inside the hub's editorial slot. */
  bodyHtml: string;
  faqs: { question: string; answer: string }[];
}

export const areaHubs: AreaHub[] = [
`;
const HUBS_FOOTER = `];\n`;
const hubSlugs = () => Array.from({ length: HUB_COUNT }, (_, i) => (i === 9 ? HUB_SLUG : `area-${i + 1}`));

export function hubRepository(): Map<string, string> {
  return new Map([[HUBS_PATH, HUBS_HEADER + hubSlugs().map((slug, i) => hub(slug, 9000 + i)).join('\n') + '\n' + HUBS_FOOTER]]);
}
const bodyLine = (payload: PublishPayload) => `    bodyHtml: ${q(payload.html.replace(/\n/g, ''))},`;
/** Good: only the target record's body line is replaced, with the supplied HTML as a single-quoted string. */
export function hubRefreshed(original: string, payload: PublishPayload): AgentOutput {
  const lines = original.split('\n');
  const at = lines.findIndex((line, i) => line.startsWith('    bodyHtml: ') && lines.slice(0, i).reverse().find(l => l.startsWith('    slug: ')) === `    slug: ${q(HUB_SLUG)},`);
  lines[at] = bodyLine(payload);
  return { files: { [HUBS_PATH]: lines.join('\n') }, articlePath: HUBS_PATH, route: HUB_ROUTE, slug: HUB_SLUG };
}
/** Bad: the agent rewrote the file around the one record it cared about; every other hub is gone. */
export function hubPeersWiped(original: string, payload: PublishPayload): AgentOutput {
  const record = ['  {', `    slug: ${q(HUB_SLUG)},`, `    name: 'Larkfield',`, `    updatedAt: ${q(payload.date)},`, `    summary: ${q(payload.meta)},`, bodyLine(payload), '    faqs: [],', '  },'].join('\n');
  return { files: { [HUBS_PATH]: HUBS_HEADER + record + '\n' + HUBS_FOOTER }, articlePath: HUBS_PATH, route: HUB_ROUTE, slug: HUB_SLUG };
}
