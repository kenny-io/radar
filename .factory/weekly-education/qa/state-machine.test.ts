import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { collectEducation, educationContext, EDUCATION_WEEK } from '@/server/services/lifecycle/education';
import { dispatchLifecycleBatch } from '@/server/services/lifecycle/dispatch';
import { educationAllowed, updateEducationPreference, stopOnboarding, updateEngagementPreferences } from '@/server/services/lifecycle/preferences';
import { recordEngagement, collectWorkUpdates } from '@/server/services/lifecycle/engagement';
import { queueLifecycle, type LifecyclePayload } from '@/server/services/lifecycle/queue';
const F=new Fixtures('education-independent');const M=schema.lifecycleEmails,E=schema.educationEnrollments;const day=864e5;
const base=new Date('2026-11-10T12:00:00Z');
const enrollment=async(uid:string)=>(await db.select().from(E).where(eq(E.userId,uid)))[0];
const mails=async(uid:string)=>await db.select().from(M).where(eq(M.userId,uid));
const decode=(r:typeof M.$inferSelect)=>decrypt<LifecyclePayload>(r.payloadEnc)!;
const fake=()=>vi.fn(async(url:string,init?:RequestInit)=>init?.method==='POST'?new Response('{"id":"qa-provider-accepted"}'):new Response('',{status:404}));
const posts=(f:any)=>f.mock.calls.filter((c:any)=>c[1]?.method==='POST');
const send=async(now:Date,f:any=fake(),clock=()=>now)=>{await dispatchLifecycleBatch({now,userIds:F.users,fetch:f,sleep:async()=>{},clock} as any);return f;};
async function owner(){const u=await F.user();await F.account(u.id,{comp:true});const b=await F.biz(u);await db.update(schema.businesses).set({timezone:'UTC'}).where(eq(schema.businesses.id,b.id));return {u,b};}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(base);process.env.RADAR_EDUCATION_EMAILS='1';process.env.RADAR_BILLING='on';env.devStubs=false;env.resendKey='qa-not-real';env.stripeSecretKey='sk_test_local_only';});
afterEach(async()=>{await db.delete(E).where(inArray(E.userId,F.users));await F.cleanup();vi.useRealTimers();});
describe('independent education state and dispatch',()=>{
 it('enrolls verified users once regardless of billing stage, excludes guests/unverified/inherited optout',async()=>{
  const ids=[];for(const status of ['none','trialing','active','canceled','past_due'] as const){const u=await F.user();await F.account(u.id,{status});ids.push(u.id);}
  const g=await F.user({guest:true}),n=await F.user({verified:false}),off=await F.user();await stopOnboarding(off.id);
  await Promise.all([collectEducation(base,[...ids,g.id,n.id,off.id]),collectEducation(base,[...ids,g.id,n.id,off.id])]);
  expect((await db.select().from(E).where(inArray(E.userId,ids)))).toHaveLength(5);for(const id of ids)expect(await mails(id)).toHaveLength(1);
  for(const id of [g.id,n.id,off.id])expect(await enrollment(id)).toBeUndefined();
  await db.update(schema.users).set({emailVerifiedAt:base}).where(eq(schema.users.id,n.id));await collectEducation(base,[n.id]);expect(await enrollment(n.id)).toBeTruthy();
  await updateEducationPreference(off.id,true,base);await collectEducation(base,[off.id]);expect(await enrollment(off.id)).toBeTruthy();
 });
 it('sends exactly five ordered lessons after acceptance plus7days, no downtime catch-up/re-enrollment',async()=>{
  const {u}=await owner();let now=base;const lessons=[];
  for(let step=0;step<5;step++){
   vi.setSystemTime(now);await collectEducation(now,[u.id]);const e=await enrollment(u.id);const row=(await mails(u.id)).find(m=>m.id===e.pendingEmailId)!;lessons.push(decode(row).data.education!.lesson);
   const f=fake();await Promise.all([send(now,f),send(now,f)]);expect(posts(f)).toHaveLength(1);
   const after=await enrollment(u.id);expect(after.nextLesson).toBe(step+1);expect(after.pendingEmailId).toBeNull();expect(after.nextDueAt.getTime()-after.lastAcceptedAt!.getTime()).toBe(EDUCATION_WEEK);
   await collectEducation(new Date(now.getTime()+EDUCATION_WEEK-1),[u.id]);expect((await mails(u.id)).length).toBe(step+1);
   now=new Date(now.getTime()+EDUCATION_WEEK+14*day);
  }
  expect(lessons).toEqual(['ai_visibility','daily_brief','backlinks','organic_search','social_marketing']);expect((await enrollment(u.id)).status).toBe('completed');
  await updateEducationPreference(u.id,false,now);await updateEducationPreference(u.id,true,now);await collectEducation(now,[u.id]);expect(await mails(u.id)).toHaveLength(5);
 });
 it('suppression lookup malformed/unavailable/auth failures defer with zero provider attempts',async()=>{
  for(const status of [200,401,403,429,500]){const {u}=await owner();await collectEducation(base,[u.id]);const f=vi.fn(async()=>new Response(status===200?'{}':'',{status}));await send(base,f);expect(posts(f)).toHaveLength(0);const row=(await mails(u.id))[0];expect(row.firstAttemptAt).toBeNull();expect(row.attempts).toBe(0);expect(row.status).toBe('queued');}
 });
 it('freezes retry body/key across profile changes and uses eventual acceptance time for next due',async()=>{
  const {u,b}=await owner();await collectEducation(base,[u.id]);let post=0;const f=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='POST'?new Response(post++===0?'':'{"id":"qa-retry"}',{status:post===1?503:200}):new Response('',{status:404}));
  await send(base,f);const first=(await mails(u.id))[0];expect(first.attempts).toBe(1);
  await db.update(schema.users).set({name:'Changed name'}).where(eq(schema.users.id,u.id));await db.update(schema.businesses).set({profile:{...b.profile,business:{...b.profile.business,name:'Changed business'}}}).where(eq(schema.businesses.id,b.id));
  const retryAt=new Date(base.getTime()+3600e3);await send(retryAt,f);expect(posts(f)).toHaveLength(2);expect(posts(f)[0][1].body).toBe(posts(f)[1][1].body);expect(posts(f)[0][1].headers).toEqual(posts(f)[1][1].headers);
  expect((await enrollment(u.id)).nextDueAt.getTime()).toBe(retryAt.getTime()+EDUCATION_WEEK);
 });
 it('optout pauses unattempted row, resumption uses same id; changed recipient blocks without POST',async()=>{
  const {u}=await owner();await collectEducation(base,[u.id]);const id=(await enrollment(u.id)).pendingEmailId;
  await updateEducationPreference(u.id,false,base);let f=await send(base);expect(posts(f)).toHaveLength(0);expect((await enrollment(u.id)).status).toBe('paused');
  await updateEducationPreference(u.id,true,base);await collectEducation(base,[u.id]);expect((await enrollment(u.id)).pendingEmailId).toBe(id);
  await db.update(schema.users).set({email:'changed-'+u.email}).where(eq(schema.users.id,u.id));f=await send(base);expect(posts(f)).toHaveLength(0);expect((await enrollment(u.id)).status).toBe('blocked');
 });
 it('shared optional cap counts ambiguous founder attempts and business-local daytime',async()=>{
  const {u,b}=await owner();await db.update(schema.businesses).set({timezone:'Asia/Dubai'}).where(eq(schema.businesses.id,b.id));
  const quiet=new Date('2026-11-10T22:00:00Z');await collectEducation(quiet,[u.id]);expect(await mails(u.id)).toHaveLength(1);expect((await mails(u.id))[0].nextAttemptAt.toISOString()).toBe('2026-11-11T05:00:00.000Z');
  const at=new Date('2026-11-11T08:00:00Z');await queueLifecycle(db,{type:'founder_note',userId:u.id,eventKey:'qa-cap-'+u.id,data:{},sendAt:at});await db.update(M).set({firstAttemptAt:at,status:'failed'}).where(eq(M.userId,u.id));await collectEducation(at,[u.id]);expect((await mails(u.id)).filter(m=>m.type==='weekly_education')).toHaveLength(1);const f=await send(at);expect(posts(f)).toHaveLength(0);
 });
 it('does not borrow profile data for member-only users or write billing in read-only context selection',async()=>{
  const {u,b}=await owner();const member=await F.user();await F.member(b.id,member);const ctx=await educationContext(member.id);expect(ctx.businessId).toBeUndefined();expect(ctx.context.businessName).toBeUndefined();expect(ctx.context.access).toBe('workspace');
  const other=await F.user();await F.biz(other);await educationContext(other.id);expect((await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId,other.id)))).toHaveLength(0);
 });
 it('protects a pending outbox row from deletion while allowing account cascade',async()=>{
  const {u}=await owner();await collectEducation(base,[u.id]);const id=(await enrollment(u.id)).pendingEmailId!;
  await expect(db.delete(M).where(eq(M.id,id))).rejects.toThrow();
  await db.delete(schema.businesses).where(eq(schema.businesses.ownerId,u.id));await db.delete(schema.users).where(eq(schema.users.id,u.id));expect(await enrollment(u.id)).toBeUndefined();expect(await mails(u.id)).toHaveLength(0);
 });
 it('uses new event hooks without an optin row, preserves saved false and excludes unverified users',async()=>{
  for(const mode of ['fresh','explicit-off','unverified'] as const){
   const {u,b}=await owner();if(mode==='explicit-off')await updateEngagementPreferences(u.id,{dailyBrief:false});if(mode==='unverified')await db.update(schema.users).set({emailVerifiedAt:null}).where(eq(schema.users.id,u.id));
   await db.insert(schema.briefDays).values({businessId:b.id,date:'2026-11-10',scannedAt:base.toISOString(),items:[{id:'qa-reply',kind:'reply',st:'open',plat:'reddit',url:'https://reddit.com/r/test/comments/qa',title:'Relevant conversation'}]});
   await recordEngagement(db,{businessId:b.id,kind:'brief_reply',ref:'2026-11-10',now:base});await collectWorkUpdates(new Date(base.getTime()+3600e3),[u.id]);
   expect((await mails(u.id)).filter(m=>m.type==='work_update')).toHaveLength(mode==='fresh'?1:0);
  }
 });
 it('matching suppression stops mail, thrown lookup fails closed, and every actual request is paced',async()=>{
  const {u}=await owner();await collectEducation(base,[u.id]);const sleeps:number[]=[];
  const f=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='GET'?new Response(JSON.stringify({email:u.email,reason:'complaint'})):new Response('{"id":"never"}'));
  await dispatchLifecycleBatch({now:base,userIds:[u.id],fetch:f as any,sleep:async(ms)=>{sleeps.push(ms);},clock:()=>base});expect(posts(f)).toHaveLength(0);expect((await enrollment(u.id)).status).toBe('blocked');expect(sleeps).toEqual([125]);
  const {u:v}=await owner();await collectEducation(base,[v.id]);const outage=vi.fn(async()=>{throw Error('simulated local outage');});await send(base,outage);expect((await mails(v.id))[0].attempts).toBe(0);
  const {u:w}=await owner();await collectEducation(base,[w.id]);const calls:number[]=[];const ok=fake();await dispatchLifecycleBatch({now:base,userIds:[w.id],fetch:ok as any,sleep:async(ms)=>{calls.push(ms);},clock:()=>base});expect(ok).toHaveBeenCalledTimes(2);expect(calls).toEqual([125,125]);
 });
 it('blocks expired/ambiguous lessons and never starts another key; simulated delivery never advances',async()=>{
  const {u}=await owner();await collectEducation(base,[u.id]);await db.update(M).set({firstAttemptAt:new Date(base.getTime()-24*3600e3),attempts:1}).where(eq(M.userId,u.id));const f=await send(base);expect(posts(f)).toHaveLength(0);expect((await enrollment(u.id)).status).toBe('blocked');await collectEducation(new Date(base.getTime()+30*day),[u.id]);expect(await mails(u.id)).toHaveLength(1);
  const {u:v}=await owner();await collectEducation(base,[v.id]);env.devStubs=true;const no=await send(base);expect(no).not.toHaveBeenCalled();expect((await enrollment(v.id)).nextLesson).toBe(0);expect((await mails(v.id))[0].status).toBe('logged');
 });

 it('rolls back acceptance atomically if progression fails, then reuses identical request on retry',async()=>{
  const {u}=await owner();await collectEducation(base,[u.id]);const f=fake();
  await pool.query("CREATE OR REPLACE FUNCTION qa_education_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = '"+u.id+"'::uuid AND NEW.next_lesson = 1 THEN RAISE EXCEPTION 'QA injected acknowledgment transaction failure'; END IF; RETURN NEW; END $$");
  await pool.query('CREATE TRIGGER qa_education_ack_failure BEFORE UPDATE ON education_enrollments FOR EACH ROW EXECUTE FUNCTION qa_education_reject()');
  try{await send(base,f);expect((await mails(u.id))[0].status).toBe('queued');expect((await enrollment(u.id)).nextLesson).toBe(0);expect((await enrollment(u.id)).pendingEmailId).not.toBeNull();}
  finally{await pool.query('DROP TRIGGER qa_education_ack_failure ON education_enrollments');await pool.query('DROP FUNCTION qa_education_reject()');}
  await send(new Date(base.getTime()+60e3),f);expect(posts(f)).toHaveLength(2);expect(posts(f)[0][1].body).toBe(posts(f)[1][1].body);expect(posts(f)[0][1].headers['Idempotency-Key']).toBe(posts(f)[1][1].headers['Idempotency-Key']);expect((await enrollment(u.id)).nextLesson).toBe(1);
 });
 it('prequeued due education wins a shared slot over a competing work update',async()=>{
  const {u,b}=await owner();const at=new Date(base.getTime()+3600e3);
  await db.insert(schema.briefDays).values({businessId:b.id,date:'2026-11-10',scannedAt:base.toISOString(),items:[{id:'qa-priority',kind:'reply',st:'open',plat:'reddit',url:'https://reddit.com/r/test/comments/qa',title:'Relevant'}]});await recordEngagement(db,{businessId:b.id,kind:'brief_reply',ref:'2026-11-10',now:base});await collectWorkUpdates(at,[u.id]);expect((await mails(u.id)).filter(m=>m.type==='work_update')).toHaveLength(1);
  await collectEducation(at,[u.id]);const f=await send(at);expect(posts(f)).toHaveLength(1);expect((await enrollment(u.id)).nextLesson).toBe(1);expect((await mails(u.id)).find(m=>m.type==='work_update')?.attempts).toBe(0);
 });

 it('daily work for a full week cannot keep consuming the next due education slot',async()=>{
  const {u,b}=await owner();await collectEducation(base,[u.id]);await send(base);
  const work=async(n:number,collectAt:Date)=>{const occurred=new Date(base.getTime()+n*day-3600e3),date=occurred.toISOString().slice(0,10);await db.insert(schema.briefDays).values({businessId:b.id,date,scannedAt:occurred.toISOString(),items:[{id:'qa-week-'+n,kind:'reply',st:'open',plat:'reddit',url:'https://reddit.com/r/test/comments/qa',title:'Relevant'}]});await recordEngagement(db,{businessId:b.id,kind:'brief_reply',ref:date,now:occurred});await collectWorkUpdates(collectAt,[u.id]);};
  for(let n=1;n<=6;n++){const at=new Date(base.getTime()+n*day+3600e3);vi.setSystemTime(at);await work(n,at);await collectEducation(at,[u.id]);const f=await send(at);expect(posts(f)).toHaveLength(1);expect((await enrollment(u.id)).nextLesson).toBe(1);}
  const due=new Date(base.getTime()+7*day);vi.setSystemTime(due);await collectEducation(due,[u.id]);const pending=(await enrollment(u.id)).pendingEmailId!;expect((await mails(u.id)).find(m=>m.id===pending)?.nextAttemptAt.getTime()).toBe(due.getTime()+3600e3);
  const slot=new Date(due.getTime()+3600e3);vi.setSystemTime(slot);await work(7,slot);const f=await send(slot);expect(posts(f)).toHaveLength(1);expect((await enrollment(u.id)).nextLesson).toBe(2);expect((await mails(u.id)).find(m=>m.type==='work_update'&&m.status==='queued')?.attempts).toBe(0);
  const attempts=(await mails(u.id)).filter(m=>m.firstAttemptAt).map(m=>m.firstAttemptAt!.getTime()).sort((a,b)=>a-b);for(let i=1;i<attempts.length;i++)expect(attempts[i]-attempts[i-1]).toBeGreaterThanOrEqual(day);
 });

 it('keeps at least168hours spacing through fall daylight-saving change and sends during local daytime',async()=>{
  const {u,b}=await owner();await db.update(schema.businesses).set({timezone:'America/New_York'}).where(eq(schema.businesses.id,b.id));const first=new Date('2026-10-25T13:00:00Z');vi.setSystemTime(first);await collectEducation(first,[u.id]);await send(first);expect((await enrollment(u.id)).nextLesson).toBe(1);
  const due=new Date('2026-11-01T13:00:00Z');vi.setSystemTime(due);await collectEducation(due,[u.id]);const f=await send(due);expect(posts(f)).toHaveLength(0);const slot=new Date('2026-11-01T14:00:00Z');await send(slot);expect((await enrollment(u.id)).nextLesson).toBe(2);const sent=(await mails(u.id)).map(m=>m.sentAt!.getTime()).sort((a,b)=>a-b);expect(sent[1]-sent[0]).toBe(169*3600e3);
 });

 it('uses native provider enforcement only for the exact bounded restricted_api_key401 capability response',async()=>{
  const {u}=await owner();await collectEducation(base,[u.id]);const sleeps:number[]=[];const f=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='GET'?new Response(JSON.stringify({name:'restricted_api_key',message:'Sending-only API key'}),{status:401}):new Response('{"id":"native-provider-acceptance-not-delivery"}'));
  await dispatchLifecycleBatch({now:base,userIds:[u.id],fetch:f as any,sleep:async(ms)=>{sleeps.push(ms);},clock:()=>base});expect(posts(f)).toHaveLength(1);expect((await enrollment(u.id)).nextLesson).toBe(1);expect(sleeps).toEqual([125,125]);
 });
 it('never falls back for invalid/unknown/unbounded/other-status lookup errors',async()=>{
  for(const [status,body]of [[401,'{"name":"invalid_api_key"}'],[401,'{"name":"restricted_api_key_extra"}'],[401,'{"message":"restricted_api_key"}'],[401,'[]'],[401,'null'],[401,'not JSON'],[401,JSON.stringify({name:'restricted_api_key',extra:'x'.repeat(4096)})],[403,'{"name":"restricted_api_key"}']] as const){const {u}=await owner();await collectEducation(base,[u.id]);const f=vi.fn(async()=>new Response(body,{status}));await send(base,f);expect(posts(f)).toHaveLength(0);expect((await mails(u.id))[0].attempts).toBe(0);expect((await enrollment(u.id)).nextLesson).toBe(0);}
 });
 it('rechecks optout after restricted-key lookup before any provider POST',async()=>{
  const {u}=await owner();await collectEducation(base,[u.id]);const f=vi.fn(async()=>{await updateEducationPreference(u.id,false,base);return new Response('{"name":"restricted_api_key"}',{status:401});});await send(base,f);expect(posts(f)).toHaveLength(0);expect((await mails(u.id))[0].attempts).toBe(0);expect((await enrollment(u.id)).status).toBe('paused');
 });

 it.each(['invoice_paid','welcome'] as const)('keeps transactional %s ahead of optional education',async(type)=>{
  const {u}=await owner();await collectEducation(base,[u.id]);await queueLifecycle(db,{userId:u.id,type,eventKey:'qa-transactional-priority:'+u.id,data:{amountCents:5000},sendAt:base});const f=fake();await dispatchLifecycleBatch({now:base,userIds:[u.id],fetch:f as any,sleep:async()=>{},clock:()=>base,limit:1});expect((await mails(u.id)).find(m=>m.type===type)?.status).toBe('sent');expect((await enrollment(u.id)).nextLesson).toBe(0);
 });

});
