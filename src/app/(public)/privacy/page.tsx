import type { Metadata } from 'next';
import { LegalPage, Contact } from '../LegalPage';

export const metadata: Metadata = { title: 'Privacy Policy — Radar' };
export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" updated="October 19, 2026">
    <p>This policy explains what information Radar collects, how it is used, and the choices you have. Radar is a search and social marketing service for small businesses, available at radar.thally.io.</p>

    <h2>Information we collect</h2>
    <ul>
      <li><b>Account information.</b> Your name, email address and profile picture, from Google Sign-In or the details you enter when you sign up. If you sign up with a password, we store only a salted hash of it.</li>
      <li><b>Business information.</b> Your website address and what Radar learns from reading your public website, plus the profile, keywords, articles, social posts and settings you create or edit in Radar.</li>
      <li><b>Google Search Console data.</b> If you connect Search Console, we read search performance data (queries, pages, clicks, impressions, position) for the property you choose.</li>
      <li><b>Connected services.</b> If you connect a blog platform (for example WordPress, Ghost, Webflow, Shopify or GitHub), we store the access tokens or credentials needed to publish on your behalf.</li>
      <li><b>Team members.</b> Email addresses of people you invite to your workspace.</li>
      <li><b>Technical data.</b> A session cookie that keeps you signed in, and server logs (IP address, browser, timestamps) used for security and debugging.</li>
    </ul>

    <h2>How we use it</h2>
    <p>We use your information only to provide Radar&rsquo;s features to you: analyzing your site, planning and drafting content, publishing to your connected blog, preparing social posts, finding relevant online conversations, reporting search performance and AI-assistant visibility, and sending emails you trigger (such as team invitations). We do not sell your data or use it for advertising.</p>

    <h2>Google user data</h2>
    <p>Radar requests the <code>openid</code>, <code>email</code> and <code>profile</code> scopes to sign you in, and the read-only <code>webmasters.readonly</code> scope to show your Search Console performance and suggest content. Radar cannot change anything in your Search Console account.</p>
    <p>Radar&rsquo;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Google user data is used only to provide user-facing features in Radar. It is not transferred to others except as needed to provide those features, to comply with law, or as part of a merger or acquisition with notice to you. It is not used for advertising, and people do not read it unless you ask us to for support, it is needed for security or legal reasons, or it has been aggregated and anonymized for internal operations.</p>
    <p>Search Console data is not sent to AI model providers to train their models. Where Radar uses an AI model to suggest content from your search data, only the specific data needed for that suggestion is sent, under the provider&rsquo;s API terms.</p>

    <h2>Service providers</h2>
    <p>We share data with service providers only as needed to run Radar:</p>
    <ul>
      <li>Hosting and database (Railway), file storage (Cloudflare R2) and email delivery (Resend).</li>
      <li>AI model providers (OpenAI, Anthropic, xAI, Google, Perplexity) to research, draft and check content. These providers process requests under their API terms, which do not allow them to train on API data by default.</li>
      <li>Data providers (DataForSEO, YouTube Data API, Open PageRank, Reddit, X, Hacker News) to look up keyword data and public conversations. We send them search terms, not your personal information.</li>
      <li>The blog and social platforms you choose to connect, when you publish.</li>
    </ul>

    <h2>Security and retention</h2>
    <p>Data is encrypted in transit. Access tokens and blog credentials are additionally encrypted at rest. We keep your data while your account is active. When you delete a business or your account, or ask us to, we delete the associated data, including Search Console data and connected-service tokens, within 30 days, except where we must keep records by law. You can disconnect Search Console at any time in Settings, or revoke Radar&rsquo;s access from your <a href="https://myaccount.google.com/permissions">Google Account permissions</a>.</p>

    <h2>Your choices</h2>
    <p>You can view and edit your business information in Radar at any time. To access, export or delete your data, contact us. If you are in a region with data-protection laws (such as the EU, UK or California), you have the rights those laws give you, and you can exercise them through the same contact.</p>

    <h2>Children</h2>
    <p>Radar is a business tool and is not intended for anyone under 16.</p>

    <h2>Changes</h2>
    <p>If we change this policy in a meaningful way, we will update the date above and tell signed-in users before the change takes effect.</p>

    <h2>Contact</h2>
    <p>Privacy questions or requests: <Contact />.</p>
  </LegalPage>;
}
