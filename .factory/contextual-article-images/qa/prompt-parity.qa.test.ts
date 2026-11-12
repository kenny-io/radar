// T4 QA: the image prompt of every caller that existed before this change is byte-identical to the base revision.
// The base module is `git show 4f1bcf83:src/server/services/images.ts` with its relative imports made absolute, written
// to a temporary file next to this one and removed afterwards. Pure: imagePrompt builds a string, nothing is rendered.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { imagePrompt as headPrompt, STYLE_PROMPTS as headStyles, MODEL_STYLES as headModelStyles } from '@/server/services/images';

const BASE = '4f1bcf83';
const dir = path.resolve('.factory/contextual-article-images/qa/.generated');
const file = path.join(dir, 'images.base.ts');
let basePrompt: (r: any) => string; let baseStyles: Record<string, string>; let baseModelStyles: string[];
const out: string[] = [];

beforeAll(async () => {
  const source = execFileSync('git', ['show', `${BASE}:src/server/services/images.ts`], { encoding: 'utf8' })
    .replace(/from '\.\.\/([^']+)'/g, "from '@/server/$1'").replace(/from '\.\/([^']+)'/g, "from '@/server/services/$1'");
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, source);
  const base = await import(/* @vite-ignore */ file);
  basePrompt = base.imagePrompt; baseStyles = base.STYLE_PROMPTS; baseModelStyles = base.MODEL_STYLES;
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync((process.env.QA_EVIDENCE_DIR || '.factory/contextual-article-images/qa/evidence') + '/prompt-parity.txt', out.join('\n') + '\n');
});

const styles = ['editorial', 'flat', 'render3d', 'handdrawn', 'photography', 'illustration', 'branded', 'infographic', 'unknown-style', ''];
const kinds = [undefined, 'hero', 'social', 'brief', 'article-body', 'images'];
const prompts = [undefined, '', 'A founder at a desk reviewing invoices', 'Calm, editorial image about wasl 611 reviews', '  spaced   out \n prompt.  ', 'Ends with a question?', 'Unicode “quotes” — and emoji ☕', 'x'.repeat(1000)];
const names = ['Lived', "O'Brien & Sons", ''];
const brands = [{ primary: '#123456', secondary: '#abcdef' }, { primary: '', secondary: '' }];

describe(`imagePrompt at HEAD equals ${BASE} for every request without \`literal\``, () => {
  it('style texts and the model-style list are unchanged', () => {
    expect(headStyles).toEqual(baseStyles);
    expect(headModelStyles).toEqual(baseModelStyles);
  });
  it('social, Daily Brief, owner-typed cover and every other pre-existing request shape', () => {
    let n = 0; let different = 0;
    for (const style of styles) for (const kind of kinds) for (const prompt of prompts) for (const name of names) for (const brand of brands) for (const seed of [0, 1, 42, 2147483647]) for (const cropSafe of [undefined, false, true]) {
      for (const literal of [undefined, false] as const) {
        const req: any = { style, kind, prompt, headline: 'Wasl 611 Reviews: Tenant Ratings and What to Check First', name, brand, seed, cropSafe, ...(literal === false ? { literal } : {}) };
        const a = Buffer.from(headPrompt(req), 'utf8'); const b = Buffer.from(basePrompt(req), 'utf8');
        n++; if (!a.equals(b)) { different++; if (different < 5) out.push('DIFFERENT: ' + JSON.stringify(req) + '\n  head: ' + a.toString() + '\n  base: ' + b.toString()); }
      }
    }
    out.push(`compared ${n} requests without literal (10 styles x 6 kinds x 8 prompts x 3 names x 2 brands x 4 seeds x 3 cropSafe x literal absent/false): ${different} differ`);
    expect(different).toBe(0);
    expect(n).toBeGreaterThan(30_000);
  });
  it('the exact strings three real callers build (social pack, Daily Brief, owner-typed cover)', () => {
    const brand = { primary: '#0B5FFF', secondary: '#FFB000' };
    const callers = {
      social: { kind: 'social', style: 'illustration', brand, headline: 'Three questions to ask before you sign', name: 'Lived', seed: 7, prompt: 'A tenant reading a tenancy contract at a kitchen table', cropSafe: true },
      brief: { kind: 'brief', style: 'photography', brand, headline: '', name: 'Lived', seed: 12, prompt: 'A quiet residential street in the early morning' },
      ownerCover: { kind: 'hero', style: 'illustration', brand, headline: 'Wasl 611 Reviews', name: 'Lived', seed: 3, prompt: 'The entrance gate of a staff accommodation community at sunrise' },
    };
    for (const [name, req] of Object.entries(callers)) {
      const head = headPrompt(req as any); const base = basePrompt(req as any);
      out.push(`\n${name}\n  head: ${head}\n  base: ${base}\n  identical: ${head === base} (${Buffer.byteLength(head)} bytes)`);
      expect(head).toBe(base);
    }
  });
  it('the literal wrapper is a different prompt, used only when asked', () => {
    const req = { kind: 'hero', style: 'illustration', brand: { primary: '#0B5FFF', secondary: '#FFB000' }, headline: 'Wasl 611 Reviews', name: 'Lived', seed: 3, prompt: 'The exterior of Wasl 611, a gated staff accommodation community of three buildings in Al Warsan, Dubai, seen from outside the entrance gate in daylight.' };
    const literal = headPrompt({ ...req, literal: true });
    out.push(`\nliteral cover prompt at HEAD:\n  ${literal}`);
    expect(literal).not.toBe(basePrompt(req));
    expect(literal).toContain('Show exactly this scene: The exterior of Wasl 611');
    expect(literal).toContain('Do not replace it with a visual metaphor');
    expect(literal).not.toMatch(/metaphor specific|visual metaphor,? built|built around one clear visual metaphor/);
    expect(literal.endsWith('No words, letters, numbers, logos or watermarks anywhere in the image.')).toBe(true);
    for (const style of ['editorial', 'render3d']) { const p = headPrompt({ ...req, style, literal: true }); out.push(`  literal ${style}: ${p.slice(0, 140)}…`); expect(p).not.toMatch(/one clear visual metaphor|abstract/i.source.includes('abstract') ? /one clear visual metaphor/ : /x/); }
  });
});
