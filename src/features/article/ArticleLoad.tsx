'use client';
// The article screen before its body is there, and when loading it failed (.factory/first-five-optimizations/architecture.md §3.3).
// Same frame as the editor (bar, column, side panel), so nothing jumps when the article arrives.
import React from 'react';
import { Btn, Empty, Skel } from '@/components/ui';

// Inline, like the editor's own responsive rules in ArticleWorkspace.tsx, and NOT a .css file imported here: a stylesheet
// that only a page imports is first needed when the workspace arrives and the page renders. React then suspends that
// commit until the file has loaded and the <Suspense> around AppProvider shows its empty fallback, so the whole shell
// blanks; in development the provider's effects also run again, which drops the workspace and fetches everything twice.
// Measured on this screen; see handoff-e2.md.
const CSS = `
.artl{margin:-44px clamp(-56px,-4vw,-20px) 0}
.artl-bar{position:sticky;top:0;z-index:20;min-height:59px;padding:12px clamp(16px,3vw,32px);background:color-mix(in oklch,var(--paper) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);gap:14px}
.artl-grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;min-height:calc(100vh - 62px)}
.artl-main{padding:48px clamp(20px,5vw,72px) 120px}
.artl-doc{display:flex;flex-direction:column;gap:13px;max-width:700px;margin:0 auto}
.artl-side{display:flex;flex-direction:column;gap:16px;border-left:1px solid var(--line);padding:24px 24px 60px;background:var(--surface)}
@media(max-width:1100px){.artl-grid{grid-template-columns:minmax(0,1fr)}.artl-side{border-left:0;border-top:1px solid var(--line)}}
@media(max-width:900px){.artl{margin-top:-28px}.artl-bar{top:61px;gap:10px}}
@media(max-width:640px){.artl{margin-left:-16px;margin-right:-16px}.artl-side{padding:20px 20px 60px}}`;

function Frame({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return <div className="artl">
    <style>{CSS}</style>
    <div className="row artl-bar"><Btn kind="ghost" size="sm" icon="back" onClick={onBack}>Calendar</Btn><span className="trunc grow hide-sm" style={{ fontWeight: 500, minWidth: 0 }}>{title}</span></div>
    {children}
  </div>;
}

export function ArticleLoading({ title, onBack }: { title: string; onBack: () => void }) {
  return <Frame title={title} onBack={onBack}>
    <div className="artl-grid" role="status" aria-busy="true" aria-label="Loading article">
      <div className="artl-main"><div className="artl-doc">
        <Skel style={{ height: 'auto', aspectRatio: '1200 / 628', borderRadius: 12 }} />
        <Skel w="82%" h={34} style={{ marginTop: 18 }} /><Skel w="56%" h={34} style={{ marginBottom: 14 }} />
        {[100, 96, 99, 71, 0, 100, 93, 97, 64].map((w, i) => (w ? <Skel key={i} w={w + '%'} h={15} /> : <span key={i} style={{ height: 10 }} />))}
      </div></div>
      <aside className="artl-side"><Skel w="70%" h={18} /><Skel h={40} style={{ marginTop: 10 }} /><Skel h={84} /><Skel h={40} /><Skel w="45%" h={34} /></aside>
    </div>
  </Frame>;
}

export function ArticleLoadError({ title, error, onRetry, onBack }: { title: string; error: string | null; onRetry: () => void; onBack: () => void }) {
  return <Frame title={title} onBack={onBack}>
    <div role="alert"><Empty icon="doc" title="Radar couldn’t load this article" body={error && !/^Radar couldn’t (load this article|finish this)/.test(error) ? error : 'Nothing was lost. Check your connection and try again.'} style={{ paddingTop: 96 }}>
      <Btn kind="primary" icon="refresh" onClick={onRetry}>Retry</Btn><Btn onClick={onBack}>Back to calendar</Btn>
    </Empty></div>
  </Frame>;
}
