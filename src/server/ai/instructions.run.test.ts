// The real ai.run with dev stubs: what the writing model boundary receives for a business with and without saved
// instructions. Only the database is replaced (one `businesses.ai` row per business id).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => {
  const saved = process.env.RADAR_DEV_STUBS; process.env.RADAR_DEV_STUBS = '1';
  return { saved, rows: {} as Record<string, any>, asked: [] as string[], inserted: [] as any[] };
});
vi.mock('drizzle-orm', async orig => ({ ...(await orig<typeof import('drizzle-orm')>()), eq: (_col: unknown, value: string) => ({ id: value }) }));
vi.mock('../db', () => ({
  db: {
    insert: () => ({ values: (v: any) => { H.inserted.push(v); return Promise.resolve(); } }),
    select: () => ({ from: () => ({ where: (w: { id: string }) => ({ limit: async () => { H.asked.push(w.id); return H.rows[w.id] ? [{ ai: H.rows[w.id] }] : []; } }) }) }),
  },
  schema: { aiCalls: {}, businesses: { ai: 'ai', id: 'id' } },
}));
import { run } from './index';
import { registerStub } from './adapters/stub';
import { BLOCK_END, BLOCK_START, instructionBlock } from './instructions';

const SYSTEM = 'You are Radar, a senior writer.\nHard rules: never invent statistics.\n\nBUSINESS PROFILE\nName: Fieldnote';
const seen: { system?: string; prompt: string }[] = [];
registerStub('test.instructions', input => { seen.push({ system: input.system, prompt: input.prompt }); return 'ok'; });
const call = (input: Partial<Parameters<typeof run>[1]> = {}, businessId: string | null = 'biz-a') => run('writing', { purpose: 'test.instructions', system: SYSTEM, prompt: 'Write the post.', ...input }, { businessId });

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  seen.length = 0; H.asked.length = 0; H.inserted.length = 0;
  H.rows = {
    'biz-a': { writing: 'claude-sonnet-5.5', instructions: { all: 'Use British spelling.', social: 'One idea per post.', articles: 'End with a trial CTA.', linkedin: 'End with a question.', x: 'No hashtags.' } },
    'biz-b': { writing: 'gpt-6-sol' },
    'biz-old': {},
  };
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => { vi.restoreAllMocks(); if (H.saved === undefined) delete process.env.RADAR_DEV_STUBS; else process.env.RADAR_DEV_STUBS = H.saved; });

describe('ai.run with saved writing instructions', () => {
  it('appends the applicable sets to the end of the system prompt and leaves the user prompt alone', async () => {
    await call({ instructions: { surface: 'social', platforms: ['linkedin'] } });
    const block = instructionBlock(H.rows['biz-a'].instructions, { surface: 'social', platforms: ['linkedin'] });
    expect(seen).toEqual([{ system: SYSTEM + '\n\n' + block, prompt: 'Write the post.' }]);
    expect(seen[0].system).toContain('| Use British spelling.');
    expect(seen[0].system).toContain('| One idea per post.');
    expect(seen[0].system).toContain('| End with a question.');
    expect(seen[0].system).not.toContain('No hashtags.');
    expect(seen[0].system).not.toContain('End with a trial CTA.');
    expect(seen[0].system!.endsWith(BLOCK_END)).toBe(true);
  });
  it('sends only the block when the call has no system prompt of its own', async () => {
    await call({ system: undefined, instructions: { surface: 'article' } });
    expect(seen[0].system).toBe(instructionBlock(H.rows['biz-a'].instructions, { surface: 'article' }));
  });
  it('reads the instructions from the business the call is for, in the same single lookup as the model', async () => {
    const out = await call({ instructions: { surface: 'article' } });
    expect(H.asked).toEqual(['biz-a']);
    expect(out.model).toBe('claude-sonnet-5.5');
  });
  it.each([['a business with no instructions', 'biz-b'], ['a business saved before the feature', 'biz-old'], ['an unknown business', 'biz-missing']])('sends the system prompt unchanged for %s', async (_l, bid) => {
    await call({ instructions: { surface: 'social', platforms: ['linkedin', 'x'] } }, bid);
    expect(seen).toEqual([{ system: SYSTEM, prompt: 'Write the post.' }]);
  });
  it('keeps an absent system prompt absent when nothing is saved', async () => {
    await call({ system: undefined, instructions: { surface: 'article' } }, 'biz-b');
    expect(seen[0].system).toBeUndefined();
    expect('system' in seen[0]).toBe(true);
  });
  it('sends nothing extra when only sets for other surfaces or platforms are saved', async () => {
    H.rows['biz-a'] = { instructions: { community: 'Lowercase is fine.', reddit: 'No pricing talk.' } };
    await call({ instructions: { surface: 'social', platforms: ['x'] } });
    expect(seen[0].system).toBe(SYSTEM);
  });
  it('never applies instructions to a call that did not ask for them (planning, research, fact-check)', async () => {
    await call();
    expect(seen[0].system).toBe(SYSTEM);
  });
  it('never applies instructions without a business', async () => {
    await call({ instructions: { surface: 'article' } }, null);
    expect(seen[0].system).toBe(SYSTEM);
    expect(H.asked).toEqual([]);
  });
  it('another business never receives them', async () => {
    await call({ instructions: { surface: 'article' } }, 'biz-b');
    await call({ instructions: { surface: 'article' } }, 'biz-a');
    expect(seen[0].system).not.toContain(BLOCK_START);
    expect(seen[1].system).toContain('| End with a trial CTA.');
  });
  it('keeps prompt and instruction text out of the ai_calls row', async () => {
    await call({ instructions: { surface: 'article' } });
    await new Promise(r => setTimeout(r, 0));
    expect(H.inserted).toHaveLength(1);
    expect(JSON.stringify(H.inserted[0])).not.toContain('British');
    expect(Object.keys(H.inserted[0]).sort()).toEqual(['businessId', 'costUsd', 'error', 'inputTokens', 'latencyMs', 'model', 'ok', 'outputTokens', 'provider', 'purpose', 'task']);
  });
});

describe('dev stub evidence line', () => {
  it('logs the received block once per call, and only when there is one', async () => {
    await call({ instructions: { surface: 'article' } });
    const block = instructionBlock(H.rows['biz-a'].instructions, { surface: 'article' });
    expect(info.mock.calls.map(c => c[0])).toEqual([`[ai:stub] test.instructions received workspace writing instructions\n${block}`]);
    info.mockClear();
    await call({ instructions: { surface: 'article' } }, 'biz-b');
    await call();
    expect(info).not.toHaveBeenCalled();
  });
});
