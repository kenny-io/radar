import { expect, it } from 'vitest';
import { recommendationDigestContent } from './digestContent';
const summary = {
  weekly: { start: '2026-11-02', end: '2026-11-09', current: { share: 0.5, mentioned: 3, collected: 6 }, previous: { share: 0.25, mentioned: 1, collected: 4 }, delta: 0.25 },
  weeklyBiggestMiss: { prompt: '<script>Which tool?</script>', promptId: 'p', misses: 3, entryId: 'topic' },
};
const render = (value = summary) => recommendationDigestContent(value as any, 'https://radar.example', 'https://radar.example/ai-email-preferences?token=SECRET');
it('reports actual numerators, comparable change and completed UTC days without inventing an outcome', () => {
  const { text } = render();
  expect(text).toContain('2026-11-02 through 2026-11-08');
  expect(text).toContain('3 of 6 collected answers (50%)');
  expect(text).toContain('1 of 4 collected answers (25%)');
  expect(text).toContain('+25.0 percentage points');
  expect(text).toContain('saved in your Content Calendar for review');
});
it('escapes question text, keeps one primary answer CTA, and excludes signed URLs from preheader', () => {
  const { html, preheader, text } = render();
  expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
  expect(html.match(/>Review all answers<\/a>/g)).toHaveLength(1);
  expect(html).toContain('>Email preferences</a>');
  expect(preheader).not.toMatch(/SECRET|token=|Which tool/);
  expect(text).toContain('Email preferences: https://radar.example/ai-email-preferences?token=SECRET');
});
it('states unavailable comparisons and missing highlights without implying success', () => {
  const value = { ...summary, weekly: { ...summary.weekly, delta: null, previous: { share: null, mentioned: 0, collected: 0 } }, weeklyBiggestMiss: null };
  const { text } = recommendationDigestContent(value as any, 'https://radar.example', '/preferences');
  expect(text).toContain('No answers were collected.');
  expect(text).toContain('isn’t enough comparable data');
  expect(text).toContain('no missed question to highlight');
  expect(text).not.toContain('every collected answer');
  expect(text).not.toContain('saved in your Content Calendar');
});
it('preserves negative percentage-point changes and avoids promising an article proposal when absent', () => {
  const value = { ...summary, weekly: { ...summary.weekly, delta: -0.125 }, weeklyBiggestMiss: { ...summary.weeklyBiggestMiss, entryId: null } };
  const { text } = recommendationDigestContent(value as any, 'https://radar.example', '/preferences');
  expect(text).toContain('-12.5 percentage points');
  expect(text).not.toContain('saved in your Content Calendar');
});

it('keeps a zero-miss preheader accurate without promising a missed question', () => {
  const value = { ...summary, weekly: { ...summary.weekly, current: { share: 1, mentioned: 6, collected: 6 } }, weeklyBiggestMiss: null };
  const { preheader, text, html } = recommendationDigestContent(value as any, 'https://radar.example', '/preferences?token=SECRET');
  expect(preheader).toContain('collected answers');
  expect(preheader).not.toMatch(/miss|question|SECRET|token=/i);
  expect(text).toContain('6 of 6 collected answers (100%)');
  expect(text).toContain('no missed question to highlight');
  expect(text).not.toContain('Most missed question:');
  expect(html).not.toContain('Most missed question:');
});

it('provides an accessible mobile document and wraps escaped long prompt words', () => {
  const longPrompt = '<img src=x onerror=alert(1)>' + 'longword'.repeat(100);
  const value = { ...summary, weeklyBiggestMiss: { ...summary.weeklyBiggestMiss, prompt: longPrompt } };
  const { html } = recommendationDigestContent(value as any, 'https://radar.example', '/preferences');
  expect(html).toMatch(/^<!doctype html><html lang="en" dir="ltr">/);
  expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"');
  expect(html).toContain('<title>Your weekly AI recommendation report</title>');
  expect(html).toContain('<main ');
  expect(html).toContain('overflow-wrap:anywhere;word-break:break-word');
  expect(html).toContain('width:100%;max-width:560px;box-sizing:border-box');
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;' + 'longword'.repeat(100));
  expect(html).toContain('</main></body></html>');
});
