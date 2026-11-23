import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BudgetCounter, BudgetMessage, budgetView } from './TextBudget';
import { customInput, draftText, platformHint, togglePlatform, type Draft } from './CustomPostComposer';
import { emptyMediaLine, imageHint, imageProblem, videoProblem } from './PostMedia';
import { PLAT } from '@/lib/constants';
import type { Platform } from '@/lib/types';

const MB = 1024 * 1024;
const drafts = (over: Partial<Record<Platform, Draft>> = {}) => ({ ...Object.fromEntries(PLAT.map(p => [p.k, { text: '', linked: true }])), ...over }) as Record<Platform, Draft>;

describe('text budget counters (same textBudget the server enforces)', () => {
  it('counts X weighted: a URL is 23, an emoji 2, CJK 2 each', () => {
    expect(budgetView('x', 'https://thally.example/a/very/long/path/that/is/long').counter).toBe('23 / 280');
    expect(budgetView('x', '🚀').counter).toBe('2 / 280');
    expect(budgetView('x', '日本語').counter).toBe('6 / 280');
  });
  it('says by how much the text is over, with a message, and keeps saving allowed', () => {
    const v = budgetView('x', 'a'.repeat(312));
    expect(v).toMatchObject({ state: 'over', over: 32, counter: '312 / 280 · 32 over', message: 'Shorten by 32 characters to post on X. You can still save.' });
    expect(v.announce).toBe('X: 32 characters over the 280 limit.');
  });
  it('uses each platform’s own limit and unit', () => {
    expect(budgetView('linkedin', 'a'.repeat(1204)).counter).toBe('1,204 / 3,000');
    expect(budgetView('youtube', 'é').counter).toBe('2 / 5,000 bytes');
    expect(budgetView('tiktok', 'a').counter).toBe('1 / 4,000');
    expect(budgetView('tiktok', 'a', { video: true }).counter).toBe('1 / 2,200');
    expect(budgetView('facebook', 'a'.repeat(9000))).toMatchObject({ state: 'ok', counter: '9,000 characters', message: null });
  });
  it('blocks empty text with a muted prompt, red only once the user tried to save', () => {
    const v = budgetView('linkedin', '   ');
    expect(v).toMatchObject({ state: 'empty', message: 'Write something to post on LinkedIn.' });
    expect(renderToStaticMarkup(React.createElement(BudgetMessage, { view: v }))).toContain('var(--mute)');
    expect(renderToStaticMarkup(React.createElement(BudgetMessage, { view: v, strict: true }))).toContain('var(--bad)');
  });
  it('announces only on state changes: the key moves in steps of 10 over, not per keystroke', () => {
    expect(budgetView('x', 'a'.repeat(281)).key).toBe(budgetView('x', 'a'.repeat(289)).key);
    expect(budgetView('x', 'a'.repeat(289)).key).not.toBe(budgetView('x', 'a'.repeat(292)).key);
    expect(budgetView('x', 'a').key).toBe(budgetView('x', 'a'.repeat(280)).key);
  });
  it('never relies on color alone: the red counter also says "over"', () => {
    const html = renderToStaticMarkup(React.createElement(BudgetCounter, { view: budgetView('x', 'a'.repeat(300)), id: 'c' }));
    expect(html).toContain('var(--bad)'); expect(html).toContain('20 over'); expect(html).toContain('id="c"');
  });
});

describe('composer: starting text, per-platform edits, the exact createCustom input', () => {
  it('a linked platform mirrors the starting text; an edited one keeps its own', () => {
    expect(draftText({ text: 'old', linked: true }, 'start')).toBe('start');
    expect(draftText({ text: 'mine', linked: false }, 'start')).toBe('mine');
  });
  it('keeps the pick order and drops a platform on a second toggle', () => {
    expect(togglePlatform(['linkedin', 'x'], 'instagram')).toEqual(['linkedin', 'x', 'instagram']);
    expect(togglePlatform(['linkedin', 'x', 'instagram'], 'x')).toEqual(['linkedin', 'instagram']);
  });
  it('sends only name and platform/text (strict input), text verbatim, and only selected platforms', () => {
    const d = drafts({ x: { text: '  Noon on X  ', linked: false }, reddit: { text: 'kept while deselected', linked: false } });
    expect(customInput('  Thally launch ', ['linkedin', 'x'], d, 'Two o’clock on LinkedIn')).toEqual({ name: 'Thally launch', posts: [{ platform: 'linkedin', text: 'Two o’clock on LinkedIn' }, { platform: 'x', text: '  Noon on X  ' }] });
    expect(customInput('   ', ['x'], d, '')).toEqual({ posts: [{ platform: 'x', text: '  Noon on X  ' }] });
  });
  it('labels what each platform needs', () => {
    expect(platformHint('youtube', true)).toBe('Needs a video');
    expect(platformHint('instagram', true)).toBe('Needs an image or video');
    expect(platformHint('reddit', true)).toBe('Copy and paste');
    expect(platformHint('x', true)).toBe('');
    expect(platformHint('x', false)).toBe('Copy and paste');
  });
});

describe('media slot: instant client checks and copy (the server stays authoritative)', () => {
  it('refuses large or wrong-typed images before uploading, and leaves an unknown type to the server', () => {
    expect(imageProblem('x', { size: 5 * MB + 1, type: 'image/png' })).toBe('Choose an image smaller than 5 MB.');
    expect(imageProblem('x', { size: 10, type: 'image/gif' })).toBe('Choose a JPG, PNG or WebP image.');
    expect(imageProblem('x', { size: 10, type: 'image/svg+xml' })).toBe('Choose a JPG, PNG or WebP image.');
    expect(imageProblem('x', { size: 10, type: '' })).toBeNull();
    expect(imageProblem('linkedin', { size: 5 * MB, type: 'image/webp' })).toBeNull();
  });
  it('refuses large or wrong-typed videos, with Instagram’s MP4 rule', () => {
    expect(videoProblem('tiktok', { size: 100 * MB + 1, type: 'video/mp4' })).toBe('Choose a video under 100 MB.');
    expect(videoProblem('instagram', { size: 10, type: 'video/webm' })).toBe('Instagram reels need an MP4 video.');
    expect(videoProblem('youtube', { size: 10, type: 'video/webm' })).toBeNull();
    expect(videoProblem('youtube', { size: 10, type: 'video/quicktime' })).toBe('Choose an MP4 or WebM video.');
  });
  it('says what Radar stores, from the stored-type contract', () => {
    expect(imageHint('x')).toBe('JPG, PNG or WebP, up to 5 MB.');
    expect(imageHint('instagram')).toBe('JPG, PNG or WebP, up to 5 MB. Saved as JPG. Between 4:5 portrait and 1.91:1 landscape.');
    expect(imageHint('tiktok')).toBe('JPG, PNG or WebP, up to 5 MB. PNG images are saved as JPG.');
    expect(imageHint('linkedin')).toBe('JPG, PNG or WebP, up to 5 MB. WebP images are saved as JPG.');
  });
  it('tells media-required platforms to add media, and others that text-only is fine', () => {
    expect(emptyMediaLine('instagram', true)).toBe('Add an image or video to post here');
    expect(emptyMediaLine('youtube', true)).toBe('Add a video to post here');
    expect(emptyMediaLine('x', true)).toBe('No image · text-only post');
    expect(emptyMediaLine('instagram', false)).toBe('No image · text-only post');
  });
});
