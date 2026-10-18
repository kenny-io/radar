'use client';
// Pack view — port of PackView (prototype/radar-social.jsx). Copy and download only: nothing is ever posted.
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { AutoText, Btn, LogoTile, PageHead, Tabs, copyText, downloadBlob, sleep } from '@/components/ui';
import { Visual, visualBlob } from '@/components/Visual';
import { IMG_SIZES, STYLES, plat } from '@/lib/constants';
import { ago, fmtD } from '@/lib/format';
import type { Platform, SocialPack, SocialPost, Workspace } from '@/lib/types';

export function PackView({ pack }: { pack: SocialPack }) {
  const app = useApp(); const B = app.B!; const { go, toast } = app; const brand = B.profile.brand;
  const keys = (pack.posts ? Object.keys(pack.posts) : []) as Platform[]; const [cur, setCur] = useState<Platform>(keys[0]); const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [, tick] = useState(0); useEffect(() => { const iv = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(iv); }, []);
  const p = pack.posts && pack.posts[cur];
  const headline = (pack as any).headline || pack.source.label;
  const patchPost = (k: Platform, patch: Partial<SocialPost>) => (b: Workspace): Workspace => ({ ...b, social: { ...b.social, packs: b.social.packs.map(x => x.id === pack.id ? { ...x, posts: { ...x.posts, [k]: { ...x.posts[k]!, ...patch } } } : x) } });
  const regen = async (what: 'text' | 'image') => {
    setBusy(b => ({ ...b, [what]: true }));
    try { await app.act(what === 'text' ? 'social.regenText' : 'social.regenImage', { packId: pack.id, platform: cur }); } catch { /* toasted */ }
    setBusy(b => ({ ...b, [what]: false }));
  };
  const fname = (k: string) => `${pack.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${k}`;
  const dlOne = async (k: Platform) => { const q = pack.posts[k]!; const [w, h] = IMG_SIZES[k]; const blob = await visualBlob(q.imageUrl, { style: q.style === 'custom' ? 'illustration' : q.style, brand, headline, seed: q.seed, name: B.profile.business.name }, w, h); if (blob) downloadBlob(blob, fname(k) + '.png'); };
  const dlAll = async () => { const txt = keys.map(k => `— ${plat(k).l} —\n\n${pack.posts[k]!.text}\n`).join('\n'); downloadBlob(new Blob([txt], { type: 'text/plain' }), fname('copy') + '.txt'); for (const k of keys) { await sleep(250); await dlOne(k); } toast(`Downloaded copy and ${keys.length} visuals. Nothing was posted.`); };
  const len = p ? p.text.length : 0;
  return <div className="page">
    <Btn kind="ghost" size="sm" icon="back" onClick={() => go('social')} style={{ marginLeft: -10, marginBottom: 18 }}>Content library</Btn>
    <PageHead title={pack.name} sub={<span>From {pack.source.kind === 'suggest' ? 'a Radar suggestion' : pack.source.kind === 'idea' ? 'an idea' : pack.source.kind === 'url' ? 'an article URL' : 'a Radar article'} · {fmtD(pack.created)}{pack.auto ? ' · Auto-generated' : ''}</span>}>
      <Btn icon="download" onClick={dlAll}>Download all</Btn>
    </PageHead>
    <Tabs value={cur} onChange={setCur} items={keys.map(k => ({ v: k, l: plat(k).l }))} style={{ marginBottom: 30 }} />
    {p && <div className="pack-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(240px,1fr)', gap: 40, alignItems: 'start' }}>
      <style>{`@media(max-width:1100px){.pack-grid{grid-template-columns:1fr!important}}`}</style>
      <div className="card" style={{ padding: 18, borderRadius: 20, display: 'grid' }}>
        {keys.map(k => { const q = pack.posts[k]!; const on = k === cur; return <div key={k} aria-hidden={!on} style={{ gridArea: '1/1', visibility: on ? 'visible' : 'hidden', opacity: on ? 1 : 0, transition: on ? 'opacity .25s var(--ease)' : 'opacity .12s, visibility 0s .12s', pointerEvents: on ? 'auto' : 'none' }}>
          <div className="row" style={{ marginBottom: 12, gap: 10 }}><LogoTile brand={brand} s={36} /><span className="col grow"><span className="small" style={{ fontWeight: 600 }}>{B.profile.business.name}</span><span className="xs sub">{plat(k).l} preview</span></span></div>
          <AutoText className="input-bare" tabIndex={on ? 0 : -1} value={q.text} onChange={e => { const text = e.target.value; app.actLater(`social.text:${pack.id}:${k}`, 'social.text', { packId: pack.id, platform: k, text }, { optimistic: patchPost(k, { text }) }); }} style={{ display: 'block', lineHeight: 1.55, fontSize: 15, opacity: on && busy.text ? .4 : 1, transition: 'opacity .3s' }} aria-label={plat(k).l + ' post text'} />
          <div style={{ marginTop: 12 }}><Visual style={q.style === 'custom' ? 'illustration' : q.style} brand={brand} headline={headline} seed={q.seed} ratio={plat(k).ratio} name={B.profile.business.name} radius={12} busy={on && busy.image} url={q.imageUrl} /></div>
        </div>; })}
      </div>
      <div className="col" style={{ gap: 26, position: 'sticky', top: 24 }}>
        <div className="col" style={{ gap: 10 }}>
          <Btn kind="primary" size="lg" className="btn-block" icon="copy" onClick={() => { copyText(p.text); app.act('social.copied', { packId: pack.id, platform: cur }, { optimistic: patchPost(cur, { copiedAt: Date.now() }) }).catch(() => {}); toast(`Copied. Paste it into ${plat(cur).l} to publish.`); }}>Copy text</Btn>
          <Btn size="lg" className="btn-block" icon="download" onClick={() => dlOne(cur)}>Download visual</Btn>
          <span className="xs sub" style={{ textAlign: 'center' }}>{p.copiedAt ? `Copied ${ago(p.copiedAt)} · not tracked as published` : 'Copying or downloading doesn’t publish anything.'}</span>
        </div>
        <div className="col" style={{ borderTop: '1px solid var(--line2)' }}>
          <div className="row" style={{ padding: '14px 0', borderBottom: '1px solid var(--line2)' }}><span className="grow small">Text{cur === 'x' && <span className="num" style={{ marginLeft: 8, color: len > 280 ? 'var(--bad)' : 'var(--mute)' }}>{len}/280</span>}</span><Btn size="sm" kind="ghost" icon="refresh" loading={busy.text} onClick={() => regen('text')}>Regenerate</Btn></div>
          <div className="row" style={{ padding: '14px 0', borderBottom: '1px solid var(--line2)' }}><span className="grow small">Image · {(STYLES.find(s => s.k === p.style) || STYLES[1]).l}</span><Btn size="sm" kind="ghost" icon="refresh" loading={busy.image} onClick={() => regen('image')}>Regenerate</Btn></div>
          <div className="row" style={{ padding: '14px 0' }}><span className="grow small">Style</span><select className="input" style={{ width: 170, height: 34, fontSize: 13 }} value={p.style} onChange={e => { const style = e.target.value as SocialPost['style']; app.act('social.style', { packId: pack.id, platform: cur, style }, { optimistic: patchPost(cur, { style, imageUrl: null }) }).catch(() => {}); }}>{STYLES.filter(s => s.k !== 'custom').map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></div>
        </div>
        {cur === 'reddit' && <p className="xs sub">Includes a disclosure line. Check each community’s self-promotion rules before posting.</p>}
      </div>
    </div>}
  </div>;
}
