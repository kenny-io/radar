import Link from 'next/link';
import { BLOG_POSTS, editorialDate, getPost, type BlogPostMeta, type BlogSlug } from '@/lib/marketing-posts';
import { MkRoot, Nav } from '../MkRoot';
import { Arrow, Closing, Footer } from '../parts';
import { TableOfContents } from './TableOfContents';
import { ArticleBody } from './ArticleBodies';
import './blog.css';

function PostRows({ posts }: { posts: readonly BlogPostMeta[] }) {
  return <ol className="bl-l rv">{posts.map(post => <li key={post.slug}><Link href={`/blog/${post.slug}`}><time dateTime={post.date}>{editorialDate(post.date)}</time><span><b>{post.title}</b><span className="bl-d">{post.dek}</span></span><span className="bl-c">{post.category}</span></Link></li>)}</ol>;
}
export function BlogIndex() {
  const [latest, ...rest] = BLOG_POSTS;
  return <MkRoot kind="fp"><a className="skip" href="#main">Skip to content</a><Nav /><main id="main"><section className="bl-hero"><div className="wrap"><p className="crumb">Blog</p><h1 className="fp-h1">Notes on getting found.</h1><p className="fp-sub">Practical guides to search, AI visibility and the conversations where your next customers ask for help.</p></div></section><section className="bl-posts" aria-label="Latest guides"><div className="wrap"><Link className="bc dark bl-f rv" href={`/blog/${latest.slug}`}><div><p className="bk">{latest.category} · Latest</p><h2>{latest.title}</h2><span className="go">Read the guide<Arrow /></span></div><div className="bl-fd"><p>{latest.dek}</p><p className="bl-meta"><time dateTime={latest.date}>{editorialDate(latest.date)}</time><span>{latest.readTime} min read</span></p></div></Link><PostRows posts={rest} /></div></section><Closing /></main><Footer /></MkRoot>;
}
export function BlogArticle({ post }: { post: BlogPostMeta & { slug: BlogSlug } }) {
  const related = post.related.map(slug => getPost(slug)).filter((item): item is typeof BLOG_POSTS[number] => Boolean(item));
  return <MkRoot kind="fp"><a className="skip" href="#main">Skip to content</a><Nav /><main id="main"><article className="wrap po-g"><header className="po-h rv"><p className="crumb"><Link href="/blog">Blog</Link><span aria-hidden="true">/</span><b>{post.category}</b></p><h1 className="po-t">{post.title}</h1><p className="po-d">{post.dek}</p><p className="po-m"><span>Radar team</span><time dateTime={post.date}>{editorialDate(post.date)}</time><span>{post.readTime} min read</span></p></header><TableOfContents sections={post.toc} /><div className="po-b"><ArticleBody slug={post.slug} /><aside className="po-cta"><div><p className="bk">{post.cta.label}</p><b>{post.cta.headline}</b><p>{post.cta.description}</p></div><Link className="mbtn mbtn-k" href={post.cta.href}>See how it works<Arrow /></Link></aside></div></article><section className="pg-sec" aria-labelledby="more-t"><div className="wrap"><div className="pg-head rv"><h2 className="pg-t" id="more-t">Keep reading</h2><Link className="mbtn mbtn-k" href="/blog">All posts</Link></div><PostRows posts={related} /></div></section><Closing /></main><Footer /></MkRoot>;
}
