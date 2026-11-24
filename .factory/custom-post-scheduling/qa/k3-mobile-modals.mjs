// C11 375px: pack view with image, Schedule window, Schedule all (5 postable rows) — no horizontal scroll, nothing cut off.
import assert from 'node:assert/strict';
import { session, check, finish, base, evidence, files, noHScroll } from './lib.mjs';
const { p, act, errors } = await session('Editor', { viewport: { width: 375, height: 812 } });
const id = (await (await act('social.createCustom', { name: 'Mobile schedule check', posts: ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'facebook'].map(k => ({ platform: k, text: 'Mobile text for ' + k + ' https://example.com/' + 'longpath'.repeat(20) })) })).json()).data.packId;
await check('C11 375px: pack view with long link text and image, Schedule window and Schedule all fit', async () => {
  await p.goto(`${base}/social?pack=${id}`); await p.getByText(/Written by you/).waitFor(); assert(await noHScroll(p), 'pack page');
  await p.locator('.tabs button').filter({ hasText: 'LinkedIn' }).click(); await p.getByLabel('Upload image for LinkedIn', { exact: true }).setInputFiles(files + '/landscape.jpg'); await p.getByRole('img', { name: 'Your image for LinkedIn' }).waitFor(); assert(await noHScroll(p), 'pack with image');
  const cutPage = await p.locator('.page button, .page textarea, .page img').evaluateAll(els => els.filter(e => !e.closest('.tabs')).map(e => e.getBoundingClientRect()).filter(r => r.width && (r.right > innerWidth + 1 || r.left < -1)).length); assert.equal(cutPage, 0);
  await p.screenshot({ path: evidence + '/k4-375-pack.png', fullPage: true });
  await p.getByRole('button', { name: 'Schedule', exact: true }).click(); const m = p.getByRole('dialog', { name: 'Schedule LinkedIn post', exact: true }); await m.waitFor(); assert(await noHScroll(p)); const mb = await m.boundingBox(); assert(mb.x >= 0 && mb.x + mb.width <= 376, JSON.stringify(mb));
  const cut1 = await m.locator('select,button').evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width && (r.right > innerWidth + 1 || r.left < -1)).length); assert.equal(cut1, 0); await p.screenshot({ path: evidence + '/k5-375-schedule.png' }); await m.getByRole('button', { name: 'Cancel', exact: true }).click();
  await p.getByRole('button', { name: 'Schedule all', exact: true }).click(); const a = p.getByRole('dialog', { name: 'Schedule this pack', exact: true }); await a.waitFor(); assert(await noHScroll(p)); const ab = await a.boundingBox(); assert(ab.x >= 0 && ab.x + ab.width <= 376, JSON.stringify(ab));
  const cut = await a.locator('select,button').evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width && (r.right > innerWidth + 1 || r.left < -1)).length); assert.equal(cut, 0); await p.screenshot({ path: evidence + '/k6-375-schedule-all.png', fullPage: true });
  const rows = (await a.innerText()).split('\n').filter(l => /LinkedIn|^X$|Instagram|TikTok|YouTube|Add media|Fix issues/.test(l)); return { modal: mb, all: ab, rows };
}, p);
await check('No page errors', async () => { assert.deepEqual(errors, []); });
await finish('k3-mobile-modals-results.json');
