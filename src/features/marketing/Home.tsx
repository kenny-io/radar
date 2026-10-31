// Homepage redesign (2026-10-31). The prototype's sample testimonials remain omitted.
import { MkRoot, HeroField, Nav, DomainForm } from './MkRoot';
import { RadarMark, Check, Logo, Closing, Footer } from './parts';
import { Statement, HowItWorks, FeatureStory, HomeScrollEffects } from './HomeStory';
import './home-redesign.css';

const connectors = [['framer', 'Framer'], ['ghost', 'Ghost'], ['github', 'GitHub'], ['notion', 'Notion'], ['shopify', 'Shopify'], ['webflow', 'Webflow'], ['wix', 'Wix'], ['wordpress', 'WordPress'], ['wpcom', 'WordPress.com'], ['webhook', 'Webhook']];
const comparison = [
  ['Where you show up', 'Google, AI answers, social feeds and conversations', 'Mostly Google', 'Wherever you find time to post'],
  ['Your time', 'A few minutes of review a day', 'Calls, briefs and monthly reports', 'Evenings and weekends'],
  ['AI assistants', 'Checked every night across five', 'Rarely tracked', 'No way to know what they say'],
  ['Publishing control', 'Review-first, or automatic publishing you enable', 'On their schedule', 'You do all of it'],
  ['Price', '$50/month, everything included', 'A monthly retainer', 'Several tool subscriptions'],
];
const included = [
  ['Daily Brief', 'Conversations on Reddit, X, LinkedIn, Hacker News and Quora, with replies in your voice.'],
  ['Content Calendar', 'Researched articles for your schedule. Review them, or enable Daily autopilot.'],
  ['AI Visibility', 'Nightly checks across ChatGPT, Perplexity, Gemini, Claude and Grok.'],
  ['Social Marketing', 'On-brand posts and visuals, with optional automatic generation and scheduling.'],
  ['Performance', 'Search Console data with suggestions ranked by impact.'],
  ['Backlinks network', 'Optional, approved, disclosed links from relevant businesses.'],
  ['Publishing', 'Ten platforms, from WordPress to a signed webhook.'],
  ['Your whole team', 'Invite as many people as you need.'],
];
function WebhookMark() { return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 8.5a3.5 3.5 0 1 1 5.2 3.1L17 16M8.2 12.4 5.6 17h6.9M14 17.2a3.5 3.5 0 1 0 3-5.2" /></svg>; }

export function Home() {
  return <MkRoot kind="home">
    <HeroField /><HomeScrollEffects />
    <a className="skip" href="#main">Skip to content</a><Nav />
    <main id="main">
      <section className="hero" id="top" aria-labelledby="hero-t"><div className="wrap fin-in"><h1 className="fin-t" id="hero-t">You built it<span className="pd" aria-hidden="true" /><span className="sr">.</span><br />Let people and AI find it.</h1><DomainForm id="dom-hero" /></div><div className="cue" aria-hidden="true"><span /></div></section>
      <div className="mk-page">
    <section className="pg-logos" aria-labelledby="lg-t"><div className="wrap"><p className="pg-eyebrow" id="lg-t">Where Radar carries your product</p><ul className="logos"><li><Logo k="google" s={18} /><span>Google</span></li><li><Logo k="chatgpt" s={18} /><span>ChatGPT</span></li><li><Logo k="perplexity" s={18} /><span>Perplexity</span></li><li><Logo k="gemini" s={18} /><span>Gemini</span></li><li><Logo k="claude" s={18} /><span>Claude</span></li><li><Logo k="grok" s={18} /><span>Grok</span></li><li><Logo k="reddit" s={18} /><span>Reddit</span></li><li><Logo k="x" s={18} /><span>X</span></li><li><Logo k="linkedin" s={18} /><span>LinkedIn</span></li><li><Logo k="hn" s={18} /><span>Hacker News</span></li><li><Logo k="quora" s={18} /><span>Quora</span></li><li><Logo k="facebook" s={18} /><span>Facebook</span></li></ul></div></section>
      <section className="pg-sec" id="unseen" aria-labelledby="un-t"><div className="wrap">
        <div className="pg-head rv"><h2 className="pg-t" id="un-t">Great products stay invisible when no one knows your name yet.</h2><p className="pg-l">Three walls stand between a new product and its first customers.</p></div>
        <div className="woes wl rv">
          <article><div className="bv vg-search" aria-hidden="true"><p className="vq"><i /><span>best time tracker for freelancers</span></p><ul><li><b>Tallyhour · Time tracking for teams</b><span>tallyhour.example</span></li><li><b>Hourwise · Billable hours, simplified</b><span>hourwise.example</span></li></ul><p className="vmiss"><i className="dot" />Your site: not on page one</p></div><p className="bk">No domain reputation</p><h3 className="bt3">Google ranks sites it already trusts.</h3><p className="fix"><i className="dot" /><span>Radar aims every article at keywords your site can realistically win.</span></p></article>
          <article><div className="bv vg-ai" aria-hidden="true"><p className="vbub">What’s the best time tracker for freelance designers?</p><p className="vans">Most freelancers start with <b>Tallyhour</b> or <b>Hourwise</b>. Both offer simple timers and invoicing.</p><p className="vmiss"><i className="dot" />Your product: not mentioned</p></div><p className="bk">No brand recognition</p><h3 className="bt3">AI assistants recommend names they’ve seen widely.</h3><p className="fix"><i className="dot" /><span>Radar checks five assistants nightly and turns every gap into a topic.</span></p></article>
          <article><div className="bv vg-net" aria-hidden="true"><span className="nw" /><span className="ping" /><span className="me" /><span className="vlab">Your followers</span></div><p className="bk">Stuck in your network</p><h3 className="bt3">Launch posts reach your followers, then stop.</h3><p className="fix"><i className="dot" /><span>Radar finds the conversations where strangers ask for what you built.</span></p></article>
        </div>
      </div></section>
      <Statement /><HowItWorks /><FeatureStory />
      <section className="pg-sec" id="stack" aria-labelledby="stk-t"><div className="wrap stk">
        <div className="stk-x rv"><h2 className="pg-t" id="stk-t">Publishes where you already do.</h2><p className="pg-l">Connected once, tested first. Review each article, or enable blog autopilot.</p><p className="stk-also"><span>Also connects to</span><span className="stk-i"><Logo k="google" s={16} />Search Console</span><span className="stk-i"><Logo k="x" s={16} />X</span><span className="stk-i"><Logo k="linkedin" s={16} />LinkedIn</span></p></div>
        <ul className="stk-g rv" aria-label="Publishing connectors">{connectors.map(([key, label]) => <li key={key}>{key === 'webhook' ? <WebhookMark /> : <Logo k={key} s={28} />}<span>{label}</span></li>)}</ul>
      </div></section>
      <section className="pg-sec" id="compare" aria-labelledby="cmp-t"><div className="wrap"><div className="pg-head rv"><h2 className="pg-t" id="cmp-t">Radar vs. the usual options</h2><p className="pg-l">Three ways to get found when you’re new.</p></div>
        <div className="c3 rv"><table aria-label="Radar compared with an SEO agency and doing it yourself"><thead><tr><td /><th scope="col" className="c3-r"><span className="cmp-b"><RadarMark s={16} />Radar</span></th><th scope="col">An SEO agency</th><th scope="col">Doing it yourself</th></tr></thead><tbody>{comparison.map(([label, radar, agency, self]) => <tr key={label}><th scope="row">{label}</th><td className="c3-r" data-l="Radar"><span className="yes"><Check />{radar}</span></td><td data-l="An SEO agency">{agency}</td><td data-l="Doing it yourself">{self}</td></tr>)}</tbody></table></div>
        <div className="trust"><div className="rv"><h3 className="bt3">Review first, or turn on autopilot.</h3><p className="bd">Blog autopilot and social automatic scheduling are separate opt-ins. You choose each in its own settings.</p></div><div className="rv"><h3 className="bt3">Help first, never spam.</h3><p className="bd">Replies help first. By default, personal replies mention your product when someone asks for a recommendation, with a disclosure. Reddit drafts never include links.</p></div><div className="rv"><h3 className="bt3">Honest signals, no guarantees.</h3><p className="bd">New domains take time to rank, and no one controls what an AI says. Radar shows where you stand and what to do next.</p></div></div>
      </div></section>
      <section className="pg-sec" id="pricing" aria-labelledby="pr-t"><div className="wrap"><div className="pg-head rv"><h2 className="pg-t" id="pr-t">One plan. Everything included.</h2><p className="pg-l">No tiers, credits or add-ons.</p></div><div className="pr1 rv"><div className="pr1-l"><p className="bk">Radar</p><p className="pr-amt"><b>$50</b><span>/month</span></p><p className="pr-trial">3-day free trial</p><a className="mbtn mbtn-solid mbtn-lg" href="/signup">Start free trial</a><ol className="pr-steps" aria-label="How the trial works"><li><span className="dot" /><b>Today · $1</b><span>A $1 payment confirms your card works and is credited toward your first month.</span></li><li><span className="dot" /><b>Days 1–3 · Free</b><span>Your trial starts once the card is confirmed.</span></li><li><span className="dot" /><b>Day 4 · $50/month</b><span>Your subscription begins.</span></li></ol></div><div className="pr1-r"><p className="bk">Everything in Radar</p><ul>{included.map(([title, text]) => <li key={title}><Check /><span><b>{title}</b><span>{text}</span></span></li>)}</ul></div></div></div></section>
      <section className="pg-sec" id="faq" aria-labelledby="faq-t">
        <div className="wrap faq-grid">
          <div className="faq-side rv"><h2 className="pg-t" id="faq-t">Questions</h2><p className="pg-l">Anything else? Sign in and ask from inside Radar.</p></div>
          <div className="faq">
            <details>
              <summary>My website is new. Can Radar help?</summary>
              <p>Yes. Radar finds keywords your site can realistically compete for, conversations worth joining, and gaps in your AI visibility. Ranking takes time, and no one can guarantee rankings or AI recommendations.</p>
            </details>
            <details>
              <summary>Can Radar write and publish blog posts automatically?</summary>
              <p>Yes. Radar researches and drafts articles for your content calendar. Review-first is the default: you approve each draft before it publishes.</p>
              <p>To skip individual approvals, enable Daily autopilot and confirm the acknowledgment. With a connected blog and a publishing schedule, Radar can write and publish automatically.</p>
            </details>
            <details>
              <summary>Can Radar create and publish social posts automatically too?</summary>
              <p>Yes. In Social Marketing, turn on Automatic generation to create posts and visuals from your articles and Business Profile on your chosen days.</p>
              <p>Save to library keeps them for review. Where social publishing is enabled, Schedule posts queues posts to connected X and LinkedIn accounts for the next day, without another approval. This is separate from blog autopilot.</p>
            </details>
            <details>
              <summary>Which social platforms can I publish to?</summary>
              <p>Where enabled, Radar can publish and schedule posts to connected X and LinkedIn accounts. Settings shows the channels available in your workspace. Facebook, Reddit and Quora posts stay copy-and-paste.</p>
            </details>
            <details>
              <summary>Can I pause automatic publishing?</summary>
              <p>Yes. Pause blog publishing to hold articles; drafting can continue. Social automation has its own controls: turn off Automatic generation to stop new packs. Posts already scheduled are not canceled, so unschedule those separately.</p>
            </details>
            <details>
              <summary>Does Radar post community replies for me?</summary>
              <p>No. You review and post Daily Brief replies yourself. Copy a reply into the conversation, or use Reply now on X to open X’s own reply box. You decide whether to send it there.</p>
            </details>
            <details>
              <summary>Will replies mention my product?</summary>
              <p>Personal replies help first. By default, they mention your product when someone asks for a recommendation, with a disclosure that you work on it. You can change the mention setting or use the helpful-only version. Reddit drafts never include links.</p>
            </details>
            <details>
              <summary>Where can Radar publish blog articles?</summary>
              <p>Framer, Ghost, GitHub, Notion, Shopify, Webflow, Wix, WordPress, WordPress.com, or any site through a signed webhook. Every connection is tested before it’s saved.</p>
              <p>The GitHub connector opens a pull request in your site’s repository. You merge it to publish through your site’s deployment process.</p>
            </details>
            <details>
              <summary>Can I see whether AI assistants recommend me?</summary>
              <p>Yes. Radar checks your prompts nightly across ChatGPT, Perplexity, Gemini, Claude and Grok, showing mentions, position and cited sites. Failed checks keep the last recorded result; prompts without a result show Not collected.</p>
            </details>
            <details>
              <summary>Do I need Google Search Console?</summary>
              <p>No, but connecting it lets Radar use your real search queries and results to find opportunities and refresh older content. Access is read-only, with up to 16 months of available history imported.</p>
            </details>
            <details>
              <summary>How does the backlinks network work?</summary>
              <p>It’s optional. Review proposals yourself, or enable auto-approval for matches that meet your rules. Network links stay disclosed and marked with <code>rel="sponsored"</code> (the default) or <code>rel="nofollow"</code>. Radar re-checks links weekly. Joining is free; leave anytime. Links don’t guarantee higher rankings.</p>
            </details>
            <details>
              <summary>How much does Radar cost?</summary>
              <p>$50 a month, with every feature included, after a 3-day free trial. One account subscription covers all businesses you own. Businesses you join as a teammate may be covered by their owner.</p>
            </details>
            <details>
              <summary>Why is there a $1 payment to start the trial?</summary>
              <p>It confirms your card works and is credited toward your first month. Your 3-day free trial starts once it succeeds, followed by the $50 monthly subscription.</p>
            </details>
            <details>
              <summary>How do I manage or cancel my subscription?</summary>
              <p>Open Settings → Billing. If your account has a Stripe subscription, you can update your card, download invoices and manage cancellation securely through Stripe.</p>
            </details>
          </div>
        </div>
      </section></div>
    <Closing headline="Be found by the people looking for you." /></main><Footer bot />
  </MkRoot>;
}
