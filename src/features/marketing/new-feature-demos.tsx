'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Logo } from './parts';
import { reducedMotion } from './MkRoot';
import { BRIEF_REPLIES, SOCIAL_POSTS, performancePath, performanceSeries } from './feature-demo-data';

/** Clipboard failures keep the initial state and announce an honest manual-copy fallback. */
export function DailyBriefDemo() {
  const [mode, setMode] = useState(0), [stage, setStage] = useState<'ready' | 'copied' | 'posted'>('ready');
  const [message, setMessage] = useState(''), [copying, setCopying] = useState(false);
  const action = useRef<HTMLButtonElement>(null), undo = useRef<HTMLButtonElement>(null), revision = useRef(0);
  const reset = () => { revision.current++; setStage('ready'); setMessage(''); setCopying(false); };
  const copy = async () => {
    if (stage === 'copied') { setStage('posted'); requestAnimationFrame(() => undo.current?.focus()); return; }
    const current = revision.current; setCopying(true); setMessage('');
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(BRIEF_REPLIES[mode]);
      if (current === revision.current) setStage('copied');
    } catch { if (current === revision.current) setMessage('Copy unavailable. Select the reply text and copy it manually.'); }
    finally { if (current === revision.current) setCopying(false); }
  };
  return <div className={`demo br${stage === 'posted' ? ' posted' : ''}`} id="br" aria-label="Illustrative Daily Brief reply">
    <div className="br-m"><Logo k="reddit" s={16} /><span>r/freelance · 3h · 41 comments</span><span className="br-o">Open thread ↗</span></div>
    <p className="br-t">How do you track time without a timer running all day?</p>
    <p className="br-w">Freelance designers forgetting to start timers is a buyer need in your Business Profile.</p>
    <div className="br-c"><div className="br-ch"><span>Your reply</span><div className="seg2" role="group" aria-label="Reply style">{['Just help', 'Mention Fieldnote'].map((label, i) => <button type="button" key={label} aria-pressed={mode === i} onClick={() => { setMode(i); reset(); }}>{label}</button>)}</div></div>
      <p className="br-x swap" key={mode} id="br-x" aria-live="polite">{BRIEF_REPLIES[mode]}</p>
      <div className="br-a"><button className="mbtn mbtn-k" ref={action} type="button" id="br-b" onClick={copy} disabled={copying}>{copying ? 'Copying…' : stage === 'copied' ? 'I posted it' : 'Copy reply'}</button><span className={`br-st${stage === 'copied' ? ' cp' : stage === 'posted' ? ' ok' : ''}`} aria-live="polite">{stage !== 'ready' && <><i className="dot" />{stage === 'copied' ? 'Copied' : 'Posted'}</>}</span><button className="br-u" ref={undo} type="button" onClick={() => { reset(); requestAnimationFrame(() => action.current?.focus()); }}>Undo</button></div>
      <p className="br-f">{mode === 0 ? 'Reddit drafts never include links.' : 'Reddit drafts never include links, and always disclose that you work on Fieldnote.'}</p>
      {message && <p className="br-f" role="status">{message}</p>}
    </div><p className="demo-note">Illustrative demo. No reply is posted.</p>
  </div>;
}

function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: number, total: number, choose: (index: number) => void, tabs: (HTMLButtonElement | null)[]) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? total - 1 : (current + (event.key === 'ArrowRight' ? 1 : total - 1)) % total;
  choose(next); tabs[next]?.focus();
}

export function SocialMarketingDemo() {
  const root = useRef<HTMLDivElement>(null), tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [current, setCurrent] = useState(0), [auto, setAuto] = useState(true), [visible, setVisible] = useState(false), [motion, setMotion] = useState(false), [status, setStatus] = useState('');
  const generation = useRef(0), post = SOCIAL_POSTS[current];
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setMotion(media.matches); change(); media.addEventListener('change', change);
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting && entries[0].intersectionRatio >= .35), { threshold: .35 }); observer.observe(root.current!);
    return () => { observer.disconnect(); media.removeEventListener('change', change); };
  }, []);
  useEffect(() => { if (!auto || !visible || motion) return; const timer = setTimeout(() => { generation.current++; setCurrent(i => (i + 1) % SOCIAL_POSTS.length); setStatus(''); }, 3800); return () => clearTimeout(timer); }, [auto, visible, motion, current]);
  const stop = () => setAuto(false);
  const choose = (i: number) => { stop(); generation.current++; setCurrent(i); setStatus(''); };
  const copy = async () => {
    stop(); const version = generation.current;
    try { if (!navigator.clipboard) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(post.text); if (version === generation.current) setStatus('Copied'); }
    catch { if (version === generation.current) setStatus('Copy unavailable. Select the post text and copy it manually.'); }
  };
  const download = async () => {
    stop();
    try {
      await document.fonts.ready;
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = Math.round(1200 / post.ratio);
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = '#2b3a67'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.font = '600 66px sans-serif';
      let line = '', y = 145;
      for (const word of 'Fifteen minutes on Friday beats chasing gaps.'.split(' ')) { const candidate = line ? `${line} ${word}` : word; if (ctx.measureText(candidate).width > 1050) { ctx.fillText(line, 75, y); y += 82; line = word; } else line = candidate; }
      ctx.fillText(line, 75, y); ctx.font = '28px monospace'; ctx.fillText('Fieldnote', 75, canvas.height - 65);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Cannot create image')), 'image/png'));
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `fieldnote-${post.name.toLowerCase()}-demo.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus('Image downloaded');
    } catch { setStatus('Image download unavailable in this browser.'); }
  };
  return <div ref={root} className="demo sx" id="sx" aria-label="Illustrative social pack" onClickCapture={stop} onKeyDownCapture={stop}>
    <div className="sx-tabs" role="tablist" aria-label="Platform">{SOCIAL_POSTS.map((item, i) => <button key={item.name} type="button" role="tab" ref={node => { tabs.current[i] = node; }} id={`sx-tab-${i}`} aria-selected={current === i} aria-controls="sx-panel" tabIndex={current === i ? 0 : -1} onClick={() => choose(i)} onKeyDown={event => moveTab(event, current, SOCIAL_POSTS.length, choose, tabs.current)}>{item.name}</button>)}</div>
    <div className="sx-p" id="sx-panel" role="tabpanel" aria-labelledby={`sx-tab-${current}`} tabIndex={0}><div className="sx-h"><span className="bp-lg" aria-hidden="true">F</span><span className="who"><b>Fieldnote</b><span>{post.name} preview</span></span></div><p className="sx-x swap" key={current} aria-live="polite">{post.text}</p><div className="sx-v" style={{ '--r': post.ratio } as React.CSSProperties} aria-hidden="true"><b>Fifteen minutes on Friday beats chasing gaps.</b><span>Fieldnote</span></div></div>
    <div className="sx-f"><span>{post.limit ? `${post.text.length.toLocaleString('en-US')} / ${post.limit.toLocaleString('en-US')}` : `Copy and paste for ${post.name}`}</span><span className="sx-b">{post.limit ? <><button type="button" className="pill k" onClick={() => setStatus('Demo only. No post was sent.')}>Post now</button><button type="button" className="pill" onClick={() => setStatus('Demo only. No post was scheduled.')}>Schedule</button></> : <><button type="button" className="pill k" onClick={copy}>Copy text</button><button type="button" className="pill" onClick={download}>Download image</button></>}</span></div>
    <p className="demo-note" role="status">{status || 'Illustrative demo. No connected accounts or real posting.'}</p>
  </div>;
}

const SERIES = performanceSeries();
const METRICS = [['Clicks', '2,204', '+38%'], ['Impressions', '61.8k', '+22%'], ['CTR', '3.6%', '+0.4'], ['Avg. position', '14.2', '−2.1']];
export function PerformanceDemo() {
  const root = useRef<HTMLDivElement>(null), line = useRef<SVGPathElement>(null), tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [metric, setMetric] = useState(0), [seen, setSeen] = useState(false), [motion, setMotion] = useState(false);
  const path = performancePath(SERIES[metric], metric === 3);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setMotion(media.matches); change(); media.addEventListener('change', change);
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) { setSeen(true); observer.disconnect(); } }, { threshold: .35 }); observer.observe(root.current!);
    return () => { observer.disconnect(); media.removeEventListener('change', change); };
  }, []);
  useEffect(() => {
    if (!line.current || !seen) return;
    const node = line.current;
    if (motion || reducedMotion()) { node.style.strokeDasharray = 'none'; node.style.strokeDashoffset = '0'; return; }
    const length = node.getTotalLength(); node.style.transition = 'none'; node.style.strokeDasharray = String(length); node.style.strokeDashoffset = String(length); node.getBoundingClientRect();
    const frame = requestAnimationFrame(() => { node.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1)'; node.style.strokeDashoffset = '0'; });
    return () => cancelAnimationFrame(frame);
  }, [metric, seen, motion]);
  return <div className="demo pm" id="pm" ref={root} aria-label="Illustrative Search Console performance for fieldnote.app">
    <div className="pm-h"><span>Search · last 28 days</span><span className="tag">Measured · fieldnote.app</span></div>
    <div className="pm-k" role="tablist" aria-label="Metric">{METRICS.map(([label, value, delta], i) => <button key={label} type="button" role="tab" ref={node => { tabs.current[i] = node; }} id={`pm-tab-${i}`} aria-controls="pm-panel" aria-selected={metric === i} tabIndex={metric === i ? 0 : -1} onClick={() => setMetric(i)} onKeyDown={event => moveTab(event, metric, METRICS.length, setMetric, tabs.current)}><span>{label}</span><b>{value}</b><em className="up">{delta}</em></button>)}</div>
    <div id="pm-panel" role="tabpanel" aria-labelledby={`pm-tab-${metric}`}><span className="sr" aria-live="polite">Illustrative {METRICS[metric][0]} trend. {metric === 3 ? 'Lower position values appear higher on the chart.' : 'Larger values appear higher on the chart.'}</span><svg className={`pm-c${seen || motion ? ' on' : ''}`} viewBox="0 0 520 150" preserveAspectRatio="none" aria-hidden="true"><path className="ar" d={`${path} L520 150 L0 150 Z`} /><path ref={line} className="ln" d={path} /></svg></div>
    <div className="pm-x" aria-hidden="true"><span>Oct 6</span><span>Oct 19</span><span>Nov 2</span></div>
    <div className="pm-s"><p className="pm-sh">What to improve<span>Ranked by expected impact</span></p><div className="pm-r"><span className="pr hi"><i className="dot" />High</span><span><b>Refresh “freelance invoice template”</b><small>Position 11.4 · 9,200 impressions · few clicks</small></span></div><div className="pm-r"><span className="pr md"><i className="dot" />Medium</span><span><b>Answer “how to estimate design projects”</b><small>Impressions, but no page for it yet</small></span></div></div>
    <p className="demo-note">Illustrative example. No customer data.</p>
  </div>;
}
