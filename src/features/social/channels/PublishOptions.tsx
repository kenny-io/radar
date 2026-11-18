'use client';
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Field } from '@/components/ui';
import type { Platform, SocialPost, TikTokCreatorInfo } from '@/lib/types';

const PRIVACY: Record<string, string> = { PUBLIC_TO_EVERYONE: 'Everyone', MUTUAL_FOLLOW_FRIENDS: 'Friends', FOLLOWER_OF_CREATOR: 'Followers', SELF_ONLY: 'Only me' };

/** Provider choices are intentionally explicit: no default audience or prechecked consent. */
export function PublishOptions({ packId, platform, post, acctId, disabled, onReady }: { packId: string; platform: Platform; post: SocialPost; acctId?: string; disabled: boolean; onReady: (ready: boolean) => void }) {
  const app = useApp(); const [creator, setCreator] = useState<TikTokCreatorInfo | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (platform !== 'tiktok') { onReady(true); return; }
    let active = true; setCreator(null); setError(''); onReady(false);
    if (!acctId) return;
    setLoading(true);
    app.act<{ creator: TikTokCreatorInfo }>('social.tiktokCreatorInfo', { acctId }, { silent: true }).then(r => {
      if (active) {
        setCreator(r.creator);
        const old = post.publishOptions?.tiktok; const c = r.creator;
        if (old && ((old.allowComment && c.commentDisabled) || (old.allowDuet && c.duetDisabled) || (old.allowStitch && c.stitchDisabled) || (old.privacyLevel && !c.privacyLevels.includes(old.privacyLevel)))) {
          save({ tiktok: { ...old, privacyLevel: old.privacyLevel && c.privacyLevels.includes(old.privacyLevel) ? old.privacyLevel : undefined, allowComment: !!old.allowComment && !c.commentDisabled, allowDuet: !!old.allowDuet && !c.duetDisabled, allowStitch: !!old.allowStitch && !c.stitchDisabled, consent: false } });
        }
        onReady(true);
      }
    }).catch(e => { if (active) setError(e.message || 'TikTok could not load your publishing permissions.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [platform, acctId, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = post.publishOptions || {};
  const save = (patch: Partial<NonNullable<SocialPost['publishOptions']>>) => {
    const next = { ...options, ...patch };
    app.actLater(`social.options:${packId}:${platform}`, 'social.publishOptions', { packId, platform, options: next }, {
      optimistic: b => ({ ...b, social: { ...b.social, packs: b.social.packs.map(p => p.id === packId ? { ...p, posts: { ...p.posts, [platform]: { ...p.posts[platform]!, publishOptions: next } } } : p) } }),
    });
  };
  if (platform === 'youtube') return <fieldset disabled={disabled} className="col" style={{ border: 0, padding: 0, margin: 0, gap: 14, minWidth: 0 }}>
    <legend className="small" style={{ fontWeight: 500, marginBottom: 12 }}>YouTube publishing</legend>
    <Field label="Video title"><input className="input" aria-label="Video title" maxLength={100} value={options.title || ''} onChange={e => save({ title: e.target.value })} /></Field>
    <Field label="Visibility"><select className="input" aria-label="YouTube visibility" value={options.privacy || ''} onChange={e => save({ privacy: e.target.value as 'public' | 'private' | 'unlisted' })}><option value="" disabled>Choose visibility</option><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></Field>
    <Field label="Audience"><select className="input" aria-label="YouTube audience" value={options.madeForKids === undefined ? '' : String(options.madeForKids)} onChange={e => save({ madeForKids: e.target.value === 'true' })}><option value="" disabled>Is this video made for kids?</option><option value="true">Yes, made for kids</option><option value="false">No, not made for kids</option></select></Field>
    <p className="xs sub">Your post text becomes the video description. YouTube processes the video before it is available to viewers.</p>
  </fieldset>;
  if (platform !== 'tiktok') return null;
  const t = options.tiktok;
  const setTikTok = (patch: Record<string, unknown>) => save({ tiktok: { allowComment: false, allowDuet: false, allowStitch: false, commercialContent: false, brandOrganic: false, brandedContent: false, consent: false, ...t, ...patch } as NonNullable<NonNullable<SocialPost['publishOptions']>['tiktok']> });
  const check = (label: React.ReactNode, checked: boolean, change: (v: boolean) => void, locked = false) => <label className="row small" style={{ gap: 9, alignItems: 'flex-start' }}><input type="checkbox" checked={checked} disabled={disabled || locked} onChange={e => change(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--ink)' }} /><span>{label}</span></label>;
  return <fieldset disabled={disabled} className="col" style={{ border: 0, padding: 0, margin: 0, gap: 12, minWidth: 0 }}>
    <legend className="small" style={{ fontWeight: 500, marginBottom: 12 }}>TikTok publishing</legend>
    {loading && <span className="small sub" role="status">Loading TikTok permissions…</span>}
    {creator && <div className="row" style={{ gap: 10 }}>{creator.avatarUrl && <img src={creator.avatarUrl} alt="" width={32} height={32} style={{ borderRadius: 99 }} />}<span className="small sub">Posting as {creator.nickname || creator.username}</span></div>}
    {error && <span className="small" role="alert" style={{ color: 'var(--bad)' }}>{error}</span>}
    {creator && <>
      <Field label="Who can view this post"><select className="input" aria-label="TikTok audience" value={t?.privacyLevel || ''} onChange={e => setTikTok({ privacyLevel: e.target.value, consent: false })}><option value="" disabled>Choose an audience</option>{creator.privacyLevels.map(p => <option key={p} value={p} disabled={p === 'SELF_ONLY' && !!t?.brandedContent}>{PRIVACY[p] || p}</option>)}</select></Field>
      {check('Allow comments', !!t?.allowComment && !creator.commentDisabled, v => setTikTok({ allowComment: v, consent: false }), creator.commentDisabled)}
      {post.video && <>{check('Allow Duet', !!t?.allowDuet && !creator.duetDisabled, v => setTikTok({ allowDuet: v, consent: false }), creator.duetDisabled)}{check('Allow Stitch', !!t?.allowStitch && !creator.stitchDisabled, v => setTikTok({ allowStitch: v, consent: false }), creator.stitchDisabled)}<span className="xs sub">Your TikTok account allows videos up to {creator.maxVideoDurationSec} seconds.</span></>}
      {check('Disclose commercial content', !!t?.commercialContent, v => setTikTok({ commercialContent: v, brandOrganic: false, brandedContent: false, consent: false }))}
      {t?.commercialContent && <div className="col" style={{ gap: 10, paddingLeft: 22 }}>{check('Your brand', !!t.brandOrganic, v => setTikTok({ brandOrganic: v, consent: false }))}{check('Branded content (another business)', !!t.brandedContent, v => setTikTok({ brandedContent: v, consent: false }))}<span className="xs sub">Branded content cannot use “Only me”.</span></div>}
      {check(<>I agree to TikTok’s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>{t?.brandedContent && <> and <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a></>}, and approve publishing this post.</>, !!t?.consent, v => setTikTok({ consent: v }))}
      <p className="xs sub">TikTok may take a few minutes to process your post. Keep its processing status in Radar until confirmation.</p>
    </>}
    <Btn size="sm" kind="ghost" disabled={disabled || loading} onClick={() => setRefresh(x => x + 1)}>Refresh TikTok permissions</Btn>
  </fieldset>;
}
