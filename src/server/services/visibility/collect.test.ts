// AI visibility: recognising the business in an assistant's answer, and the precheck that lets collection skip the
// extraction model call (IS-5). The oracle below is the matcher exactly as collectOne had it inline before the precheck
// existed; the properties are checked against it, not against bizMatcher's own helpers.
import { describe, expect, it } from 'vitest';
import { bizMatcher } from './collect';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The matcher before IS-5: the business's 0-based place among `products`, or -1 (not mentioned). */
function before(name: string, domain: string, text: string, products: string[]): number {
  const n = norm(name), d = norm(domain), root = norm(domain.split('.')[0]);
  const isBiz = (s: string) => { const x = norm(s); return !!x && (x === n || x === d || x === root || (n.length >= 4 && x.includes(n)) || x.includes(d)); };
  let idx = products.findIndex(isBiz);
  const inText = new RegExp(`(^|[^a-z0-9])(${escapeRe(name.toLowerCase())}|${escapeRe(domain.toLowerCase())})([^a-z0-9]|$)`, 'i').test(text);
  if (idx < 0 && inText) {
    const at = text.toLowerCase().indexOf(name.toLowerCase());
    idx = products.filter(p => { const i = text.toLowerCase().indexOf(p.toLowerCase()); return i >= 0 && i < at; }).length;
  }
  return idx;
}

/** Deterministic PRNG (mulberry32), so a failure reproduces. */
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const BUSINESSES: [name: string, domain: string][] = [
  ['Fieldnote', 'fieldnote.app'], ['Field Note', 'getfieldnote.com'], ['Acme', 'acme.io'], ['AB', 'ab.co'], ['X', 'x.com'], ['4D', '4d.studio'],
  ['Яндекс', 'yandex.ru'], ['東京メモ', 'tokyo-memo.jp'], ['Café Nöte', 'cafe-note.fr'], ['O’Reilly Tools', 'oreilly-tools.example.com'], ['C++ Coach', 'cpp.coach'],
  ['Мой Склад', 'мойсклад.рф'], ['note', 'note.dev'], ['Tally (HQ)', 'tally.hq'],
];
const WORDS = ['popular', 'options', 'include', 'Tallyhour', 'Billable', 'and', 'for', 'freelance', 'designers', 'try', 'a', 'free', 'trial', 'notes', 'field', 'the', 'best', 'tool', 'is', 'Harvest', 'Toggl Track', 'clockify.me', 'время', 'メモ', 'café', 'x', 'ab', '4', 'd', 'acmecorp', 'yandex', 'tokyo', 'memo', 'cpp', 'coach', 'tally', 'hq', 'oreilly', 'tools'];
const SEPS = [' ', ' ', ' ', ', ', '. ', '; ', ' — ', '\n', '\n\n• ', '-', '/', ' (', ') ', '’s ', ': ', ''];
function sample(r: () => number) {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const [name, domain] = pick(BUSINESSES);
  // Ways the business can (nearly) appear: as written, shouted, glued to a suffix, split by a separator, by domain, by the
  // domain's first label, or cut short.
  const mid = Math.max(1, Math.floor(name.length / 2));
  const nearly = [name, name.toUpperCase(), name.toLowerCase(), name + 's', 'my' + name, name.slice(0, mid) + pick(['-', ' ', '.', '’']) + name.slice(mid), domain, 'https://www.' + domain + '/pricing', domain.split('.')[0], name.slice(0, -1), name.replace(/\s+/g, '')];
  const n = 4 + Math.floor(r() * 22); let text = '';
  for (let i = 0; i < n; i++) text += (r() < 0.12 ? pick(nearly) : pick(WORDS)) + pick(SEPS);
  // Names "copied as written": any stretch of the answer (the extraction prompt's contract), a few of them.
  const products = Array.from({ length: Math.floor(r() * 6) }, () => { const a = Math.floor(r() * text.length); return text.slice(a, a + 1 + Math.floor(r() * 24)).trim(); }).filter(Boolean);
  return { name, domain, text, products, pick };
}

describe('bizMatcher.place (unchanged matching)', () => {
  const m = bizMatcher('Fieldnote', 'fieldnote.app');
  it('places the business by its order among the names the answer lists', () => {
    const text = 'Commonly recommended: Tallyhour, for its integrations; Fieldnote, which stands out for invoicing; and Billable.';
    expect(m.place(text, ['Tallyhour', 'Fieldnote', 'Billable'])).toBe(1);
    expect(m.place(text, ['Fieldnote', 'Tallyhour'])).toBe(0);
    expect(m.place(text, ['Tallyhour', 'fieldnote.app'])).toBe(1);
    expect(m.place(text, ['Tallyhour', 'The Fieldnote App'])).toBe(1);
  });
  it('named in the text but missed by extraction: placed by first appearance among the extracted names', () => {
    expect(m.place('Tallyhour is popular. Fieldnote is worth a look. Billable too.', ['Tallyhour', 'Billable'])).toBe(1);
    expect(m.place('Fieldnote first, then Tallyhour.', [])).toBe(0);
  });
  it('not named: -1, whatever else the answer lists', () => {
    expect(m.place('Popular options include Tallyhour and Billable.', ['Tallyhour', 'Billable'])).toBe(-1);
    expect(m.place('Popular options include Tallyhour and Billable.', [])).toBe(-1);
  });
  it('agrees with the matcher as it was before, on 6,000 generated answers and name lists (including invented names)', () => {
    const r = rng(20261110);
    for (let i = 0; i < 6000; i++) {
      const s = sample(r);
      const invented = r() < 0.3 ? [...s.products, s.pick(['Fieldnote', 'acme', 'Field-Note', 'YANDEX.RU', 'x', 'ab', 'Notebook', s.name, s.domain])] : s.products;
      const got = bizMatcher(s.name, s.domain).place(s.text, invented);
      if (got !== before(s.name, s.domain, s.text, invented)) throw new Error(`place differs for ${JSON.stringify({ ...s, pick: undefined, invented })}`);
    }
  });
});

describe('bizMatcher.canMatch (the extraction precheck, IS-5)', () => {
  it('false only when the answer cannot name the business; true as soon as it might', () => {
    const m = bizMatcher('Fieldnote', 'fieldnote.app');
    expect(m.canMatch('Popular options include Tallyhour and Billable. Try a couple of free trials.')).toBe(false);
    expect(m.canMatch('Take notes in the field with any of these.')).toBe(false);
    expect(m.canMatch('Fieldnote is worth a look.')).toBe(true);
    expect(m.canMatch('FIELD NOTE is worth a look.')).toBe(true);                    // extraction may copy "FIELD NOTE"
    expect(m.canMatch('See https://www.fieldnote.app/pricing for details.')).toBe(true);
    expect(m.canMatch('Fieldnotes and similar apps')).toBe(true);                    // a longer name that contains it
  });
  it('a name with no Latin letters or digits is still found when the answer contains it as written', () => {
    const m = bizMatcher('Яндекс', 'yandex.ru');
    expect(m.canMatch('Популярные варианты: Google и Яндекс.')).toBe(true);
    expect(before('Яндекс', 'yandex.ru', 'Популярные варианты: Google и Яндекс.', ['Google'])).toBe(1);
    expect(m.canMatch('Популярные варианты: Google и Bing.')).toBe(false);
    expect(m.canMatch('Try Yandex for local search.')).toBe(true);                   // by the domain's first label
    const jp = bizMatcher('東京メモ', 'tokyo-memo.jp');
    expect(jp.canMatch('おすすめは東京メモです。')).toBe(true);
    expect(jp.canMatch('おすすめは大阪ノートです。')).toBe(false);
  });
  it('a domain that normalises to nothing matches everything today, so nothing is skipped for it', () => {
    for (const domain of ['', '.', 'мойсклад.рф']) {
      const m = bizMatcher('Мой Склад', domain);
      expect(m.canMatch('Popular options include Tallyhour and Billable.')).toBe(true);
      expect(m.place('Popular options include Tallyhour and Billable.', ['Tallyhour', 'Billable'])).toBe(before('Мой Склад', domain, 'Popular options include Tallyhour and Billable.', ['Tallyhour', 'Billable']));
    }
  });
  it('property: when canMatch is false, the old matcher says "not mentioned" for every list of names copied from the answer', () => {
    const r = rng(7); let skipped = 0, kept = 0, mentioned = 0; const perBiz = new Map<string, number>();
    for (let i = 0; i < 20000; i++) {
      const s = sample(r);
      const idx = before(s.name, s.domain, s.text, s.products);
      if (bizMatcher(s.name, s.domain).canMatch(s.text)) { kept++; if (idx >= 0) mentioned++; continue; }
      skipped++; perBiz.set(s.name, (perBiz.get(s.name) || 0) + 1);
      if (idx !== -1) throw new Error(`skipping would lose a mention: ${JSON.stringify({ name: s.name, domain: s.domain, text: s.text, products: s.products, idx })}`);
      // The stored result must also be what an empty extraction gives: that is what collectOne passes when it skips.
      if (before(s.name, s.domain, s.text, []) !== -1) throw new Error(`an empty list is not "not mentioned": ${JSON.stringify({ name: s.name, domain: s.domain, text: s.text })}`);
    }
    // The generator really exercised both sides, and the skip side for every kind of name (Latin, short, non-Latin, punctuated).
    expect(skipped).toBeGreaterThan(2000);
    expect(mentioned).toBeGreaterThan(2000);
    expect(kept).toBeGreaterThan(mentioned);                        // canMatch errs on the side of asking
    for (const name of ['Fieldnote', 'AB', 'X', 'Яндекс', '東京メモ', 'Café Nöte', 'O’Reilly Tools', 'C++ Coach']) expect(perBiz.get(name) || 0).toBeGreaterThan(20);
  });
});
