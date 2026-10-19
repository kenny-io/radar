'use client';
// Scanning view — port of RadarSweep + BriefScan (prototype/radar-brief.jsx), driven by the real `brief.scan` job.
import React, { useEffect, useRef, useState } from 'react';
import { Btn, Icon } from '@/components/ui';
import { PlatLogo } from '@/components/brand';
import { BPLAT } from '@/lib/constants';
import type { BriefPlatform } from '@/lib/types';
import { DRAFT_SUB, RANK_SUB, enabledInOrder, type BriefScanProgress, type ScanStep } from './model';

type Phase = 'read' | 'rank' | 'done';
interface Blip { ang: number; r: number; t: number; keep: boolean; jit: number; kt?: number; ft?: number }

/* ── radar sweep (scan) ──────────────────────────────── */
export function RadarSweep({ phase, kept, size = 280 }: { phase: Phase; kept: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null); const st = useRef({ phase, kept }); st.current = { phase, kept };
  useEffect(() => {
    const c = ref.current!, ctx = c.getContext('2d')!, dpr = window.devicePixelRatio || 1; c.width = size * dpr; c.height = size * dpr; ctx.scale(dpr, dpr);
    const R = size / 2 - 6, cx = size / 2, cy = size / 2, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const blips: Blip[] = []; let a = -Math.PI / 2, last = performance.now(), raf = 0;
    const tau = Math.PI * 2, norm = (x: number) => ((x % tau) + tau) % tau;
    const frame = (t: number) => {
      const dt = Math.min(.05, (t - last) / 1000); last = t; const { phase, kept } = st.current;
      a += dt * (phase === 'rank' ? 2.4 : 1.7);
      if (phase === 'read' && Math.random() < dt * 22) blips.push({ ang: a - .05 - Math.random() * .15, r: .18 + Math.random() * .78, t, keep: false, jit: Math.random() });
      if (phase === 'rank') { const k = blips.filter(b => b.keep).length; if (k < kept) { const c2 = blips.filter(b => !b.keep && b.r > .3); if (c2.length && Math.random() < dt * 6) c2[Math.floor(Math.random() * c2.length)].keep = true; } }
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = 'oklch(0.91 0.004 265)'; ctx.lineWidth = 1;
      [1, .72, .44, .16].forEach(f => { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, tau); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.strokeStyle = 'oklch(0.955 0.003 265)'; ctx.stroke();
      if (phase !== 'done' && !reduce) {
        if ((ctx as any).createConicGradient) { const g = (ctx as any).createConicGradient(a - 1.1, cx, cy) as CanvasGradient; g.addColorStop(0, 'oklch(0.66 0.19 42 / 0)'); g.addColorStop(.175, 'oklch(0.66 0.19 42 / .22)'); g.addColorStop(.1751, 'oklch(0.66 0.19 42 / 0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - 1.1, a); ctx.closePath(); ctx.fill(); }
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.strokeStyle = 'oklch(0.66 0.19 42 / .8)'; ctx.lineWidth = 1.25; ctx.stroke();
      }
      blips.forEach(b => {
        const since = norm(a - b.ang) / tau; const x = cx + Math.cos(b.ang) * R * b.r, y = cy + Math.sin(b.ang) * R * b.r;
        if (b.keep) { const pr = Math.min(1, (t - (b.kt || (b.kt = t))) / 500); ctx.fillStyle = 'oklch(0.66 0.19 42 / .16)'; ctx.beginPath(); ctx.arc(x, y, 9 * pr, 0, tau); ctx.fill(); ctx.fillStyle = 'oklch(0.66 0.19 42)'; ctx.beginPath(); ctx.arc(x, y, 3.4, 0, tau); ctx.fill(); return; }
        const fade = phase === 'rank' || phase === 'done' ? Math.max(0, 1 - (t - (b.ft || (b.ft = t))) / 700) * .5 : 1 - since;
        if (fade <= 0) return; ctx.fillStyle = `oklch(0.2 0.012 265 / ${(fade * .55).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, 1.8 + b.jit * .8, 0, tau); ctx.fill();
      });
      ctx.fillStyle = 'oklch(0.2 0.012 265)'; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, tau); ctx.fill();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf);
  }, [size]);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} aria-hidden="true" />;
}

/**
 * Step list + sweep for one scan job. `progress` streams from the job; `err` is the failing platform's name
 * ("A source" when the failure wasn't a platform). The counter eases toward the job's live threads-read count.
 */
export function BriefScan({ platforms, progress, err, onRetry, onCancel, busy }: {
  platforms: BriefPlatform[]; progress: BriefScanProgress | null; err: string | null;
  onRetry: () => void; onCancel: (() => void) | null; busy?: boolean;
}) {
  const steps: ScanStep[] = progress?.steps?.length ? progress.steps : [...enabledInOrder(platforms).map(k => ({ k, sub: '' })), { k: 'rank', sub: RANK_SUB }, { k: 'draft', sub: DRAFT_SUB }];
  const cur = progress?.step;
  const i = cur === 'done' ? steps.length - 1 : Math.max(0, steps.findIndex(s => s.k === cur));
  const target = progress?.threadsRead || 0;
  const [read, setRead] = useState(0);
  const kIsRead = (k?: string) => !!k && k !== 'rank' && k !== 'draft' && k !== 'done';
  useEffect(() => {
    if (err) return;
    const t = setInterval(() => setRead(r => (r >= target ? r : Math.min(target, r + (kIsRead(steps[i]?.k) ? 37 + Math.floor(Math.random() * 40) : Math.max(1, Math.ceil((target - r) / 4)))))), 90);
    return () => clearInterval(t);
  }, [i, err, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const phase: Phase = err ? 'done' : steps[i] && steps[i].k === 'rank' ? 'rank' : steps[i] && (steps[i].k === 'draft' || cur === 'done') ? 'done' : 'read';
  return <div className="brief-scan enter">
    <div className="brief-scope"><RadarSweep phase={phase} kept={platforms.length * 2 + 2} /></div>
    <div className="col" style={{ gap: 0, minWidth: 0 }}>
      <span className="eyebrow" style={{ marginBottom: 14 }}>{read.toLocaleString('en-US')} threads read</span>
      {steps.map((s, j) => {
        const done = j < i || (cur === 'done' && j === i), now = j === i && !err && !done, bad = !!err && j === i;
        const isPlat = !!BPLAT[s.k as BriefPlatform];
        return <div key={s.k} className="brief-step" style={{ opacity: j > i ? .35 : 1 }}>
          <span className="brief-step-i">{bad ? <i className="dot" style={{ background: 'var(--bad)' }} /> : done ? <Icon n="check" s={14} w={2} style={{ color: 'var(--ok)' }} /> : now ? <span className="spin" style={{ color: 'var(--signal)' }} /> : <i className="dot" style={{ background: 'var(--line)' }} />}</span>
          <span className="col" style={{ minWidth: 0 }}><span className="small row" style={{ gap: 8, fontWeight: now || bad ? 500 : 400 }}>{isPlat && <PlatLogo k={s.k} s={14} />}{bad ? `${err} didn’t respond` : isPlat ? `Reading ${BPLAT[s.k as BriefPlatform]}` : s.k === 'rank' ? 'Choosing what’s worth your time' : 'Drafting in your voice'}</span>{(now || bad) && <span className="xs sub enter">{bad ? 'Nothing was lost. Try again in a minute.' : s.sub}</span>}</span>
        </div>;
      })}
      {err && <div className="row enter" style={{ gap: 10, marginTop: 18 }}><Btn kind="primary" icon="refresh" loading={busy} onClick={onRetry}>Try again</Btn>{onCancel && <Btn kind="ghost" onClick={onCancel}>Keep this morning’s brief</Btn>}</div>}
    </div>
  </div>;
}
