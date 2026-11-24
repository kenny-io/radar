import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PostedLink, postImageCount } from './PublishBox';
import type { Platform, Pub, SocialPost } from '@/lib/types';
const pub = (extra: Partial<Pub> = {}): Pub => ({ platform: 'youtube', status: 'posted', date: '2026-11-19', time: '08:00', dueAt: '', acct: null, url: 'https://www.youtube.com/watch?v=synthetic&feature=share', ...extra });
const render = (p: Pub, platform: Platform = 'youtube') => renderToStaticMarkup(React.createElement(PostedLink, { pub: p, platform }));
describe('posted platform navigation', () => {
  it('renders a genuine exact-receipt native anchor with safe new-tab attributes', () => {
    const html = render(pub());
    expect(html).toContain('href="https://www.youtube.com/watch?v=synthetic&amp;feature=share"');
    expect(html).toContain('target="_blank"'); expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('View on YouTube'); expect(html).not.toContain('<button');
  });
  it.each(['x', 'linkedin', 'instagram', 'tiktok'] as const)('uses the same native link for %s without routing through Radar', platform => { expect(render(pub({ url: 'https://example.test/exact-post' }), platform)).toContain('href="https://example.test/exact-post"'); });
  it.each([null, '', '/relative', '//example.test/post', 'javascript:alert(1)', 'data:text/html,test', 'not a url'])('explains an unusable %s receipt without a dead View action', url => { const html = render(pub({ url })); expect(html).toContain('The post link is unavailable. Check YouTube for this post.'); expect(html).not.toContain('<a'); expect(html).not.toContain('View on'); });
  it('never exposes a stale YouTube URL after history removal or changes no-resend data', () => { const p = pub({ historyExpired: true, noResend: true }); const before = JSON.stringify(p); const html = render(p); expect(html).toContain('YouTube connection details were removed.'); expect(html).not.toContain('<a'); expect(html).not.toContain('watch?v='); expect(JSON.stringify(p)).toBe(before); });
});
describe('images a post would send (nImg)', () => {
  const base: Pick<SocialPost, 'video' | 'slides' | 'imageUrl' | 'mediaGeneration' | 'author'> = { imageUrl: null };
  const video = { url: '/v.mp4', durationSec: 10, width: 1080, height: 1920, fps: 30, meta: { bytes: 10, type: 'video/mp4' } };
  it('counts nothing for a post the user wrote without an image, so Post now never promises a Radar image', () => { expect(postImageCount({ ...base, author: 'user' })).toBe(0); });
  it('counts the uploaded image, and nothing once a video replaces it', () => { expect(postImageCount({ ...base, author: 'user', imageUrl: '/u.jpg' })).toBe(1); expect(postImageCount({ ...base, author: 'user', imageUrl: '/u.jpg', video })).toBe(0); });
  it('keeps the generated-pack formula: a still is rendered at send, slides count, explainers wait', () => {
    expect(postImageCount(base)).toBe(1);
    expect(postImageCount({ ...base, slides: [{ url: '/1.jpg', alt: '', meta: { bytes: 1, type: 'image/jpeg' } }, { url: '/2.jpg', alt: '', meta: { bytes: 1, type: 'image/jpeg' } }] })).toBe(2);
    expect(postImageCount({ ...base, mediaGeneration: { id: 'g', requestId: 'r', format: 'video', status: 'rendering', stage: '', reason: '', overridden: false } })).toBe(0);
    expect(postImageCount({ ...base, video })).toBe(0);
  });
});
