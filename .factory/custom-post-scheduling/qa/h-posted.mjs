// C1: after the worker run, the pack shows Posted with a link; library Posted filter; failed state readable; posted post is not editable.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, evidence, files, runtime, packData } from './lib.mjs';
const H = JSON.parse(await fs.readFile(runtime + '/headline-pack.json', 'utf8')).packId; const { T, E } = JSON.parse(await fs.readFile(runtime + '/worker-packs.json', 'utf8'));
const { p, errors, act, c } = await session('Editor'); const tab = re => p.locator('.tabs button').filter({ hasText: re }).click();
const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) });
await check('C1 Pack shows Posted with a working link on both platforms', async () => {
  await p.goto(`${base}/social?pack=${H}`); await p.getByText(/Written by you/).waitFor(); const out = {};
  for (const [l, re, host] of [['LinkedIn', 'LinkedIn', 'https://www.linkedin.com/feed/update/'], ['X', /^X$/, 'https://x.com/customqa/status/']]) {
    await tab(re); const link = p.getByRole('link', { name: `View on ${l}`, exact: true }); await link.waitFor(); const href = await link.getAttribute('href'); assert(href.startsWith(host), href); assert.equal(await link.getAttribute('target'), '_blank');
    const side = await p.locator('.pack-side').innerText(); assert(/Posted/.test(side), side); out[l] = { href, status: side.split('\n').find(s => /Posted/.test(s)) };
    assert.equal(await p.getByRole('button', { name: 'Post now', exact: true }).count(), 0); assert.equal(await p.getByRole('button', { name: 'Schedule', exact: true }).count(), 0);
    out[l].mediaButtons = await p.locator(`section[aria-label="Media for ${l}"]`).getByRole('button').evaluateAll(b => b.map(x => `${x.innerText.trim()}:${x.disabled ? 'disabled' : 'enabled'}`));
    await p.screenshot({ path: `${evidence}/h1-posted-${l}.png`, fullPage: true });
  }
  return out;
}, p);
await check('C6 A posted post refuses media/text changes on the server', async () => {
  const before = await packData(H);
  const img = await j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-image`, { headers: { origin: base }, multipart: { packId: H, platform: 'x', file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await fs.readFile(files + '/landscape.jpg') } } }));
  const rm = await j(await act('social.imageRemove', { packId: H, platform: 'x' })); const txt = await j(await act('social.text', { packId: H, platform: 'x', text: 'changed after posting' })); const again = await j(await act('social.postNow', { sid: `s:${H}:x` }));
  const after = await packData(H); assert.equal(after.posts.x.imageUrl, before.posts.x.imageUrl);
  return { upload: `${img.status} ${img.body?.error}`, remove: `${rm.status} ${rm.body?.error}`, text: `${txt.status} ${txt.body?.error || 'accepted'}`, textNow: after.posts.x.text === before.posts.x.text ? 'unchanged' : 'CHANGED', postAgain: `${again.status} ${again.body?.error || JSON.stringify(again.body?.data?.pub?.status)}` };
});
await check('C3/C6 Over-limit edit after scheduling shows a readable failed state: nothing published, Try again blocked until fixed', async () => {
  await p.goto(`${base}/social?pack=${E}&plat=x`); await p.getByText(/Written by you/).waitFor(); await tab(/^X$/);
  await p.getByText(/^Didn’t post /).waitFor(); const side = await p.locator('.pack-side').innerText(); await p.screenshot({ path: evidence + '/h2-failed-over-limit.png', fullPage: true });
  assert(/Shorten to 280 characters/.test(side), side); const retry = p.getByRole('button', { name: 'Try again', exact: true }); const disabled = await retry.isDisabled();
  assert.equal(await p.getByRole('link', { name: 'View on X' }).count(), 0);
  return { side: side.replace(/\n+/g, ' | ').slice(0, 420), tryAgainDisabled: disabled };
}, p);
await check('C10 Library: Posted and Needs-attention filters, search by name and by post text, text tile for text-only pack', async () => {
  await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Content library', exact: true }).waitFor(); const out = {};
  out.filters = await p.getByRole('group', { name: 'Filter packs by status' }).getByRole('button').allInnerTexts();
  await p.getByRole('button', { name: /^Posted \(/ }).click(); out.posted = (await p.getByRole('article').allInnerTexts()).map(t => t.split('\n').filter(Boolean).slice(0, 4).join(' | '));
  assert(out.posted.some(t => /Thally launch day/.test(t)) && out.posted.some(t => /QA text only/.test(t)));
  await p.getByRole('button', { name: /^All packs \(/ }).click(); const search = p.getByRole('searchbox', { name: 'Search saved packs', exact: true });
  await search.fill('QA text only'); await p.waitForTimeout(300); assert.equal(await p.getByRole('article').count(), 1); const card = p.getByRole('article'); const text = await card.innerText(); out.textCard = text.replace(/\n+/g, ' | ');
  assert(/Text post/.test(text) && /Written by you/.test(text) && /Text only LinkedIn post from QA/.test(text), text); assert.equal(await card.locator('img').count(), 0); await p.screenshot({ path: evidence + '/h3-library-text-tile.png', fullPage: true });
  await search.fill('weekly review matters'); await p.waitForTimeout(300); out.byBodyText = await p.getByRole('article').count(); 
  await search.fill('calendar-based time tracking for designers. https'); await p.waitForTimeout(300); out.byXText = await p.getByRole('article').count();
  await search.fill('zzz-no-match'); await p.getByRole('heading', { name: 'No packs match your search' }).waitFor();
  await search.fill(''); await p.screenshot({ path: evidence + '/h4-library-all.png', fullPage: true });
  assert.equal(out.byBodyText, 1, 'search by post text (LinkedIn body)'); assert.equal(out.byXText, 1, 'search by X text');
  return out;
}, p);
await check('No page errors', async () => { assert.deepEqual(errors.filter(e => !/status of 4\d\d/.test(e)), []); });
await finish('h-posted-results.json');
