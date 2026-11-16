'use client';
// Settings → Delete business (.factory/delete-business/brief.md "Experience", architecture.md §9). The Owner deletes the
// business they have open after typing its domain; Radar keeps it for 7 days, and "Recently deleted" restores it.
// Delete and restore both end in a full navigation, so nothing of the old business survives in this tab.
import React, { useId, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { ApiError, deleteBusinessCall, isSubscriptionRequired } from '@/client/api';
import { deletedFlash, fmtWipe, wipeAfter } from '@/client/deletion';
import { setFlash } from '@/client/flash';
import { leaveIfDeleted } from '@/client/leave';
import { Btn, Icon, Modal } from '@/components/ui';
import { RecentlyDeleted } from '@/features/restore/RecentlyDeleted';
import { DELETE_RETENTION_DAYS, domainMatches } from '@/lib/deletion';

const RETRY = 'Radar couldn’t finish this. Try again.';

/** The delete row's content: what goes, the 7 days, and the button that opens the dialog. Owner of the open business only. */
export function DeleteBusiness() {
  const { B, bid } = useApp();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!B || !bid || B.role !== 'Owner') return null;
  const name = B.profile.business.name || B.profile.domain;
  return <>
    <p className="small sub" style={{ maxWidth: 560 }}>This removes {name} from Radar with everything in it: the profile, calendar, articles, posts, connections and team access. Radar keeps it for {DELETE_RETENTION_DAYS} days so you can restore it, then wipes it for good.</p>
    <Btn ref={trigger} kind="danger" aria-haspopup="dialog" onClick={() => setOpen(true)}>Delete business</Btn>
    {open && <DeleteDialog bid={bid} name={name} domain={B.profile.domain} back={trigger} onClose={() => setOpen(false)} />}
  </>;
}

/** "Recently deleted" in Settings: the signed-in owner's own deleted businesses, whichever business is open. */
export function DeletedBusinesses() {
  const { me, refreshMe } = useApp();
  return <RecentlyDeleted items={me.deleted} onGone={() => { refreshMe().catch(() => {}); }} />;
}

function DeleteDialog({ bid, name, domain, back, onClose }: { bid: string; name: string; domain: string; back: React.RefObject<HTMLElement | null>; onClose: () => void }) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false); // Enter twice before the first re-render must still send one request
  /** `field`: the server said the domain does not match (shown under the field). `form`: anything else it refused. */
  const [err, setErr] = useState<{ at: 'field' | 'form'; msg: string } | null>(null);
  // Fixed when the dialog opens. After the delete, the server's own `purgeAt` is what the toast shows.
  const [until] = useState(() => fmtWipe(wipeAfter(Date.now())));
  const match = domainMatches(typed, domain);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!match || running.current) return; // Enter does nothing until the text matches
    running.current = true; setBusy(true); setErr(null);
    try {
      const r = await deleteBusinessCall(bid, typed);
      // Stays busy until the page goes: the next business the owner can use, or the no-business screen.
      setFlash(deletedFlash(r.name || name, r.purgeAt), 'ok');
      window.location.assign(r.nextId ? '/dashboard' : '/onboarding');
    } catch (x) {
      if (leaveIfDeleted(x)) return; // already deleted (another tab): it is done, leave the same way
      if (isSubscriptionRequired(x)) { window.location.assign('/start-trial'); return; }
      if (x instanceof ApiError && x.status === 401) { window.location.href = '/signup'; return; }
      running.current = false; setBusy(false);
      setErr({ at: x instanceof ApiError && x.code === 'domain_mismatch' ? 'field' : 'form', msg: x instanceof ApiError ? x.message : RETRY });
    }
  };

  const kept = ['Your Radar subscription is not affected.', 'Posts already published stay where they are.'];
  return <Modal open onClose={onClose} dismissable={!busy} width={480} label={`Delete ${name}?`} focus={back}>
    <form className="col" style={{ padding: 30, gap: 20 }} onSubmit={submit} aria-busy={busy} noValidate>
      <div className="col" style={{ gap: 10 }}>
        <h2 className="h2" style={{ overflowWrap: 'anywhere' }}>Delete {name}?</h2>
        <p className="sub">Radar stops writing, publishing, posting and scanning for {name} right away, and your team loses access. <span style={{ color: 'var(--ink)' }}>Radar keeps it for {DELETE_RETENTION_DAYS} days, until {until}, then wipes it for good.</span></p>
      </div>
      <ul className="col small" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
        {kept.map(t => <li key={t} className="row" style={{ gap: 8, alignItems: 'flex-start', color: 'var(--ink2)' }}><Icon n="check" s={15} w={1.8} style={{ color: 'var(--mute)', marginTop: 2 }} /><span>{t}</span></li>)}
      </ul>
      <div className="field">
        <label className="label" htmlFor={id} style={{ fontSize: 13, lineHeight: 1.45 }}>Type <span style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{domain}</span> to confirm</label>
        <input id={id} data-autofocus className={'input' + (err?.at === 'field' ? ' err' : '')} value={typed} readOnly={busy}
          onChange={e => { setTyped(e.target.value); if (err) setErr(null); }}
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" enterKeyHint="done"
          aria-invalid={err?.at === 'field' || undefined} aria-describedby={err?.at === 'field' ? id + '-err' : undefined} />
        {err?.at === 'field' && <span id={id + '-err'} className="xs" role="alert" style={{ color: 'var(--bad)' }}>{err.msg}</span>}
      </div>
      {err?.at === 'form' && <p className="small" role="alert" style={{ color: 'var(--bad)' }}>{err.msg}</p>}
      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind="danger" type="submit" disabled={!match} loading={busy}>Delete business</Btn>
      </div>
    </form>
  </Modal>;
}
