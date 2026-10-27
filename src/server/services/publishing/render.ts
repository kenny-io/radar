// Article → publishable formats (02-system.md §7 "Publishing payload"). Pure functions, safe to import anywhere on the server.
// blocksToHtml / blocksToMarkdown are the contract other areas may use (CONTRACTS.md).
import type { ArticleBodyImage, Block, Source, VideoRef } from '@/lib/types';
import { articleBodyImageAnchor } from '@/lib/articleImages';

export interface RenderOpts {
  bodyImages?: ArticleBodyImage[];
  /** Embedded YouTube videos (in order). Inserted after the first section, as in the article editor. */
  videos?: (VideoRef | { id: string; title?: string; channel?: string })[];
  /** Sources rendered as a citations list at the end (removed sources are skipped). */
  sources?: Source[];
  /** Heading for the citations list. */
  sourcesHeading?: string;
}

export const escHtml = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u: string) => (/^https?:\/\//i.test(u || '') ? u : '#');

/** Index of the block the videos follow: the block before the first h2 that isn't the first block (prototype ArticleWorkspace). */
export function videoAnchor(blocks: Block[]): number {
  const at = blocks.findIndex((x, j) => j > 0 && x[0] === 'h2');
  return at > 0 ? at - 1 : blocks.length - 1;
}
const ytId = (id: string) => String(id).replace(/[^A-Za-z0-9_-]/g, '');

export function videoHtml(v: { id: string; title?: string; channel?: string }): string {
  const id = ytId(v.id); const title = v.title || 'YouTube video';
  const credit = [v.title, 'YouTube', v.channel].filter(Boolean).join(' · ');
  return `<figure class="radar-video"><iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/${id}" title="${escHtml(title)}" frameborder="0" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><figcaption>${escHtml(credit)} — <a href="https://www.youtube.com/watch?v=${id}" rel="noopener">Watch on YouTube</a></figcaption></figure>`;
}

function blockHtml(b: Block): string {
  if (b[0] === 'ul') return '<ul>' + (b[1] as string[]).map(li => `<li>${escHtml(li)}</li>`).join('') + '</ul>';
  return `<${b[0]}>${escHtml(b[1] as string)}</${b[0]}>`;
}

export function sourcesList(sources: Source[] = []) { return sources.filter(s => !s.removed && s.url); }

export function blocksToHtml(blocks: Block[], opts: RenderOpts = {}): string {
  const out: string[] = [];
  const vids = opts.videos || [];
  const anchor = videoAnchor(blocks);
  blocks.forEach((b, i) => {
    out.push(blockHtml(b));
    for (const image of opts.bodyImages || []) if (articleBodyImageAnchor(blocks, image) === i && /^https?:\/\//i.test(image.url)) out.push(`<figure class="radar-body-image"><img src="${escHtml(image.url)}" alt="${escHtml(image.alt)}" width="1200" height="675" loading="lazy" /></figure>`);
    if (i === anchor) vids.forEach(v => out.push(videoHtml(v)));
  });
  if (!blocks.length) vids.forEach(v => out.push(videoHtml(v)));
  const src = sourcesList(opts.sources);
  if (src.length) out.push(`<h2>${escHtml(opts.sourcesHeading || 'Sources')}</h2><ol class="radar-sources">` + src.map(s => `<li><a href="${escHtml(safeUrl(s.url))}" rel="noopener">${escHtml(s.title || s.url)}</a></li>`).join('') + '</ol>');
  return out.join('\n');
}

/**
 * Markdown-safe text, also safe in MDX: JSX/expression openers (`<`, `{`) are escaped, and so is every line start that would
 * become a list, heading, quote, code block, thematic break or — MDX only — an ESM `import`/`export` statement (the first
 * letter becomes a character reference, which both Markdown and MDX decode back to the letter).
 */
export const escMd = (s: string) => String(s ?? '').replace(/([\\`*_[\]{}<>#|~])/g, '\\$1').replace(/&(?=#?\w+;)/g, '\\&')
  .replace(/^[ \t]+/gm, '').replace(/^(\d+)([.)])/gm, '$1\\$2').replace(/^([-+=])/gm, '\\$1')
  .replace(/^(import|export)(?=\s|$)/gm, w => `&#${w.charCodeAt(0)};${w.slice(1)}`);
/** A link destination that can't end the link early or open JSX/an expression in MDX. */
const mdUrl = (u: string) => safeUrl(u).replace(/[\s()<>{}\\]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));

/** Plain Markdown/MDX body. Videos become JSX-compatible iframes (valid in MDX and in most Markdown renderers that allow HTML);
 *  the iframe title has no double quotes, so no &quot; reference is needed inside the JSX attribute. */
export function blocksToMarkdown(blocks: Block[], opts: RenderOpts = {}): string {
  const out: string[] = [];
  const vids = opts.videos || [];
  const anchor = videoAnchor(blocks);
  const vmd = (v: { id: string; title?: string; channel?: string }) => {
    const id = ytId(v.id); const credit = [v.title, 'YouTube', v.channel].filter(Boolean).join(' · ');
    return `<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/${id}" title="${escHtml((v.title || 'YouTube video').replace(/"/g, "'"))}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen></iframe>\n\n*${escMd(credit)}* — [Watch on YouTube](https://www.youtube.com/watch?v=${id})`;
  };
  blocks.forEach((b, i) => {
    if (b[0] === 'ul') out.push((b[1] as string[]).map(li => `- ${escMd(li)}`).join('\n'));
    else if (b[0] === 'h2') out.push(`## ${escMd(b[1] as string)}`);
    else if (b[0] === 'h3') out.push(`### ${escMd(b[1] as string)}`);
    else out.push(escMd(b[1] as string));
    for (const image of opts.bodyImages || []) if (articleBodyImageAnchor(blocks, image) === i && /^https?:\/\//i.test(image.url)) out.push(`![${escMd(image.alt.replace(/\s+/g, ' '))}](${mdUrl(image.url)})`);
    if (i === anchor) vids.forEach(v => out.push(vmd(v)));
  });
  const src = sourcesList(opts.sources);
  if (src.length) out.push(`## ${opts.sourcesHeading || 'Sources'}\n\n` + src.map((s, i) => `${i + 1}. [${escMd(s.title || s.url)}](${mdUrl(s.url)})`).join('\n'));
  return out.join('\n\n') + '\n';
}

/** YAML frontmatter value (always double-quoted, JSON-escaped). */
export const yamlStr = (s: string | null | undefined) => JSON.stringify(String(s ?? ''));
