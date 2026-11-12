// Article fidelity for the sandbox publisher (.factory/sandbox-publisher/architecture.md §7, "Article fidelity").
// Pure functions: no I/O, no clock, no network, no model. Everything compared here is untrusted agent output measured
// against the article Radar supplied; results carry unit positions, kinds and counts only, never article or source text.
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
  const read = decode === true ? decodeEntities(decodeEscapes(stripMarkup(text))) : decode === 'markup' ? decodeEntities(stripMarkup(text)) : decode === 'escapes' ? decodeEscapes(text) : text;
  const plain = read.normalize('NFKC').replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, '').toLowerCase();
  return plain.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
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

export type FidelityRule = 'no-units' | 'omitted' | 'truncated' | 'altered' | 'interleaved' | 'headings' | 'order' | 'duplicated' | 'padded';
export interface FidelityIssue { rule: FidelityRule; detail: string }
export interface FidelityInput {
  units: ArticleUnit[];
  /** Final content of every changed file (plus the pinned article file on a retry that did not change it). */
  contents: string[];
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
  counts: { interleaved: number; interleavedAllowed: number; units: number; paragraphs: number; items: number; headings: number; headingsPresent: number; articleTokens: number; orderedShare: number; duplicates: number; duplicatesAllowed: number; addedTokens: number | null; addedTokenLimit: number };
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

  // F2 headings.
  const headingsMissing = headings.filter(probe => !state.get(probe)!.present).map(probe => probe.unit);
  const headingsPresent = headings.length - headingsMissing.length;
  if (headings.length && headingsPresent / headings.length < FIDELITY.headingsPresent) issues.push({ rule: 'headings', detail: `${headingsMissing.length} of ${headings.length} headings are missing: ${listed(headingsMissing)}` });

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
  const counts = { interleaved: interleaved.length, interleavedAllowed, units: total, paragraphs, items: prose.length - paragraphs, headings: headings.length, headingsPresent, articleTokens, orderedShare, duplicates: duplicated.length, duplicatesAllowed, addedTokens, addedTokenLimit };
  const ok = issues.length === 0;
  const detail = ok
    ? `${paragraphs} of ${paragraphs} paragraphs and ${counts.items} of ${counts.items} list items present, ${prose.length - interleaved.length} of them word for word`
      + (interleaved.length ? ` and ${interleaved.length} with other words or markup between the article's words (unit index ${interleaved.map(probe => probe.unit.index).join(', ')}; ${interleavedAllowed} allowed)` : '')
      + `; ${headingsPresent} of ${headings.length} headings present`
      + (headingsMissing.length ? ` (not carried, by unit index, ${headingsMissing.map(unit => unit.index).join(', ')})` : '')
      + `; ${Math.round(orderedShare * 100)}% in the article's order; ${duplicated.length} repeated paragraphs (${duplicatesAllowed} allowed)`
      + (addedTokens === null ? '; no lines added to the article file' : `; the article file adds ${addedTokens} words against a ceiling of ${addedTokenLimit}`)
    : issues.map(issue => issue.detail).join('; ');
  return { ok, issues, headingsMissing: headingsMissing.map(unit => unit.index), interleaved: interleaved.map(probe => probe.unit.index), counts, detail };
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
