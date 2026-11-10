import { describe, expect, it } from 'vitest';
import { AI_MODELS, INSTRUCTION_KEYS, INSTRUCTION_MAX, INSTRUCTION_SETS, cleanInstruction } from './constants';

describe('cleanInstruction', () => {
  it('normalizes Windows and old Mac line endings to \\n', () => {
    expect(cleanInstruction('Use British spelling.\r\nNever say “unlock”.\rEnd with a question.')).toBe('Use British spelling.\nNever say “unlock”.\nEnd with a question.');
  });
  it('trims the ends and keeps inner newlines and tabs', () => {
    expect(cleanInstruction('  \n one\n\n\ttwo \n ')).toBe('one\n\n\ttwo');
  });
  it('drops NUL and other control characters that the database or a prompt cannot carry', () => {
    expect(cleanInstruction('a\u0000b\u0007c\u001Fd\u007Fe')).toBe('abcde');
  });
  it('treats whitespace-only and missing input as empty', () => {
    expect(cleanInstruction(' \r\n\t ')).toBe('');
    expect(cleanInstruction(undefined as any)).toBe('');
    expect(cleanInstruction(null as any)).toBe('');
  });
  it('counts a CRLF line break as one character toward the limit', () => {
    const text = `${'a'.repeat(INSTRUCTION_MAX - 2)}\r\nb`;
    expect(text.length).toBe(INSTRUCTION_MAX + 1);
    expect(cleanInstruction(text).length).toBe(INSTRUCTION_MAX);
  });
});

describe('INSTRUCTION_SETS', () => {
  it('describes every instruction key exactly once, in canonical order', () => {
    expect(INSTRUCTION_SETS.map(s => s.k)).toEqual([...INSTRUCTION_KEYS]);
  });
  it('lists the four general sets first, then the six platforms', () => {
    expect(INSTRUCTION_SETS.filter(s => s.group === 'general').map(s => s.k)).toEqual(['all', 'articles', 'social', 'community']);
    expect(INSTRUCTION_SETS.filter(s => s.group === 'platform').map(s => s.k)).toEqual(['linkedin', 'x', 'reddit', 'facebook', 'quora', 'hn']);
  });
  it('gives every set a label, a description and an example', () => {
    for (const s of INSTRUCTION_SETS) { expect(s.l.trim()).not.toBe(''); expect(s.d.trim()).not.toBe(''); expect(s.ph.trim()).not.toBe(''); }
  });
  it('never names a model or provider in its copy', () => {
    const names = [...AI_MODELS.flatMap(g => [g.p, ...g.list.flatMap(m => [m.l, m.id])]), 'GPT', 'Claude', 'Grok', 'Gemini', 'OpenRouter', 'LLM', 'AI model'];
    for (const s of INSTRUCTION_SETS) for (const copy of [s.l, s.d, s.ph]) for (const n of names) expect(copy.toLowerCase()).not.toContain(n.toLowerCase());
  });
  it('fits every example inside the limit', () => {
    for (const s of INSTRUCTION_SETS) expect(cleanInstruction(s.ph).length).toBeLessThanOrEqual(INSTRUCTION_MAX);
  });
});
