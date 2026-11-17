'use client';
// /restore: the owner's deleted businesses, on a page that needs no open business (.factory/delete-business/
// architecture.md §5). It is where the confirmation email and the no-business screen send an owner who deleted their
// only business. It links back to /dashboard, where the app decides what to open.
import React, { useState } from 'react';
import { DELETE_RETENTION_DAYS } from '@/lib/deletion';
import type { DeletedBusiness } from '@/lib/types';
import { RecentlyDeleted } from './RecentlyDeleted';

export function RestorePage({ deleted }: { deleted: DeletedBusiness[] }) {
  // A row whose 7 days have passed is dropped after its toast; when the last one goes the page says so.
  const [list, setList] = useState(deleted);
  return <div className="col" style={{ maxWidth: 560, width: '100%', margin: '0 auto', gap: 20, position: 'relative' }}>
    {list.length ? <>
      <h1 className="h1">Restore a business</h1>
      <p className="sub">Radar keeps a deleted business for {DELETE_RETENTION_DAYS} days. Restore it before it is wiped and it comes back as it was.</p>
      <RecentlyDeleted items={list} onGone={id => setList(l => l.filter(b => b.id !== id))} />
    </> : <>
      <h1 className="h1">Nothing to restore</h1>
      <p className="sub">Radar keeps a deleted business for {DELETE_RETENTION_DAYS} days, then wipes it for good. You have none inside that time.</p>
    </>}
    <a href="/dashboard" style={{ alignSelf: 'flex-start' }}>Return to Radar</a>
  </div>;
}
