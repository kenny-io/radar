// Model tiers and the price table, as pure functions: which model plan a purpose gets under each switch, and what a
// call costs. How the plan turns into requests, rows and failover is tiers.run.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PURPOSE_TIER, STANDARD_EFFORT, UTILITY_FALLBACKS, effortOn, resolve, standardDefault, tierOf, tiersOn } from './tiers';
import { costOf } from './prices';

const ENV = ['RADAR_AI_TIERS', 'RADAR_AI_UTILITY_MODEL', 'RADAR_AI_WRITING_MODEL', 'RADAR_AI_RESEARCH_MODEL', 'RADAR_AI_PREMIUM_MODEL', 'RADAR_AI_PREMIUM_FALLBACK', 'RADAR_AI_PREMIUM_EFFORT', 'RADAR_AI_EFFORT'];
const FB = { writing: ['claude-sonnet-5.5', 'grok-4.7', 'gpt-6-sol'], research: ['claude-opus-5.5', 'gpt-6-sol', 'grok-4.7'] };
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { for (const v of ENV) vi.stubEnv(v, ''); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** Every non-test source file under src/server, read once. */
const SOURCES = (function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== 'tiers.ts' ? [fs.readFileSync(p, 'utf8')] : [];
  });
})(path.resolve(__dirname, '..')).join('\n');

describe('the purpose table', () => {
  it.each([...Object.keys(PURPOSE_TIER), ...Object.keys(STANDARD_EFFORT)])('%s is a purpose some caller really sends (a rename would silently drop it to standard)', purpose => {
    expect(SOURCES).toContain(`purpose: '${purpose}'`);
  });
  it('utility is exactly the six scoring, classification and extraction purposes plus image directions; premium exactly the three chosen tasks', () => {
    const of = (tier: string) => Object.keys(PURPOSE_TIER).filter(p => PURPOSE_TIER[p] === tier).sort();
    expect(of('utility')).toEqual(['analysis.classify', 'article.destat', 'article.imageDirections', 'article.meta', 'brief.rank', 'keywords.intent', 'visibility.extract']);
    expect(of('premium')).toEqual(['article.draft', 'calendar.topics', 'suggestions.refreshDraft']);
    expect(of('standard')).toEqual([]);
  });
  it('a purpose that is not listed is standard', () => {
    expect(tierOf('social.post')).toBe('standard');
    expect(tierOf('something.new')).toBe('standard');
    expect(tierOf('')).toBe('standard');
  });
});

describe('RADAR_AI_TIERS', () => {
  it.each([
    ['', { utility: true, premium: true, legacy: false }],
    ['utility,premium', { utility: true, premium: true, legacy: false }],
    ['premium', { utility: false, premium: true, legacy: false }],
    [' Utility ', { utility: true, premium: false, legacy: false }],
    ['off', { utility: false, premium: false, legacy: true }],
    ['OFF', { utility: false, premium: false, legacy: true }],
    ['premium,off', { utility: false, premium: false, legacy: true }],
    ['premium,turbo', { utility: false, premium: true, legacy: false }],
  ])('%j', (value, expected) => {
    vi.stubEnv('RADAR_AI_TIERS', value);
    expect(tiersOn()).toEqual(expected);
  });
});

describe('resolve: the model plan for a call', () => {
  it('legacy: the business choice or the old defaults, the kind as the logged task, and no effort or extras on any purpose', () => {
    vi.stubEnv('RADAR_AI_TIERS', 'off');
    // Every other variable is ignored under `off`.
    vi.stubEnv('RADAR_AI_WRITING_MODEL', 'grok-4.6'); vi.stubEnv('RADAR_AI_UTILITY_MODEL', 'gpt-6-luna'); vi.stubEnv('RADAR_AI_PREMIUM_MODEL', 'gpt-6-astra');
    for (const purpose of ['social.post', 'article.meta', 'article.draft', 'support.answer']) {
      expect(resolve('writing', purpose, {}, FB)).toMatchObject({ logTask: 'writing', chosen: 'gpt-6-sol', steps: [{ chosen: 'gpt-6-sol', fallbacks: FB.writing }] });
      expect(resolve('writing', purpose, { writing: 'grok-4.7' }, FB).steps).toEqual([{ chosen: 'grok-4.7', fallbacks: FB.writing }]);
    }
    expect(resolve('research', 'brief.rank', {}, FB)).toMatchObject({ logTask: 'research', steps: [{ chosen: 'claude-opus-5.5', fallbacks: FB.research }] });
    expect(resolve('research', 'brief.rank', { research: 'gpt-6-sol' }, FB).steps).toEqual([{ chosen: 'gpt-6-sol', fallbacks: FB.research }]);
    expect(standardDefault('writing')).toBe('gpt-6-sol');
  });

  it('utility: the small model at low effort with its own failover list, whatever the business chose', () => {
    const plain = resolve('writing', 'keywords.intent', {}, FB);
    expect(plain).toEqual({ tier: 'utility', logTask: 'utility', chosen: 'claude-haiku-5.5', steps: [{ chosen: 'claude-haiku-5.5', fallbacks: UTILITY_FALLBACKS, effort: 'low', boost: 'utility' }] });
    expect(resolve('writing', 'keywords.intent', { writing: 'grok-4.7', research: 'claude-fable-5.2' }, FB)).toEqual(plain);
    // brief.rank is a research call at its call site; its tier, not the kind, decides.
    expect(resolve('research', 'brief.rank', { research: 'gpt-6-astra' }, FB)).toEqual(plain);
  });

  it('standard: the business choice, else the default, with the kind as the logged task', () => {
    expect(resolve('writing', 'social.post', {}, FB)).toEqual({ tier: 'standard', logTask: 'writing', chosen: 'claude-opus-5.5', steps: [{ chosen: 'claude-opus-5.5', fallbacks: FB.writing, boost: 'standard' }] });
    expect(resolve('writing', 'social.post', { writing: 'gpt-6-sol' }, FB).steps).toEqual([{ chosen: 'gpt-6-sol', fallbacks: FB.writing, boost: 'standard' }]);
    expect(resolve('research', 'brief.scan', {}, FB).steps).toEqual([{ chosen: 'claude-opus-5.5', fallbacks: FB.research, boost: 'standard' }]);
  });

  it('standard: only the three purposes a person waits on carry an effort, and it is low', () => {
    for (const purpose of ['support.answer', 'article.rewrite', 'brief.rewrite']) expect(resolve('writing', purpose, { writing: 'gpt-6-sol' }, FB).steps).toEqual([{ chosen: 'gpt-6-sol', fallbacks: FB.writing, effort: 'low', boost: 'standard' }]);
    expect(resolve('writing', 'social.post', {}, FB).steps[0]).not.toHaveProperty('effort');
  });

  it('premium with no choice: the premium chain at medium effort, then the standard plan', () => {
    expect(resolve('writing', 'article.draft', {}, FB)).toEqual({
      tier: 'premium', logTask: 'premium', chosen: 'claude-fable-5.2',
      steps: [{ chosen: 'claude-fable-5.2', fallbacks: ['gpt-6-astra'], effort: 'medium', boost: 'premium' }, { chosen: 'claude-opus-5.5', fallbacks: FB.writing, boost: 'standard' }],
    });
  });
  it('premium: a choice other than the default replaces the premium chain and sends no effort', () => {
    expect(resolve('writing', 'article.draft', { writing: 'gpt-6.1-sol' }, FB)).toEqual({ tier: 'premium', logTask: 'premium', chosen: 'gpt-6.1-sol', steps: [{ chosen: 'gpt-6.1-sol', fallbacks: FB.writing, boost: 'standard' }] });
    // Only the choice for the call's own kind counts.
    expect(resolve('writing', 'article.draft', { research: 'gpt-6.1-sol' }, FB).chosen).toBe('claude-fable-5.2');
  });
  it('premium: picking the default again is the same as never picking (the premium chain runs)', () => {
    expect(resolve('writing', 'article.draft', { writing: 'claude-opus-5.5' }, FB)).toEqual(resolve('writing', 'article.draft', {}, FB));
    // The default is the deployment's: with another default configured, Opus becomes an ordinary explicit choice.
    vi.stubEnv('RADAR_AI_WRITING_MODEL', 'gpt-6-sol');
    expect(resolve('writing', 'article.draft', { writing: 'gpt-6-sol' }, FB).chosen).toBe('claude-fable-5.2');
    expect(resolve('writing', 'article.draft', { writing: 'claude-opus-5.5' }, FB).steps).toEqual([{ chosen: 'claude-opus-5.5', fallbacks: FB.writing, boost: 'standard' }]);
  });

  it('a tier that is switched off routes its purposes as standard calls of their kind', () => {
    vi.stubEnv('RADAR_AI_TIERS', 'premium');
    expect(resolve('research', 'brief.rank', { research: 'gpt-6-sol' }, FB)).toEqual({ tier: 'utility', logTask: 'research', chosen: 'gpt-6-sol', steps: [{ chosen: 'gpt-6-sol', fallbacks: FB.research, boost: 'standard' }] });
    expect(resolve('writing', 'article.draft', {}, FB).chosen).toBe('claude-fable-5.2');
    vi.stubEnv('RADAR_AI_TIERS', 'utility');
    expect(resolve('writing', 'article.draft', {}, FB)).toEqual({ tier: 'premium', logTask: 'writing', chosen: 'claude-opus-5.5', steps: [{ chosen: 'claude-opus-5.5', fallbacks: FB.writing, boost: 'standard' }] });
    expect(resolve('writing', 'article.meta', {}, FB).chosen).toBe('claude-haiku-5.5');
  });

  it('each tier model has an environment override', () => {
    vi.stubEnv('RADAR_AI_UTILITY_MODEL', 'gpt-6-luna'); vi.stubEnv('RADAR_AI_WRITING_MODEL', 'gpt-6-sol'); vi.stubEnv('RADAR_AI_RESEARCH_MODEL', 'grok-4.7');
    vi.stubEnv('RADAR_AI_PREMIUM_MODEL', 'gpt-6-astra'); vi.stubEnv('RADAR_AI_PREMIUM_FALLBACK', 'claude-fable-5.1'); vi.stubEnv('RADAR_AI_PREMIUM_EFFORT', 'high');
    expect(resolve('writing', 'article.meta', {}, FB).steps).toEqual([{ chosen: 'gpt-6-luna', fallbacks: UTILITY_FALLBACKS, effort: 'low', boost: 'utility' }]);
    expect(standardDefault('writing')).toBe('gpt-6-sol');
    expect(standardDefault('research')).toBe('grok-4.7');
    expect(resolve('writing', 'article.draft', {}, FB).steps).toEqual([{ chosen: 'gpt-6-astra', fallbacks: ['claude-fable-5.1'], effort: 'high', boost: 'premium' }, { chosen: 'gpt-6-sol', fallbacks: FB.writing, boost: 'standard' }]);
  });
  it('an override that is not a catalogue model is ignored, with one warning', () => {
    vi.stubEnv('RADAR_AI_UTILITY_MODEL', 'gpt-7-nova'); vi.stubEnv('RADAR_AI_PREMIUM_MODEL', 'claude-fable-9'); vi.stubEnv('RADAR_AI_PREMIUM_EFFORT', 'maximum');
    expect(resolve('writing', 'article.meta', {}, FB).chosen).toBe('claude-haiku-5.5');
    expect(resolve('writing', 'article.meta', {}, FB).chosen).toBe('claude-haiku-5.5');
    expect(resolve('writing', 'article.draft', {}, FB).steps[0]).toMatchObject({ chosen: 'claude-fable-5.2', effort: 'medium' });
    expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('gpt-7-nova'))).toHaveLength(1);
  });
  it('RADAR_AI_EFFORT=off is the only value that turns effort off', () => {
    expect(effortOn()).toBe(true);
    vi.stubEnv('RADAR_AI_EFFORT', 'on'); expect(effortOn()).toBe(true);
    vi.stubEnv('RADAR_AI_EFFORT', 'OFF'); expect(effortOn()).toBe(false);
  });
});

describe('costOf', () => {
  const M = 1_000_000;
  it('prices a model the same whatever the route calls it', () => {
    const want = (2 * 1000 + 10 * 500) / M;
    for (const id of ['claude-sonnet-5.5', 'claude-sonnet-5-5', 'anthropic/claude-sonnet-5.5']) expect(costOf(id, { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(want, 12);
    expect(costOf('claude-fable-5-2', { inputTokens: M, outputTokens: M })).toBeCloseTo(48, 9);
    expect(costOf('openai/gpt-6.1-sol', { inputTokens: 100_000, outputTokens: 100_000 })).toBeCloseTo(1.2, 9);
  });
  it('the long-prompt rate starts above the threshold and applies to the whole request', () => {
    expect(costOf('claude-haiku-5.5', { inputTokens: 100_000, outputTokens: 1000 })).toBeCloseTo((100_000 * 0.10 + 1000 * 0.50) / M, 12);
    expect(costOf('claude-haiku-5.5', { inputTokens: 100_001, outputTokens: 1000 })).toBeCloseTo((100_001 * 0.50 + 1000 * 2.50) / M, 12);
    expect(costOf('gpt-6-sol', { inputTokens: 272_000, outputTokens: 0 })).toBeCloseTo(0.544, 9);
    expect(costOf('gpt-6-sol', { inputTokens: 272_001, outputTokens: 0 })).toBeCloseTo(272_001 * 4 / M, 9);
    // xAI's rule is "200k or more".
    expect(costOf('grok-4.7', { inputTokens: 199_999, outputTokens: 0 })).toBeCloseTo(199_999 * 2 / M, 9);
    expect(costOf('grok-4.7', { inputTokens: 200_000, outputTokens: 0 })).toBeCloseTo(0.8, 9);
  });
  it('is null, never a guess, when the billed unit has no known rate', () => {
    expect(costOf('gpt-7-nova', { inputTokens: 100, outputTokens: 100 })).toBeNull();
    expect(costOf('gemini-flash-latest', { inputTokens: 100, outputTokens: 100 })).toBeNull();
    expect(costOf('gpt-image-1', { images: 1 })).toBeNull();
    expect(costOf('sonar-pro', { requests: 1 })).toBeNull();
    // A known token rate does not cover an image the same model has no image rate for.
    expect(costOf('gpt-6-sol', { inputTokens: 10, outputTokens: 10, images: 1 })).toBeNull();
  });
  it('is null when nothing was billed (a request the provider never answered)', () => {
    expect(costOf('claude-opus-5.5', {})).toBeNull();
    expect(costOf('claude-opus-5.5', { inputTokens: null, outputTokens: null })).toBeNull();
    expect(costOf('claude-opus-5.5', { searches: 3 }, 'Anthropic')).toBeNull();
  });
  it('one reported token count is enough', () => {
    expect(costOf('claude-opus-5.5', { inputTokens: 1000 })).toBeCloseTo(0.004, 12);
    expect(costOf('claude-opus-5.5', { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
  it('images and requests are priced per unit', () => {
    expect(costOf('grok-imagine-image', { images: 1 })).toBeCloseTo(0.02, 12);
    expect(costOf('perplexity-search', { requests: 1 })).toBeCloseTo(0.005, 12);
  });
  it('a web search adds the provider fee where one is published, and nothing elsewhere', () => {
    const tokens = { inputTokens: 1000, outputTokens: 1000 };
    expect(costOf('claude-sonnet-5-5', { ...tokens, searches: 3 }, 'Anthropic')).toBeCloseTo(0.012 + 0.03, 12);
    expect(costOf('gpt-6-sol', { ...tokens, searches: 2 }, 'OpenAI')).toBeCloseTo(0.012 + 0.02, 12);
    expect(costOf('grok-4.7', { ...tokens, searches: 3 }, 'SpaceX')).toBeCloseTo(0.008, 12);
    expect(costOf('claude-sonnet-5-5', { ...tokens, searches: 3 })).toBeCloseTo(0.012, 12);
    expect(costOf('claude-sonnet-5.5', { ...tokens, searches: 3 }, 'openrouter')).toBeCloseTo(0.012, 12);
  });
});
