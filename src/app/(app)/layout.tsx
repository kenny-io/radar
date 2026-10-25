import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { getMe } from '@/server/auth/users';
import { openBusinessUrl, resolveEntry, SAVED_DASHBOARD } from '@/server/billing/guard';
import { AppProvider } from '@/client/app';
import { AppShell } from '@/features/shell/AppShell';

export const dynamic = 'force-dynamic';
// Server route guard (handoff §3.4, architecture §4.3): no session → /signup; no business → /onboarding;
// no trialing/active subscription → /start-trial. A direct URL can't skip it.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  if (!u) redirect('/signup');
  const e = await resolveEntry(u);
  if ('redirect' in e) redirect(e.redirect);
  if (e.committed) redirect(openBusinessUrl(e.committed, SAVED_DASHBOARD));   // self-healed a saved draft: open it (D2)
  const me = await getMe(u);   // currentId is chosen only among accessible businesses
  return <Suspense><AppProvider me={me}><AppShell>{children}</AppShell></AppProvider></Suspense>;
}
