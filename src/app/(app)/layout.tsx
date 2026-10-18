import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { getMe } from '@/server/auth/users';
import { AppProvider } from '@/client/app';
import { AppShell } from '@/features/shell/AppShell';

export const dynamic = 'force-dynamic';
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  if (!u) redirect('/signup');
  const me = await getMe(u);
  return <Suspense><AppProvider me={me}><AppShell>{children}</AppShell></AppProvider></Suspense>;
}
