import { describe, expect, it } from 'vitest';
import { load } from 'cheerio';
import { BLOG_POSTS, getPost } from './marketing-posts';
import { absoluteUrl, blogRssXml, blogStructuredData, jsonLd, metadataFor, SITE_ORIGIN } from './seo';
import { GET as rss } from '../app/(marketing)/blog/rss.xml/route';

describe('public editorial content contracts', () => {
  it('allows exactly the supplied five posts, newest first, and rejects arbitrary/customer paths', () => {
    expect(BLOG_POSTS.map(post => post.slug)).toEqual(['does-chatgpt-recommend-you', 'rank-a-new-website', 'reddit-without-getting-banned', 'page-two-refresh', 'safe-backlinks-new-sites']);
    for (const slug of ['not-a-post', '../api/me', '../../article/customer-id', 'DOES-CHATGPT-RECOMMEND-YOU']) expect(getPost(slug)).toBeUndefined();
    expect(new Set(BLOG_POSTS.map(post => post.slug)).size).toBe(5);
    for (const post of BLOG_POSTS) {
      expect(post.related).toHaveLength(2); expect(new Set(post.related).size).toBe(2);
      for (const related of post.related) { expect(related).not.toBe(post.slug); expect(getPost(related)).toBeDefined(); }
      expect(post.date).toMatch(/^2026-\d{2}-\d{2}$/); expect(post.dateModified).toBe('2026-11-03');
      expect(post.dateModified >= post.date).toBe(true); expect(post.readTime).toBeGreaterThan(0);
      expect(post.cta.href).toMatch(/^\/features\//); expect(new Set(post.toc.map(section => section.id)).size).toBe(post.toc.length);
    }
  });
  it('keeps article canonical, feed autodiscovery, schema and images tied to the same public post', () => {
    for (const post of BLOG_POSTS) {
      const canonical = absoluteUrl(`/blog/${post.slug}`), metadata = metadataFor(`/blog/${post.slug}`), schema = blogStructuredData(post);
      expect(metadata.alternates).toMatchObject({ canonical, types: { 'application/rss+xml': `${SITE_ORIGIN}/blog/rss.xml` } });
      expect(metadata.openGraph).toMatchObject({ type: 'article', url: canonical, publishedTime: post.date, modifiedTime: post.dateModified });
      expect(schema).toMatchObject({ '@type': 'BlogPosting', headline: post.title, mainEntityOfPage: { '@id': canonical }, datePublished: post.date, dateModified: post.dateModified, image: { url: `${SITE_ORIGIN}/social/blog-${post.slug}.png`, width: 1200, height: 630 }, publisher: { legalName: 'Fairspleet LLC' } });
      expect(JSON.parse(jsonLd(schema))).toEqual(schema);
    }
  });
  it('serves parseable RSS with round-tripping titles, dates, permanent GUIDs and no private URLs', async () => {
    const response = rss(); expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    expect(response.headers.get('set-cookie')).toBeNull(); const text = await response.text(); expect(text).toBe(blogRssXml());
    const $ = load(text, { xmlMode: true }); expect($('rss').attr('version')).toBe('2.0'); expect($('item')).toHaveLength(5);
    $('item').each((i, element) => {
      const post = BLOG_POSTS[i], item = $(element), url = absoluteUrl(`/blog/${post.slug}`);
      expect(item.find('title').text()).toBe(post.title); expect(item.find('description').text()).toBe(post.description);
      expect(item.find('link').text()).toBe(url); expect(item.find('guid').text()).toBe(url); expect(item.find('guid').attr('isPermaLink')).toBe('true');
      expect(new Date(item.find('pubDate').text()).toISOString().slice(0, 10)).toBe(post.date);
    });
    expect(text).not.toMatch(/\/api\/|\/article\/|radar_session|sk_live_|whsec_/);
  });
});
