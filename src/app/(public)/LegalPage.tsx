// Shared shell for the public policy pages (/privacy, /terms, /bot). Not part of the prototype — see DIVERGENCES.md.
import Link from 'next/link';
import { Mark } from '@/components/ui';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return <div style={{ minHeight: '100%', background: 'var(--paper)' }}>
    <header style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Link href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 10 }}><Mark s={22} /><b style={{ fontWeight: 600, letterSpacing: '-.01em' }}>Radar</b></Link>
      <nav style={{ display: 'flex', gap: 18, fontSize: 13.5, color: 'var(--mute)' }}>
        <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/bot">RadarBot</Link>
      </nav>
    </header>
    <main className="legal" style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px 96px' }}>
      <h1 style={{ fontSize: 32, lineHeight: 1.15, letterSpacing: '-.02em', fontWeight: 600, margin: '0 0 8px' }}>{title}</h1>
      <p style={{ color: 'var(--mute)', margin: '0 0 36px', fontSize: 13.5 }}>Last updated {updated}</p>
      {children}
    </main>
    <style>{`.legal h2{font-size:18px;font-weight:600;letter-spacing:-.01em;margin:36px 0 10px}.legal p,.legal li{color:var(--ink2);line-height:1.65}.legal ul{padding-left:20px}.legal li{margin:4px 0}.legal code{font-family:var(--mono);font-size:13px;background:var(--fill);padding:1px 5px;border-radius:5px}`}</style>
  </div>;
}

export function contactEmail() {
  return process.env.SUPPORT_INBOX || process.env.MAIL_FROM?.replace(/^.*<|>.*$/g, '') || '';
}

export function Contact() {
  const email = contactEmail();
  return email ? <a href={`mailto:${email}`}>{email}</a> : <span>the support address shown in the app</span>;
}
