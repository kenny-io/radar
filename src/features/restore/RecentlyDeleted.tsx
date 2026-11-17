'use client';
// "Recently deleted": the owner's deleted businesses that can still be restored, one row each with a Restore button
// (.factory/delete-business/architecture.md §9). The same list is in Settings → Delete business and on /restore, which
// has no app shell, so it takes its rows as a prop and uses only the toast host from the root layout.
import React, { useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, restoreBusinessCall } from '@/client/api';
import { restoredFlash, wipedOn } from '@/client/deletion';
import { setFlash } from '@/client/flash';
import { Btn, LogoTile, useToast } from '@/components/ui';
import type { DeletedBusiness } from '@/lib/types';

/** The server answered that this business can no longer come back: say so, then take the row away. */
const GONE = ['restore_expired', 'restore_not_found'];
const RETRY = 'Radar couldn’t finish this. Try again.';

const never = () => () => {};
/** False on the server and while its HTML is being taken over, true from then on. Dates are written in the viewer's
 *  own time zone, which the server does not know, so they are shown only once this is true. */
export const useLocalTime = () => useSyncExternalStore(never, () => true, () => false);

/** `onGone`: a row was dropped because its 7 days have passed or it is already wiped (Settings reloads `me`; /restore
 *  shows its empty state when none is left). Renders nothing when there is no row. */
export function RecentlyDeleted({ items, onGone }: { items: DeletedBusiness[]; onGone?: (id: string) => void }) {
  const toast = useToast(); const local = useLocalTime();
  const [busy, setBusy] = useState<string | null>(null);
  // One restore at a time: each one ends in a full navigation. A ref, because two clicks can arrive before the first
  // one has re-rendered the buttons as disabled.
  const running = useRef(false);
  const [gone, setGone] = useState<string[]>([]);
  const list = items.filter(b => !gone.includes(b.id));
  const restore = async (b: DeletedBusiness) => {
    if (running.current) return;
    running.current = true; setBusy(b.id);
    try {
      const r = await restoreBusinessCall(b.id);
      // The button stays busy until the page goes. The layout opens the business, or /start-trial when it came back locked.
      setFlash(restoredFlash(r.name || b.name), 'ok');
      window.location.assign('/dashboard');
    } catch (e) {
      running.current = false; setBusy(null);
      if (e instanceof ApiError && e.status === 401) { window.location.assign('/signin?next=' + encodeURIComponent('/restore')); return; }
      toast(e instanceof ApiError ? e.message : RETRY, { tone: 'bad' });
      if (e instanceof ApiError && GONE.includes(e.code || '')) { setGone(g => [...g, b.id]); onGone?.(b.id); }
    }
  };
  if (!list.length) return null;
  return <ul className="col" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-busy={!!busy}>
    {list.map(b => <li key={b.id} className="row" style={{ gap: 12, padding: '12px 0', borderTop: '1px solid var(--line2)' }}>
      <LogoTile brand={b.brand} s={30} />
      <span className="col grow" style={{ gap: 2 }}>
        <span className="small" style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{b.name}</span>
        {/* The domain and the date, with a dot between them; on a narrow screen the date moves to its own line and the dot
            goes (.dot-sep). The date is never cut: where even its own line is too short it wraps, and only "at 4:05 PM"
            is kept together. A long domain breaks where it must. */}
        <span className="xs sub dot-sep"><span><span style={{ overflowWrap: 'anywhere' }}>{b.domain}</span>{local && <span>{wipedOn(b.purgeAt).replace(/ at (\S+) (AM|PM)$/, ' at\u00a0$1\u00a0$2')}</span>}</span></span>
      </span>
      <Btn size="sm" loading={busy === b.id} disabled={!!busy} aria-label={`Restore ${b.name}`} onClick={() => restore(b)}>Restore</Btn>
    </li>)}
  </ul>;
}
