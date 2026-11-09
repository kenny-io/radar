import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const environment = JSON.parse(await fs.readFile('.data/autopilot/local-env.json', 'utf8'));
assert.equal(new URL(environment.DATABASE_URL).pathname, '/radar_autopilot_release_qa');
Object.assign(process.env, environment);
const { db, schema: S, pool } = await import('../../../src/server/db/index.ts');
const { eq, and, inArray } = await import('drizzle-orm');
const { defaultProfile, getBiz } = await import('../../../src/server/workspace.ts');
const { env } = await import('../../../src/server/env.ts');
const { encrypt } = await import('../../../src/server/crypto.ts');
const { jobDefs, enqueue, runJobNow } = await import('../../../src/server/jobs/queue.ts');
const { setAutopilot } = await import('../../../src/server/services/autopilot/control.ts');
const { canRun } = await import('../../../src/server/services/autopilot/guard.ts');
const { enqueueHandoff, deliverHandoff, businessHref } = await import('../../../src/server/services/autopilot/handoff.ts');
const { claimScheduled, runSend } = await import('../../../src/server/services/social/publish/send.ts');
const { stubTokens, stubState, stubAdapter } = await import('../../../src/server/services/social/publish/stubs.ts');
const { tokenFields, setAdapterForTests } = await import('../../../src/server/services/social/publish/accounts.ts');
const { renderImageFile } = await import('../../../src/server/services/images.ts');
const { todayIn, addDays } = await import('../../../src/lib/format.ts');
await import('../../../src/server/services/calendar/jobs.ts');
await import('../../../src/server/services/social/publish/jobs.ts');
const output = '.factory/autopilot/qa';
const results = [];
const check = async (name, fn) => { try { results.push({ name, pass: true, detail: await fn() }); } catch (e) { results.push({ name, pass: false, error: e.stack }); } console.log(JSON.stringify(results.at(-1))); };
const tag = crypto.randomUUID();
const [user] = await db.insert(S.users).values({ name: 'Autopilot helper QA', email: `autopilot-helper-${tag}@test.local` }).returning();
const profile = defaultProfile('helper-' + tag + '.test'); profile.business.name = 'Helper Program QA'; profile.business.description = 'Calendar time tracking for freelance designers'; profile.business.offerings = ['Calendar time tracking']; profile.business.differentiators = ['Calendar based']; profile.audience.segments = ['Freelance designers']; profile.audience.buyers = ['Designers']; profile.audience.needs = ['Track billable time'];
const [biz] = await db.insert(S.businesses).values({ ownerId: user.id, domain: profile.domain, profile, status: 'active', timezone: 'UTC', socialAuto: { on: false, platforms: ['x'], time: '08:00' }, calendarSettings: { market: 'United States', language: 'English (US)', cadence: 'custom', perWeek: 2 } }).returning();
const [other] = await db.insert(S.businesses).values({ ownerId: user.id, domain: 'other-' + tag + '.test', profile: { ...profile, business: { ...profile.business, name: 'Other helper QA' } }, status: 'active', timezone: 'UTC' }).returning();
for (const b of [biz, other]) await db.insert(S.members).values({ businessId: b.id, userId: user.id, email: user.email, role: 'Owner', status: 'active' });
const context = async () => ({ user: { id: user.id, name: user.name, email: user.email }, bid: biz.id, role: 'Owner', biz: await getBiz(biz.id) });
const row = async () => getBiz(biz.id);
const date = todayIn('UTC');
let activation;
const [account] = await db.insert(S.socialAccounts).values({ businessId: biz.id, ch: 'x', remoteId: 'qa-' + tag, name: 'Autopilot helper QA', handle: '@helperqa', ...tokenFields(stubTokens('x')), connectedBy: user.id }).returning();
const ctxFor = j => ({ job: j, payload: j.payload, businessId: j.businessId, attempt: 1, progress: async () => {}, touch: async () => {} });
const makeItem = (id, text = 'Useful standalone marketing post.') => ({ id, kind: 'post', pl: 'x', plats: ['x'], title: 'QA feed post', tag: 'QA', why: 'QA fixture', drafts: { x: text }, edits: {}, mention: false, st: 'open' });
let items = [];
await db.insert(S.briefDays).values({ businessId: biz.id, date, items, candidates: [], scannedAt: new Date().toISOString() });
const publication = async (id, activationId = null, text) => {
  items.push(makeItem(id, text)); await db.update(S.briefDays).set({ items }).where(and(eq(S.briefDays.businessId, biz.id), eq(S.briefDays.date, date)));
  const [p] = await db.insert(S.socialPubs).values({ businessId: biz.id, sid: `b:${date}:${id}`, src: 'brief', platform: 'x', kind: 'post', acctId: account.id, ch: 'x', acctLabel: '@helperqa', status: 'scheduled', date, time: '08:00', dueAt: new Date(Date.now() - 5000), auto: !!activationId, autopilotActivationId: activationId }).returning(); return p;
};
try {
  await check('AC1/8 Owner toggle preserves separate preferences and canRun obeys activation', async () => {
    const before = await row(); assert.equal(await canRun(biz.id, 'invented'), false);
    await setAutopilot(await context(), true); activation = (await row()).autopilot.activationId;
    assert(activation); assert.equal(await canRun(biz.id, activation), true); assert.equal(await canRun(biz.id, 'invented'), false);
    const after = await row(); assert.deepEqual(after.blog, before.blog); assert.deepEqual(after.socialAuto, before.socialAuto); return { authorizedActiveOnly: true, storedPreferencesUnchanged: true };
  });
  await check('AC3 Additive calendar creates researched topics while preserving existing proposed work and article edits', async () => {
    const id = 'qa-kept-' + tag;
    const [kept] = await db.insert(S.calendarEntries).values({ id, businessId: biz.id, date: addDays(date, 1), title: 'Owner custom topic must remain', kw: 'bespoke owner topic', type: 'Guide', status: 'proposed', audience: 'My audience', relevance: 'Hand picked' }).returning();
    const custom = { entryId: id, generated: false, body: [], brief: { angle: 'Owner edited brief', outline: ['Never replace this'], words: 1400 }, seo: { title: 'Custom SEO', slug: 'custom', meta: 'Owner edited' }, img: { style: 'branded', seed: 1, prompt: 'Owner image', alt: '', url: null, urlKey: null } };
    await db.insert(S.articles).values({ entryId: id, businessId: biz.id, data: custom });
    const payload = { settings: { market: 'United States', language: 'English (US)', start: addDays(date, 1), cadence: 'custom', perWeek: 2 }, keep: true, autopilotActivationId: activation };
    const [job] = await db.insert(S.jobs).values({ kind: 'calendar.generate', businessId: biz.id, payload, status: 'running', attempts: 1, maxAttempts: 2 }).returning();
    const result = await jobDefs().get('calendar.generate').run(ctxFor(job));
    const after = await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.businessId, biz.id));
    assert(after.length > 1); assert.deepEqual(after.find(e => e.id === id), kept);
    assert.deepEqual((await db.select().from(S.articles).where(eq(S.articles.entryId, id)))[0].data, custom);
    assert.equal(new Set(after.map(e => e.date)).size, after.length); assert.equal(new Set(after.map(e => e.kw.trim().toLowerCase())).size, after.length);
    const beforeRetry = after.map(e => e.id).sort(); await jobDefs().get('calendar.generate').run(ctxFor(job));
    const retry = await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.businessId, biz.id));
    assert.deepEqual(retry.map(e => e.id).sort(), beforeRetry);
    await db.update(S.jobs).set({ status: 'done', result }).where(eq(S.jobs.id, job.id));
    return { researchedTopics: after.length - 1, exactOwnerProposalAndArticlePreserved: true, repeatStable: true };
  });
  await check('AC5 Durable handoff preserves prepared text, source and owner-only recipient; repeat and late arrivals dedupe', async () => {
    const item = { key: 'reddit-test', title: 'Reply on Reddit', reason: 'Radar cannot post community comments.', href: businessHref(biz.id, '/brief'), sourceUrl: 'https://www.reddit.com/r/freelance/comments/qa', text: 'Owner edited this exact draft.\nSecond paragraph.' };
    assert.equal(await enqueueHandoff(biz.id, activation, [item]), 1); assert.equal(await enqueueHandoff(biz.id, activation, [item]), 0);
    let jobs = await db.select().from(S.jobs).where(and(eq(S.jobs.businessId, biz.id), eq(S.jobs.kind, 'autopilot.handoff'))); assert.equal(jobs.length, 1);
    await deliverHandoff(ctxFor(jobs[0])); await deliverHandoff(ctxFor(jobs[0]));
    let mail = await db.select().from(S.outboxEmails).where(eq(S.outboxEmails.to, user.email)); assert.equal(mail.length, 1); assert.equal(mail[0].status, 'logged'); assert(mail[0].text.includes(item.text)); assert(mail[0].text.includes(item.sourceUrl));
    assert.equal(await enqueueHandoff(biz.id, activation, [item, { ...item, key: 'reddit-later', title: 'Later conversation', text: 'New late draft' }]), 1);
    jobs = await db.select().from(S.jobs).where(and(eq(S.jobs.businessId, biz.id), eq(S.jobs.kind, 'autopilot.handoff'))); assert.equal(jobs.length, 2);
    const later = jobs.find(j => j.payload.items[0].key === 'reddit-later'); await deliverHandoff(ctxFor(later));
    mail = await db.select().from(S.outboxEmails).where(eq(S.outboxEmails.to, user.email)); assert.equal(mail.length, 2); assert.equal(mail.filter(m => m.text.includes(item.text)).length, 1);
    return { exactTextAndSource: true, onlyOwnerRecipient: true, repeatedDeliveryOneOutbox: true, lateArrivalNewBatch: true };
  });
  await check('AC5 Failed email retries the same persisted outbox payload', async () => {
    await enqueueHandoff(biz.id, activation, [{ key: 'mail-retry', title: 'Retry delivery', reason: 'QA controlled mail outage', href: businessHref(biz.id, '/brief'), text: 'The original persisted email draft.' }]);
    const job = (await db.select().from(S.jobs).where(and(eq(S.jobs.businessId, biz.id), eq(S.jobs.kind, 'autopilot.handoff')))).find(j => j.payload.items[0].key === 'mail-retry');
    const oldFetch = globalThis.fetch, oldKey = env.resendKey; let blockedFetch = 0;
    try { env.resendKey = 'qa-no-network'; globalThis.fetch = async () => { blockedFetch++; throw Error('QA intercepted mail outage'); }; await assert.rejects(deliverHandoff(ctxFor(job))); }
    finally { globalThis.fetch = oldFetch; env.resendKey = oldKey; }
    assert.equal(blockedFetch, 1);
    const before = (await db.select().from(S.outboxEmails).where(eq(S.outboxEmails.to, user.email))).find(m => m.text.includes('original persisted')); assert.equal(before.status, 'failed');
    await deliverHandoff(ctxFor(job)); const after = (await db.select().from(S.outboxEmails).where(eq(S.outboxEmails.id, before.id)))[0]; assert.equal(after.status, 'logged'); assert.equal(after.text, before.text);
    return { interceptedOutage: true, retriedSameOutboxId: true, persistedPayloadUnchanged: true, noExternalMail: true };
  });
  await check('AC5 Email link opens correct owned business even with another business selected', async () => {
    const token = crypto.randomBytes(32).toString('base64url'); await db.insert(S.sessions).values({ id: crypto.createHash('sha256').update(token).digest('hex'), userId: user.id, expiresAt: new Date(Date.now() + 3600000) });
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
      const c = await browser.newContext(); await c.addCookies([{ name: 'radar_session', value: token, url: env.appUrl }, { name: 'radar_biz', value: other.id, url: env.appUrl }]); const p = await c.newPage();
      assert.equal((await (await c.request.get(env.appUrl + '/api/me')).json()).currentId, other.id);
      const href = businessHref(biz.id, '/brief'); await p.goto(href); await p.getByRole('heading', { name: 'Daily Brief', exact: true }).waitFor({ timeout: 30000 });
      const current = (await (await c.request.get(env.appUrl + '/api/me')).json()).currentId; assert.equal(current, biz.id);
      await p.screenshot({ path: output + '/handoff-correct-business.png', fullPage: true }); return { previouslyOtherBusiness: true, emailLinkSwitchedToIntended: true };
    } finally { await browser.close(); }
  });
  await check('AC4 Supported active autonomous publication sends exactly once through existing worker', async () => {
    const p = await publication('active-supported', activation); const before = stubState.creates;
    const claimed = await claimScheduled(p.id); assert(claimed); const sent = await runSend(claimed, { manual: false }); assert.equal(sent.status, 'posted');
    assert.equal(stubState.creates - before, 1); assert.equal(await claimScheduled(p.id), null); return { posted: true, duplicateClaimRefused: true };
  });
  await check('AC6 Disable revokes claimed autonomous work and preserves manual queued publication', async () => {
    const automatic = await publication('disabled-auto', activation), manual = await publication('manual-still-allowed');
    const claimed = await claimScheduled(automatic.id); assert(claimed); const before = stubState.creates;
    await setAutopilot(await context(), false);
    const blocked = await runSend(claimed, { manual: false }); assert.equal(blocked.status, 'failed'); assert.equal(stubState.creates, before);
    const manualClaim = await claimScheduled(manual.id); assert(manualClaim); const posted = await runSend(manualClaim, { manual: false }); assert.equal(posted.status, 'posted'); assert.equal(stubState.creates, before + 1);
    await setAutopilot(await context(), true); const newest = (await row()).autopilot.activationId; assert.notEqual(newest, activation); assert.equal(await canRun(biz.id, activation), false); activation = newest;
    return { blockedClaimedAutoBeforeCreate: true, manualSchedulePublished: true, oldActivationRemainsRevoked: true };
  });
  await check('AC6 Disable during media upload blocks final social create', async () => {
    const file = await renderImageFile({ bid: biz.id, style: 'branded', headline: 'QA media boundary', name: profile.business.name, brand: profile.brand, seed: 1, w: 1200, h: 628, kind: 'social' });
    const p = await publication('pause-during-media', activation); items.at(-1).img = { style: 'branded', seed: 1, n: 1, urls: [file.url], meta: [{ bytes: file.bytes, type: file.type }], status: 'ready' }; await db.update(S.briefDays).set({ items }).where(and(eq(S.briefDays.businessId, biz.id), eq(S.briefDays.date, date)));
    const adapter = stubAdapter('x'); let uploads = 0, creates = 0;
    setAdapterForTests('x', { ...adapter, upload: async () => { uploads++; await setAutopilot(await context(), false); return 'qa-upload'; }, create: async () => { creates++; throw Error('Should never create after pause'); } });
    try { const claimed = await claimScheduled(p.id); assert(claimed); const outcome = await runSend(claimed, { manual: false }); assert.equal(outcome.status, 'failed'); assert.equal(uploads, 1); assert.equal(creates, 0); }
    finally { setAdapterForTests('x', null); }
    return { realStoredMedia: true, pausedInsideUpload: true, createCount: 0 };
  });
} finally {
  await fs.writeFile(output + '/helper-results.json', JSON.stringify({ at: new Date().toISOString(), businessId: biz.id, results }, null, 2));
  await pool.end();
}
process.exit(results.some(r => !r.pass) ? 1 : 0);
