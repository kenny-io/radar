// What an edit in the article workspace sends to `article.save`. QA D1: a tab that missed the draft sent the direction
// it still showed along with an alt-text edit, and the old default replaced the direction Radar had written.
import { describe, expect, it } from 'vitest';
import type { Article } from '@/lib/types';
import { LaterQueue } from '@/client/laterQueue';
import { articleSave, coverDirectionHint, type ArtPatch } from './autosave';

/** The article as a tab that missed the draft still shows it: undrafted, with the creation default direction. */
const stale = {
  body: [], brief: { angle: 'Why tenants read reviews', outline: ['First'], words: 1400 }, seo: { title: 'Harbour Court reviews', meta: '', slug: 'harbour-court-reviews' },
  img: { style: 'illustration', seed: 1, prompt: 'Calm, editorial image about harbour court reviews', alt: '', url: null, urlKey: null }, videos: [],
} as unknown as Article;
/** As the workspace does it: apply the edit locally, then ask what to send. */
const edit = (a: Article, p: ArtPatch) => { const cur = { ...a, ...p, img: { ...a.img, ...(p.img || {}) } } as Article; return { cur, ...articleSave('e1', cur, p) }; };

describe('an image edit sends only the field the person changed', () => {
  it('typing in Alt text sends the alt and not the direction or the style the tab happens to show', () => {
    const { key, patch } = edit(stale, { img: { alt: 'Harbour Court from the quay' } });
    expect(patch).toEqual({ img: { alt: 'Harbour Court from the quay' } });
    expect(JSON.stringify(patch)).not.toContain('Calm, editorial image about');
    expect(key).toBe('art:e1:img.alt');
  });
  it('typing a direction sends the direction only, as typed', () => {
    const { key, patch } = edit(stale, { img: { prompt: ' A lighthouse above the harbour ' } });
    expect(patch).toEqual({ img: { prompt: ' A lighthouse above the harbour ' } });
    expect(key).toBe('art:e1:img.prompt');
  });
  it('clearing a field is an edit and is sent; fields only the server sets are never sent', () => {
    expect(edit({ ...stale, img: { ...stale.img, alt: 'Old' } }, { img: { alt: '' } }).patch).toEqual({ img: { alt: '' } });
    const forged = edit(stale, { img: { alt: 'A', url: 'https://example.test/x.png', seed: 9, promptBy: 'radar', placeholder: null } as any });
    expect(forged.patch).toEqual({ img: { alt: 'A' } });
    expect(edit(stale, { img: { seed: 9 } }).patch).toEqual({});
  });
  it('several image fields changed in one edit travel together under one key', () => {
    const { key, patch } = edit(stale, { img: { alt: 'A', style: 'photography', prompt: 'P' } });
    expect(patch).toEqual({ img: { style: 'photography', prompt: 'P', alt: 'A' } });
    expect(key).toBe('art:e1:img.style,img.prompt,img.alt');
  });
});

describe('edits to different image fields do not cancel each other while they wait to be saved', () => {
  /** The debounced queue the app uses, with hand-driven timers; `sent` is what would reach article.save, in order. */
  function typing() {
    const timers: (() => void)[] = []; const sent: any[] = [];
    const queue = new LaterQueue({ set: fn => timers.push(fn), clear: t => { timers[(t as number) - 1] = () => {}; } });
    let a = stale;
    const type = (p: ArtPatch) => { const { cur, key, patch } = edit(a, p); a = cur; queue.schedule(key, 600, async () => { sent.push(patch); }); };
    return { type, sent, flush: () => queue.flush() };
  }
  it('a direction typed just before an alt: both are saved', async () => {
    const t = typing();
    t.type({ img: { prompt: 'A lighthouse above the harbour' } });
    t.type({ img: { alt: 'A lighthouse' } });
    await t.flush();
    expect(t.sent).toEqual([{ img: { prompt: 'A lighthouse above the harbour' } }, { img: { alt: 'A lighthouse' } }]);
  });
  it('keystrokes in one field still collapse into its last value', async () => {
    const t = typing();
    for (const alt of ['A', 'A l', 'A lighthouse']) t.type({ img: { alt } });
    t.type({ img: { prompt: 'Dusk' } });
    t.type({ img: { alt: 'A lighthouse at dusk' } });
    await t.flush();
    // One save per field, each with the last value typed (the field typed last is sent last).
    expect(t.sent).toEqual([{ img: { prompt: 'Dusk' } }, { img: { alt: 'A lighthouse at dusk' } }]);
  });
  it('an image edit and a text edit wait under different keys', async () => {
    const t = typing();
    t.type({ seo: { ...stale.seo, meta: 'What tenants say' } });
    t.type({ img: { alt: 'A lighthouse' } });
    await t.flush();
    expect(t.sent).toEqual([{ seo: { ...stale.seo, meta: 'What tenants say' } }, { img: { alt: 'A lighthouse' } }]);
  });
});

describe('everything else is sent as before', () => {
  it('body, brief, SEO and videos send the whole edited part under the key they always had', () => {
    expect(edit(stale, { body: [['p', 'Text']] })).toMatchObject({ key: 'art:e1:body', patch: { body: [['p', 'Text']] } });
    expect(edit(stale, { brief: { ...stale.brief, angle: 'Sharper' } })).toMatchObject({ key: 'art:e1:brief', patch: { brief: { angle: 'Sharper', outline: ['First'], words: 1400 } } });
    expect(edit(stale, { seo: { ...stale.seo, slug: 'new-slug' } })).toMatchObject({ key: 'art:e1:seo', patch: { seo: { title: 'Harbour Court reviews', meta: '', slug: 'new-slug' } } });
    expect(edit(stale, { videos: ['abc'] })).toMatchObject({ key: 'art:e1:videos', patch: { videos: ['abc'] } });
    expect(Object.keys(edit(stale, { videos: ['abc'] }).patch)).toEqual(['videos']);
  });
});

describe('the hint under "Describe your image"', () => {
  it('before the first draft says Radar will write it when it drafts; afterwards that Radar wrote it', () => {
    expect(coverDirectionHint(false)).toBe('Radar writes this from your article when it drafts it. Edit it to describe the cover you want: your wording is used as written and also guides body images. Generated pictures are illustrations and may differ from the real subject.');
    expect(coverDirectionHint(true)).toBe('Radar writes this from your article. Edit it to describe the cover you want: your wording is used as written and also guides body images. Generated pictures are illustrations and may differ from the real subject.');
  });
});
