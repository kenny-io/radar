// /restore: a signed-in page outside every route group, so it works with no business left and never runs the app's
// entry guard (.factory/delete-business/architecture.md §5). The list is the signed-in owner's own; nobody else has one.
import React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { listDeleted } from '@/server/deletion';
import { AuthShell } from '@/features/onboarding/Signup';
import { RestorePage } from '@/features/restore/RestorePage';

export const metadata: Metadata = { title: 'Restore a business · Radar', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect('/signin?next=' + encodeURIComponent('/restore'));
  return <AuthShell energy={.2}><RestorePage deleted={await listDeleted(user.id)} /></AuthShell>;
}
