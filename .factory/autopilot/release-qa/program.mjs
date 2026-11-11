import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const environment = JSON.parse(await fs.readFile('.data/autopilot/local-env.json', 'utf8'));
assert.equal(new URL(environment.DATABASE_URL).pathname, '/radar_autopilot_release_qa'); Object.assign(process.env, environment);
const { db, schema: S, pool } = await import('../../../src/server/db/index.ts');
const { eq, and, inArray, desc } = await import('drizzle-orm');
const { defaultProfile, getBiz, bizToday } = await import('../../../src/server/workspace.ts');
const { enqueue, runJobNow, getJob } = await import('../../../src/server/jobs/queue.ts');
const { setAutopilot, requestAutopilotRun } = await import('../../../src/server/services/autopilot/control.ts');
const { runAutopilot, autopilotTick } = await import('../../../src/server/services/autopilot/run.ts');
const { publisherTick } = await import('../../../src/server/services/social/publish/jobs.ts');
const { runScheduler } = await import('../../../src/server/services/publishing/jobs.ts');
const { tokenFields } = await import('../../../src/server/services/social/publish/accounts.ts');
const { stubTokens, stubState } = await import('../../../src/server/services/social/publish/stubs.ts');
const { dailyPackId } = await import('../../../src/server/services/social/auto.ts');
const { addDays } = await import('../../../src/lib/format.ts');
await import('../../../src/server/jobs/all.ts');
const results = [], tag = crypto.randomUUID();
const check = async (name, fn) => { try { results.push({ name, pass: true, detail: await fn() }); } catch (e) { results.push({ name, pass: false, error: e.stack }); } console.log(JSON.stringify(results.at(-1))); };
const [owner] = await db.insert(S.users).values({ emailVerifiedAt: new Date(), name: 'Program owner QA', email: `program-${tag}@test.local` }).returning();
const profile = defaultProfile('program-' + tag + '.test'); profile.business.name = 'Program Autopilot QA'; profile.business.description = 'Calendar time tracking for freelance designers'; profile.business.offerings = ['Calendar time tracking']; profile.business.differentiators = ['Calendar based']; profile.audience.segments = ['Freelance designers']; profile.audience.buyers = ['Designers']; profile.audience.needs = ['Track billable time'];
profile.keywords.list = ['time tracking for designers','billable hours tracking','calendar time tracking'].map(kw => ({ kw, intent: 'Commercial', vol: 500, kd: 12, src: 'user', priority: true }));
const [biz] = await db.insert(S.businesses).values({ ownerId: owner.id, domain: profile.domain, profile, status: 'active', timezone: 'Pacific/Honolulu', socialAuto: { on: false, freq: 'daily', platforms: ['x','linkedin','reddit'], style: 'branded', time: '00:00', post: 'library' }, blog: { mode: 'review', time: '00:00' }, calendarSettings: { market: 'United States', language: 'English (US)', cadence: 'daily', perWeek: 3 }, briefSettings: { platforms: ['reddit','x','linkedin'], time: '00:00', mention: 'asked', accounts: ['founder'] } }).returning();
await db.insert(S.members).values({ businessId: biz.id, userId: owner.id, email: owner.email, role: 'Owner', status: 'active' });
await db.insert(S.connections).values({ businessId: biz.id, type: 'wordpress', url: 'https://' + profile.domain, fields: { url: 'https://' + profile.domain }, status: 'ok' });
const accounts = [];
for (const ch of ['x','li_profile','li_page']) accounts.push((await db.insert(S.socialAccounts).values({ businessId: biz.id, ch, remoteId: `program-${ch}-${tag}`, name: 'Program QA '+ch, handle: ch === 'x' ? '@programqa' : null, ...tokenFields(stubTokens(ch)), connectedBy: owner.id }).returning())[0]);
const row = async () => getBiz(biz.id);
const context = async () => ({ user: { id: owner.id, name: owner.name, email: owner.email }, bid: biz.id, role: 'Owner', biz: await row() });
const jobs = kind => db.select().from(S.jobs).where(and(eq(S.jobs.businessId, biz.id), ...(kind ? [eq(S.jobs.kind, kind)] : []))).orderBy(S.jobs.createdAt);
const execute = async id => {
  await db.update(S.jobs).set({ status: 'running', attempts: 1, lockedBy: 'independent-qa', lockedAt: new Date() }).where(eq(S.jobs.id, id));
  await runJobNow(id); const done = await getJob(id); assert.equal(done.status, 'done', `Job ${done.kind} did not finish: ${done.error}`); return done;
};
const runQueued = async kind => { const active = (await jobs(kind)).filter(j => j.status === 'queued'); for (const j of active) await execute(j.id); return active.length; };
const program = async () => { const { jobId } = await requestAutopilotRun(await context()); return execute(jobId); };
const date = bizToday(biz);
const reddit = { id: 'qa-reddit-edited', kind: 'reply', plat: 'reddit', where: 'r/freelance', title: 'How to track design time?', url: 'https://www.reddit.com/r/freelance/comments/autopilotqa', tag: 'Asking for help', why: 'A useful audience question', drafts: { help: 'Generic default reply.', mention: 'Original mention draft.' }, edits: { mention: 'Exact owner-edited reply for this Reddit conversation.' }, mention: true, st: 'open' };
let activation, scheduledArticleId;
try {
 await check('AC2/3/4/5 Empty program queues durable calendar, social and Brief work once without changing saved preferences', async () => {
  await setAutopilot(await context(), true); activation = (await row()).autopilot.activationId;
  await Promise.all([autopilotTick(),autopilotTick()]); assert.equal((await jobs('autopilot.run')).filter(j => j.status === 'queued').length,1);
  await runQueued('autopilot.run');
  for (const kind of ['calendar.generate','social.autoRun','brief.scan']) assert.equal((await jobs(kind)).filter(j => j.status==='queued').length,1,kind);
  const after = await row(); assert.deepEqual(after.blog,biz.blog);assert.deepEqual(after.socialAuto,biz.socialAuto);assert.equal(after.briefSetup,false);
  return { calendarQueued: true, socialQueued: true, scanQueued: true, storedIndividualPreferencesUnchanged: true };
 });
 await check('AC2/3/4/5 Registered child workers generate calendar, daily social pack and fresh Daily Brief', async () => {
  for (const kind of ['calendar.generate','social.autoRun','brief.scan']) await runQueued(kind);
  const entries=await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.businessId,biz.id));assert(entries.length>0);
  const packs=await db.select().from(S.socialPacks).where(eq(S.socialPacks.businessId,biz.id));assert.equal(packs.length,1);assert.equal(packs[0].id,dailyPackId(biz.id,date));assert(packs[0].data.posts.x);assert(packs[0].data.posts.linkedin);assert(packs[0].data.posts.reddit);
  const [day]=await db.select().from(S.briefDays).where(and(eq(S.briefDays.businessId,biz.id),eq(S.briefDays.date,date)));assert(day);assert(day.items.length>0);
  await db.update(S.briefDays).set({items:[...day.items,reddit]}).where(and(eq(S.briefDays.businessId,biz.id),eq(S.briefDays.date,date)));
  return { calendarTopics:entries.length,oneDailyPack:true,briefItems:day.items.length,localDate:date,timezone:biz.timezone };
 });
 await check('AC2/4/5 Coordinator schedules supported feed posts, drafts article and emails manual edited Reddit reply', async () => {
  await program(); const pubs=await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId,biz.id));assert(pubs.some(p=>p.platform==='x'));assert(pubs.some(p=>p.platform==='linkedin'));
  for(const platform of ['x','linkedin'])assert(pubs.filter(p=>p.platform===platform).length<=2);
  assert(pubs.every(p=>p.autopilotActivationId===activation));assert.equal(pubs.filter(p=>p.sid.includes(reddit.id)).length,0);
  assert((await jobs('article.draft')).some(j=>j.status==='queued'));
  await runQueued('autopilot.handoff');const mail=await db.select().from(S.outboxEmails).where(eq(S.outboxEmails.to,owner.email));assert(mail.some(m=>m.text.includes(reddit.edits.mention)&&m.text.includes(reddit.url)));
  const [day]=await db.select().from(S.briefDays).where(and(eq(S.briefDays.businessId,biz.id),eq(S.briefDays.date,date)));assert.equal(day.items.find(i=>i.id===reddit.id).st,'open');
  return { scheduled:pubs.length,capAtMostTwoPerPlatform:true,articleQueued:true,exactEditedRedditHandoff:true,unsupportedNeverMarkedPosted:true };
 });
 await check('AC2/4 Scheduled social workers publish valid posts and repeated tick cannot duplicate create', async () => {
  await db.update(S.socialPubs).set({dueAt:new Date(Date.now()-5000)}).where(and(eq(S.socialPubs.businessId,biz.id),eq(S.socialPubs.status,'scheduled')));
  const before=stubState.creates;await publisherTick(new Date());await runQueued('social.send');
  const pubs=await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId,biz.id));assert(pubs.every(p=>p.status==='posted'));const sent=stubState.creates-before;assert.equal(sent,pubs.length);
  await publisherTick(new Date());assert.equal(await runQueued('social.send'),0);assert.equal(stubState.creates-before,sent);
  return { posted:sent,allStubProviders:true,duplicateCreates:0 };
 });
 await check('AC3 Article worker schedules without review and due publisher completes connected blog publication', async () => {
  await runQueued('article.draft');const entries=await db.select().from(S.calendarEntries).where(and(eq(S.calendarEntries.businessId,biz.id),eq(S.calendarEntries.status,'scheduled')));assert(entries.length>0);const e=entries[0];scheduledArticleId=e.id;
  const [art]=await db.select().from(S.articles).where(eq(S.articles.entryId,e.id));assert(art.data.generated);assert(art.data.body.length>0);
  // Advance only this synthetic publication date to simulate its due business day; keep the real scheduler/publisher.
  await db.update(S.calendarEntries).set({date}).where(eq(S.calendarEntries.id,e.id));await runScheduler(new Date());await runQueued('publish.entry');
  const [published]=await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.id,e.id));assert.equal(published.status,'published');assert(published.publishedUrl);assert.equal(published.autopilotActivationId,activation);
  return { draftedAndScheduledWithoutApproval:true,syntheticDateAdvancedToDue:true,publishedViaExistingConnector:true };
 });
 await check('AC2/5 Repeated program pass preserves posted state, pack IDs and existing owner handoffs', async () => {
  const beforePacks=await db.select().from(S.socialPacks).where(eq(S.socialPacks.businessId,biz.id));const beforeMail=await db.select().from(S.outboxEmails).where(eq(S.outboxEmails.to,owner.email));const beforePubs=await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId,biz.id));
  await program();await runQueued('autopilot.handoff');
  assert.deepEqual((await db.select().from(S.socialPacks).where(eq(S.socialPacks.businessId,biz.id))).map(p=>p.id),beforePacks.map(p=>p.id));assert.equal((await db.select().from(S.outboxEmails).where(eq(S.outboxEmails.to,owner.email))).length,beforeMail.length);assert.equal((await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId,biz.id))).length,beforePubs.length);
  return { oneDailyPack:true,noDuplicatePublications:true,noDuplicateManualHandoff:true };
 });
 await check('AC6 Reenable adopts untouched old proposals without reviving queued old publications or manual schedules', async () => {
  const old=activation,id='old-proposed-'+tag;const [current]=await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.id,scheduledArticleId));
  await db.insert(S.calendarEntries).values({id,businessId:biz.id,date:addDays(date,1),title:'Untouched proposal across activations',kw:'untouched revival topic',type:'Guide',status:'proposed',autopilotActivationId:old});
  const oldScheduledId='old-scheduled-'+tag;await db.insert(S.calendarEntries).values({id:oldScheduledId,businessId:biz.id,date:addDays(date,3),title:'Held old publication',kw:'held old',type:'Guide',status:'scheduled',autopilotActivationId:old});
  const manualId='manual-scheduled-'+tag;await db.insert(S.calendarEntries).values({id:manualId,businessId:biz.id,date:addDays(date,4),title:'Manual schedule remains',kw:'manual old',type:'Guide',status:'scheduled'});
  await setAutopilot(await context(),false);await setAutopilot(await context(),true);activation=(await row()).autopilot.activationId;assert.notEqual(activation,old);await runQueued('autopilot.run');await program();
  const [held]=await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.id,oldScheduledId));assert.equal(held.status,'review');assert.equal(held.autopilotActivationId,old);
  const [manual]=await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.id,manualId));assert.equal(manual.status,'scheduled');assert.equal(manual.autopilotActivationId,null);
  const drafts=(await jobs('article.draft')).filter(j=>j.payload.autopilotActivationId===activation);assert(drafts.length>0);return{newActivation:true,untouchedProposalEligible:true,oldQueuedPublicationHeld:true,manualSchedulePreserved:true};
 });
 await check('AC5 Final failed autonomous social generation escalates to owner handoff', async () => {
  await db.insert(S.jobs).values({kind:'social.autoRun',businessId:biz.id,ref:date,status:'failed',payload:{date,autopilotActivationId:activation},attempts:3,maxAttempts:3,error:'QA final social generation failure'});
  await program();const batch=(await jobs('autopilot.handoff')).flatMap(j=>j.payload.items);assert(batch.some(i=>/social/i.test(i.title)&&/needs attention/i.test(i.title)),'Missing final social generation handoff');return{finalGenerationFailureEscalated:true};
 });
 await check('AC8 Lapsed billing blocks coordinator work instead of failing open', async () => {
  const before=(await jobs()).length;const previous=process.env.RADAR_BILLING;process.env.RADAR_BILLING='on';
  try {const snapshot=(await jobs('autopilot.run')).at(-1);const result=await runAutopilot({job:snapshot,payload:{activationId:activation},businessId:biz.id,attempt:1,progress:async()=>{},touch:async()=>{}});assert.equal(result.skipped,'autopilot_off_or_no_access');assert.equal((await jobs()).length,before);}finally{process.env.RADAR_BILLING=previous}
  return{lapsedOwnerNoNewWork:true};
 });
 await check('AC5 Expired scheduled accounts and uncertain publication outcomes reach the owner without automatic resend', async () => {
  const [day]=await db.select().from(S.briefDays).where(and(eq(S.briefDays.businessId,biz.id),eq(S.briefDays.date,date)));
  const item={id:'qa-unknown-result',kind:'post',pl:'x',plats:['x'],title:'Uncertain publication',tag:'QA',why:'QA failure',drafts:{x:'Do not resend this uncertain post.'},edits:{},mention:false,st:'open'};
  await db.update(S.briefDays).set({items:[...day.items,item]}).where(and(eq(S.briefDays.businessId,biz.id),eq(S.briefDays.date,date)));
  const account=accounts.find(a=>a.ch==='x');
  const [unknown]=await db.insert(S.socialPubs).values({businessId:biz.id,sid:`b:${date}:${item.id}`,src:'brief',platform:'x',kind:'post',acctId:account.id,ch:'x',acctLabel:'@programqa',status:'failed',date,time:'00:00',dueAt:new Date(),autopilotActivationId:activation,errCode:'unknown'}).returning();
  const [held]=await db.insert(S.socialPubs).values({businessId:biz.id,sid:`b:${date}:qa-held-account`,src:'brief',platform:'x',kind:'post',acctId:account.id,ch:'x',acctLabel:'@programqa',status:'scheduled',date:addDays(date,1),time:'00:00',dueAt:new Date(Date.now()+86400000),autopilotActivationId:activation}).returning();
  await db.update(S.socialAccounts).set({expired:true}).where(eq(S.socialAccounts.id,account.id));const before=stubState.creates;
  await program();const handoffs=(await jobs('autopilot.handoff')).flatMap(j=>j.payload.items);
  assert(handoffs.some(i=>i.key==='held-post:'+held.id&&/reconnect/i.test(i.reason)));
  assert(handoffs.some(i=>i.key==='failed-post:'+unknown.id&&/avoid a duplicate/i.test(i.reason)));
  assert.equal(stubState.creates,before);assert.equal((await db.select().from(S.socialPubs).where(eq(S.socialPubs.id,unknown.id)))[0].status,'failed');
  return{expiredAccountHandoff:true,unknownOutcomeWarning:true,noAutomaticResend:true};
 });
 await check('AC6 Explicit manual article adoption clears revoked program provenance', async () => {
  await setAutopilot(await context(),false);
  const actions=(await import('../../../src/server/actions/article.ts')).actions;
  const publish=(await import('../../../src/server/actions/publishing.ts')).actions;
  const id='manual-adoption-'+tag;
  await db.insert(S.calendarEntries).values({id,businessId:biz.id,date,title:'Manually adopted article',kw:'manual adoption',type:'Guide',status:'review',autopilotActivationId:activation});
  await db.insert(S.articles).values({entryId:id,businessId:biz.id,data:{generated:true,body:[['p','Manually approved saved copy.']]}});
  await actions['article.approve'].run(await context(),{entryId:id,withoutPublishing:false});
  let [article]=await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.id,id));assert.equal(article.status,'scheduled');assert.equal(article.autopilotActivationId,null);
  // Simulate a legacy revoked ownership marker before explicit Publish now; the action must adopt it independently.
  await db.update(S.calendarEntries).set({autopilotActivationId:activation}).where(eq(S.calendarEntries.id,id));
  const result=await publish['publish.now'].run(await context(),{entryId:id});[article]=await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.id,id));assert.equal(article.autopilotActivationId,null);assert.equal(article.status,'publishing');assert.equal((await getJob(result.jobId)).payload.manual,true);
  return{manualApprovalClearsProvenance:true,explicitPublishNowClearsProvenance:true,manualJobRecorded:true};
 });
} finally {
 await db.update(S.businesses).set({autopilot:{...(await row()).autopilot,enabled:false}}).where(eq(S.businesses.id,biz.id));
 await fs.writeFile('.factory/autopilot/release-qa/program-results.json',JSON.stringify({at:new Date().toISOString(),businessId:biz.id,results},null,2));await pool.end();
}
process.exit(results.some(r=>!r.pass)?1:0);
