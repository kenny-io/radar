// Synthetic repository: Markdown pages plus a committed JSON index of more than 100 KB that a script regenerates before
// every build. Shape of the 6 and 9 Nov failures (a generated index too large for the planner). All content is generated.
import type { PublishPayload } from '../../types';
import { paragraph, phrase, seeded, sentence } from './article';
import type { AgentOutput } from './tree';

export const INDEX_PATH = 'src/generated/website-pages.json';
export const GENERATOR_PATH = 'scripts/generate-pages.mjs';
export const PAGE_PATH = (slug: string) => `content/pages/${slug}.md`;
export const PAGE_ROUTE = (slug: string) => `/resources/${slug}`;

interface IndexRecord { slug: string; title: string; description: string; updatedAt: string; words: number; headings: string[]; excerpt: string }
const GENERATOR = `// Rebuilds ${INDEX_PATH} from content/pages. Runs as "prebuild", so the index is always regenerated before next build.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const pages = readdirSync('content/pages').filter(name => name.endsWith('.md')).sort().map(name => {
  const [, front, body] = readFileSync('content/pages/' + name, 'utf8').split('---\\n');
  const field = key => (front.match(new RegExp('^' + key + ': "(.*)"$', 'm')) || [])[1] || '';
  const paragraphs = body.split('\\n\\n').filter(block => block && !block.startsWith('#'));
  return {
    slug: name.slice(0, -3),
    title: field('title'),
    description: field('description'),
    updatedAt: field('updatedAt'),
    words: body.split(/\\s+/).filter(Boolean).length,
    headings: body.split('\\n').filter(line => line.startsWith('## ')).map(line => line.slice(3)),
    excerpt: paragraphs[0] || '',
  };
});
writeFileSync('${INDEX_PATH}', JSON.stringify({ pages }, null, 2) + '\\n');
`;

function peer(seed: number): { record: IndexRecord; markdown: string } {
  const random = seeded(seed);
  const title = phrase(random, 5); const headings = [phrase(random), phrase(random), phrase(random)];
  const first = paragraph(random, 4);
  const body = [first, ...headings.flatMap(heading => ['## ' + heading, paragraph(random), paragraph(random)])].join('\n\n') + '\n';
  const record = { slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + seed, title, description: sentence(random), updatedAt: `2026-0${1 + (seed % 9)}-1${seed % 10}`, words: body.split(/\s+/).filter(Boolean).length, headings, excerpt: first };
  return { record, markdown: `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(record.description)}\nupdatedAt: ${JSON.stringify(record.updatedAt)}\n---\n${body}` };
}

export const INDEXED_PAGES = 150;
/** 150 generated pages are indexed (about 110 KB of JSON); the sources of the first six are in the tree. */
export function generatedIndexRepository(): Map<string, string> {
  const peers = Array.from({ length: INDEXED_PAGES }, (_, i) => peer(4000 + i));
  return new Map<string, string>([
    ...peers.slice(0, 6).map(({ record, markdown }): [string, string] => [PAGE_PATH(record.slug), markdown]),
    [GENERATOR_PATH, GENERATOR],
    ['package.json', '{\n  "name": "website",\n  "private": true,\n  "scripts": {\n    "prebuild": "node scripts/generate-pages.mjs",\n    "build": "next build"\n  }\n}\n'],
    [INDEX_PATH, JSON.stringify({ pages: peers.map(item => item.record) }, null, 2) + '\n'],
  ]);
}

const page = (payload: PublishPayload, body = payload.markdown) => `---\ntitle: ${JSON.stringify(payload.title)}\ndescription: ${JSON.stringify(payload.meta)}\nupdatedAt: ${JSON.stringify(payload.date)}\n---\n${body}`;
const recordFor = (payload: PublishPayload): IndexRecord => ({
  slug: payload.slug, title: payload.title, description: payload.meta, updatedAt: payload.date, words: payload.markdown.split(/\s+/).filter(Boolean).length,
  headings: payload.blocks.filter(block => block[0] === 'h2').map(block => block[1] as string), excerpt: String(payload.blocks.find(block => block[0] === 'p')?.[1] ?? ''),
});

// Hand-written agent outputs --------------------------------------------------------------------------------------------

/** Good: only the authored page is added; the agent read the generator and the prebuild ordering and left the index alone. */
export function pageOnly(payload: PublishPayload): AgentOutput {
  return { files: { [PAGE_PATH(payload.slug)]: page(payload) }, articlePath: PAGE_PATH(payload.slug), route: PAGE_ROUTE(payload.slug) };
}
/** Good: the page plus one record appended to the committed index by a minimal text edit (the previous last record gains a comma). */
export function pageAndIndexRecord(index: string, payload: PublishPayload): AgentOutput {
  const record = JSON.stringify(recordFor(payload), null, 2).split('\n').map(line => '    ' + line).join('\n');
  const at = index.lastIndexOf('\n  ]');
  return { ...pageOnly(payload), files: { [PAGE_PATH(payload.slug)]: page(payload), [INDEX_PATH]: index.slice(0, at) + ',\n' + record + index.slice(at) } };
}
/** Bad: the index was parsed and written back without its formatting, so every existing line changed. */
export function pageAndReserialisedIndex(index: string, payload: PublishPayload): AgentOutput {
  const parsed = JSON.parse(index) as { pages: IndexRecord[] };
  return { ...pageOnly(payload), files: { [PAGE_PATH(payload.slug)]: page(payload), [INDEX_PATH]: JSON.stringify({ pages: [...parsed.pages, recordFor(payload)] }) + '\n' } };
}
/** Bad: the appended record is missing the comma after the previous one, so the index no longer parses. */
export function pageAndBrokenIndex(index: string, payload: PublishPayload): AgentOutput {
  const output = pageAndIndexRecord(index, payload);
  const at = index.lastIndexOf('\n  ]');
  return { ...output, files: { ...output.files, [INDEX_PATH]: String(output.files[INDEX_PATH]).slice(0, at) + String(output.files[INDEX_PATH]).slice(at + 1) } };
}
