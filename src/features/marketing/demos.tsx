'use client';
// Marketing demos: port of prototype home.js (keyword ceiling, onboarding) and features/feature.js (keyword ceiling, step lists,
// AI answers, backlink proposal). With reduced motion every demo shows its end state straight away.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { reducedMotion } from './MkRoot';

/** Runs `fn` once when `el` is `th` visible (or at once with reduced motion). */
function useOnce(ref: React.RefObject<HTMLElement | null>, th: number, fn: () => void | (() => void)) {
  const f = useRef(fn); f.current = fn;
  useEffect(() => {
    let undo: void | (() => void);
    if (reducedMotion()) { undo = f.current(); return () => { if (undo) undo(); }; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); undo = f.current(); } }, { threshold: th });
    io.observe(ref.current!);
    return () => { io.disconnect(); if (undo) undo(); };
  }, [ref, th]);
}

/** Keyword ceiling: adds `.run` (ceiling line, struck-through rows) once in view. */
export function RunOnView({ className, th, delay, label, children }: { className: string; th: number; delay: number; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null); const [run, setRun] = useState(false);
  useOnce(ref, th, () => { const t = setTimeout(() => setRun(true), reducedMotion() ? 0 : delay); return () => clearTimeout(t); });
  return <div ref={ref} className={className + (run ? ' run' : '')} role="group" aria-label={label}>{children}</div>;
}

/** A research list that ticks its items off in sequence, 420ms apart. */
export function SeqList({ items }: { items: string[] }) {
  const ref = useRef<HTMLOListElement>(null); const [n, setN] = useState(0);
  useOnce(ref, .5, () => {
    if (reducedMotion()) { setN(items.length); return; }
    const ts = items.map((_, i) => setTimeout(() => setN(i + 1), 300 + i * 420)); return () => ts.forEach(clearTimeout);
  });
  return <ol ref={ref} className="rl">{items.map((t, i) => <li key={t} className={i < n ? 'ok' : undefined}><i></i>{t}</li>)}</ol>;
}

const OB_DOMAIN = 'fieldnote.app';
const OB_STEPS: [string, string][] = [['Reading your website', '42 pages on fieldnote.app'], ['Understanding the business', 'Fieldnote · Time tracking'], ['Mapping existing content', '18 articles · 6 pages already rank'], ['Finding your audience', '3 segments · 3 competitors'], ['Extracting your brand', 'Logo, 2 colors, voice']];
/** Home "Start" demo: types fieldnote.app, then ticks off five analysis steps. Replay restarts it. */
export function ObDemo() {
  const ref = useRef<HTMLDivElement>(null); const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [phase, setPhase] = useState<'' | 'in' | 'ready' | 'analyzing' | 'done'>(''); const [typed, setTyped] = useState(''); const [steps, setSteps] = useState<string[]>(OB_STEPS.map(() => ''));
  const run = useCallback(() => {
    timers.current.forEach(clearTimeout); timers.current = []; setPhase('in'); setTyped(''); setSteps(OB_STEPS.map(() => ''));
    if (reducedMotion()) { setTyped(OB_DOMAIN); setSteps(OB_STEPS.map(() => 'ok')); setPhase('done'); return; }
    const q = (f: () => void, t: number) => timers.current.push(setTimeout(f, t));
    const step = (k: number, c: string) => setSteps(s => s.map((x, j) => (j === k ? c : x)));
    let t = 400; for (let i = 1; i <= OB_DOMAIN.length; i++) { q(() => setTyped(OB_DOMAIN.slice(0, i)), t); t += 70; }
    q(() => setPhase('ready'), t += 150); q(() => setPhase('analyzing'), t += 650);
    OB_STEPS.forEach((_, k) => { q(() => step(k, 'act'), t += 150); q(() => step(k, 'ok'), t += 820); });
    q(() => setPhase('done'), t += 300);
  }, []);
  useOnce(ref, .5, run);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const done = phase === 'done';
  return <div ref={ref} className={'ob rv' + (phase ? ' in' : '') + (phase && phase !== 'in' ? ' ' + phase : '')} id="ob" role="group" aria-label="Illustrative example of Radar analyzing a website">
    <p className="ob-t">Let’s get to know your business.</p>
    <div className="ob-f"><span className="pre">https://</span><span className="ob-in" id="ob-in">{typed}</span><span className="ob-caret" aria-hidden="true"></span><span className="ob-b" id="ob-b">Analyze website</span></div>
    <ol className="ob-steps" id="ob-steps">{OB_STEPS.map(([a, b], k) => <li key={a} className={steps[k] || undefined}><i aria-hidden="true"></i><span>{a}</span><em>{b}</em></li>)}</ol>
    <div className="ob-done" id="ob-done"><span className="ob-b solid">Review what Radar found</span><span>About a minute to check.</span></div>
    <button className="ob-re" id="ob-re" type="button" onClick={run} tabIndex={done ? undefined : -1}>Replay</button>
  </div>;
}

const AI_ENGINES = ['ChatGPT', 'Perplexity', 'Gemini', 'Claude', 'Grok'];
const AI: { pos: number; cite: boolean; a: string; src: string[] }[] = [
  { pos: 2, cite: true, a: 'Tallyhour is the familiar pick if you like a running timer.¹ [Fieldnote] suits designers who hate timers: it turns your calendar into a timesheet and invoices from approved hours.² Hourwise works well for small teams that bill by project.³', src: ['tallyhour.example', 'fieldnote.app', 'hourwise.example'] },
  { pos: 3, cite: true, a: 'Popular options include Tallyhour for simple timers¹ and Hourwise for project budgets.² [Fieldnote] is worth a look if you plan your day in a calendar, since it builds the timesheet for you.³', src: ['tallyhour.example', 'hourwise.example', 'fieldnote.app'] },
  { pos: 3, cite: false, a: 'Freelance designers often start with Tallyhour¹ or Hourwise² for quick timers and invoices. If you’d rather not run a timer at all, [Fieldnote] reads your calendar and drafts your timesheet.', src: ['tallyhour.example', 'hourwise.example'] },
  { pos: 1, cite: true, a: '[Fieldnote] is a strong fit for freelance designers: it reads your calendar, so there’s no timer to forget, and invoices from approved hours.¹ Tallyhour and Hourwise are solid if you prefer a stopwatch.²', src: ['fieldnote.app', 'tallyhour.example'] },
  { pos: 0, cite: false, a: 'Tallyhour is the usual recommendation for freelancers who want a quick timer.¹ Hourwise adds project budgets and invoicing on top.²', src: ['tallyhour.example', 'hourwise.example'] }];
const sups = (s: string) => s.split(/([¹²³])/).map((p, i) => (i % 2 ? <sup key={i}>{p}</sup> : p));
const word = (x: string) => { const m = x.match(/^\[(.+?)\](.*)$/); return m ? <><mark>{m[1]}</mark>{sups(m[2])}</> : sups(x); };

/** AI visibility hero: one question, five assistants. Auto-advances every 4.2s until the user picks a tab; arrow keys move
 *  between tabs. */
export function AiDemo() {
  const ref = useRef<HTMLDivElement>(null); const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [cur, setCur] = useState(0); const [n, setN] = useState(0); const [on, setOn] = useState(false); const [auto, setAuto] = useState(true);
  const st = useRef({ cur: 0, auto: true, seen: false, t: undefined as ReturnType<typeof setTimeout> | undefined });
  const show = useCallback((i: number) => {
    const s = st.current; s.cur = i; setCur(i); setN(x => x + 1); setOn(false); clearTimeout(s.t);
    const rm = reducedMotion(); const w = AI[i].a.split(' ').length;
    s.t = setTimeout(() => { setOn(true); if (s.auto && !rm) s.t = setTimeout(() => show((s.cur + 1) % 5), 4200); }, rm ? 0 : w * 30 + 400);
  }, []);
  useEffect(() => {
    const s = st.current; if (reducedMotion()) { s.seen = true; show(s.cur); }
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting && !s.seen) { s.seen = true; show(s.cur); } else if (!e.isIntersecting && s.auto) { clearTimeout(s.t); s.seen = false; }
    }), { threshold: .35 });
    io.observe(ref.current!);
    return () => { io.disconnect(); clearTimeout(s.t); };
  }, [show]);
  const pick = (i: number) => { st.current.auto = false; setAuto(false); show(i); };
  const d = AI[cur]; const rm = n > 0 && reducedMotion();
  return <div className="ai" id="ai-demo" ref={ref}>
    <div className="ai-tabs" role="tablist" aria-label="Assistant">{AI_ENGINES.map((e, j) => <button key={e} ref={b => { tabs.current[j] = b; }} role="tab" id={'ai-tab-' + j} aria-controls="ai-panel" aria-selected={j === cur} tabIndex={j === cur ? 0 : -1} type="button"
      onClick={() => pick(j)} onKeyDown={ev => { if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); const k = (st.current.cur + (ev.key === 'ArrowRight' ? 1 : 4)) % 5; pick(k); tabs.current[k]?.focus(); } }}>{e}</button>)}</div>
    {/* Announced only once the user has picked a tab, so the auto-advance doesn't read out every 4.2s. */}
    <div className="ai-body" role="tabpanel" id="ai-panel" aria-labelledby={'ai-tab-' + cur} aria-live={auto ? 'off' : 'polite'}><p className="ai-q">What’s the best time tracking app for freelance designers?</p>
      <p className="ai-a" id="ai-a" key={n}>{n > 0 && d.a.split(' ').map((x, k) => <Fragment key={k}>{k ? ' ' : ''}<span className="w" style={{ animationDelay: (rm ? 0 : k * 30) + 'ms' }}>{word(x)}</span></Fragment>)}</p>
      <p className={'ai-src' + (on ? ' on' : '')} id="ai-src">{n > 0 && d.src.map((s, k) => <span key={s} className={s === 'fieldnote.app' ? 'me' : undefined}>{k + 1 + '  ' + s + (s === 'fieldnote.app' ? ' · your site' : '')}</span>)}</p></div>
    <p className={'ai-res' + (on ? ' on' : '')} id="ai-res">{n > 0 && (d.pos
      ? <><span className="st-ok"><i className="dot"></i>Mentioned · #{d.pos}</span><span>{d.cite ? 'Cited your site' : 'Your site wasn’t cited'}</span></>
      : <><span className="st-no"><i className="dot" style={{ color: '#a7a9ae' }}></i>Not mentioned</span><span>Articles that answer this question directly tend to be cited.</span></>)}</p>
  </div>;
}

/** Backlinks hero: Approve / Decline swap to a plain status with Undo, announced through aria-live. */
export function ProposalDemo() {
  const [st, setSt] = useState<'' | 'ok' | 'no'>(''); const undo = useRef<HTMLButtonElement>(null); const approve = useRef<HTMLButtonElement>(null); const moved = useRef(false);
  useEffect(() => { if (!moved.current) return; (st ? undo : approve).current?.focus(); }, [st]);
  const set = (v: '' | 'ok' | 'no') => { moved.current = true; setSt(v); };
  return <div className={'demo bp' + (st ? ' ' + st : '')} role="group" aria-label="Illustrative backlink proposal">
    <div className="bp-top"><span className="bp-lg" aria-hidden="true">P</span><span className="who"><b>Paper &amp; Pixel</b><span>paperandpixel.example</span></span><span className="bp-auth"><b>48</b>Authority</span></div>
    <p className="bp-sent"><small>On “How to price your first design project”</small>Once you’ve agreed on a price, send a clear invoice. <u>A simple freelance invoice template</u> saves you from chasing payments later.</p>
    <ul className="bp-meta"><li><span>Links to</span><span>fieldnote.app/invoice-template</span></li><li><span>Marked</span><span><code>rel=&quot;sponsored&quot;</code> · Partner link</span></li><li><span>Why it fits</span><span>Their readers are freelance designers pricing projects.</span></li></ul>
    <div className="bp-act" aria-live="polite">
      {!st && <><button className="mbtn mbtn-o" type="button" onClick={() => set('no')}>Decline</button><button className="mbtn mbtn-k" type="button" ref={approve} onClick={() => set('ok')}>Approve</button></>}
      {st === 'ok' && <span className="res r-ok"><i className="dot"></i>Approved</span>}
      {st === 'no' && <span className="res r-no"><i className="dot"></i>Declined</span>}
      {st && <button className="undo" type="button" ref={undo} onClick={() => set('')}>Undo</button>}
    </div>
  </div>;
}
