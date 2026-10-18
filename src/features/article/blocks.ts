// Isomorphic helpers for article bodies (used by the drafting job and the workspace).
// The writing model streams a light markdown dialect that maps 1:1 onto Block[]:
//   "## Heading" → h2 · "### Sub" → h3 · "- item" lines → ul · anything else → p (blank line separates blocks)
import type { Article, Block, CalendarEntry, Profile } from '@/lib/types';
import { slugify } from '@/lib/format';

const MARK_RE = /\s*\[(\d{1,2})\]/g;

/** Parse markdown-ish text into blocks. `final=false` keeps the last (in-progress) chunk out of the complete list. */
export function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  const chunks = text.replace(/\r/g, '').split(/\n{2,}/);
  for (const raw of chunks) {
    const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
    if (!lines.length) continue;
    let i = 0;
    while (i < lines.length) {
      const l = lines[i].trim();
      if (/^#{3,}\s+/.test(l)) { out.push(['h3', clean(l.replace(/^#{3,}\s+/, ''))]); i++; continue; }
      if (/^#{1,2}\s+/.test(l)) { out.push(['h2', clean(l.replace(/^#{1,2}\s+/, ''))]); i++; continue; }
      if (/^([-*•]|\d+[.)])\s+/.test(l)) {
        const items: string[] = [];
        while (i < lines.length && /^([-*•]|\d+[.)])\s+/.test(lines[i].trim())) { items.push(clean(lines[i].trim().replace(/^([-*•]|\d+[.)])\s+/, ''))); i++; }
        out.push(['ul', items]); continue;
      }
      const para: string[] = [];
      while (i < lines.length && !/^(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/.test(lines[i].trim())) { para.push(lines[i].trim()); i++; }
      out.push(['p', clean(para.join(' '))]);
    }
  }
  return out.filter(b => (Array.isArray(b[1]) ? b[1].length : b[1]));
}
const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/(^|\s)\*(\S.+?)\*(?=\s|$)/g, '$1$2').trim();

/** Split streamed text into complete blocks plus the raw in-progress tail. */
export function splitStream(text: string): { blocks: Block[]; partial: string } {
  const cut = text.lastIndexOf('\n\n');
  if (cut < 0) return { blocks: [], partial: text };
  return { blocks: parseBlocks(text.slice(0, cut)), partial: text.slice(cut + 2) };
}

/** Strip [n] citation markers; returns the clean text and the claims (sentence → source index, 0-based). */
export function extractClaims(blocks: Block[]): { body: Block[]; claims: Article['claims'] } {
  const claims: Article['claims'] = [];
  const body = blocks.map((b, bi): Block => {
    const one = (t: string) => {
      const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/);
      for (const s of sentences) {
        const ms = [...s.matchAll(MARK_RE)];
        if (!ms.length) continue;
        const txt = s.replace(MARK_RE, '').trim();
        for (const m of ms) claims.push({ block: bi, text: txt, source: Number(m[1]) - 1 });
      }
      return t.replace(MARK_RE, '').replace(/\s+([.,;:!?])/g, '$1').trim();
    };
    return b[0] === 'ul' ? ['ul', (b[1] as string[]).map(one)] : [b[0], one(b[1] as string)] as Block;
  });
  return { body, claims };
}

export const blockText = (b: Block) => (Array.isArray(b[1]) ? b[1].join(' ') : b[1]);

/** A statistic-like number: percentages, currency, multipliers, or numbers ≥ 10 (years excluded). */
const NUM_RE = /(?:[$€£]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|x\b|k\b|million|billion)?/gi;
export function statNumbers(t: string): string[] {
  return (t.match(NUM_RE) || []).map(s => s.trim()).filter(s => {
    const n = Number(s.replace(/[^\d.]/g, ''));
    if (!isFinite(n)) return false;
    const marked = /[%$€£x]|percent|k\b|million|billion/i.test(s);
    if (!marked && n >= 1900 && n <= 2100 && /^\d{4}$/.test(s)) return false; // a year
    return marked || n >= 10;
  });
}
export const normNum = (s: string) => s.toLowerCase().replace(/percent/, '%').replace(/[\s,]/g, '').replace(/^[$€£]/, '');

export function defaultArticle(e: Pick<CalendarEntry, 'id' | 'kw' | 'title' | 'relevance'>, _profile?: Profile): Article {
  return {
    entryId: e.id, generated: false, body: [],
    brief: { angle: e.relevance, words: 1400, outline: [] },
    seo: { title: e.title, meta: '', slug: slugify(e.kw) },
    img: { style: 'branded', seed: 1, prompt: 'Calm, editorial image about ' + e.kw, alt: '', url: null, urlKey: null },
    videos: [], videoMeta: [], sources: [], claims: [], draftedAt: null,
  };
}
