import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, Contact } from '../LegalPage';

export const metadata: Metadata = { title: 'Terms of Service — Radar' };
export const dynamic = 'force-dynamic';

export default function TermsPage() {
  return <LegalPage title="Terms of Service" updated="October 19, 2026">
    <p>These terms govern your use of Radar at radar.thally.io. By creating an account or using Radar, you agree to them. If you use Radar for a business, you confirm you are allowed to accept these terms for it.</p>

    <h2>Your account</h2>
    <p>Keep your sign-in secure and tell us if you think someone else has accessed your account. You are responsible for activity in your workspace, including by teammates you invite.</p>

    <h2>Your content</h2>
    <p>You keep ownership of your website content, business information and everything Radar drafts for you. You give us permission to process it only to run Radar for you. You are responsible for reviewing what you publish. Radar&rsquo;s drafts are generated with AI models and can contain mistakes; check facts, claims and links before publishing, especially if you use autopilot publishing.</p>

    <h2>Connected services</h2>
    <p>When you connect Google Search Console, a blog platform or another service, you authorize Radar to act on that service within the permissions you grant: reading data, or creating and publishing posts. You can disconnect at any time. Your use of those services stays subject to their own terms.</p>

    <h2>Acceptable use</h2>
    <p>Do not use Radar to publish content that is unlawful, deceptive or infringing; to spam, including in online communities surfaced by the Daily Brief; to access sites or accounts you are not authorized to use; or to interfere with Radar or other users. Follow each community&rsquo;s rules when you join conversations Radar suggests.</p>

    <h2>Backlink network</h2>
    <p>The link network is opt-in. Links placed through it are disclosed and marked with <code>rel=&quot;sponsored&quot;</code>, and either side can remove a link at any time. Do not use the network to manipulate search rankings in ways that break search engine guidelines.</p>

    <h2>Availability and changes</h2>
    <p>We work to keep Radar running but do not guarantee it will be uninterrupted or error-free. Third-party data (search volumes, AI-assistant answers, public conversations) is provided as available and may be incomplete. We may change or discontinue features. If we make a material change to these terms, we will tell you in advance.</p>

    <h2>Ending</h2>
    <p>You can stop using Radar and ask us to delete your account at any time. We may suspend accounts that break these terms or put the service or others at risk.</p>

    <h2>Liability</h2>
    <p>To the extent the law allows, Radar is provided &ldquo;as is&rdquo;, and we are not liable for indirect or consequential losses, lost profits, or lost data arising from your use of Radar. Nothing in these terms limits liability that cannot be limited by law.</p>

    <h2>Privacy</h2>
    <p>How we handle personal data is described in the <Link href="/privacy">Privacy Policy</Link>.</p>

    <h2>Contact</h2>
    <p>Questions about these terms: <Contact />.</p>
  </LegalPage>;
}
