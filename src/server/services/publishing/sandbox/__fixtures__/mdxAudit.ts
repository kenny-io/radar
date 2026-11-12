// Synthetic repository: an MDX blog whose own audit script fails the build on U+2014 (em dash), while the supplied
// article contains one. Shape of the 9 Nov failure (a repository rule the planner could not satisfy). All content is generated.
import type { Block } from '@/lib/types';
import type { PublishPayload } from '../../types';
import { blocksToMarkdown } from '../../render';
import { PARAPHRASED, paragraph, phrase, seeded, sentence } from './article';
import type { AgentOutput } from './tree';

export const AUDIT_PATH = 'scripts/seo-audit.mjs';
export const POST_PATH = (slug: string) => `content/blog/${slug}.mdx`;
export const POST_ROUTE = (slug: string) => `/blog/${slug}`;

const AUDIT = `// Style audit, run in CI before the build. A post that contains a banned character fails the build.
import { readdirSync, readFileSync } from 'node:fs';

const BANNED = [{ name: 'em dash', pattern: /\\u2014/ }, { name: 'non-breaking space', pattern: /\\u00a0/ }];
let failures = 0;
for (const name of readdirSync('content/blog')) {
  const text = readFileSync('content/blog/' + name, 'utf8');
  for (const rule of BANNED) {
    if (rule.pattern.test(text)) { console.error(name + ': contains ' + rule.name); failures++; }
  }
  if (!/^description: ".{50,160}"$/m.test(text)) { console.error(name + ': description must be 50 to 160 characters'); failures++; }
}
process.exit(failures ? 1 : 0);
`;
const frontmatter = (title: string, description: string, date: string) => `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\npublishedAt: ${JSON.stringify(date)}\nauthor: "Editorial team"\n---\n\n`;

export function mdxAuditRepository(): Map<string, string> {
  const files = new Map<string, string>([
    [AUDIT_PATH, AUDIT],
    ['src/lib/blog.ts', `import { readdirSync } from 'node:fs';\n\n// Every .mdx file in content/blog is a post; the file name is the slug.\nexport const postSlugs = () => readdirSync('content/blog').filter(name => name.endsWith('.mdx')).map(name => name.slice(0, -4));\n`],
  ]);
  for (let i = 0; i < 8; i++) {
    const random = seeded(7000 + i); const title = phrase(random, 5);
    const body = Array.from({ length: 4 }, () => `## ${phrase(random)}\n\n${paragraph(random)}\n\n${paragraph(random)}`).join('\n\n');
    files.set(POST_PATH(title.toLowerCase().replace(/[^a-z0-9]+/g, '-')), frontmatter(title, sentence(random), `2026-0${i + 1}-15`) + body + '\n');
  }
  return files;
}

/** Hard-wraps prose at 96 columns, as an editor configured for the repository would. */
const wrap = (text: string) => text.split('\n').map(line => {
  if (line.length <= 96 || /^(?:#|!\[|<|\d+\\?\. \[)/.test(line)) return line;
  const out: string[] = []; let current = '';
  for (const word of line.split(' ')) { if (current && (current + ' ' + word).length > 96) { out.push(current); current = word; } else current = current ? current + ' ' + word : word; }
  return [...out, current].join('\n');
}).join('\n');
/** The conversion the audit forces: no em dash, straight quotes, wrapped lines. Wording is untouched. */
const conform = (markdown: string) => wrap(markdown.replace(/ ?— ?/g, ', ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"'));
const post = (payload: PublishPayload, body: string) => frontmatter(payload.title, payload.meta, payload.date) + body;

// Hand-written agent outputs --------------------------------------------------------------------------------------------

/** Good: a new MDX post with frontmatter; the em dash is replaced because the repository's audit bans it. */
export function mdxPost(payload: PublishPayload): AgentOutput {
  return {
    files: { [POST_PATH(payload.slug)]: post(payload, conform(payload.markdown)) }, articlePath: POST_PATH(payload.slug), route: POST_ROUTE(payload.slug),
    report: { conventions: [{ path: AUDIT_PATH, rule: 'Posts must not contain an em dash.' }], deviations: [{ kind: 'punctuation', detail: 'Replaced one em dash with a comma to satisfy the audit script.' }] },
  };
}
/** Bad: the agent "tidied" three paragraphs while converting; the facts are the same but the wording is not the article's. */
export function mdxPostParaphrased(payload: PublishPayload): AgentOutput {
  const blocks = payload.blocks.map((block, i): Block => (PARAPHRASED[i] && block[0] === 'p' ? ['p', PARAPHRASED[i]] : block));
  return { files: { [POST_PATH(payload.slug)]: post(payload, conform(blocksToMarkdown(blocks))) }, articlePath: POST_PATH(payload.slug), route: POST_ROUTE(payload.slug) };
}
/** A post body rendered from other blocks (omitted, truncated, duplicated or padded variants are built by the tests). */
export function mdxPostFrom(payload: PublishPayload, blocks: Block[]): AgentOutput {
  return { files: { [POST_PATH(payload.slug)]: post(payload, conform(blocksToMarkdown(blocks))) }, articlePath: POST_PATH(payload.slug), route: POST_ROUTE(payload.slug) };
}
