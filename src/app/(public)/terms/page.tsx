import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, Contact, Operator } from '../LegalPage';

export const metadata: Metadata = { title: 'Terms of Service — Radar' };
export const dynamic = 'force-dynamic';

export default function TermsPage() {
  return <LegalPage title="Terms of Service" updated="November 3, 2026">
    <Operator />
    <p>These terms govern your use of Radar at radar.thally.io. By creating an account or using Radar, you agree to them. If you use Radar for a business, you confirm you are allowed to accept these terms for it.</p>
    <p>The <a href="https://thally.io/terms">Thally Terms of Service</a> also apply. The Radar-specific features and billing terms on this page take precedence where they differ, including the trial described below.</p>

    <h2>Your account</h2>
    <p>Keep your sign-in secure and tell us if you think someone else has accessed your account. You are responsible for activity in your workspace, including by teammates you invite.</p>

    <h2>Pricing, trial and renewal</h2>
    <p>Radar has one plan at US$50 per month. When you start a new trial, a US$1 payment confirms your card and is credited toward your first monthly invoice. This is an actual payment, not a temporary authorization. Your three-day trial starts after the payment is confirmed. Unless you cancel before the trial ends, your subscription renews automatically at US$50 per month; the US$1 credit reduces your first monthly charge to US$49 before any applicable taxes. The trial page shows the trial end date before you confirm.</p>
    <p>The plan belongs to the account paying for it and covers that account&rsquo;s businesses. A business&rsquo;s access depends on its owner&rsquo;s plan. Existing accounts explicitly granted complimentary access keep that access. Returning subscribers whose paid access has ended are shown the amount due to restart, without another free trial.</p>

    <h2>Cancellation, refunds and billing support</h2>
    <p>To stop renewal, open Settings → Billing → Manage billing and cancel through Stripe, or contact <Contact />. Cancel before your trial ends to avoid the first monthly subscription charge. A paid subscription canceled during its billing period stays available until the end of that period. Signing out, disconnecting a service or stopping use does not cancel a subscription.</p>
    <p>Radar uses Thally&rsquo;s <a href="https://thally.io/terms#plans-billing-and-refunds">refund policy</a>: eligible first-time paid customers can request a refund of their most recent payment within their first 30 days on a paid plan. Contact <Contact /> for refunds, disputed charges, or help canceling if the billing portal is unavailable. Statutory refund and consumer rights remain in effect.</p>
    <p>Stripe processes payments and stores payment-card details. You authorize the trial payment and recurring charges shown when you subscribe. We will notify you before a price change applies to a future renewal. Unpaid subscriptions may lose paid access.</p>

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
    <p>Questions about these terms: <Contact legal />. Account and billing help: <Contact />. The governing-law and dispute provisions in the <a href="https://thally.io/terms">Thally Terms</a> apply, subject to mandatory rights in your location.</p>
  </LegalPage>;
}
