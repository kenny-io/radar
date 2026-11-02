import type { Viewport } from 'next';
import { notFound } from 'next/navigation';
import { BLOG_POSTS, getPost } from '@/lib/marketing-posts';
import { blogStructuredData, jsonLd, metadataFor } from '@/lib/seo';
import { BlogArticle } from '@/features/marketing/blog/BlogPages';
export const dynamic = 'force-static';
export const dynamicParams = false;
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };
export function generateStaticParams() { return BLOG_POSTS.map(post => ({ slug: post.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug); if (!post) notFound();
  return metadataFor(`/blog/${post.slug}`);
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug); if (!post) notFound();
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(blogStructuredData(post)) }} /><BlogArticle post={post} /></>;
}
