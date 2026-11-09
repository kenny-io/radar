import { describe, expect, it } from 'vitest';
import { load } from 'cheerio';
import { renderFailureEmail } from './email';
import type { FailureEvent } from './failures';

const event = (extra: Partial<FailureEvent> = {}): FailureEvent => ({ id: 'alert-uuid', timestamp: '2026-11-10T09:05:02Z', environment: 'production', service: 'worker', rootOperation: 'article.draft', context: { source: 'ai', operation: 'article.draft', provider: 'openrouter', jobId: 'job-uuid' }, error: { name: 'Error', message: 'Insufficient credits', status: 402, code: 'insufficient_quota', cause: 'Provider balance exhausted' }, hint: 'Top up provider credits, then retry the article.', ...extra });

describe('readable operational email presentation', () => {
  it('renders a distinct test alert with no failure label or irrelevant fallback disclaimer', () => {
    const result = renderFailureEmail(event({ error: { name: 'SyntheticTest', message: 'TEST ONLY' }, rootOperation: 'observability.smoke', context: { source: 'system', operation: 'observability.smoke', ref: 'alert-uuid', degraded: true }, hint: 'Old generic incident hint' }));
    expect(result.subject).toBe('[Radar] Test alert');
    const $ = load(result.html); expect($('h1').text()).toBe('Your test alert has arrived');
    expect($('body').text()).toContain('Test alert'); expect($('body').text()).toContain('No action needed. This confirms Radar can send alerts from worker in production.');
    expect(result.text).toContain('\n\nNO ACTION NEEDED\n');
    expect(result.html).not.toMatch(/SyntheticTest|Provider fallback|Action failed|does not confirm|Old generic incident hint|Root operation|Resource ID/);
  });
  it('leads a real credit failure with a friendly operation and actionable next step', () => {
    const result = renderFailureEmail(event()); const $ = load(result.html);
    expect(result.subject).toBe('[Radar] Article draft failed (OpenRouter)'); expect($('h1').text()).toBe('Article draft failed');
    expect($('body').text()).toContain('Insufficient credits'); expect($('body').text()).toContain('402'); expect($('body').text()).toContain('Provider balance exhausted'); expect($('body').text()).toContain('Top up provider credits');
    expect(result.text).toContain('\n\nNEXT STEP\nTop up provider credits'); expect(result.text).toContain('10 Nov 2026, 09:05:02 UTC');
    expect(result.text).toContain('Operation: article.draft'); expect(result.text).not.toContain('Root operation: article.draft');
  });
  it('shows a cautious fallback note only for relevant continuing provider attempts', () => {
    const fallback = renderFailureEmail(event({ context: { source: 'ai', operation: 'article.draft', provider: 'openrouter', degraded: true, retrying: true } }));
    expect(fallback.html).toContain('Provider fallback'); expect(fallback.text).toContain('Radar is trying an alternative'); expect(fallback.text).not.toContain('fallback succeeded');
    const partial = renderFailureEmail(event({ context: { source: 'social', operation: 'social.afterPosted', degraded: true } }));
    expect(partial.html).toContain('Needs attention'); expect(partial.text).not.toContain('Provider fallback'); expect(partial.text).toContain('Some work may already be saved or completed');
    expect(renderFailureEmail(event()).text).not.toContain('trying an alternative');
  });
  it('does not mistake an ordinary connector test failure for the synthetic alert', () => {
    const result = renderFailureEmail(event({ context: { source: 'publishing', operation: 'blog.test' } }));
    expect(result.subject).not.toBe('[Radar] Test alert'); expect(result.html).toContain('Action failed'); expect(result.html).toContain('blog.test');
  });
  it('escapes untrusted values in every HTML section while preserving readable text', () => {
    const unsafe = `<img src=x onerror="alert('x')">&`;
    const result = renderFailureEmail(event({ id: unsafe, environment: unsafe, service: unsafe, rootOperation: unsafe, context: { source: 'ai', operation: unsafe, provider: unsafe, model: unsafe, businessId: unsafe, userId: unsafe, ref: unsafe + 'ref', jobId: unsafe, requestId: unsafe, code: unsafe }, error: { name: 'Error', message: unsafe, cause: unsafe }, hint: unsafe }));
    const $ = load(result.html); expect($('img,script,iframe')).toHaveLength(0); expect(result.html).not.toContain('<img'); expect(result.html).toContain('&lt;img'); expect($('body').text()).toContain(unsafe); expect(result.text).toContain(unsafe);
    expect($('[onerror]')).toHaveLength(0); expect($('title').text()).toBe(result.subject);
  });
  it('uses email-safe accessible structure and wrapping without external resources', () => {
    const result = renderFailureEmail(event()); const $ = load(result.html);
    expect($('html').attr('lang')).toBe('en'); expect($('html').attr('dir')).toBe('ltr');
    expect($('body').children().first().attr('lang')).toBe('en'); expect($('body').children().first().attr('dir')).toBe('ltr');
    expect($('h1')).toHaveLength(1); $('table').each((_, table) => { expect($(table).attr('role')).toBe('presentation'); });
    expect($('meta[name="viewport"]')).toHaveLength(1); expect($('img,link,script')).toHaveLength(0);
    expect(result.html).toContain('max-width:640px'); expect(result.html).toContain('overflow-wrap:anywhere'); expect(result.html).toContain('prefers-color-scheme:dark');
  });
});
