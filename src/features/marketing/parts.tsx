// Shared marketing pieces (prototype "Radar Home.html" and features/*.html). Copy is verbatim from the prototype.
import Link from 'next/link';
import { BrandIcon } from '@/components/brand';
import { DomainForm } from './MkRoot';
import { RadarMark } from './mark';
export { RadarMark, Arrow, Check } from './mark';

/** Brand marks bundled with the app (D4) in place of the prototype's hot-linked google.com/s2/favicons images. Decorative:
 *  the name is always written next to it. `color` paints single-colour marks (ChatGPT, Grok) on dark cards. */
export function Logo({ k, s, color }: { k: string; s: number; color?: string }) {
  return <span className="mk-logo" aria-hidden="true"><BrandIcon k={k} s={s} style={color ? { color } : undefined} /></span>;
}

/** Closing card: "You built it● Let people and AI find it." with the website field. */
export function Closing() {
  return <section className="end" id="begin" aria-labelledby="end-t"><div className="wrap"><div className="end-card rv"><h2 className="end-t" id="end-t">You built it<span className="pd" aria-hidden="true"></span><span className="sr">.</span><br />Let people and AI find it.</h2><DomainForm id="dom-fin" /><p className="wm wm-d" aria-hidden="true">Radar</p></div></div></section>;
}

export function Footer({ bot }: { bot?: boolean }) {
  return <footer className="foot">
    <div className="wrap foot-in"><span className="brand"><RadarMark s={18} />Radar</span><nav className="foot-l" aria-label="Footer"><Link href="/features/organic-search">Organic search</Link><Link href="/features/ai-visibility">AI visibility</Link><Link href="/features/backlinks">Backlinks</Link><a href="/signin">Sign in</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>{bot && <a href="/bot">RadarBot</a>}</nav><span className="foot-c">Product images show illustrative data.</span></div></footer>;
}

