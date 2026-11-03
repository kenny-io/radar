import type { Metadata } from 'next';
import { AuthShell } from '@/features/onboarding/Signup';
import { preferenceUser } from '@/server/services/lifecycle/preferences';
import { PreferenceForm } from './PreferenceForm';
export const metadata: Metadata = { title: 'Email preferences · Radar', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const raw = (await searchParams).token, token = typeof raw === 'string' && raw.length < 256 ? raw : '';
  const valid = !!preferenceUser(token);
  return <AuthShell energy={.2}><div className="col" style={{ maxWidth: 420, width: '100%', margin: '0 auto', gap: 20, position: 'relative' }}>
    <h1 className="h1">Email preferences</h1>
    {valid ? <><p className="sub">You can stop the founder’s optional setup check-in here. This does not affect billing or account-security messages.</p><PreferenceForm token={token} /></> : <p role="alert">This preference link isn’t valid. Contact <a href="mailto:support@thally.io">support@thally.io</a> for help.</p>}
    <a href="/signin">Return to sign in</a>
  </div></AuthShell>;
}
