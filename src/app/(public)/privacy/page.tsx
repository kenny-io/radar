import { metadataFor } from '@/lib/seo';
import { LegalPage, Contact, Operator } from '../LegalPage';

export const metadata = metadataFor('/privacy');
export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" updated="November 19, 2026">
    <Operator />
    <p>This policy explains what information Radar collects, how it is used, and the choices you have. Radar is a search and social marketing service for small businesses, available at radar.thally.io.</p>
    <p>Fairspleet LLC is responsible for Radar&rsquo;s account, billing and service-operation data. This page supplements the <a href="https://thally.io/privacy">Thally Privacy Policy</a> with Radar&rsquo;s specific data uses and providers. Its provisions about legal bases, international transfers and privacy rights also apply to Radar.</p>

    <h2>Information we collect</h2>
    <ul>
      <li><b>Account information.</b> Your name, email address and profile picture, from Google Sign-In or the details you enter when you sign up. If you sign up with a password, we store only a salted hash of it.</li>
      <li><b>Business information.</b> Your website address and what Radar learns from reading your public website, plus the profile, keywords, articles, social posts and settings you create or edit in Radar.</li>
      <li><b>Google Search Console data.</b> If you connect Search Console, we read search performance data (queries, pages, clicks, impressions, position) for the property you choose.</li>
      <li><b>YouTube publishing.</b> If you connect YouTube, we receive your channel ID, channel name and handle, OAuth access and refresh tokens, and the video IDs and processing results for videos you upload through Radar. We also store the video files, titles, descriptions, visibility and audience settings you provide for those uploads.</li>
      <li><b>Connected services.</b> If you connect a blog platform (for example WordPress, Ghost, Webflow, Shopify or GitHub), we store the access tokens or credentials needed to publish on your behalf.</li>
      <li><b>Team members.</b> Email addresses of people you invite to your workspace.</li>
      <li><b>Billing information.</b> Stripe customer, payment and subscription identifiers, payment status, trial and renewal dates, and limited card information such as brand, last four digits and a card fingerprint used to prevent repeated trials. Stripe collects card details directly; Radar does not store your full card number or security code.</li>
      <li><b>Usage records.</b> A log of what Radar does for you and what you do with it, for example replies you mark as posted, articles published, social posts copied and AI answers checked. It holds counts, platforms, dates and public links, not the text of your drafts. We use it to measure and improve Radar and to report aggregate, anonymized results.</li>
      <li><b>Technical data.</b> Cookies for signed-in and guest sessions, the selected business and secure Google sign-in, browser preferences such as theme, and server logs (IP address, browser, timestamps) used for security and debugging. IP addresses and hashed account identifiers are used for abuse limits. Payment processing may also use Stripe&rsquo;s fraud-prevention technologies.</li>
    </ul>

    <h2>How we use it</h2>
    <p>We use your information to provide and secure Radar, administer accounts and subscriptions, process payments, prevent abuse, respond to support requests, and meet legal obligations. Radar&rsquo;s features include analyzing your site, planning and drafting content, publishing to your connected blog and social accounts, preparing social posts, finding relevant online conversations, reporting search performance and AI-assistant visibility, and sending service emails such as team invitations. We do not sell your data or use it for advertising.</p>
    <p>If you choose explainer media generation, Radar sends the relevant source content and your notes to the configured AI providers to plan and check the explanation, and sends the finished script to ElevenLabs to generate narration. Source notes, scripts and timing records are available to authorized members of that business. Publishable audio, video and slides are hosted in file storage so you can preview them and the social platforms can retrieve them when you post. Avoid putting confidential information into content you intend to publish. Generating media does not itself publish it or turn on Autopilot.</p>

    <h2>Google user data</h2>
    <p>Radar requests the <code>openid</code>, <code>email</code> and <code>profile</code> scopes to sign you in, and the read-only <code>webmasters.readonly</code> scope to show your Search Console performance and suggest content. Radar cannot change anything in your Search Console account.</p>
    <p>The optional YouTube connection uses YouTube API Services and separately requests <code>youtube.upload</code> to upload videos you choose and <code>youtube.readonly</code> to identify your channel and check upload processing. Radar sends your selected video, title, description, visibility and audience choices to YouTube when you publish or schedule it. This connection does not publish a video by itself. Your connected channel details and upload-processing responses are not sent to AI model providers.</p>
    <p>Google processes information under the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>. Using Radar&rsquo;s YouTube features is also subject to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.</p>
    <p>Radar&rsquo;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Google user data is used only to provide or improve user-facing features in Radar. Transfers are limited to providing those features with your consent, security, legal requirements, or a merger or acquisition with your explicit prior consent. It is not used for advertising, and people do not read it unless you ask us to for support, it is needed for security or legal reasons, or it has been aggregated and anonymized for internal operations in accordance with applicable law.</p>
    <p>Search Console data is not sent to AI model providers to train their models. Where Radar uses an AI model to suggest content from your search data, only the specific data needed for that suggestion is sent, under the provider&rsquo;s API terms.</p>

    <h2>Service providers</h2>
    <p>We share data with service providers only as needed to run Radar:</p>
    <ul>
      <li>Hosting and database (Railway), file storage (Cloudflare R2) and email delivery (Resend).</li>
      <li>AI model providers (OpenAI, Anthropic, xAI, Google, Perplexity), directly or through OpenRouter, to research, draft and check content. Requests can contain your business profile, prompts, drafts and relevant search data. Provider processing and retention depend on their API terms and service settings. Fairspleet does not use your content to train AI models. Radar requests non-collecting providers for OpenRouter text requests; this is not a promise of zero retention across every provider or feature.</li>
      <li>Stripe for payments, recurring billing, invoices, subscription management and fraud prevention. See <a href="https://stripe.com/privacy">Stripe&rsquo;s Privacy Policy</a>.</li>
      <li>Data providers (DataForSEO, YouTube Data API, Open PageRank, Reddit, X, Hacker News) to look up keyword data and public conversations. We send them search terms, not your personal information.</li>
      <li>The blog and social platforms you choose to connect, when you publish.</li>
      <li>ElevenLabs, when you request narrated explainer media, receives the script and voice settings needed to produce the audio. Its processing is subject to its API terms and service settings.</li>
    </ul>

    <h2>Security and retention</h2>
    <p>Data is encrypted in transit. Access tokens and blog credentials are additionally encrypted at rest. We keep your data while your account is active. When you delete a business or your account, or ask us to, we delete the associated data, including Search Console data and connected-service tokens, within 30 days, except where we must keep records by law. Images inside articles Radar already published stay available so those articles keep working. You can disconnect Search Console at any time in Settings, or revoke Radar&rsquo;s access from your <a href="https://myaccount.google.com/permissions">Google Account permissions</a>.</p>
    <p>You can disconnect YouTube in Settings → Social accounts or contact <Contact legal /> to request deletion of your YouTube connection data. Radar removes the connection, channel details, upload identifiers and links, and stops its scheduled uploads when that request is processed. It immediately asks Google to revoke the grant; if Google is temporarily unavailable, Radar retries for up to 24 hours and then removes the retained encrypted revoke credential. Your drafts, source videos and publishing choices can remain, along with local upload status that prevents an uncertain upload from being sent twice. Reconnecting does not automatically approve stopped drafts.</p>
    <p>Radar checks connected YouTube authorization and channel details daily. Stored channel details and upload receipts are refreshed or removed within 30 days, with a 28-day expiry safety margin. Revoked access found during these checks triggers connection-data removal. YouTube connection-data deletion requests, including deleting a business, are handled under the shorter seven-day YouTube limit rather than the general 30-day retention period above. You can also revoke access at any time through your <a href="https://security.google.com/settings/security/permissions">Google security settings</a>. Disconnecting or deleting Radar data does not delete a video already on YouTube; use YouTube&rsquo;s controls to remove it.</p>
    <p>Financial, security and backup records may be retained where needed for legal obligations, security or recovery. Disconnecting Radar does not erase posts already published or records held by Stripe or another connected service; use that service&rsquo;s controls or contact us for assistance. Essential cookies can be blocked in your browser, but sign-in and other features may then stop working.</p>

    <h2>Your choices</h2>
    <p>You can view and edit your business information in Radar at any time. To access, export, correct or delete your data, contact <Contact legal />. Depending on your location, you may also object to or restrict processing, withdraw consent, or complain to your data-protection authority. We may need to verify your identity before acting on a request.</p>

    <h2>Children</h2>
    <p>Radar is a business tool and is not intended for anyone under 16.</p>

    <h2>Changes</h2>
    <p>If we change this policy in a meaningful way, we will update the date above and tell signed-in users before the change takes effect.</p>

    <h2>Contact</h2>
    <p>Privacy questions or requests: <Contact legal />. General support: <Contact />.</p>
  </LegalPage>;
}
