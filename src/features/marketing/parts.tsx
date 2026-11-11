// Shared marketing pieces (prototype "Radar Home.html" and features/*.html). Copy is verbatim from the prototype.
import Link from 'next/link';
import { BrandIcon } from '@/components/brand';
import { DomainForm } from './MkRoot';
import { RadarMark } from './mark';
import { FEATURE_LINKS } from './marketing-links';
export { RadarMark, Arrow, Check } from './mark';

/** Brand marks bundled with the app (D4) in place of the prototype's hot-linked google.com/s2/favicons images. Decorative:
 *  the name is always written next to it. `color` paints single-colour marks (ChatGPT, Grok) on dark cards. */
export function Logo({ k, s, color }: { k: string; s: number; color?: string }) {
  return <span className="mk-logo" aria-hidden="true"><BrandIcon k={k} s={s} style={color ? { color } : undefined} /></span>;
}

/** Closing card with an optional page-specific headline and the shared website field. */
export function Closing({ headline }: { headline?: React.ReactNode } = {}) {
  return <section className="end" id="begin" aria-labelledby="end-t"><div className="wrap"><div className="end-card rv"><h2 className="end-t" id="end-t">{headline ?? <>You built it<span className="pd" aria-hidden="true"></span><span className="sr">.</span><br />Let people and AI find it.</>}</h2><DomainForm id="dom-fin" /><p className="wm wm-d" aria-hidden="true">Radar</p></div></div></section>;
}

export function Footer({ bot: _bot }: { bot?: boolean }) {
  return <footer className="foot">
    <div className="wrap foot-g">
      <div className="foot-b"><span className="brand"><RadarMark s={18} />Radar</span><p className="foot-c">A product of <a href="https://thally.io">Thally</a>. Product images show illustrative data.</p></div>
      <nav className="foot-col" aria-label="Features"><p>Features</p>{FEATURE_LINKS.map(item => <Link key={item.href} href={item.href}>{item.name}</Link>)}</nav>
      <nav className="foot-col" aria-label="Resources"><p>Resources</p><Link href="/blog">Blog</Link><Link href="/#pricing">Pricing</Link><Link href="/#faq">Questions</Link></nav>
      <nav className="foot-col" aria-label="Company"><p>Company</p><a href="/signin">Sign in</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/bot">RadarBot</Link></nav>
    </div></footer>;
}

