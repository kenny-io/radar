// Synthetic repository: every blog post is a typed record in one authored TypeScript file of more than 150 KB.
// Shape of the 10 Nov failure (an authored registry too large for the planner to read). All content is generated.
import type { Block } from '@/lib/types';
import type { PublishPayload } from '../../types';
import { paragraph, phrase, seeded, sentence } from './article';
import type { AgentOutput } from './tree';

export const REGISTRY_PATH = 'apps/web/app/blog/posts.ts';
export const REGISTRY_ROUTE = (slug: string) => `/blog/${slug}`;

interface Table { caption: string; headers: string[]; rows: string[][] }
interface Section { heading: string; paragraphs: string[]; bullets?: string[]; table?: Table }
export interface PostRecord { slug: string; title: string; description: string; publishedAt: string; author: string; intro: string[]; sections: Section[] }

/** Single-quoted TypeScript string, as a formatter would write it. */
const q = (text: string) => "'" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const list = (indent: string, name: string, values: string[]) => [`${indent}${name}: [`, ...values.map(value => `${indent}  ${q(value)},`), `${indent}],`];

/** The source lines of one record, in the registry's own formatting (two-space indentation, trailing commas). */
export function recordSource(post: PostRecord): string {
  const lines = ['  {', `    slug: ${q(post.slug)},`, `    title: ${q(post.title)},`, `    description: ${q(post.description)},`, `    publishedAt: ${q(post.publishedAt)},`, `    author: ${q(post.author)},`, ...list('    ', 'intro', post.intro), '    sections: ['];
  for (const section of post.sections) {
    lines.push('      {', `        heading: ${q(section.heading)},`, ...list('        ', 'paragraphs', section.paragraphs));
    if (section.bullets) lines.push(...list('        ', 'bullets', section.bullets));
    if (section.table) lines.push('        table: {', `          caption: ${q(section.table.caption)},`, `          headers: [${section.table.headers.map(q).join(', ')}],`, '          rows: [', ...section.table.rows.map(row => `            [${row.map(q).join(', ')}],`), '          ],', '        },');
    lines.push('      },');
  }
  lines.push('    ],', '  },');
  return lines.join('\n');
}

const HEADER = `// Blog posts are authored here. The listing page and the [slug] route both read this array.
export type BlogTable = { caption: string; headers: string[]; rows: string[][] };
export type BlogSection = { heading: string; paragraphs: string[]; bullets?: string[]; table?: BlogTable };
export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  author: string;
  intro: string[];
  sections: BlogSection[];
};

export const posts: BlogPost[] = [
`;
const FOOTER = `];

export const postBySlug = (slug: string) => posts.find(post => post.slug === slug);
`;

function peerRecord(seed: number): PostRecord {
  const random = seeded(seed);
  const title = phrase(random, 5);
  return {
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + seed, title, description: sentence(random), publishedAt: `2025-${String(1 + (seed % 12)).padStart(2, '0')}-${String(1 + (seed % 27)).padStart(2, '0')}`, author: 'Editorial team',
    intro: [paragraph(random), paragraph(random)],
    sections: Array.from({ length: 4 }, (_, i) => ({
      heading: phrase(random), paragraphs: [paragraph(random), paragraph(random)],
      ...(i % 2 === 0 ? { bullets: [sentence(random), sentence(random), sentence(random)] } : {}),
      ...(i === 3 ? { table: { caption: phrase(random), headers: ['Option', 'Detail'], rows: [[phrase(random, 2), phrase(random, 4)], [phrase(random, 2), phrase(random, 4)]] } } : {}),
    })),
  };
}

export const PEER_RECORDS = 40;
/** posts.ts with 40 generated peer records (about 190 KB), the listing page and the post route. */
export function typedRegistryRepository(): Map<string, string> {
  const registry = HEADER + Array.from({ length: PEER_RECORDS }, (_, i) => recordSource(peerRecord(1000 + i))).join('\n') + '\n' + FOOTER;
  return new Map([
    [REGISTRY_PATH, registry],
    ['apps/web/app/blog/page.tsx', `import Link from 'next/link';\nimport { posts } from './posts';\n\nexport default function BlogIndex() {\n  return (\n    <ul>\n      {posts.map(post => (\n        <li key={post.slug}>\n          <Link href={\`/blog/\${post.slug}\`}>{post.title}</Link>\n        </li>\n      ))}\n    </ul>\n  );\n}\n`],
    ['apps/web/app/blog/[slug]/page.tsx', `import { notFound } from 'next/navigation';\nimport { postBySlug, posts } from '../posts';\n\nexport const generateStaticParams = () => posts.map(post => ({ slug: post.slug }));\n\nexport default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {\n  const post = postBySlug((await params).slug);\n  if (!post) notFound();\n  return (\n    <article>\n      <h1>{post.title}</h1>\n      {post.intro.map(text => <p key={text}>{text}</p>)}\n      {post.sections.map(section => (\n        <section key={section.heading}>\n          <h2>{section.heading}</h2>\n          {section.paragraphs.map(text => <p key={text}>{text}</p>)}\n          {section.bullets && <ul>{section.bullets.map(text => <li key={text}>{text}</li>)}</ul>}\n        </section>\n      ))}\n    </article>\n  );\n}\n`],
    ['apps/web/package.json', '{\n  "name": "web",\n  "private": true,\n  "scripts": { "build": "next build" }\n}\n'],
  ]);
}

/** Format conversion a careful agent performs for this registry: paragraphs become string arrays, a list of short
 *  "label: value" entries becomes table rows, any other list becomes bullets, and h3 subsections become sections. */
export function toRecord(blocks: Block[], payload: Pick<PublishPayload, 'slug' | 'title' | 'meta' | 'date'>): PostRecord {
  const record: PostRecord = { slug: payload.slug, title: payload.title, description: payload.meta, publishedAt: payload.date, author: 'Editorial team', intro: [], sections: [] };
  for (const block of blocks) {
    const section = record.sections.at(-1);
    if (block[0] === 'h2' || block[0] === 'h3') record.sections.push({ heading: block[1], paragraphs: [] });
    else if (block[0] === 'p') (section ? section.paragraphs : record.intro).push(block[1]);
    else if (block[0] === 'ul' && section) {
      const pairs = block[1].map(item => /^([^:]{1,24}): (.{1,40})$/.exec(item));
      if (pairs.every(Boolean)) section.table = { caption: section.heading, headers: ['Home', 'Price'], rows: pairs.map(pair => [pair![1], pair![2]]) };
      else section.bullets = [...(section.bullets ?? []), ...block[1]];
    }
  }
  return record;
}
/** Inserts one record after the last peer, touching no existing line. */
export function withRecord(registry: string, record: string): string {
  const at = registry.lastIndexOf('\n];');
  return registry.slice(0, at) + '\n' + record + registry.slice(at);
}

// Hand-written agent outputs --------------------------------------------------------------------------------------------

/** Good: the registry gains one record and nothing else changes. */
export function registryIntegration(registry: string, payload: PublishPayload, blocks: Block[] = payload.blocks): AgentOutput {
  return { files: { [REGISTRY_PATH]: withRecord(registry, recordSource(toRecord(blocks, payload))) }, articlePath: REGISTRY_PATH, route: REGISTRY_ROUTE(payload.slug) };
}
/** Bad: the record is correct, but the agent ran the whole file through a formatter with four-space indentation. */
export function registryReformatted(registry: string, payload: PublishPayload): AgentOutput {
  const output = registryIntegration(registry, payload);
  return { ...output, files: { [REGISTRY_PATH]: String(output.files[REGISTRY_PATH]).replace(/^( +)/gm, indent => indent + indent) } };
}
