// Diagnose 375px horizontal overflow on custom pack view; and ?write=1 after Discard.
import fs from 'node:fs/promises';
import { session, base, fixture, evidence, db, browser, runtime } from './lib.mjs';
const { p, act } = await session('Editor', { viewport: { width: 375, height: 812 } });
const j = async r => (await r.json()).data.packId; const out = {};
const culprits = () => p.evaluate(() => { const w = innerWidth; return { scrollWidth: document.documentElement.scrollWidth, innerWidth: w, wide: [...document.querySelectorAll('body *')].map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.right > w + 1).map(x => `${x.e.tagName}.${String(x.e.className).slice(0, 30)} right=${Math.round(x.r.right)} w=${Math.round(x.r.width)} "${(x.e.innerText || '').slice(0, 24).replace(/\n/g, ' ')}"`).slice(0, 12) }; });
const cases = {
  normal2: await j(await act('social.createCustom', { name: 'Thally launch', posts: [{ platform: 'linkedin', text: 'A normal LinkedIn post with ordinary words.' }, { platform: 'x', text: 'A normal X post.' }] })),
  longUrlText: await j(await act('social.createCustom', { name: 'Long link post', posts: [{ platform: 'linkedin', text: 'Read https://example.com/' + 'averyveryverylongunbrokenpathsegment'.repeat(8) }, { platform: 'x', text: 'W'.repeat(300) }] })),
  longName: await j(await act('social.createCustom', { name: 'N'.repeat(120), posts: [{ platform: 'linkedin', text: 'Short' }, { platform: 'x', text: 'Short' }] })),
  defaultNameFromUrl: await j(await act('social.createCustom', { posts: [{ platform: 'x', text: 'https://example.com/' + 'averyveryverylongunbrokenpathsegment'.repeat(8) }, { platform: 'linkedin', text: 'Short' }] })),
  eightPlatforms: await j(await act('social.createCustom', { name: 'Eight platforms', posts: ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'facebook', 'reddit', 'quora'].map(k => ({ platform: k, text: 'Short ' + k })) })),
};
for (const [k, id] of Object.entries(cases)) { await p.goto(`${base}/social?pack=${id}`); await p.getByText(/Written by you/).waitFor(); await p.waitForTimeout(300); out[k] = await culprits(); await p.screenshot({ path: `${evidence}/k7-375-pack-${k}.png`, fullPage: true }); }
// a generated (non-custom) pack with the same eight platforms and a long name, for baseline comparison
const gid = 'qa-gen-mobile'; const post = t => ({ text: t, style: 'branded', seed: 1, imageUrl: null, copiedAt: null, v: 0 });
await db.query('INSERT INTO social_packs(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING', [gid, fixture.businessId, { id: gid, name: 'N'.repeat(120), source: { kind: 'idea', label: 'Baseline idea' }, created: '2026-11-24', style: 'branded', auto: false, order: ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'facebook', 'reddit', 'quora'], posts: Object.fromEntries(['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'facebook', 'reddit', 'quora'].map(k => [k, post('Short ' + k)])), headline: 'Baseline' }]);
await p.goto(`${base}/social?pack=${gid}`); await p.locator('h1').first().waitFor(); await p.waitForTimeout(500); out.generatedBaseline_longName8 = await culprits(); await p.screenshot({ path: `${evidence}/k7-375-pack-generated-baseline.png`, fullPage: true });
await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Content library' }).waitFor(); await p.waitForTimeout(300); out.library = await culprits(); await p.screenshot({ path: `${evidence}/k8-375-library-many.png`, fullPage: true });
// ?write=1 then Discard
await p.goto(base + '/social?write=1'); const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.waitFor(); await d.getByLabel('Starting text').fill('x'); await p.keyboard.press('Escape'); await p.getByRole('button', { name: 'Discard', exact: true }).click(); await d.waitFor({ state: 'hidden' }); await p.waitForTimeout(800);
out.urlAfterDiscard = p.url().replace(base, ''); await p.reload(); await p.getByRole('heading', { name: 'Content library' }).waitFor(); await p.waitForTimeout(800); out.dialogAfterReload = await p.getByRole('dialog').count();
await fs.writeFile('.factory/custom-post-scheduling/qa/k2-mobile-diagnose-results.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1)); await browser.close(); await db.end();
