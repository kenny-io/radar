import React from 'react';
import type { Metadata } from 'next';
import { currentUser } from '@/server/auth/session';
import { redirect } from 'next/navigation';
import { EmailSettings } from '@/features/settings/EmailSettings';
import { AuthShell } from '@/features/onboarding/Signup';
import { preferenceUser, workPreferenceUser, educationPreferenceUser } from '@/server/services/lifecycle/preferences';
import { PreferenceForm } from './PreferenceForm';
export const metadata: Metadata = { title: 'Email preferences · Radar', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const raw = (await searchParams).token;
  if (raw === undefined) {
    if (!await currentUser()) redirect('/signin?next=' + encodeURIComponent('/email-preferences'));
    return <AuthShell energy={.2}><div className="col" style={{ maxWidth: 560, width: '100%', margin: '0 auto', gap: 20, position: 'relative' }}>
      <h1 className="h1">Email preferences</h1><p className="sub">Manage emails for your account. You can change these choices at any time, including before or after a subscription.</p><EmailSettings /><a href="/dashboard">Return to Radar</a>
    </div></AuthShell>;
  }
  const token = typeof raw === 'string' && raw.length < 256 ? raw : '';
  const work = !!workPreferenceUser(token);
  const education = !!educationPreferenceUser(token);
  const valid = education || work || !!preferenceUser(token);
  return <AuthShell energy={.2}><div className="col" style={{ maxWidth: 420, width: '100%', margin: '0 auto', gap: 20, position: 'relative' }}>
    <h1 className="h1">Email preferences</h1>
    {valid ? <><p className="sub">{education ? 'You can stop the weekly Radar lessons and one-time guides here.' : work ? 'You can stop Daily Brief, calendar and social follow-through reminders here.' : 'You can stop the founder’s optional setup check-in here.'} This does not affect billing or account-security messages.</p><PreferenceForm token={token} work={work} education={education} /></> : <p role="alert">This preference link isn’t valid. Contact <a href="mailto:support@thally.io">support@thally.io</a> for help.</p>}
    <a href="/email-preferences">Manage all email preferences</a>
    <a href="/signin">Return to sign in</a>
  </div></AuthShell>;
}
