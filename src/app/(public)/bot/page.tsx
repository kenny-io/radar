import type { Metadata } from 'next';
import { LegalPage, Contact } from '../LegalPage';

export const metadata: Metadata = { title: 'RadarBot — Radar' };
export const dynamic = 'force-dynamic';

export default function BotPage() {
  return <LegalPage title="RadarBot" updated="October 19, 2026">
    <p>RadarBot is the crawler used by Radar, a search and social marketing tool for small businesses. It identifies itself with a user agent that starts with <code>RadarBot/1.0</code> and links back to this page.</p>

    <h2>When it visits</h2>
    <ul>
      <li><b>Site analysis.</b> When a Radar customer adds their own website, RadarBot reads <code>robots.txt</code>, the sitemap, and up to about 100 pages of that site to learn what the business does.</li>
      <li><b>Backlink checks.</b> For businesses in Radar&rsquo;s opt-in link network, RadarBot fetches the specific pages where a partner agreed to place a link, to confirm the link is still there.</li>
    </ul>
    <p>It does not crawl the wider web, follow links off the site it was asked to read, submit forms, or log in.</p>

    <h2>Controlling access</h2>
    <p>RadarBot honors <code>robots.txt</code> rules addressed to <code>RadarBot</code> or <code>*</code>, including <code>Crawl-delay</code> (up to 5 seconds). To block it entirely:</p>
    <pre style={{ background: 'var(--fill)', borderRadius: 12, padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 13 }}>{`User-agent: RadarBot
Disallow: /`}</pre>
    <p>Without a crawl delay it fetches at most four pages at a time and stops after about 100 pages.</p>

    <h2>Contact</h2>
    <p>Questions or problems with RadarBot: <Contact />.</p>
  </LegalPage>;
}
