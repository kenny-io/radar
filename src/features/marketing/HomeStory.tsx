'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Arrow } from './mark';

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const SENTENCE = 'You built something people want. Radar makes sure they can find it.';

export function Statement() {
  return <section className="say" id="say" aria-label="What Radar does"><div className="wrap"><p className="say-t" aria-label={SENTENCE}>{SENTENCE.split(' ').map((word, i) => <Fragment key={i}>{i > 0 && ' '}<span aria-hidden="true">{word}</span></Fragment>)}</p></div></section>;
}

/** One passive scroll coordinator updates both scroll-linked stories without intercepting scrolling. */
export function HomeScrollEffects() {
  useEffect(() => {
    const statement = document.querySelector<HTMLElement>('#say .say-t');
    const words = Array.from(statement?.querySelectorAll('span') || []);
    const story = document.getElementById('t3');
    const slides = Array.from(story?.querySelectorAll<HTMLElement>('.t3-s') || []);
    const buttons = Array.from(story?.querySelectorAll<HTMLButtonElement>('.t3-idx button') || []);
    const pinned = matchMedia('(min-width:1001px) and (min-height:640px)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    function update() {
      frame = 0;
      if (statement) {
        const progress = clamp((innerHeight * .82 - statement.getBoundingClientRect().top) / (innerHeight * .5)) * words.length;
        words.forEach((word, i) => { word.style.opacity = String(reduced.matches ? 1 : .16 + .84 * clamp(progress - i)); });
      }
      if (!story) return;
      const progress = clamp(-story.getBoundingClientRect().top / Math.max(1, story.offsetHeight - innerHeight), 0, .9999) * slides.length;
      const active = Math.floor(progress), local = progress - active;
      slides.forEach((slide, i) => {
        slide.classList.toggle('on', !pinned.matches || i === active);
        slide.classList.toggle('past', pinned.matches && i < active);
        slide.inert = pinned.matches && i !== active;
        slide.style.setProperty('--lp', !pinned.matches || reduced.matches || i !== active ? '0' : local.toFixed(4));
      });
      buttons.forEach((button, i) => {
        button.setAttribute('aria-current', i === active ? 'true' : 'false');
        button.style.setProperty('--f', String(i < active ? 1 : i === active ? local : 0));
      });
    }
    const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
    pinned.addEventListener('change', queue);
    reduced.addEventListener('change', queue);
    return () => {
      removeEventListener('scroll', queue); removeEventListener('resize', queue);
      pinned.removeEventListener('change', queue); reduced.removeEventListener('change', queue);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

const STEPS = [
  ['Radar reads your site', 'It learns what you sell, who buys it and how you sound.'],
  ['Your month is planned', 'Topics matched to your site and schedule, and conversations worth joining.'],
  ['Choose how it ships.', 'Review each draft, or enable automatic publishing in its settings.'],
];
const DURATIONS = [9000, 7000, 6000];
const ANALYSIS = [
  ['Reading your website', '42 pages on fieldnote.app'],
  ['Understanding the business', 'Fieldnote · Time tracking'],
  ['Mapping existing content', '18 articles · 6 pages already rank'],
  ['Finding your audience', '3 segments · 3 competitors'],
  ['Extracting your brand', 'Logo, 2 colors, voice'],
];
const KEYWORDS: [string, string, number][] = [
  ['time tracking software', '74,000', 84], ['how to estimate design projects', '1,900', 31],
  ['best time tracker for freelancers', '6,600', 52], ['track billable hours without a timer', '880', 21],
  ['freelance invoice template', '2,400', 27],
];
const SHIP = [
  ['How to track billable hours without a timer', 'Article · fieldnote.app/blog · Thu, Oct 22', 'Approve', 'Scheduled'],
  ['“Fifteen minutes on Friday beats chasing gaps.”', 'LinkedIn post · Tomorrow, 9:00 AM', 'Schedule', 'Scheduled'],
  ['How do you track time without a timer running all day?', 'Reply · r/freelance · Drafted in your voice', 'Copy reply', 'Copied'],
];
const vars = (values: Record<string, string | number>) => values as React.CSSProperties;

export function HowItWorks() {
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [current, setCurrent] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  const [manual, setManual] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    change(); media.addEventListener('change', change);
    const observer = new IntersectionObserver(entries => { const inView = entries.some(e => e.intersectionRatio >= .35); setVisible(inView); if (inView) setSeen(true); }, { threshold: [0, .35] });
    observer.observe(root.current!);
    return () => { observer.disconnect(); media.removeEventListener('change', change); };
  }, []);
  // A single clock owns demo phases and progress, so all of them freeze while off-screen.
  useEffect(() => {
    if (!visible || reduced || (manual && elapsed >= DURATIONS[current])) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), delta = now - last; last = now;
      setElapsed(value => Math.min(DURATIONS[current], value + delta));
    }, 50);
    return () => clearInterval(timer);
  }, [visible, reduced, current, manual, elapsed >= DURATIONS[current]]);
  useEffect(() => {
    if (!manual && !reduced && elapsed >= DURATIONS[current]) { setCurrent(i => (i + 1) % STEPS.length); setElapsed(0); }
  }, [elapsed, current, manual, reduced]);
  const choose = (index: number) => { setManual(true); setCurrent(index); setElapsed(0); };
  const time = reduced ? Infinity : elapsed;
  const domain = 'fieldnote.app';
  const typed = domain.slice(0, Math.floor(clamp((time - 400) / 70, 0, domain.length)));
  const phase = time >= 7670 ? 'done' : time >= 2040 ? 'analyzing' : time >= 1390 ? 'ready' : '';
  const running = visible && !reduced;
  return <section className="pg-sec" id="how" aria-labelledby="how-t"><div className="wrap">
    <div className="pg-head rv"><h2 className="pg-t" id="how-t">Paste your website. Radar does the rest.</h2><p className="pg-l">No setup calls. No briefs to write.</p></div>
    <div ref={root} className={'how rv' + (seen ? ' in' : '') + (!running ? ' paused' : '')} data-autoplay={!manual && !reduced} data-step={current}>
      <div className="how-l" role="tablist" aria-label="How Radar works" aria-orientation="vertical" onFocusCapture={() => setManual(true)} onKeyDown={event => {
        setManual(true);
        const keys: Record<string, number> = { ArrowDown: (current + 1) % 3, ArrowRight: (current + 1) % 3, ArrowUp: (current + 2) % 3, ArrowLeft: (current + 2) % 3, Home: 0, End: 2 };
        if (event.key in keys) { event.preventDefault(); const next = keys[event.key]; choose(next); tabs.current[next]?.focus(); }
      }}>{STEPS.map(([title, description], i) => <button ref={element => { tabs.current[i] = element; }} key={title} type="button" className="how-s" role="tab" id={'hs-' + i} aria-controls={'hp-' + i} aria-selected={current === i} tabIndex={current === i ? 0 : -1} onClick={() => choose(i)}><i aria-hidden="true" style={{ transform: `scaleY(${current === i ? manual || reduced ? 1 : elapsed / DURATIONS[i] : 0})` }} /><b>{title}</b><span aria-hidden={current !== i}><span>{description}</span></span></button>)}</div>
      <div className="how-r">
        <div className={'hp' + (current === 0 ? ' on' : '')} id="hp-0" role="tabpanel" aria-labelledby="hs-0" inert={current !== 0} aria-hidden={current !== 0}>
          <div className={'ob ' + phase} id="ob" role="group" aria-label="Illustrative example of Radar analyzing a website"><p className="ob-t">Let’s get to know your business.</p><div className="ob-f"><span className="pre">https://</span><span className="ob-in" id="ob-in">{typed}</span><span className="ob-caret" aria-hidden="true" /><span className="ob-b">Analyze website</span></div><ol className="ob-steps" id="ob-steps">{ANALYSIS.map(([title, detail], i) => <li key={title} className={time >= 3010 + i * 970 ? 'ok' : time >= 2190 + i * 970 ? 'act' : ''}><i aria-hidden="true" /><span>{title}</span><em>{detail}</em></li>)}</ol><div className="ob-done"><span className="ob-b solid">Review what Radar found</span><span>About a minute to check.</span></div></div>
        </div>
        <div className={'hp' + (current === 1 ? ' on' : '')} id="hp-1" role="tabpanel" aria-labelledby="hs-1" inert={current !== 1} aria-hidden={current !== 1}>
          <div className={'ceil' + (time >= 350 ? ' run' : '')} id="ceil" role="group" aria-label="Illustrative keyword list with a difficulty ceiling of 34"><p className="ob-t">Keywords fieldnote.app can win</p><div className="ceil-h"><span>Keyword</span><span className="vol">Volume</span><span className="ceil-tag">Ceiling 34</span></div><ol>{KEYWORDS.map(([keyword, volume, difficulty]) => <li key={keyword} className={difficulty > 34 ? 'out' : ''}><span className="kw">{keyword}</span><span className="vol">{volume}</span><span className="bar" style={vars({ '--d': difficulty })}><i /></span><span className="dv">{difficulty}</span></li>)}</ol><p className="ceil-n">Radar skips keywords above your site’s ceiling and plans the rest.</p></div>
        </div>
        <div className={'hp' + (current === 2 ? ' on' : '')} id="hp-2" role="tabpanel" aria-labelledby="hs-2" inert={current !== 2} aria-hidden={current !== 2}>
          <div className="ship" id="ship"><p className="ob-t">Ready for your review</p><ul className="sp-l">{SHIP.map(([title, detail, action, status], i) => { const done = time >= 950 + i * 1100; return <li className={'sp-i' + (done ? ' done' : time >= 700 + i * 1100 ? ' press' : '')} key={title}><span className="sp-m"><b>{title}</b><em>{detail}</em></span><span className="sp-a"><span className={'sp-b' + (i === 0 ? ' solid' : '')} aria-hidden={done}>{action}</span><span className="sp-st" aria-hidden={!done}><i className="dot" />{status}</span></span></li>; })}</ul><p className="ceil-n">Review-first shown. Blog autopilot and social automatic scheduling are opt-in.</p></div>
        </div>
      </div>
    </div><p className="pg-cap">Illustrative example.</p>
  </div></section>;
}

const FEATURES = [
  { name: 'Daily Brief', title: 'Be there when people ask.', text: 'Every morning, Radar finds threads on Reddit, X, LinkedIn, Hacker News and Quora where you can help, with a reply drafted in your voice.', shot: 'c-brief-open', width: 2560, height: 1150, w: '112%', pan: '-8%', alt: 'Daily Brief in Radar: a thread from r/freelance with a helpful reply drafted in the founder’s voice.' },
  { name: 'Content Calendar', title: 'A month of articles, planned.', text: 'Topics matched to your site and publishing schedule, with drafts ready for review or Daily autopilot.', shot: 'c-calendar', width: 1990, height: 1620, w: '100%', pan: '-32%', alt: 'Content Calendar in Radar: a month view with one researched article topic per day.', href: '/features/organic-search', link: 'Organic search' },
  { name: 'AI Visibility', title: 'Know when AI recommends you.', text: 'Every night, Radar asks five assistants what your customers ask, and shows where you stand.', shot: 'c-ai', width: 2036, height: 1080, w: '108%', pan: '-16%', alt: 'AI Visibility in Radar: mentioned in 6 of 14 answers across five assistants.', href: '/features/ai-visibility', link: 'AI visibility' },
  { name: 'Social Marketing', title: 'On brand, on every platform.', text: 'Turn an idea, a link or an article into posts and visuals made for each platform.', shot: 'c-social', width: 1300, height: 560, w: '100%', pan: '0%', alt: 'Two post packs in Radar with on-brand visuals.' },
  { name: 'Performance', title: 'Your next move, spelled out.', text: 'Search Console data, with suggestions ranked by expected impact.', shot: 'p-perf', width: 2000, height: 1255, w: '100%', pan: '-20%', alt: 'Performance in Radar: Search Console clicks, impressions and suggestions.' },
  { name: 'Backlinks', title: 'Reputation, earned honestly.', text: 'Approved, disclosed links from businesses that fit.', shot: 'c-backlinks', width: 1990, height: 580, w: '116%', pan: '0%', alt: 'Backlinks network in Radar: proposed links awaiting approval.', href: '/features/backlinks', link: 'Backlinks network' },
];
export function FeatureStory() {
  const root = useRef<HTMLDivElement>(null);
  const seek = (index: number) => {
    const node = root.current!;
    scrollTo({ top: node.getBoundingClientRect().top + scrollY + (node.offsetHeight - innerHeight) * (index + .08) / FEATURES.length, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <section className="pg-sec" id="features" aria-labelledby="ft-t"><div className="wrap"><div className="pg-head rv"><h2 className="pg-t" id="ft-t">One place to be found everywhere.</h2><p className="pg-l">Six tools. One Business Profile. Everything sounds like you.</p></div></div>
    <div className="t3" id="t3" ref={root} style={vars({ '--n': FEATURES.length })}><div className="t3-pin"><div className="wrap t3-in"><nav className="t3-idx" aria-label="Features">{FEATURES.map((feature, i) => <button type="button" key={feature.name} onClick={() => seek(i)} aria-current={i === 0 ? 'true' : 'false'}><span>{feature.name}</span><i aria-hidden="true"><b /></i></button>)}</nav><div className="t3-st">{FEATURES.map((feature, i) => <article className={'t3-s' + (i === 0 ? ' on' : '')} aria-label={feature.name} key={feature.name}><div className="t3-x"><p className="bk">{feature.name}</p><h3 className="t3-t">{feature.title}</h3><p className="t3-d">{feature.text}{feature.href && <> <Link className="t3-a" href={feature.href}>{feature.link}<Arrow /></Link></>}</p></div><div className="t3-v"><img src={'/marketing/shots/' + feature.shot + '.webp'} width={feature.width} height={feature.height} style={vars({ '--w': feature.w, '--pan': feature.pan })} loading="lazy" decoding="async" alt={feature.alt} /></div></article>)}</div></div></div></div>
    <div className="wrap"><p className="pg-cap t3-cap">Product images show illustrative data.</p></div>
  </section>;
}
