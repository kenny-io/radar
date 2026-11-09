import '../lifecycle/engagementJobs';
import { tick } from '@/server/jobs/cron';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { setProviderNameForTests } from '@/server/billing/config';
import { collectEducation } from '../lifecycle/education';
import { dispatchLifecycleBatch } from '../lifecycle/dispatch';
import type { LifecyclePayload } from '../lifecycle/queue';
import { collectAiReports, prepareAiReport, reportKey } from './digest';
import { currentPromptSeries, visibilitySummary } from './history';
import { disableDigestEmail, digestPreferencesToken, managedDigestPreferences, readDigestPreferencesToken, updateDigestPreference } from './digestPreferences';
import { GET as preferencePage, POST as normalOptout } from '@/app/ai-email-preferences/route';
import { POST as oneclick } from '@/app/api/ai-email-preferences/route';
const F = new Fixtures(), M = schema.lifecycleEmails, B = schema.businesses, O = schema.aiObservations;
const now = new Date('2026-11-16T12:00:00Z'), DAY = 864e5;
const old = {flag:process.env.RADAR_EDUCATION_EMAILS,billing:process.env.RADAR_BILLING,stub:env.devStubs,key:env.resendKey};
const unpack = (m:typeof M.$inferSelect) => decrypt<LifecyclePayload>(m.payloadEnc)!;
const mails = (uid:string) => db.select().from(M).where(and(eq(M.userId,uid),eq(M.type,'ai_weekly_report'))).orderBy(M.createdAt,M.id);
const provider = (status=200) => vi.fn(async (_url:string|URL|Request,init?:RequestInit) => init?.method === 'GET' ? new Response('{"name":"restricted_api_key"}',{status:401}) : new Response(status===200?'{"id":"report-fake-ack"}':'',{status}));
const send = (uid:string,at=now,fake=provider(),limit=10) => dispatchLifecycleBatch({userIds:[uid],now:at,clock:()=>at,fetch:fake as typeof fetch,sleep:async()=>{},limit});
async function owner() {
  const u = await F.user(); await F.account(u.id,{status:'active'}); const b = await F.biz(u); await db.update(B).set({timezone:'UTC'}).where(eq(B.id,b.id));
  const [p] = await db.insert(schema.aiPrompts).values({businessId:b.id,prompt:'Which tool helps independent teams?',source:'user'}).returning();
  return {u,b,p};
}
async function observation(bid:string,pid:string,status:'mentioned'|'not-mentioned'|'not-collected'='mentioned',day='2026-11-15',engine='ChatGPT',series?:string) {
  await db.insert(O).values({businessId:bid,promptId:pid,prompt:'Which tool helps independent teams?',engine,series:series||await currentPromptSeries(bid),day,status,measuredAt:new Date(day+'T23:00:00Z'),cites:[]});
}
describe.skipIf(!process.env.DATABASE_URL)('weekly AI report actual database and lifecycle integration (fake transports)',()=>{
  beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);process.env.RADAR_EDUCATION_EMAILS='1';process.env.RADAR_BILLING='on';env.devStubs=false;env.resendKey='fake-not-real';setProviderNameForTests('stub');});
  afterEach(()=>{vi.useRealTimers();env.devStubs=old.stub;env.resendKey=old.key;setProviderNameForTests(null);});
  afterAll(async()=>{for(const[k,v]of[['RADAR_EDUCATION_EMAILS',old.flag],['RADAR_BILLING',old.billing]]){if(v===undefined)delete process.env[k!];else process.env[k!]=v;}await F.cleanup();});
  it('registers and runs the real weekly report cron hook through the scheduler',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await tick(now);expect(await mails(u.id)).toHaveLength(1);
  });
  it('registers a distinct fixed Monday period, queues once under concurrency and includes correct business/identity/preferences',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await observation(b.id,p.id,'not-mentioned','2026-11-14');
    await Promise.all([collectAiReports(now,[u.id]),collectAiReports(now,[u.id])]);const [m]=await mails(u.id);expect(await mails(u.id)).toHaveLength(1);expect(m.eventKey).toBe(reportKey(b.id,'2026-11-16',u.id));expect(m.expiresAt).toEqual(new Date('2026-11-23T08:00:00Z'));
    const payload=unpack(m);expect(payload.envelope.from).toMatch(/^Ekene from Radar </);expect(payload.envelope.reply_to).toBe('team@thally.io');expect(payload.envelope.html).not.toMatch(/<h1[\s>]/i);expect(payload.envelope.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const url=new URL('/api/b/current','https://example.test');url.searchParams.set('id',b.id);url.searchParams.set('next','/performance?tab=ai');expect(payload.envelope.text).toContain(url.pathname+url.search);
    expect(payload.envelope.text).toContain('1 of 2 collected answers');expect(payload.envelope.text).toContain('saved in your Content Calendar for review');
    expect((await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.businessId,b.id)))[0]).toMatchObject({status:'proposed',kw:p.prompt.slice(0,120)});
    await send(u.id);expect((await mails(u.id))[0].status).toBe('sent');await collectAiReports(new Date(+now+3600e3),[u.id]);expect(await mails(u.id)).toHaveLength(1);
  });
  it('does not send on Tuesday/before08UTC or fabricate history from latest results',async()=>{
    const {u,b,p}=await owner();await db.insert(schema.aiResults).values({businessId:b.id,promptId:p.id,engine:'ChatGPT',status:'mentioned',date:'2026-11-15'});
    expect((await collectAiReports(now,[u.id])).queued).toBe(0);await observation(b.id,p.id);
    for(const at of[new Date('2026-11-16T07:59:59Z'),new Date('2026-11-17T12:00:00Z')])expect((await collectAiReports(at,[u.id])).queued).toBe(0);
  });
  it('uses completed UTC days/current series, preserves previous unavailability and latest successful daily cell',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await observation(b.id,p.id,'not-collected');await observation(b.id,p.id,'not-mentioned','2026-11-16','Gemini');await observation(b.id,p.id,'not-mentioned','2026-11-01','Gemini');
    const s=await visibilitySummary(b.id,now);expect(s.weekly.current).toMatchObject({mentioned:1,collected:1,share:1});expect(s.weekly.previous.collected).toBe(0);expect(s.weekly.delta).toBeNull();
    await collectAiReports(now,[u.id]);expect(unpack((await mails(u.id))[0]).envelope.text).toContain('There isn’t enough comparable data');
  });
  it('keeps report preference independent from education off; stored report false excludes discovery',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await db.insert(schema.userEmailPreferences).values({userId:u.id,education:false,onboarding:false});await collectAiReports(now,[u.id]);expect(await mails(u.id)).toHaveLength(1);
    const other=await owner();await observation(other.b.id,other.p.id);await updateDigestPreference(other.u.id,other.b.id,false);await collectAiReports(now,[other.u.id]);expect(await mails(other.u.id)).toHaveLength(0);
  });
  it.each(['guest','unverified','role','ownership','inactive'] as const)('excludes invalid source at capture: %s',async mode=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);
    if(mode==='guest')await db.update(schema.users).set({guest:true}).where(eq(schema.users.id,u.id));
    if(mode==='unverified')await db.update(schema.users).set({emailVerifiedAt:null}).where(eq(schema.users.id,u.id));
    if(mode==='role')await db.update(schema.members).set({role:'Admin'}).where(eq(schema.members.businessId,b.id));
    if(mode==='ownership'){const other=await F.user();await db.update(B).set({ownerId:other.id}).where(eq(B.id,b.id));}
    if(mode==='inactive')await db.update(B).set({status:'onboarding'}).where(eq(B.id,b.id));
    await collectAiReports(now,[u.id]);expect(await mails(u.id)).toHaveLength(0);
  });
  it('does not require a current subscription to report retained true data',async()=>{
    const {u,b,p}=await owner();await F.account(u.id,{status:'canceled'});await observation(b.id,p.id);await collectAiReports(now,[u.id]);await send(u.id);expect((await mails(u.id))[0].status).toBe('sent');
  });
  it.each(['email','unverified','role','owner','preference','series'] as const)('rechecks current source before sending: %s',async mode=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await collectAiReports(now,[u.id]);
    if(mode==='email')await db.update(schema.users).set({email:'changed-'+u.email}).where(eq(schema.users.id,u.id));
    if(mode==='unverified')await db.update(schema.users).set({emailVerifiedAt:null}).where(eq(schema.users.id,u.id));
    if(mode==='role')await db.update(schema.members).set({role:'Editor'}).where(eq(schema.members.businessId,b.id));
    if(mode==='owner'){const other=await F.user();await db.update(B).set({ownerId:other.id}).where(eq(B.id,b.id));}
    if(mode==='preference')await updateDigestPreference(u.id,b.id,false);
    if(mode==='series')await db.insert(schema.aiPrompts).values({businessId:b.id,prompt:'A different question?',source:'user'});
    const fake=provider();await send(u.id,now,fake);expect(fake).not.toHaveBeenCalled();expect((await mails(u.id))[0].status).toBe('suppressed');
  });
  it('rechecks preferences after the suppression request before any provider POST',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await collectAiReports(now,[u.id]);const fake=vi.fn(async()=>{await updateDigestPreference(u.id,b.id,false);return new Response('',{status:404});});await send(u.id,now,fake);expect(fake).toHaveBeenCalledOnce();expect((await mails(u.id))[0].firstAttemptAt).toBeNull();
  });
  it('refreshes only stale proposed-topic wording before first attempt and freezes the report period/figures',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id,'not-mentioned');await collectAiReports(now,[u.id]);const [m]=await mails(u.id), initial=unpack(m);const entry=initial.data.aiReport!.summary.weeklyBiggestMiss!.entryId!;
    await db.update(schema.calendarEntries).set({status:'approved'}).where(eq(schema.calendarEntries.id,entry));const later=new Date(+now+DAY);vi.setSystemTime(later);await send(u.id,later);const final=unpack((await mails(u.id))[0]);expect(final.envelope.text).not.toContain('saved in your Content Calendar');expect(final.data.aiReport!.summary.weekly).toEqual(initial.data.aiReport!.summary.weekly);expect(final.data.aiReport!.periodEnd).toBe('2026-11-16');
  });
  it('retries the identical body/key/from after new observations, blocks changed required topic after an attempt',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await collectAiReports(now,[u.id]);const fail=provider(503);await send(u.id,now,fail);const [m]=await mails(u.id);await observation(b.id,p.id,'not-mentioned','2026-11-16');vi.setSystemTime(m.nextAttemptAt);const ack=provider();await send(u.id,m.nextAttemptAt,ack);
    const post=(f:ReturnType<typeof provider>)=>f.mock.calls.find(([,i])=>i?.method==='POST')![1]!;expect(post(ack).body).toBe(post(fail).body);expect(post(ack).headers).toEqual(post(fail).headers);
    const x=await owner();await observation(x.b.id,x.p.id,'not-mentioned');vi.setSystemTime(now);await collectAiReports(now,[x.u.id]);await send(x.u.id,now,provider(503));const [attempt]=await mails(x.u.id);await db.update(schema.calendarEntries).set({status:'approved'}).where(eq(schema.calendarEntries.businessId,x.b.id));const fake=provider();vi.setSystemTime(attempt.nextAttemptAt);await send(x.u.id,attempt.nextAttemptAt,fake);expect(fake).not.toHaveBeenCalled();expect((await mails(x.u.id))[0].payloadEnc).toBe(attempt.payloadEnc);
  });
  it('expires a paused period before next Monday and never queues historical Tuesday catchup',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await collectAiReports(now,[u.id]);process.env.RADAR_EDUCATION_EMAILS='0';const later=new Date('2026-11-23T08:00:00Z');vi.setSystemTime(later);const fake=provider();await send(u.id,later,fake);expect(fake).not.toHaveBeenCalled();expect((await mails(u.id))[0].lastError).toBe('expired_report_period');process.env.RADAR_EDUCATION_EMAILS='1';expect((await collectAiReports(new Date('2026-11-24T12:00:00Z'),[u.id])).queued).toBe(0);
  });
  it('prioritizes the weekly course and shares cap/daytime across multiple business reports',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await collectAiReports(now,[u.id]);await collectEducation(now,[u.id]);await send(u.id,now,provider(),1);expect((await mails(u.id))[0].firstAttemptAt).toBeNull();
    const early=new Date(+now+DAY-1);vi.setSystemTime(early);const fake=provider();await send(u.id,early,fake);expect(fake).not.toHaveBeenCalled();const next=new Date(+now+DAY);vi.setSystemTime(next);await send(u.id,next);expect((await mails(u.id))[0].status).toBe('sent');
  });
  it('does not send another accepted business-period report after an owner transfer',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await collectAiReports(now,[u.id]);await send(u.id);const next=await F.user();await F.account(next.id,{status:'active'});await db.update(B).set({ownerId:next.id}).where(eq(B.id,b.id));await db.insert(schema.members).values({businessId:b.id,userId:next.id,email:next.email,role:'Owner',status:'active'});await collectAiReports(now,[next.id]);expect(await mails(next.id)).toHaveLength(0);
  });
  it('rotates never-sent businesses ahead of previously accepted businesses without cap bypass',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await collectAiReports(now,[u.id]);await send(u.id);
    const next=new Date(+now+7*DAY);vi.setSystemTime(next);const other=await F.biz(u);await db.update(B).set({timezone:'UTC'}).where(eq(B.id,other.id));const [p2]=await db.insert(schema.aiPrompts).values({businessId:other.id,prompt:'Which app is best?',source:'user'}).returning();await observation(b.id,p.id,'mentioned','2026-11-22');await observation(other.id,p2.id,'mentioned','2026-11-22');await collectAiReports(next,[u.id]);await send(u.id,next,provider(),1);
    const sent=await db.select().from(M).where(and(eq(M.userId,u.id),eq(M.type,'ai_weekly_report'),eq(M.status,'sent')));expect(sent.map(m=>m.businessId)).toContain(other.id);expect(sent.filter(m=>m.eventKey.includes('2026-11-23'))).toHaveLength(1);
  });
  it('does not let an old-series first page starve later ready businesses and retries scans next hour',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id,'mentioned','2026-11-15','ChatGPT','0'.repeat(64));const a=await collectAiReports(now,[u.id]);expect(a).toMatchObject({scanned:1,queued:0});expect((await collectAiReports(now,[u.id])).scanned).toBe(0);await observation(b.id,p.id);expect((await collectAiReports(now,[u.id])).queued).toBe(0);expect((await collectAiReports(new Date(+now+3600e3),[u.id])).queued).toBe(1);
  });
  it('bounds long generated question display without changing full prompt-series identity',async()=>{
    const {u,b,p}=await owner();const full='Long buyer question '.repeat(40);await db.update(schema.aiPrompts).set({prompt:full}).where(eq(schema.aiPrompts.id,p.id));const series=await currentPromptSeries(b.id);await observation(b.id,p.id,'not-mentioned');await collectAiReports(now,[u.id]);const [m]=await mails(u.id);const payload=unpack(m);expect(payload.data.aiReport!.series).toBe(series);expect(payload.data.aiReport!.summary.weeklyBiggestMiss!.prompt).toHaveLength(300);expect(payload.data.aiReport!.summary.weeklyBiggestMiss!.prompt).toMatch(/…$/);await send(u.id);expect((await mails(u.id))[0].status).toBe('sent');expect((await db.select().from(schema.aiPrompts).where(eq(schema.aiPrompts.id,p.id)))[0].prompt).toBe(full);
  });
  it('pages beyond100 stale-series businesses during the same hour instead of starving a ready business',async()=>{
    const {u}=await owner();const ids=Array.from({length:101},(_,i)=>(i===100?'f':'0')+randomUUID().slice(1));
    await db.insert(B).values(ids.map((id,i)=>({id,ownerId:u.id,domain:`scan-${i}-${u.id}.test`,profile:{},status:'active' as const,timezone:'UTC'})));
    await db.insert(schema.members).values(ids.map(businessId=>({businessId,userId:u.id,email:u.email,role:'Owner' as const,status:'active' as const})));
    const prompts=await db.insert(schema.aiPrompts).values(ids.map(businessId=>({businessId,prompt:'Which app is useful?',source:'user' as const}))).returning();
    for(const p of prompts)await observation(p.businessId,p.id,'mentioned','2026-11-15','ChatGPT',p.businessId===ids[100]?undefined:'0'.repeat(64));
    const first=await collectAiReports(now,[u.id]);expect(first).toMatchObject({scanned:100,queued:0});const second=await collectAiReports(now,[u.id]);expect(second).toMatchObject({scanned:1,queued:1});expect((await mails(u.id))[0].businessId).toBe(ids[100]);
  });
  it('holds ambiguous report retries at23hours under the same body and key',async()=>{
    const {u,b,p}=await owner();await observation(b.id,p.id);await collectAiReports(now,[u.id]);await send(u.id,now,provider(503));const [first]=await mails(u.id), at=new Date(+now+23*3600e3);vi.setSystemTime(at);const fake=provider();await send(u.id,at,fake);expect(fake).not.toHaveBeenCalled();const [final]=await mails(u.id);expect(final.status).toBe('failed');expect(final.payloadEnc).toBe(first.payloadEnc);expect(final.eventKey).toBe(first.eventKey);expect(final.attempts).toBe(first.attempts);
  });
  it('supports Owner/Admin management without subscription, denies viewer/foreign access and rejects stale-owner tokens',async()=>{
    const {u,b}=await owner(), admin=await F.user(), viewer=await F.user(), foreign=await F.user();await F.member(b.id,admin,'Admin');await F.member(b.id,viewer,'Viewer');await F.account(u.id,{status:'canceled'});
    expect(await managedDigestPreferences(u.id)).toContainEqual(expect.objectContaining({id:b.id,weeklyEmail:true}));expect(await updateDigestPreference(admin.id,b.id,false)).toBe(true);expect(await updateDigestPreference(viewer.id,b.id,true)).toBe(false);expect(await updateDigestPreference(foreign.id,b.id,true)).toBe(false);
    const token=digestPreferencesToken(b.id,u.id);expect(readDigestPreferencesToken(token+'x')).toBeNull();expect(await disableDigestEmail(token)).toBe(true);await db.update(B).set({ownerId:foreign.id}).where(eq(B.id,b.id));expect(await disableDigestEmail(token)).toBe(false);
  });
  it.each([
    {label:'explicit same-origin',origin:'app',site:'same-origin',mode:'navigate',dest:'document',status:303},
    {label:'native opaque same-origin navigation',origin:'null',site:'same-origin',mode:'navigate',dest:'document',status:303},
    {label:'hostile origin despite same-origin metadata',origin:'https://hostile.example',site:'same-origin',mode:'navigate',dest:'document',status:403},
    {label:'opaque cross-site',origin:'null',site:'cross-site',mode:'navigate',dest:'document',status:403},
    {label:'opaque same-site sibling',origin:'null',site:'same-site',mode:'navigate',dest:'document',status:403},
    {label:'opaque missing metadata',origin:'null',site:undefined,mode:undefined,dest:undefined,status:403},
    {label:'opaque non-navigation',origin:'null',site:'same-origin',mode:'cors',dest:'document',status:403},
    {label:'opaque iframe navigation',origin:'null',site:'same-origin',mode:'navigate',dest:'iframe',status:403},
    {label:'explicit same-origin marked cross-site',origin:'app',site:'cross-site',mode:'navigate',dest:'document',status:403},
  ])('handles actual signed form Request origin policy: $label',async scenario=>{
    const {u,b}=await owner(),token=digestPreferencesToken(b.id,u.id);
    const headers=new Headers({'content-type':'application/x-www-form-urlencoded',origin:scenario.origin==='app'?new URL(env.appUrl).origin:scenario.origin});
    for(const [key,value] of [['sec-fetch-site',scenario.site],['sec-fetch-mode',scenario.mode],['sec-fetch-dest',scenario.dest]])if(value!==undefined)headers.set(key!,value);
    const response=await normalOptout(new Request(`${env.appUrl}/ai-email-preferences`,{method:'POST',headers,body:new URLSearchParams({token})}));
    expect(response.status).toBe(scenario.status);expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await managedDigestPreferences(u.id))[0].weeklyEmail).toBe(scenario.status!==303);
  });
  it('keeps native opaque-origin form authorization and streamed size bounds after the origin exception',async()=>{
    const {u,b}=await owner(),token=digestPreferencesToken(b.id,u.id),headers={'content-type':'application/x-www-form-urlencoded',origin:'null','sec-fetch-site':'same-origin','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
    const post=(body:URLSearchParams)=>normalOptout(new Request(`${env.appUrl}/ai-email-preferences`,{method:'POST',headers,body}));
    expect((await post(new URLSearchParams({token:token+'tampered'}))).status).toBe(400);
    expect((await post(new URLSearchParams({token,extra:'wrong'}))).status).toBe(400);
    expect((await post(new URLSearchParams({token:'x'.repeat(2049)}))).status).toBe(413);
    const next=await F.user();await db.update(B).set({ownerId:next.id}).where(eq(B.id,b.id));expect((await post(new URLSearchParams({token}))).status).toBe(400);
    expect((await db.select().from(schema.visibilityPreferences).where(eq(schema.visibilityPreferences.businessId,b.id)))).toHaveLength(0);
  });
  it('never mutates on preference GET, supports strict form and oneclick POST without changing education',async()=>{
    const {u,b}=await owner(), token=digestPreferencesToken(b.id,u.id);await db.insert(schema.userEmailPreferences).values({userId:u.id,education:true});const url=`${env.appUrl}/ai-email-preferences?token=${encodeURIComponent(token)}`;
    expect((await preferencePage(new Request(url))).status).toBe(200);expect((await managedDigestPreferences(u.id))[0].weeklyEmail).toBe(true);
    expect((await normalOptout(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})}))).status).toBe(303);await updateDigestPreference(u.id,b.id,true);
    expect((await oneclick(new Request(`${env.appUrl}/api/ai-email-preferences?token=${encodeURIComponent(token)}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}))).status).toBe(204);expect((await db.select().from(schema.userEmailPreferences).where(eq(schema.userEmailPreferences.userId,u.id)))[0].education).toBe(true);
    expect((await normalOptout(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token,extra:'bad'})}))).status).toBe(400);
    await updateDigestPreference(u.id,b.id,true);
    for (const body of ['List-Unsubscribe=wrong','List-Unsubscribe=One-Click&extra=bad','x'.repeat(129)]) expect((await oneclick(new Request(`${env.appUrl}/api/ai-email-preferences?token=${encodeURIComponent(token)}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body}))).status).toBe(400);
    expect((await managedDigestPreferences(u.id))[0].weeklyEmail).toBe(true);
  });
});
