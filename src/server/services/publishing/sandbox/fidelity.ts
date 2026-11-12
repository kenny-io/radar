// Article fidelity for the sandbox publisher (.factory/sandbox-publisher/architecture.md §7, "Article fidelity").
// Pure functions: no I/O, no clock, no network, no model. Everything compared here is untrusted agent output measured
// against the article Radar supplied; results carry unit positions, kinds and counts only, never article or source text.
import ts from 'typescript';
import type { Block } from '@/lib/types';
import type { PublishPayload } from '../types';
import type { ArticleUnit, ArticleUnitKind, ArticleUnitsOf } from './types';

/** Every fidelity threshold. Values are the design's (§7); the fixtures in __fixtures__ exercise each one. */
export const FIDELITY = {
  /** Window, in tokens, used to recognise a unit inside the candidate text. */
  shingleTokens: 4,
  /** Units shorter than this must occur whole and contiguous; longer ones use shingle coverage. */
  shortUnitTokens: 8,
  /** Share of a long unit's tokens that must lie inside shingles found in the candidate (its first and last shingle must
   *  also be found). Markup or an address inserted between words leaves every word inside a found shingle, so only a
   *  changed or dropped word lowers coverage. The design proposed 0.9, which lets one changed word in ten through (a
   *  price, a date); 1 means every word of the unit is found in its original run of words. */
  unitCoverage: 1,
  /** A long unit can be present by the rule above and still have other words or leftover markup between its own words,
   *  because an insertion leaves every original word inside a found shingle. Such a unit is not word for word, and one
   *  inserted word can reverse a sentence, so none is allowed (PM ruling after QA-1, defect D2; every live run so far
   *  was word for word throughout). The allowance stays max(interleavedFloor, interleavedShare of the paragraphs and
   *  items) so it can be raised for a format whose inline markup cannot be stripped. */
  interleavedShare: 0,
  interleavedFloor: 0,
  /** F2: share of headings that must be present; a template may supply a structural heading. */
  headingsPresent: 0.8,
  /** F3: share of present paragraphs and items that must appear in the article's order. */
  orderRun: 0.8,
  /** F4: a paragraph of at least this many tokens whose first and last `duplicateShingleTokens` windows both occur twice is a duplicate. */
  duplicateMinTokens: 12,
  duplicateShingleTokens: 6,
  /** F4: duplicates allowed: max(duplicateFloor, duplicateShare of the eligible paragraphs); a lede or excerpt may repeat one. */
  duplicateShare: 0.1,
  duplicateFloor: 1,
  /** F5: tokens in the article file's added lines may not exceed paddingFactor * article tokens + paddingAllowanceTokens. */
  paddingFactor: 1.5,
  paddingAllowanceTokens: 400,
  /** Diagnostics only: a failing unit with at least this coverage is described as altered rather than absent. */
  alteredCoverage: 0.5,
  /** Bounds on what a result lists. */
  unitsListed: 8,
  /** Unit indexes named in the passed check's detail when their edges could not be decided. */
  undecidedListed: 4,
  mediaListed: 100,
  mediaChars: 300,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Units

/** Each p is a paragraph, each h2 or h3 a heading, each ul entry an item. Blank units are skipped; `index` is the 0-based
 *  position among the units returned, in document order across all kinds. */
export const articleUnits: ArticleUnitsOf = (blocks: Block[]): ArticleUnit[] => {
  const units: ArticleUnit[] = [];
  const add = (kind: ArticleUnitKind, text: unknown) => { if (typeof text === 'string' && text.trim()) units.push({ index: units.length, kind, text }); };
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!Array.isArray(block)) continue;
    const [type, value] = block as [string, unknown];
    if (type === 'ul') { if (Array.isArray(value)) for (const item of value) add('item', item); }
    else if (type === 'h2' || type === 'h3') add('heading', value);
    else if (type === 'p') add('paragraph', value);
  }
  return units;
};

// ---------------------------------------------------------------------------------------------------------------------
// Normalisation. Units are plain text (Block[] carries no markup), so their tokens are taken as written. A candidate is
// a file in some format, so its markup is removed and its escapes and character references are decoded first; because
// that decoding can misread prose that merely looks like markup (a tag or a backslash mentioned in a sentence inside a
// plain string), a unit that is not found that way is also looked for in the candidate's other readings (READINGS).

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '', zwj: '', zwnj: '',
  mdash: '—', ndash: '–', minus: '−', hellip: '…', middot: '·', bull: '•', deg: '°', times: '×', divide: '÷',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', prime: '′', Prime: '″',
  copy: '©', reg: '®', trade: '™', sect: '§', para: '¶', euro: '€', pound: '£', yen: '¥', cent: '¢', dollar: '$',
  frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', micro: 'µ', plusmn: '±',
  szlig: 'ß', aelig: 'æ', AElig: 'Æ', oelig: 'œ', OElig: 'Œ', oslash: 'ø', Oslash: 'Ø', eth: 'ð', ETH: 'Ð', thorn: 'þ', THORN: 'Þ',
  iexcl: '¡', iquest: '¿', larr: '←', rarr: '→', uarr: '↑', darr: '↓', ne: '≠', le: '≤', ge: '≥',
};
const ACCENTS: Record<string, string> = { acute: '́', grave: '̀', circ: '̂', uml: '̈', tilde: '̃', cedil: '̧', ring: '̊', caron: '̌' };
const codePoint = (value: number) => (Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : ' ');

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,30});/g, (whole, body: string) => {
    if (body[0] === '#') return codePoint(/^#[xX]/.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10));
    if (Object.hasOwn(NAMED, body)) return NAMED[body];
    const accent = /^([A-Za-z])(acute|grave|circ|uml|tilde|cedil|ring|caron)$/.exec(body);
    return accent ? accent[1] + ACCENTS[accent[2]] : whole;
  });
}
/** JavaScript, JSON and Markdown escapes in one left-to-right pass: code-point escapes become their character, layout
 *  escapes become a space, and any other escaped character stands for itself. */
function decodeEscapes(text: string): string {
  return text.replace(/\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r?\n|[nrtbfv0])|([\s\S]))/g, (_whole, braced?: string, unit?: string, byte?: string, layout?: string, other?: string) => {
    if (braced !== undefined) return codePoint(parseInt(braced, 16));
    if (unit !== undefined) return String.fromCharCode(parseInt(unit, 16));
    if (byte !== undefined) return String.fromCharCode(parseInt(byte, 16));
    if (layout !== undefined) return ' ';
    return other ?? '';
  });
}
/** Removes HTML comments with a linear scan (a lazy pattern would rescan the rest of the file at every unclosed opener). */
function stripComments(text: string): string {
  let out = ''; let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    const close = open < 0 ? -1 : text.indexOf('-->', open + 4);
    if (close < 0) return out + text.slice(at);
    out += text.slice(at, open) + ' ';
    at = close + 3;
  }
}
// Candidates are untrusted and up to 2 MB, so every pattern below is written to do bounded work per starting point:
// no span may run across another opener of its own kind, and adjacent whitespace runs are capped.
function stripMarkup(text: string): string {
  return stripComments(text
    // JSON encoders that escape angle brackets and ampersands (so embedded HTML is still recognised as tags).
    .replace(/\\u003[cC]/g, '<').replace(/\\u003[eE]/g, '>').replace(/\\u0026/g, '&')
    // Markdown link and image destinations, and autolinks: the visible text stays, the address does not interrupt prose.
    .replace(/(?<!\\)\]\(\s{0,8}(?:<[^<>\n]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s{1,8}(?:"[^"\n]*"|'[^'\n]*'))?\s{0,8}\)/g, '] ')
    // Reference-style link labels and footnote markers.
    .replace(/(?<!\\)\]\[[^\]\n]{0,80}\]/g, '] ').replace(/\[\^[^\]\n]{1,40}\]/g, ' ')
    .replace(/<https?:\/\/[^<>\s]*>/gi, ' '))
    // Tags, including a JSON-escaped closing slash. An escaped bracket (Markdown `\<`) is prose and is left alone.
    .replace(/(?<!\\)<\\?\/?[A-Za-z][A-Za-z0-9:.-]*(?:\s[^<>]*)?\\?\/?>/g, ' ');
}
/** How a candidate file is read before it is tokenised. `true` is the main reading: markup removed, then string
 *  escapes and character references decoded. `false` is the text as written. `'markup'` removes markup and decodes
 *  character references but leaves backslashes alone (an HTML file whose prose mentions a Windows path); `'escapes'`
 *  decodes string escapes only (a JSON string whose prose mentions a tag). */
export type FidelityReading = boolean | 'markup' | 'escapes';
/** The readings tried, in order, for a unit the main reading did not find word for word. A unit is word for word when
 *  its words are one uninterrupted run in at least one reading. */
const READINGS: FidelityReading[] = [false, 'markup', 'escapes'];
/** Tokens are runs of letters, digits and combining marks after NFKC and lower-casing, so punctuation, quoting, line
 *  wrapping and invisible formatting characters never matter. `decode` is the reading, for candidate files; units are
 *  tokenised as written. */
export function fidelityTokens(text: string, decode: FidelityReading): string[] {
  return plainText(text, decode).match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
}
/** A candidate in one reading, normalised, before it is cut into tokens. */
function plainText(text: string, decode: FidelityReading): string {
  const read = decode === true ? decodeEntities(decodeEscapes(stripMarkup(text))) : decode === 'markup' ? decodeEntities(stripMarkup(text)) : decode === 'escapes' ? decodeEscapes(text) : text;
  return read.normalize('NFKC').replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, '').toLowerCase();
}

// ---------------------------------------------------------------------------------------------------------------------
// Unit edges (QA-2, finding N3). Finding a unit's words as one uninterrupted run says nothing about what stands directly
// before or after them: "Do not " in front of a list item leaves the item word for word. So the file is also read for
// its structure. A *boundary* is a place where one piece of rendered text ends and another begins: a blank line, a list
// marker or a heading line in Markdown; a block-level tag in HTML or JSX; the ends of a string literal in a JavaScript,
// TypeScript or JSON file; a key or a sequence entry in YAML. A unit is carried as written when, in some reading of some
// file, nothing but whole units of the article lies between its first word and the boundary before it, and between its
// last word and the boundary after it. Boundaries inside a unit do not matter (a list item split over two table cells),
// and neither does anything that is not a word.
//
// Boundaries are found on the raw file and written into a copy of it as two private-use characters, which every reading
// leaves alone and no token contains: STRONG where the format says for certain that a container ends, WEAK where only
// markup Radar does not classify, or the line structure of a file type it does not know, separates two runs of text. A
// unit whose edges are clear only through WEAK boundaries passes and is disclosed in the check's detail; a unit with
// words beside it and no boundary at all is refused. Marks are only ever inserted where a reading's patterns cannot
// straddle them (line ends, around whole tags and whole string literals, after a list marker or a YAML key).

const STRONG = '\uE000';
const WEAK = '\uE001';
type Mark = (offset: number, weak?: boolean) => void;
interface Line { start: number; end: number }

/** Elements that flow inside a line of text. Their tags are not boundaries. */
const INLINE_TAGS = new Set('a abbr acronym b bdi bdo big br cite code data del dfn em font i img ins kbd label mark q rp rt ruby s samp small span strike strong sub sup time tt u var wbr'.split(' '));
/** Elements that start a new piece of text. Their tags are boundaries. */
const BLOCK_TAGS = new Set(('address article aside audio blockquote body button canvas caption col colgroup dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html '
  + 'iframe input legend li link main menu meta nav noscript object ol optgroup option output p picture pre script section select source style summary svg table tbody td template textarea tfoot th thead title tr track ul video').split(' '));
// The two spellings of a tag that stripMarkup recognises: written with angle brackets (a JSON-escaped closing slash
// included), and with the brackets as \u003c and \u003e. Neither pattern can run across another opener.
const PLAIN_TAG = /(?<!\\)<\\?\/?([A-Za-z][A-Za-z0-9:.-]*)(?:\s[^<>]*)?\\?\/?>/g;
const ENCODED_TAG = /\\u003[cC]\\?\/?([A-Za-z][A-Za-z0-9:.-]*)(?:\s(?:(?!\\u003[cCeE])[^<>])*)?\\?\/?\\u003[eE]/g;
const ATTRIBUTE_QUOTE = /=\s*(\\?["'])/g;

/** Marks every tag: a standard block-level element is a boundary, a standard inline element is not, and anything else
 *  (a JSX, MDX, Vue or Svelte component, a custom element) is a weak one, because Radar cannot know how it renders.
 *  A quoted attribute value is its own piece of text; with `expressions`, so is each string inside an attribute written
 *  as a JavaScript expression (`items={["...", "..."]}` in MDX). Returns the offsets of the block-level tags, in order. */
function markTags(text: string, mark: Mark, expressions: boolean): number[] {
  const blocks: number[] = [];
  for (const pattern of [PLAIN_TAG, ENCODED_TAG]) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const name = match[1]; const start = match.index; const end = start + match[0].length;
      const standard = name === name.toLowerCase() && !/[:.-]/.test(name);
      if (standard && BLOCK_TAGS.has(name)) { mark(start); mark(end); blocks.push(start); }
      else if (!standard || !INLINE_TAGS.has(name)) { mark(start, true); mark(end, true); }
      if (match[0].includes('=')) {
        ATTRIBUTE_QUOTE.lastIndex = 0;
        for (let quote = ATTRIBUTE_QUOTE.exec(match[0]); quote; quote = ATTRIBUTE_QUOTE.exec(match[0])) {
          const opens = quote.index + quote[0].length - quote[1].length;
          const closes = match[0].indexOf(quote[1], opens + quote[1].length);
          if (closes < 0) break;
          mark(start + opens); mark(start + closes + quote[1].length);
          ATTRIBUTE_QUOTE.lastIndex = closes + quote[1].length;
        }
        if (expressions) markAttributeExpressions(match[0], start, mark);
      }
    }
  }
  return blocks.sort((a, b) => a - b);
}
/** `name={expression}` attributes of one tag. The expression is parsed as JavaScript and each of its strings becomes a
 *  piece of text of its own; one that does not parse only gets weak boundaries at its braces. */
function markAttributeExpressions(tag: string, tagStart: number, mark: Mark): void {
  for (let open = tag.indexOf('={'); open >= 0;) {
    let depth = 0; let at = open + 1; let quote = '';
    for (; at < tag.length; at++) {
      const ch = tag[at];
      if (quote) { if (ch === '\\') at++; else if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    if (at >= tag.length) return;
    // Parsed inside parentheses, so an object literal is an expression; offsets move back by that one character.
    const shift = tagStart + open + 2 - 1;
    if (!markStrings('attribute.tsx', `(${tag.slice(open + 2, at)})`, (offset, weak) => mark(shift + offset, weak), () => false, true)) { mark(tagStart + open + 1, true); mark(tagStart + at + 1, true); }
    open = tag.indexOf('={', at);
  }
}
const anyWithin = (sorted: number[], from: number, to: number): boolean => {
  let low = 0; let high = sorted.length;
  while (low < high) { const mid = (low + high) >> 1; if (sorted[mid] < from) low = mid + 1; else high = mid; }
  return low < sorted.length && sorted[low] < to;
};
/** The lines of text[from, to), without their line endings. */
function linesOf(text: string, from = 0, to = text.length): Line[] {
  const lines: Line[] = [];
  for (let start = from; start <= to;) {
    let end = text.indexOf('\n', start);
    if (end < 0 || end > to) end = to;
    lines.push({ start, end: end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end });
    start = end + 1;
  }
  return lines;
}
const indentOf = (body: string) => { let width = 0; for (const ch of body) { if (ch === ' ') width++; else if (ch === '\t') width += 4; else break; } return width; };

/** Markdown's line structure, which is also how prose is laid out in a plain-text string: a blank line ends a
 *  paragraph; a list marker starts an item; a heading is one line; a rule, an underline or a code fence stands alone.
 *  A single line break is not a boundary (Markdown joins the two lines into one paragraph), and neither is a quote
 *  marker. A bullet indented four columns or more, or a number other than 1, only starts an item where Markdown lets it:
 *  after a blank line or inside a list. Indentation is measured from the least indented line, for text that sits inside
 *  a YAML block or a template literal. */
function markTextLines(text: string, lines: Line[], mark: Mark, weak: boolean): void {
  let base = Infinity;
  for (const line of lines) { const body = text.slice(line.start, line.end); if (body.trim()) base = Math.min(base, body.length - body.trimStart().length); }
  if (!Number.isFinite(base)) base = 0;
  let afterBlank = true; let inList = false;
  for (const line of lines) {
    let offset = line.start; let body = text.slice(line.start, line.end);
    const lead = Math.min(base, body.length - body.trimStart().length);
    offset += lead; body = body.slice(lead);
    const quote = /^(?: {0,3}>[ \t]?)+/.exec(body);
    if (quote) { offset += quote[0].length; body = body.slice(quote[0].length); }
    if (!body.trim()) { mark(line.start, weak); afterBlank = true; continue; }
    const indent = indentOf(body);
    let match: RegExpExecArray | null;
    if (/^ {0,3}(?:(?:[-*_=][ \t]*)+|`{3,}[^`]*|~{3,}.*)$/.test(body)) { mark(line.start, weak); mark(line.end, weak); }
    else if ((match = /^ {0,3}#{1,6}(?=[ \t]|$)/.exec(body))) {
      mark(line.start, weak); mark(offset + match[0].length, weak);
      // A trailing {#id} or {.class} belongs to the heading's markup, not to its words.
      const attributes = /[ \t]\{[^{}]*\}[ \t]*$/.exec(body);
      if (attributes) mark(offset + attributes.index, weak);
      mark(line.end, weak); inList = false;
    } else if ((match = /^[ \t]*(?:[-*+]|(\d{1,9})[.)])(?:[ \t]+|$)/.exec(body)) && (indent <= 3 || afterBlank || inList) && (match[1] === undefined || Number(match[1]) === 1 || afterBlank || inList)) {
      mark(line.start, weak); mark(offset + match[0].length, weak); inList = true;
    } else if (indent === 0 && afterBlank) inList = false;
    afterBlank = false;
  }
}

/** YAML's line structure: a mapping key and a sequence entry each start a new scalar, a blank line and a comment end
 *  one, and the lines of a multi-line scalar (folded, plain or quoted) belong together. The body of a literal block
 *  (`|`) is laid out as text; a block that holds block-level HTML is left to its tags. */
function markYamlLines(text: string, lines: Line[], mark: Mark, blockTags: number[]): void {
  let block: { deeperThan: number; literal: boolean; lines: Line[] } | null = null;
  /** Lines indented deeper than this continue the scalar that began beside the last key or dash. */
  let continues: number | null = null;
  let quoted: string | null = null;
  const closeBlock = () => {
    if (!block) return;
    const body = block.lines; const html = body.length > 0 && anyWithin(blockTags, body[0].start, body[body.length - 1].end);
    if (block.literal && !html) markTextLines(text, body, mark, false);
    else if (!html) for (const line of body) if (!text.slice(line.start, line.end).trim()) mark(line.start);
    block = null;
  };
  const closes = (body: string, quote: string) => (quote === '"' ? /(?<!\\)(?:\\\\)*"/.test(body) : /'(?!')/.test(body.replace(/''/g, '')));
  for (const line of lines) {
    const body = text.slice(line.start, line.end);
    const blank = !body.trim(); const indent = body.length - body.trimStart().length;
    if (block) { if (blank || indent > block.deeperThan) { block.lines.push(line); continue; } closeBlock(); }
    if (quoted) { if (closes(body, quoted)) quoted = null; continue; }
    if (blank) { mark(line.start); continues = null; continue; }
    if (continues !== null && indent > continues) continue;
    continues = null;
    if (/^\s*#/.test(body)) { mark(line.start); mark(line.end); continue; }
    const entry = /^( *)((?:-[ \t]+|-$)*)((?:[A-Za-z0-9_$][\w.$/-]*|"[^"]*"|'[^']*')[ \t]*:(?=[ \t]|$))?/.exec(body)!;
    const dashes = entry[2]; const key = entry[3];
    if (!dashes && !key) continue;
    mark(line.start); mark(line.start + entry[0].length);
    const column = key ? entry[1].length + dashes.length : entry[1].length + Math.max(0, dashes.trimEnd().length - 1);
    const rest = body.slice(entry[0].length).trim();
    if (/^[|>][+-]?[0-9]?[+-]?(?:\s+#.*)?$/.test(rest)) block = { deeperThan: column, literal: rest[0] === '|', lines: [] };
    else if ((rest[0] === '"' || rest[0] === "'") && !closes(rest.slice(1), rest[0])) quoted = rest[0];
    else if (rest && !/^[[{&*!]/.test(rest)) continues = column;
  }
  closeBlock();
}

/** The front matter of a Markdown file, when it has one: the lines between the leading `---` and the next `---` or `...`. */
function frontMatter(text: string, lines: Line[]): number {
  if (!/^\uFEFF?---[ \t]*$/.test(text.slice(lines[0].start, lines[0].end))) return 0;
  for (let at = 1; at < lines.length; at++) if (/^(?:---|\.\.\.)[ \t]*$/.test(text.slice(lines[at].start, lines[at].end))) return at;
  return 0;
}

const stringish = (node: ts.Node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
/** JavaScript, TypeScript and JSON: every string is its own piece of text, so its two ends are boundaries. Strings
 *  joined with `+`, or placed in another string's `${}`, are one string. A string written as a JSX child (`<p>{"..."}</p>`) is part of the element's text and
 *  gets no boundary of its own; the tags around it decide. Inside a string that is laid out as text (it has line breaks
 *  and, by `htmlWithin`, no block-level HTML), the text rules apply, with an escaped \n read as the line break it is.
 *  False when the source cannot be parsed, or, with `strict`, when it has a syntax error; nothing is marked then. */
function markStrings(path: string, text: string, mark: Mark, htmlWithin: (from: number, to: number) => boolean, strict = false): boolean {
  const kind = /\.json$/i.test(path) ? ts.ScriptKind.JSON : /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : /\.jsx$/i.test(path) ? ts.ScriptKind.JSX : /\.[cm]?ts$/i.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const marks: [number, boolean][] = [];
  try {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    if (strict && ((source as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length) return false;
    const roots = new Set<ts.Node>();
    const visit = (node: ts.Node): void => {
      if (stringish(node)) {
        let root: ts.Node = node;
        // One string: the operands of `+`, a parenthesised operand, and a string placed directly in a template's ${}.
        while (root.parent && (ts.isParenthesizedExpression(root.parent) || ts.isTemplateSpan(root.parent) || ts.isTemplateExpression(root.parent) || (ts.isBinaryExpression(root.parent) && root.parent.operatorToken.kind === ts.SyntaxKind.PlusToken))) root = root.parent;
        const holder = root.parent;
        const jsxChild = !!holder && ts.isJsxExpression(holder) && !!holder.parent && (ts.isJsxElement(holder.parent) || ts.isJsxFragment(holder.parent));
        if (!jsxChild && !roots.has(root)) { roots.add(root); marks.push([root.getStart(source), false], [root.getEnd(), false]); }
        const from = node.getStart(source) + 1; const to = node.getEnd() - 1;
        if (to > from && !htmlWithin(from, to)) {
          // Logical lines: a real line break (template literals) or an escaped one.
          const lines: Line[] = []; let start = from;
          for (let at = from; at < to; at++) {
            const code = text.charCodeAt(at);
            if (code === 10) { lines.push({ start, end: at > start && text.charCodeAt(at - 1) === 13 ? at - 1 : at }); start = at + 1; }
            else if (code === 92) {
              if (text.charCodeAt(at + 1) === 110 && at + 1 < to) { lines.push({ start, end: at }); start = at + 2; }
              else if (text.charCodeAt(at + 1) === 114 && text.charCodeAt(at + 2) === 92 && text.charCodeAt(at + 3) === 110 && at + 3 < to) { lines.push({ start, end: at }); start = at + 4; at += 2; }
              at++;
            }
          }
          if (lines.length) { lines.push({ start, end: to }); markTextLines(text, lines, (offset, weak) => { marks.push([offset, !!weak]); }, false); }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  } catch { return false; }
  for (const [offset, weak] of marks) mark(offset, weak);
  return true;
}

const MARKDOWN_FILE = /\.(?:md|mdx|markdown|mdown|mkd|mdoc|qmd|rmd)$/i;
const YAML_FILE = /\.ya?ml$/i;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|json)$/i;
/** Markup files, where white space means nothing and only tags end a piece of text. */
const HTML_FILE = /\.(?:html?|xhtml|xml|svg|vue|svelte|astro|njk|liquid|hbs|handlebars|mustache|ejs|erb|php|twig|jsp)$/i;
/** `raw` with its boundaries written in. The rules are chosen by the file's extension. A file of any other type (or one
 *  given without a path) is read by its tags and as lines of text, but its line structure only gives WEAK boundaries,
 *  since Radar does not know the format. Exported for the tests. */
export function markBoundaries(path: string | undefined, raw: string): string {
  // A file cannot bring boundaries of its own.
  const text = raw.replace(/[\uE000\uE001]/g, ' ');
  const marks: number[] = [];
  const mark: Mark = (offset, weak) => { if (offset >= 0 && offset <= text.length) marks.push(offset * 2 + (weak ? 1 : 0)); };
  const name = path ?? '';
  // In a JavaScript or JSON file the parser below finds every string, attribute expressions included.
  const blockTags = markTags(text, mark, !CODE_FILE.test(name));
  if (MARKDOWN_FILE.test(name)) {
    const lines = linesOf(text); const fence = frontMatter(text, lines);
    if (fence) { mark(lines[0].end); markYamlLines(text, lines.slice(1, fence), mark, blockTags); mark(lines[fence].start); }
    markTextLines(text, lines.slice(fence), mark, false);
  } else if (YAML_FILE.test(name)) markYamlLines(text, linesOf(text), mark, blockTags);
  else if (!(CODE_FILE.test(name) && markStrings(name, text, mark, (from, to) => anyWithin(blockTags, from, to))) && !HTML_FILE.test(name)) markTextLines(text, linesOf(text), mark, true);
  if (!marks.length) return text;
  marks.sort((a, b) => a - b);
  const parts: string[] = []; let at = 0; let last = -1;
  for (const entry of marks) {
    const offset = Math.floor(entry / 2);
    // Sorted, so a strong mark at an offset comes before a weak one there, and one mark per offset is enough.
    if (offset === last) continue;
    parts.push(text.slice(at, offset), entry % 2 ? WEAK : STRONG);
    at = offset; last = offset;
  }
  parts.push(text.slice(at));
  return parts.join('');
}

/** The tokens of a marked candidate in one reading, with what lies between them: `strong[k]` is 1 when a certain
 *  boundary stands between token k-1 and token k (index 0 is the start of the file, index tokens.length its end), and
 *  `open[k]` when a certain or a weak one does. */
interface Stream { tokens: string[]; strong: Uint8Array; open: Uint8Array }
function fidelityStream(marked: string, reading: FidelityReading): Stream {
  const plain = plainText(marked, reading);
  const tokens: string[] = []; const strong: number[] = []; const open: number[] = [];
  const word = /[\p{L}\p{N}\p{M}]+/gu;
  let from = 0; let nextStrong = plain.indexOf(STRONG); let nextWeak = plain.indexOf(WEAK);
  const gap = (to: number) => {
    if (nextStrong !== -1 && nextStrong < from) nextStrong = plain.indexOf(STRONG, from);
    if (nextWeak !== -1 && nextWeak < from) nextWeak = plain.indexOf(WEAK, from);
    const certain = nextStrong !== -1 && nextStrong < to;
    strong.push(certain ? 1 : 0); open.push(certain || (nextWeak !== -1 && nextWeak < to) ? 1 : 0);
  };
  for (let match = word.exec(plain); match; match = word.exec(plain)) { gap(match.index); tokens.push(match[0]); from = match.index + match[0].length; }
  strong.push(1); open.push(1);
  if (strong.length > 1) { strong[0] = 1; open[0] = 1; }
  return { tokens, strong: Uint8Array.from(strong), open: Uint8Array.from(open) };
}

/** Which units have clear edges. A unit's occurrence is clear at its start when a boundary stands right before its
 *  first word, or when another unit's occurrence that is itself clear at its start ends exactly there; and likewise at
 *  its end. So a line, element or string may hold several whole units and nothing else, and a unit may run across
 *  boundaries, but a single word that is not the article's, on either side, leaves the unit unclear. */
class UnitEdges {
  /** Unit ids whose edges are clear by certain boundaries, and by certain or weak ones. */
  readonly clear = new Set<number>();
  readonly open = new Set<number>();
  private byFirst = new Map<string, { tokens: string[]; ids: number[] }[]>();
  private byKey = new Map<string, { tokens: string[]; ids: number[] }>();
  add(id: number, tokens: string[]): void {
    const key = tokens.join(' ');
    const known = this.byKey.get(key);
    if (known) { known.ids.push(id); return; }
    const unit = { tokens, ids: [id] };
    this.byKey.set(key, unit);
    const list = this.byFirst.get(tokens[0]);
    if (list) list.push(unit); else this.byFirst.set(tokens[0], [unit]);
  }
  scan(stream: Stream): void {
    const { tokens } = stream;
    const found: { at: number; end: number; ids: number[] }[] = [];
    for (let at = 0; at < tokens.length; at++) {
      const list = this.byFirst.get(tokens[at]);
      if (!list) continue;
      for (const unit of list) {
        const length = unit.tokens.length;
        if (at + length > tokens.length) continue;
        let same = true;
        for (let k = 1; k < length; k++) if (tokens[at + k] !== unit.tokens[k]) { same = false; break; }
        if (same) found.push({ at, end: at + length, ids: unit.ids });
      }
    }
    if (!found.length) return;
    for (const [boundary, into] of [[stream.strong, this.clear], [stream.open, this.open]] as const) {
      // Forwards: where a clear occurrence ends, the next may start. Occurrences are in the order of their starts.
      const ends = new Set<number>(); const startsClear = new Uint8Array(found.length);
      found.forEach((occurrence, index) => { if (boundary[occurrence.at] || ends.has(occurrence.at)) { startsClear[index] = 1; ends.add(occurrence.end); } });
      // Backwards: where an occurrence that is clear at its end starts, the one before it may end.
      const starts = new Set<number>();
      for (let index = found.length - 1; index >= 0; index--) {
        const occurrence = found[index];
        if (!boundary[occurrence.end] && !starts.has(occurrence.end)) continue;
        starts.add(occurrence.at);
        if (startsClear[index]) for (const id of occurrence.ids) into.add(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Occurrence index: only the token windows the units need are looked for, in one pass over each candidate.

interface Needle { tokens: string[]; start: number; length: number; /** Occurrences in the main reading of the candidates. */ count: number; positions: number[]; /** Occurrences in their other readings. */ raw: number }
class Needles {
  private byKey = new Map<string, Needle>();
  private byFirst = new Map<string, Needle[]>();
  need(tokens: string[], start: number, length: number): Needle {
    const key = tokens.slice(start, start + length).join(' ');
    let needle = this.byKey.get(key);
    if (!needle) {
      needle = { tokens, start, length, count: 0, positions: [], raw: 0 };
      this.byKey.set(key, needle);
      const first = tokens[start];
      const list = this.byFirst.get(first);
      if (list) list.push(needle); else this.byFirst.set(first, [needle]);
    }
    return needle;
  }
  /** `offset` keeps positions distinct across candidates; windows never straddle two candidates. A raw scan only
   *  records that a window exists: order and repetition are judged on decoded text alone. */
  scan(candidate: string[], offset: number, raw = false): void {
    for (let at = 0; at < candidate.length; at++) {
      const list = this.byFirst.get(candidate[at]);
      if (!list) continue;
      for (const needle of list) {
        if (at + needle.length > candidate.length) continue;
        let same = true;
        for (let k = 1; k < needle.length; k++) if (candidate[at + k] !== needle.tokens[needle.start + k]) { same = false; break; }
        if (!same) continue;
        if (raw) needle.raw++; else { needle.count++; needle.positions.push(offset + at); }
      }
    }
  }
}

/** Longest chain of units, in article order, that can be given non-decreasing candidate positions when each unit may
 *  use any one of its occurrences. With one occurrence per unit this is the longest non-decreasing run of §7 F3. */
function longestOrderedRun(occurrences: number[][]): number {
  const tails: number[] = [];
  for (const positions of occurrences) {
    // Largest first, so two occurrences of the same unit can never extend one another.
    for (let i = positions.length - 1; i >= 0; i--) {
      const position = positions[i];
      let low = 0; let high = tails.length;
      while (low < high) { const mid = (low + high) >> 1; if (tails[mid] <= position) low = mid + 1; else high = mid; }
      tails[low] = position;
    }
  }
  return tails.length;
}

// ---------------------------------------------------------------------------------------------------------------------
// The check

export type FidelityRule = 'no-units' | 'omitted' | 'truncated' | 'altered' | 'interleaved' | 'extended' | 'headings' | 'order' | 'duplicated' | 'padded';
export interface FidelityIssue { rule: FidelityRule; detail: string }
export interface FidelityInput {
  units: ArticleUnit[];
  /** Final content of every changed file (plus the pinned article file on a retry that did not change it). */
  contents: string[];
  /** The repository path of each content, in the same order. It selects the rules that say where a piece of text ends
   *  in that file (Markdown, YAML, JavaScript/TypeScript/JSON, or tags). A content without a path is read as a file of
   *  unknown type: its units can pass, but their edges are reported as not decided. */
  paths?: (string | undefined)[];
  /** The article file's added lines, for the padding rule; null when nothing was added (an unchanged retry). */
  articleAdded: string | null;
}
export interface FidelityResult {
  ok: boolean;
  /** Empty when ok. Positions are article.json unit indexes (0-based). */
  issues: FidelityIssue[];
  /** Unit indexes of headings the destination did not carry (tolerated up to the F2 threshold). */
  headingsMissing: number[];
  /** Unit indexes of paragraphs and items that are present but not word for word: something sits between their words. */
  interleaved: number[];
  /** Unit indexes of paragraphs and items whose words are all there, in one run, with other words directly before or
   *  after them in the same line, element or string. */
  extended: number[];
  /** Unit indexes (any kind) that are word for word but set off from neighbouring text only by markup or line structure
   *  Radar does not classify, so words added beside them would not be seen. They pass; the detail discloses them. */
  undecided: number[];
  counts: { interleaved: number; interleavedAllowed: number; extended: number; undecided: number; units: number; paragraphs: number; items: number; headings: number; headingsPresent: number; articleTokens: number; orderedShare: number; duplicates: number; duplicatesAllowed: number; addedTokens: number | null; addedTokenLimit: number };
  /** One factual sentence for the passed check or the failure reason. Numbers and unit kinds only. */
  detail: string;
}

const listed = (units: ArticleUnit[]) => units.slice(0, FIDELITY.unitsListed).map(unit => `${unit.kind} ${unit.index}`).join(', ') + (units.length > FIDELITY.unitsListed ? ` and ${units.length - FIDELITY.unitsListed} more` : '');

export function checkArticleFidelity(input: FidelityInput): FidelityResult {
  const units = input.units;
  const tokenised = units.map(unit => fidelityTokens(unit.text, false));
  const found = (needle: Needle) => needle.count + needle.raw > 0;
  const index = new Needles();
  const S = FIDELITY.shingleTokens; const D = FIDELITY.duplicateShingleTokens;
  interface Probe { unit: ArticleUnit; tokens: string[]; /** The unit's full run of words. */ whole: Needle; shingles?: Needle[]; first6?: Needle; last6?: Needle }
  const probes: Probe[] = [];
  units.forEach((unit, i) => {
    const tokens = tokenised[i];
    if (!tokens.length) return;
    const probe: Probe = { unit, tokens, whole: index.need(tokens, 0, tokens.length) };
    if (tokens.length >= FIDELITY.shortUnitTokens) {
      probe.shingles = [];
      for (let start = 0; start + S <= tokens.length; start++) probe.shingles.push(index.need(tokens, start, S));
    }
    if (unit.kind === 'paragraph' && tokens.length >= FIDELITY.duplicateMinTokens) {
      probe.first6 = index.need(tokens, 0, D);
      probe.last6 = index.need(tokens, tokens.length - D, D);
    }
    probes.push(probe);
  });
  let offset = 0;
  for (const content of input.contents) {
    const candidate = fidelityTokens(content, true);
    index.scan(candidate, offset);
    offset += candidate.length + 1;
  }

  const coverageOf = (probe: Probe): { present: boolean; coverage: number; endFound: boolean } => {
    if (!probe.shingles) { const whole = found(probe.whole); return { present: whole, coverage: whole ? 1 : 0, endFound: whole }; }
    const shingles = probe.shingles; const covered = new Uint8Array(probe.tokens.length);
    shingles.forEach((needle, start) => { if (found(needle)) covered.fill(1, start, start + S); });
    const coverage = covered.reduce((n, v) => n + v, 0) / probe.tokens.length;
    const endFound = found(shingles[shingles.length - 1]);
    return { present: coverage >= FIDELITY.unitCoverage && found(shingles[0]) && endFound, coverage, endFound };
  };
  // Further looks, in the other readings, only while the readings so far leave a unit unfound or not word for word.
  for (const reading of READINGS) {
    if (!probes.some(probe => !found(probe.whole))) break;
    for (const content of input.contents) index.scan(fidelityTokens(content, reading), 0, true);
  }

  // Edges: what stands directly before and after each unit that was found as one run of words (finding N3). The files
  // are read again with their structure marked; further readings only while a found unit still has no clear edges.
  const edges = new UnitEdges();
  probes.forEach((probe, id) => edges.add(id, probe.tokens));
  const edgesWanted = () => probes.some((probe, id) => found(probe.whole) && !edges.clear.has(id));
  if (edgesWanted()) {
    const marked = input.contents.map((content, at) => markBoundaries(input.paths?.[at], content));
    for (const reading of [true, ...READINGS] as FidelityReading[]) {
      for (const text of marked) edges.scan(fidelityStream(text, reading));
      if (!edgesWanted()) break;
    }
  }
  const idOf = new Map(probes.map((probe, id) => [probe, id]));
  /** clear: nothing but the article's own units shares the unit's line, element or string. open: the same, but only as
   *  far as markup or line structure Radar does not classify can show. beside: other words stand directly next to it. */
  const edgeOf = (probe: Probe): 'clear' | 'open' | 'beside' => (edges.clear.has(idOf.get(probe)!) ? 'clear' : edges.open.has(idOf.get(probe)!) ? 'open' : 'beside');

  const prose = probes.filter(probe => probe.unit.kind !== 'heading');
  const headings = probes.filter(probe => probe.unit.kind === 'heading');
  const state = new Map(probes.map(probe => [probe, coverageOf(probe)]));
  const articleTokens = probes.reduce((n, probe) => n + probe.tokens.length, 0);
  const addedTokenLimit = Math.floor(FIDELITY.paddingFactor * articleTokens + FIDELITY.paddingAllowanceTokens);
  const issues: FidelityIssue[] = [];
  const total = units.length;

  // F1 omission and truncation: every paragraph and item is present.
  const failing = prose.filter(probe => !state.get(probe)!.present);
  if (!prose.length) issues.push({ rule: 'no-units', detail: 'the supplied article has no paragraphs or list items to verify' });
  if (failing.length) {
    const lastPresent = prose.reduce((at, probe) => (state.get(probe)!.present ? Math.max(at, probe.unit.index) : at), -1);
    const absent = (probe: Probe) => state.get(probe)!.coverage < FIDELITY.alteredCoverage;
    const tail = failing.filter(probe => probe.unit.index > lastPresent && absent(probe));
    // A final unit that starts correctly but loses its ending is the same defect: the body was cut short.
    const cut = failing.filter(probe => probe.unit.index > lastPresent && !absent(probe) && !state.get(probe)!.endFound && probe === prose[prose.length - 1]);
    const truncated = [...tail, ...cut].sort((a, b) => a.unit.index - b.unit.index);
    const rest = failing.filter(probe => !truncated.includes(probe));
    const gone = rest.filter(absent); const altered = rest.filter(probe => !absent(probe));
    if (truncated.length) issues.push({ rule: 'truncated', detail: `the article is cut short: the last ${truncated.length} of ${prose.length} paragraphs and list items are missing or incomplete, starting at ${truncated[0].unit.kind} ${truncated[0].unit.index}` });
    if (gone.length) issues.push({ rule: 'omitted', detail: `${gone.length} of ${prose.length} paragraphs and list items are missing or rewritten: ${listed(gone.map(probe => probe.unit))}` });
    if (altered.length) issues.push({ rule: 'altered', detail: `${altered.length} of ${prose.length} paragraphs and list items have changed or dropped words: ${listed(altered.map(probe => probe.unit))}` });
  }

  // Present, but not word for word.
  const interleaved = prose.filter(probe => state.get(probe)!.present && !found(probe.whole));
  const interleavedAllowed = Math.max(FIDELITY.interleavedFloor, Math.floor(FIDELITY.interleavedShare * prose.length));
  if (interleaved.length > interleavedAllowed) issues.push({ rule: 'interleaved', detail: `${interleaved.length} of ${prose.length} paragraphs and list items are present but not word for word: other words or markup sit between the article's words (${interleavedAllowed ? `at most ${interleavedAllowed} may be` : 'none may be'}): ${listed(interleaved.map(probe => probe.unit))}` });

  // Word for word, with other words directly beside it: "Do not " in front of a list item, a sentence after a paragraph.
  const extended = prose.filter(probe => state.get(probe)!.present && found(probe.whole) && edgeOf(probe) === 'beside');
  if (extended.length) issues.push({ rule: 'extended', detail: `${extended.length} of ${prose.length} paragraphs and list items have words directly before or after them in their line, element or string: ${listed(extended.map(probe => probe.unit))}. Each one must stand alone there, with nothing added` });

  // F2 headings. A heading is carried when its words stand alone as a run with clear edges. One whose words only occur
  // inside other text (a longer heading, a sentence) is not: it counts with the headings a template replaced.
  const headingCarried = (probe: Probe) => state.get(probe)!.present && found(probe.whole) && edgeOf(probe) !== 'beside';
  const headingsMissing = headings.filter(probe => !headingCarried(probe)).map(probe => probe.unit);
  const headingsPresent = headings.length - headingsMissing.length;
  if (headings.length && headingsPresent / headings.length < FIDELITY.headingsPresent) issues.push({ rule: 'headings', detail: `${headingsMissing.length} of ${headings.length} headings are missing or do not stand alone, as written, on their line or in their element: ${listed(headingsMissing)}` });
  const undecided = probes.filter(probe => state.get(probe)!.present && found(probe.whole) && edgeOf(probe) === 'open').map(probe => probe.unit);

  // F3 order, over paragraphs and items that are present.
  const placed = prose.filter(probe => state.get(probe)!.present).map(probe => (probe.shingles ? probe.shingles[0] : probe.whole).positions).filter(positions => positions.length);
  const ordered = longestOrderedRun(placed);
  const orderedShare = placed.length ? ordered / placed.length : 1;
  if (orderedShare < FIDELITY.orderRun) issues.push({ rule: 'order', detail: `only ${ordered} of ${placed.length} paragraphs and list items keep the article's order` });

  // F4 once.
  const eligible = probes.filter(probe => probe.first6 && probe.last6);
  const duplicated = eligible.filter(probe => probe.first6!.count >= 2 && probe.last6!.count >= 2);
  const duplicatesAllowed = Math.max(FIDELITY.duplicateFloor, Math.floor(FIDELITY.duplicateShare * eligible.length));
  if (duplicated.length > duplicatesAllowed) issues.push({ rule: 'duplicated', detail: `${duplicated.length} of ${eligible.length} paragraphs appear more than once (at most ${duplicatesAllowed} may repeat): ${listed(duplicated.map(probe => probe.unit))}` });

  // F5 no padding.
  const addedTokens = input.articleAdded === null ? null : fidelityTokens(input.articleAdded, true).length;
  if (addedTokens !== null && addedTokens > addedTokenLimit) issues.push({ rule: 'padded', detail: `the article file adds ${addedTokens} words; the supplied article has ${articleTokens}, so at most ${addedTokenLimit} are allowed` });

  const paragraphs = prose.filter(probe => probe.unit.kind === 'paragraph').length;
  const counts = { interleaved: interleaved.length, interleavedAllowed, extended: extended.length, undecided: undecided.length, units: total, paragraphs, items: prose.length - paragraphs, headings: headings.length, headingsPresent, articleTokens, orderedShare, duplicates: duplicated.length, duplicatesAllowed, addedTokens, addedTokenLimit };
  const ok = issues.length === 0;
  const detail = ok
    ? `${paragraphs} of ${paragraphs} paragraphs and ${counts.items} of ${counts.items} list items present, ${prose.length - interleaved.length} of them word for word`
      + (interleaved.length ? ` and ${interleaved.length} with other words or markup between the article's words (unit index ${interleaved.map(probe => probe.unit.index).join(', ')}; ${interleavedAllowed} allowed)` : '')
      // Disclosure, never a silent pass: where Radar could not tell a container's end, it says which units that concerns.
      + (undecided.length ? ` (not decided for ${undecided.length}: only markup or line structure Radar does not classify separates unit ${undecided.slice(0, FIDELITY.undecidedListed).map(unit => unit.index).join(', ')}${undecided.length > FIDELITY.undecidedListed ? ` and ${undecided.length - FIDELITY.undecidedListed} more` : ''} from the text beside ${undecided.length === 1 ? 'it' : 'them'}; check the diff for words added there)` : '')
      + `; ${headingsPresent} of ${headings.length} headings present`
      + (headingsMissing.length ? ` (not carried, by unit index, ${headingsMissing.map(unit => unit.index).join(', ')})` : '')
      + `; ${Math.round(orderedShare * 100)}% in the article's order; ${duplicated.length} repeated paragraphs (${duplicatesAllowed} allowed)`
      + (addedTokens === null ? '; no lines added to the article file' : `; the article file adds ${addedTokens} words against a ceiling of ${addedTokenLimit}`)
    : issues.map(issue => issue.detail).join('; ');
  return { ok, issues, headingsMissing: headingsMissing.map(unit => unit.index), interleaved: interleaved.map(probe => probe.unit.index), extended: extended.map(probe => probe.unit.index), undecided: undecided.map(unit => unit.index), counts, detail };
}

// ---------------------------------------------------------------------------------------------------------------------
// Media and links: reported for disclosure in the pull request, never fatal (PM decision on SBX-4).

const escapedForms = (value: string) => [...new Set([
  value,
  value.replace(/&/g, '&amp;'),
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
  value.replace(/\//g, '\\/'),
  value.replace(/&/g, '\\u0026'),
  value.replace(/[\s()<>{}\\]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')),
])];

/** Every media and link reference the article carries: body-image URLs, video ids, source URLs and the absolute links
 *  of `payload.html`. Empty for an article that has none, so there is nothing a destination could fail to carry. */
export function articleReferences(payload: Pick<PublishPayload, 'html' | 'bodyImages' | 'videos' | 'sources'>): string[] {
  const wanted: string[] = [];
  const want = (value: unknown) => { if (typeof value === 'string' && value.trim() && !wanted.includes(value)) wanted.push(value); };
  for (const image of payload.bodyImages ?? []) want(image?.url);
  const videoIds = (payload.videos ?? []).map(video => video?.id).filter((id): id is string => typeof id === 'string' && !!id);
  videoIds.forEach(want);
  for (const source of payload.sources ?? []) want(source?.url);
  for (const match of String(payload.html ?? '').matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = decodeEntities(match[1] ?? match[2] ?? '');
    // A video's own watch link is covered by its id.
    if (/^https?:\/\//i.test(href) && !videoIds.some(id => href.includes(id))) want(href);
  }
  return wanted;
}

/** The article's references (`articleReferences`) that no final file carries as a literal. */
export function omittedMedia(payload: Pick<PublishPayload, 'html' | 'bodyImages' | 'videos' | 'sources'>, contents: string[]): string[] {
  return articleReferences(payload)
    .filter(value => !contents.some(content => escapedForms(value).some(form => content.includes(form))))
    .slice(0, FIDELITY.mediaListed)
    .map(value => value.slice(0, FIDELITY.mediaChars));
}
