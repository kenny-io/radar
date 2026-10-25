'use client';
// Article workspace — port of ArticleWorkspace / GenStream / Block / SeoPanel (prototype/radar-article.jsx).
// Drafting streams from the `article.draft` job; every edit autosaves to the articles table.
import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Empty, EntryStatus, Field, Icon, ListEditor, Popover, Seg, Status, Tabs, downloadBlob } from '@/components/ui';
import { Visual, visualBlob } from '@/components/Visual';
import { PublishIntro } from '@/features/publishing/PublishIntro';
import { BlogConnect } from '@/features/publishing/BlogConnect';
import { KwMembership } from '@/features/calendar/ContentCalendar';
import { platLabel, publishFailParts, tzShort } from '@/lib/constants';
import { addDays, fmtDW, fmtTime } from '@/lib/format';
import { defaultArticle, parseBlocks } from './blocks';
import { RewriteBar, VideoEmbed, VideoPicker } from './RewriteBar';
import type { Article, Block as BlockT, CalendarEntry, ConnectionPublic, VideoRef, Workspace } from '@/lib/types';

type ArtPatch = { body?: BlockT[]; brief?: Article['brief']; seo?: Article['seo']; img?: Partial<Article['img']>; videos?: string[] };
const patchArticle = (id: string, base: Article, p: ArtPatch | ((a: Article) => Partial<Article>)) => (B: Workspace): Workspace => {
  const cur = B.articles[id] || base; const add = typeof p === 'function' ? p(cur) : p;
  return { ...B, articles: { ...B.articles, [id]: { ...cur, ...add, img: { ...cur.img, ...((add as any).img || {}) } } as Article } };
};
const patchEntry = (id: string, patch: Partial<CalendarEntry>) => (B: Workspace): Workspace => ({ ...B, calendar: { ...B.calendar, entries: B.calendar.entries.map(x => (x.id === id ? { ...x, ...patch } : x)) } });

export function ArticleWorkspace() {
  const app = useApp(); const { route, go, toast } = app; const B = app.B!;
  const id = String(route.params || ''); const e = B.calendar.entries.find(x => x.id === id);
  const [tab, setTab] = useState<'brief' | 'seo' | 'image' | 'sources'>('brief'); const [mode, setMode] = useState<'edit' | 'preview'>('edit'); const [imgBusy, setImgBusy] = useState(false);
  const [pubIntro, setPubIntro] = useState(false); const [conn, setConn] = useState<null | string | { type: string; id?: string | null }>(null); const [menu, setMenu] = useState(false); const menuRef = useRef<HTMLDivElement>(null); const proseRef = useRef<HTMLDivElement>(null);
  const [vids, setVids] = useState<VideoRef[] | null>(null); const [vidBusy, setVidBusy] = useState(false); const [starting, setStarting] = useState(false);
  const A: Article | null = e ? (B.articles[id] ? { ...defaultArticle(e), ...B.articles[id] } : defaultArticle(e)) : null;

  // Draft job (Draft now, Rewrite from brief, the D-1 cron): stream progress; keep the stream up until the workspace has the result.
  const job = app.jobFor('article.draft', id);
  const running = !!job && (job.status === 'queued' || job.status === 'running');
  const catching = !!job && job.status === 'done' && !!job.result?.draftedAt && job.result.draftedAt !== A?.draftedAt;
  useEffect(() => { if (catching) app.refresh(); }, [catching]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (running || job?.status === 'done' || job?.status === 'failed') setStarting(false); }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const prog = (job?.progress || {}) as { blocks?: BlockT[]; partial?: string };
  const streamBlocks = useMemo(() => [...(prog.blocks || []), ...parseBlocks(prog.partial || '')], [prog.blocks, prog.partial]);
  const genActive = running || catching || starting;
  const gen = genActive && (!!A?.generated || streamBlocks.length > 0) ? streamBlocks : null;

  useEffect(() => { setVids(null); }, [id]);
  useEffect(() => {
    if (tab !== 'image' || !A || vids) return;
    if (A.videoMeta?.length) { setVids(A.videoMeta.slice(0, 3)); return; }
    setVidBusy(true);
    app.act<{ videos: VideoRef[] }>('article.videos', { entryId: id }, { silent: true }).then(r => setVids(r.videos)).catch(() => setVids([])).finally(() => setVidBusy(false));
  }, [tab, id, A?.videoMeta?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e || !A) return <div className="page"><Empty title="Article not found" body="It may have been removed when the calendar was regenerated."><Btn onClick={() => go('calendar')}>Back to calendar</Btn></Empty></div>;

  /** Optimistic local merge + autosave (debounced for text, immediate otherwise). */
  const setA = (p: ArtPatch, later = true) => {
    const opt = patchArticle(id, A, p);
    const cur = { ...A, ...p, img: { ...A.img, ...(p.img || {}) } };
    const patch: any = {};
    if (p.body) patch.body = cur.body; if (p.brief) patch.brief = cur.brief; if (p.seo) patch.seo = cur.seo; if (p.videos) patch.videos = cur.videos;
    if (p.img) patch.img = { style: cur.img.style, prompt: cur.img.prompt, alt: cur.img.alt };
    const key = 'art:' + id + ':' + Object.keys(patch).join(',');
    if (later) app.actLater(key, 'article.save', { entryId: id, patch }, { optimistic: opt });
    else app.act('article.save', { entryId: id, patch }, { optimistic: opt }).catch(() => {});
  };
  const st = e.status; const brand = B.profile.brand; const blog = B.blog; const conns = blog.conns;
  const defConn = conns.find(c => c.id === blog.defaultId) || conns[0] || null;
  const destConn = conns.find(c => c.id === e.dest) || defConn;
  const draftNow = () => { setStarting(true); app.act('article.draft', { entryId: id }, { optimistic: ['approved', 'proposed'].includes(st) ? patchEntry(id, { status: 'drafting' }) : undefined }).catch(() => setStarting(false)); };
  const approve = () => { if (!conns.length) { setPubIntro(true); return; } schedule(); };
  const schedule = (c?: ConnectionPublic | null) => {
    const to = c || destConn;
    app.act('article.approve', { entryId: id }, { optimistic: patchEntry(id, { status: 'scheduled' }) }).then(() => toast(`Scheduled to ${platLabel(to?.type)} for ${fmtDW(e.date)} at ${fmtTime(blog.time)} ${tzShort(blog.tz)}`, { tone: 'ok' })).catch(() => {});
  };
  const publishNow = (retry = false) => { setMenu(false); app.act(retry ? 'publish.retry' : 'publish.now', { entryId: id }, { optimistic: patchEntry(id, { status: 'publishing' }) }).catch(() => {}); };
  const heroUrl = A.img.url && A.img.urlKey === `${A.img.style}:${A.img.seed}` ? A.img.url : null;
  const removedSrc = new Set(A.sources.map((s, i) => (s.removed ? i : -1)).filter(i => i >= 0));
  const flagged = (bi: number) => A.claims.filter(c => c.block === bi && removedSrc.has(c.source)).map(c => c.text);
  const fail = publishFailParts(e.publishError, destConn?.type);
  const statusLine = st === 'scheduled' ? <Status tone={blog.paused ? 'warn' : 'ok'}>{blog.paused ? 'Paused · ' : 'Publishes '}{fmtDW(e.date)} · {fmtTime(blog.time)} {tzShort(blog.tz)}</Status> : st === 'publishing' ? <Status tone="signal" pulse>Publishing…</Status> : <EntryStatus s={st} />;
  const rewrite = async (m: string, selection: string, before: string, after: string) => (await app.act<{ text: string }>('article.rewrite', { entryId: id, mode: m, selection, before, after })).text;
  const embedded = (A.videoMeta || []).filter(v => A.videos.includes(v.id));

  return <div className="art-wrap" style={{ margin: '-44px clamp(-56px,-4vw,-20px) 0' }}>
    <div className="row art-bar" style={{ position: 'sticky', top: 0, zIndex: 20, padding: '12px clamp(16px,3vw,32px)', background: 'color-mix(in oklch,var(--paper) 88%,transparent)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--line)', gap: 14, flexWrap: 'wrap' }}>
      <Btn kind="ghost" size="sm" icon="back" onClick={() => go('calendar', { open: null })}>Calendar</Btn>
      <span className="grow row" style={{ gap: 14, minWidth: 'min(220px,40vw)' }}><span className="trunc hide-sm" style={{ fontWeight: 500, minWidth: 0 }}>{e.title}</span><span style={{ flex: 'none' }}>{statusLine}</span></span>
      {conns.length > 1 && !['published', 'publishing'].includes(st) && <select className="input hide-sm" aria-label="Publish to" style={{ width: 'auto', height: 34, fontSize: 13, paddingLeft: 12 }} value={e.dest || blog.defaultId || ''} onChange={ev => { const v = ev.target.value; app.act('article.dest', { entryId: id, dest: v }, { optimistic: patchEntry(id, { dest: v }) }).catch(() => {}); }}>{conns.map(c => <option key={c.id} value={c.id}>To {platLabel(c.type)}{c.id === blog.defaultId ? ' (default)' : ''}</option>)}</select>}
      {A.generated && <Seg value={mode} onChange={setMode} options={[{ v: 'edit', l: 'Edit' }, { v: 'preview', l: 'Preview' }]} />}
      {A.generated && !gen && ['review', 'draft', 'approved'].includes(st) && <Btn kind="primary" icon="check" onClick={approve}>Approve article</Btn>}
      {st === 'scheduled' && <div style={{ position: 'relative' }} ref={menuRef}><Btn kind="secondary" iconR="chevD" onClick={() => setMenu(!menu)}>Queued</Btn><Popover anchor={menuRef} open={menu} onClose={() => setMenu(false)} align="right"><button className="pop-i" onClick={() => publishNow()}><Icon n="send" s={16} />Publish now</button><button className="pop-i" onClick={() => { setMenu(false); app.act('article.unschedule', { entryId: id }, { optimistic: patchEntry(id, { status: 'review' }) }).catch(() => {}); toast('Unscheduled. The draft is kept.'); }}><Icon n="undo" s={16} />Unschedule</button></Popover></div>}
      {st === 'published' && <Btn kind="secondary" iconR="ext" onClick={() => window.open(e.publishedUrl || `https://${B.profile.domain}`, '_blank', 'noopener')}>View post</Btn>}
    </div>
    {st === 'failed' && <div className="row enter" style={{ padding: '14px clamp(16px,3vw,32px)', borderBottom: '1px solid var(--line)', gap: 14, flexWrap: 'wrap' }}><Status tone="bad">Publishing failed</Status><span className="small grow" style={{ minWidth: 220 }}>{fail.platform} returned <span className="mono">{fail.detail}</span>. Your article is safe — nothing was posted.</span><Btn size="sm" onClick={() => setConn({ type: destConn?.type || 'wordpress', id: destConn?.id })}>Reconnect</Btn><Btn size="sm" kind="primary" icon="refresh" onClick={() => publishNow(true)}>Retry</Btn></div>}
    <div className="art-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', minHeight: 'calc(100vh - 62px)' }}>
      <style>{`@media(max-width:1100px){.art-grid{grid-template-columns:1fr!important}.art-side{border-left:0!important;border-top:1px solid var(--line)}}@media(max-width:900px){.art-wrap{margin-top:-28px!important}.art-bar{top:61px!important;gap:10px!important}}@media(max-width:640px){.art-wrap{margin-left:-16px!important;margin-right:-16px!important}.art-h1{font-size:30px!important}.art-side{padding:20px 20px 60px!important}}`}</style>
      <div style={{ padding: '48px clamp(20px,5vw,72px) 120px' }}>
        <article style={{ maxWidth: 700, margin: '0 auto' }}>
          {!A.generated && !gen ? <div className="col enter" style={{ gap: 22, paddingTop: 24 }}>
            <span className="eyebrow">{e.mode === 'refresh' ? 'Refresh · ' + e.url : e.type} · {fmtDW(e.date)}</span>
            <h1 className="h-display art-h1" style={{ fontSize: 40 }}>{e.title}</h1>
            <p className="sub" style={{ fontSize: 17, maxWidth: 560 }}>{st === 'drafting' || genActive ? 'Radar is drafting this now. It’ll appear here in a moment.' : `Radar drafts this on ${fmtDW(addDays(e.date, -1))} — about ${A.brief.words.toLocaleString()} words in your brand voice, with sources and an image. Adjust the brief anytime before then.`}</p>
            <div className="row">{st === 'drafting' || genActive ? <Status tone="signal" pulse>Drafting…</Status> : <><Btn kind="secondary" size="lg" onClick={() => setTab('brief')}>Edit brief</Btn><Btn kind="ghost" size="lg" icon="doc" onClick={draftNow}>Draft now</Btn></>}</div>
          </div>
            : <div className="prose" ref={proseRef}>
              <div style={{ marginBottom: 28 }}><Visual style={A.img.style} brand={brand} headline={e.title} seed={A.img.seed} name={B.profile.business.name} busy={imgBusy || !!gen} url={heroUrl} /></div>
              <h1 className="h-display art-h1" style={{ fontSize: 40, marginBottom: 20 }} contentEditable={mode === 'edit' && !gen} suppressContentEditableWarning onBlur={ev => { const t = ev.currentTarget.innerText.replace(/\s+/g, ' ').trim(); if (t && t !== e.title) app.act('calendar.update', { entryId: id, title: t }, { optimistic: patchEntry(id, { title: t }) }).catch(() => {}); }}>{e.title}</h1>
              {gen ? <GenStream blocks={gen} /> : A.body.map((b, i) => {
                const vidAt = A.body.findIndex((x, j) => j > 0 && x[0] === 'h2'); const vs = i === vidAt - 1 ? embedded : [];
                return <Fragment key={id + i}><Block b={b} edit={mode === 'edit'} flags={flagged(i)} onChange={v => { const body = A.body.map((x, j) => (j === i ? [x[0], v] as BlockT : x)); if (JSON.stringify(body[i]) !== JSON.stringify(A.body[i])) setA({ body }, false); }} />{vs.map(v => <VideoEmbed key={v.id} v={v} edit={mode === 'edit'} onRemove={() => setA({ videos: A.videos.filter(x => x !== v.id) }, false)} />)}</Fragment>;
              })}
              <RewriteBar root={proseRef} enabled={mode === 'edit' && !gen && A.generated} onRewrite={rewrite} />
            </div>}
        </article>
      </div>
      <aside className="art-side" style={{ borderLeft: '1px solid var(--line)', padding: '24px 24px 60px', background: 'var(--surface)' }}>
        <Tabs value={tab} onChange={setTab} items={[{ v: 'brief', l: 'Brief' }, { v: 'seo', l: 'SEO' }, { v: 'image', l: 'Media' }, { v: 'sources', l: 'Sources' }]} style={{ marginBottom: 22, gap: 20 }} />
        {tab === 'brief' && <div className="col" style={{ gap: 20 }}>
          <Field label="Primary keyword" hint={<KwMembership app={app} kw={e.kw} />}><input className="input" value={e.kw} readOnly /></Field>
          <Field label="Angle"><textarea className="input" rows={3} value={A.brief.angle} onChange={ev => setA({ brief: { ...A.brief, angle: ev.target.value } })} /></Field>
          <Field label="Outline" hint={A.generated ? 'Changing the outline won’t rewrite your draft.' : null}><ListEditor items={A.brief.outline} onChange={v => setA({ brief: { ...A.brief, outline: v } })} placeholder="Add section" /></Field>
          <Field label="Length"><Seg value={A.brief.words} onChange={v => setA({ brief: { ...A.brief, words: v } }, false)} options={[{ v: 900 as const, l: 'Short' }, { v: 1400 as const, l: 'Standard' }, { v: 2200 as const, l: 'Long' }]} /></Field>
          {A.generated && <><Btn icon="refresh" loading={genActive} onClick={draftNow}>Rewrite from brief</Btn><span className="xs sub">Or select any text in the draft to rewrite just that part.</span></>}
        </div>}
        {tab === 'seo' && <SeoPanel A={A} set={(k, v) => setA({ seo: { ...A.seo, [k]: v } })} domain={B.profile.domain} />}
        {tab === 'image' && <div className="col" style={{ gap: 18 }}>
          <Visual style={A.img.style} brand={brand} headline={e.title} seed={A.img.seed} name={B.profile.business.name} radius={10} busy={imgBusy} url={heroUrl} />
          <Field label="Style"><select className="input" value={A.img.style} onChange={ev => setA({ img: { style: ev.target.value as any } }, false)}>{[['branded', 'Branded graphic'], ['illustration', 'Illustration'], ['photography', 'Photography'], ['infographic', 'Infographic']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Direction"><textarea className="input" rows={2} value={A.img.prompt} onChange={ev => setA({ img: { prompt: ev.target.value } })} /></Field>
          <Field label="Alt text" hint="Describes the image for screen readers and search."><input className="input" value={A.img.alt} onChange={ev => setA({ img: { alt: ev.target.value } })} /></Field>
          <div className="row"><Btn icon="refresh" loading={imgBusy} onClick={async () => { setImgBusy(true); try { await app.act('article.regenerateImage', { entryId: id }); } catch { /* toasted */ } setImgBusy(false); }}>Regenerate image</Btn><Btn kind="ghost" icon="download" onClick={async () => { const b = await visualBlob(heroUrl, { style: A.img.style, brand, headline: e.title, seed: A.img.seed, name: B.profile.business.name }, 1200, 628); if (b) downloadBlob(b, (A.seo.slug || 'image') + '.png'); }}>Download</Btn></div>
          <span className="xs sub">Uses {B.profile.business.name}’s colors <i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: brand.primary, verticalAlign: -1 }} /> <i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: brand.secondary, verticalAlign: -1 }} /> from your Business Profile.</span>
          <VideoPicker vids={vids || []} loading={vidBusy} on={A.videos} onToggle={(v, has) => { setA({ videos: has ? A.videos.filter(x => x !== v.id) : [...A.videos, v.id] }, false); toast(has ? 'Video removed' : 'Video embedded after the first section'); }} />
        </div>}
        {tab === 'sources' && <div className="col">{A.sources.map((s, i) => <div key={i} className="row" style={{ padding: '14px 0', borderTop: i ? '1px solid var(--line2)' : 0, gap: 10, alignItems: 'flex-start' }}>
          <div className="col grow" style={{ gap: 3, minWidth: 0, opacity: s.removed ? .45 : 1 }}><span className="small" style={{ fontWeight: 500, textDecoration: s.removed ? 'line-through' : 'none' }}>{s.title}</span><span className="mono sub trunc">{s.url.replace(/^https?:\/\/(www\.)?/, '')}</span><span className="xs sub">Used for: {s.use}</span></div>
          {mode === 'edit' && <Btn kind="ghost" size="sm" icon={s.removed ? 'undo' : 'x'} aria-label={s.removed ? 'Restore source' : 'Remove source'} title={s.removed ? 'Restore source' : 'Remove source'} onClick={() => app.act('article.source', { entryId: id, index: i, removed: !s.removed }, { optimistic: patchArticle(id, A, a => ({ sources: a.sources.map((x, j) => (j === i ? { ...x, removed: !s.removed } : x)) })) }).catch(() => {})} />}
        </div>)}<p className="xs sub" style={{ marginTop: 14 }}>Radar cites sources inline and never invents statistics. Remove any source and its claims are flagged in the draft.</p></div>}
      </aside>
    </div>
    <PublishIntro existing={conns.map(c => c.type)} open={pubIntro} onClose={() => setPubIntro(false)} onPick={t => { setPubIntro(false); setConn(t); }} onSkip={() => { setPubIntro(false); app.act('article.approve', { entryId: id, withoutPublishing: true }, { optimistic: patchEntry(id, { status: 'approved' }) }).then(() => toast('Approved. Copy it from Preview whenever you’re ready.')).catch(() => {}); }} />
    <BlogConnect type={conn} onClose={() => setConn(null)} onSaved={c => { setConn(null); if (st === 'failed') publishNow(true); else schedule(c); }} />
  </div>;
}

/** Streaming text with a signal caret. Reveals new text smoothly between progress updates. */
function GenStream({ blocks }: { blocks: BlockT[] }) {
  const flat = blocks.map(b => (Array.isArray(b[1]) ? b[1].join(' • ') : b[1]));
  const total = flat.reduce((s, t) => s + t.length, 0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0; const tick = () => { setShown(s => { if (s >= total) return s; return Math.min(total, s + Math.max(2, Math.ceil((total - s) / 18))); }); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [total]);
  let left = shown; const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (left <= 0 && i > 0) break;
    const full = flat[i]; const t = full.slice(0, Math.max(0, left)); left -= full.length;
    const last = left <= 0 || i === blocks.length - 1; const cls = last ? 'caret' : '';
    out.push(blocks[i][0] === 'h2' ? <h2 key={i} className={cls}>{t}</h2> : blocks[i][0] === 'h3' ? <h3 key={i} className={cls}>{t}</h3> : <p key={i} className={cls}>{t}</p>);
    if (last) break;
  }
  if (!blocks.length) out.push(<p key="c" className="caret" />);
  return <>{out}</>;
}

/** Inline flags for claims whose source was removed (subtle signal-wash; DIVERGENCES #6). */
function withFlags(text: string, flags: string[]): React.ReactNode {
  const fs = flags.filter(f => f && text.includes(f)); if (!fs.length) return text;
  const parts: React.ReactNode[] = []; let rest = text; let k = 0;
  while (rest) {
    let at = -1; let hit = '';
    for (const f of fs) { const i = rest.indexOf(f); if (i >= 0 && (at < 0 || i < at)) { at = i; hit = f; } }
    if (at < 0) { parts.push(rest); break; }
    if (at > 0) parts.push(rest.slice(0, at));
    parts.push(<mark key={k++} title="Its source was removed" style={{ background: 'var(--signal-wash)', boxShadow: 'inset 0 -1.5px 0 var(--signal)', color: 'inherit', borderRadius: 3, padding: '0 1px' }}>{hit}</mark>);
    rest = rest.slice(at + hit.length);
  }
  return parts;
}

function Block({ b, edit, onChange, flags }: { b: BlockT; edit: boolean; onChange: (v: any) => void; flags: string[] }) {
  const [t, c] = b; const sig = JSON.stringify(c).length + ':' + flags.length + ':' + (Array.isArray(c) ? c.join('|') : c).slice(0, 40);
  const p = { contentEditable: edit, suppressContentEditableWarning: true, onBlur: (e: React.FocusEvent<HTMLElement>) => onChange(t === 'ul' ? Array.from(e.currentTarget.querySelectorAll('li')).map(l => (l as HTMLElement).innerText) : e.currentTarget.innerText), style: { borderRadius: 4, transition: 'background .2s' } };
  if (t === 'h2') return <h2 key={sig} {...p}>{c as string}</h2>; if (t === 'h3') return <h3 key={sig} {...p}>{c as string}</h3>;
  if (t === 'ul') return <ul key={sig} {...p}>{(c as string[]).map((x, i) => <li key={i}>{withFlags(x, flags)}</li>)}</ul>;
  return <p key={sig} {...p}>{withFlags(c as string, flags)}</p>;
}

function SeoPanel({ A, set, domain }: { A: Article; set: (k: 'title' | 'meta' | 'slug', v: string) => void; domain: string }) {
  const s = A.seo;
  const Count = ({ n, max }: { n: number; max: number }) => <span className="xs num" style={{ color: n > max ? 'var(--bad)' : 'var(--mute)' }}>{n}/{max}</span>;
  return <div className="col" style={{ gap: 20 }}>
    <div className="col" style={{ gap: 2, padding: '14px 16px', borderRadius: 12, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--line)' }}><span className="xs sub trunc">{domain} › blog › {s.slug}</span><span style={{ color: 'var(--serp)', fontSize: 17, lineHeight: 1.3 }}>{s.title || 'Untitled'}</span><span className="small sub" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.meta || 'Add a meta description.'}</span><span className="xs sub" style={{ marginTop: 6 }}>Search result preview</span></div>
    <Field label="SEO title" mark={<Count n={s.title.length} max={60} />}><input className="input" value={s.title} onChange={e => set('title', e.target.value)} /></Field>
    <Field label="Meta description" mark={<Count n={s.meta.length} max={155} />}><textarea className="input" rows={3} value={s.meta} onChange={e => set('meta', e.target.value)} /></Field>
    <Field label="URL slug"><input className="input mono" style={{ fontSize: 13 }} value={s.slug} onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></Field>
  </div>;
}
