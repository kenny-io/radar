'use client';
// Social channels hooks and helpers (CONTRACTS § Social channels → Components): the clock used for lock/past checks,
// drag-to-reschedule, and where a calendar item opens.
import { useEffect, useState } from 'react';
import { useApp, type AppCtx } from '@/client/app';
import type { SocialItem } from '@/lib/socialPublish';
import { planMove, withPub } from './logic';

/** Server clock minus client clock, from the last workspace's `now` (lock and past checks use the server's idea of now). */
let skewMs = 0; let skewFor: string | null = null;
function noteServerNow(now: string | null | undefined) {
  if (!now || now === skewFor) return;
  const t = Date.parse(now); if (Number.isNaN(t)) return;
  skewFor = now; skewMs = t - Date.now();
}
/** `Date.now()` corrected by the server's clock. */
export const nowMs = () => Date.now() + skewMs;

/** Now (ms), corrected by `B.now`, re-rendering every 30 s so "Sending soon" and past checks stay current. */
export function useNowMs(): number {
  const { B } = useApp(); noteServerNow(B?.now);
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(iv); }, []);
  return nowMs();
}

/** Drag a scheduled post to another day (keeps its time). Refusals are toasted with the shared copy; the server re-checks. */
export function moveSocial(app: Pick<AppCtx, 'B' | 'act' | 'toast'>, sid: string, date: string) {
  const B = app.B; if (!B) return;
  noteServerNow(B.now);
  const plan = planMove(B, sid, date, nowMs());
  if (plan.kind === 'noop') return;
  if (plan.kind === 'refuse') { app.toast(plan.msg, { tone: 'warn' }); return; }
  app.act('social.move', { sid, date }, { optimistic: b => withPub(b, sid, plan.pub) }).catch(() => {});
  app.toast(plan.toast);
}

/** Open a calendar / This week item: its pack on that platform's tab, or the Daily Brief. */
export function openSocial(go: AppCtx['go'], it: Pick<SocialItem, 'src' | 'packId' | 'k'>) {
  if (it.src === 'brief') go('brief'); else go('social', { pack: it.packId, plat: it.k });
}
