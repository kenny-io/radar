import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { Fixtures } from '@/server/testing/fixtures';
import { sendMail } from '../mail';
import { deliverHandoff, type HandoffPayload } from '../autopilot/handoff';
import { PermanentJobError, type JobCtx } from '@/server/jobs/queue';
import { getBiz } from '@/server/workspace';
import { recordEngagement, collectWorkUpdates } from './engagement';
import { dispatchLifecycleBatch } from './dispatch';
import { actions as calendarActions } from '@/server/actions/calendar';
const F = new Fixtures(), recipients: string[] = [];
const prior = { stub: env.devStubs, key: env.resendKey, billing: process.env.RADAR_BILLING };
const now = new Date('2026-11-10T12:00:00Z');
const rows = (email: string) => db.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.to, email));
async function owner() { const u=await F.user(); recipients.push(u.email); const b=await F.biz(u); await db.update(schema.businesses).set({timezone:'UTC'}).where(eq(schema.businesses.id,b.id)); return {u,b}; }
async function master(bid: string, on: boolean, activationId='main-integration-activation') { await db.update(schema.businesses).set({autopilot:{enabled:on,activationId,enabledAt:now.toISOString()}}).where(eq(schema.businesses.id,bid)); }
async function handoff() {
  const {u,b}=await owner(); await master(b.id,true);
  const ctx: JobCtx<HandoffPayload>={ businessId:b.id,payload:{activationId:'main-integration-activation',ownerId:u.id,name:'Private business',items:[{key:'reply',title:'Review a reply',reason:'Replies need you',href:env.appUrl+'/brief',text:'Private saved reply',sourceUrl:'https://example.com/thread'}]},attempt:1,job:{id:randomUUID(),maxAttempts:4} as any,progress:async()=>{},touch:async()=>{} };
  return {u,b,ctx};
}
describe.skipIf(!process.env.DATABASE_URL)('deployed Autopilot and lifecycle integration (fake mail only)',()=>{
  beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);env.devStubs=false;env.resendKey='not-a-real-key';process.env.RADAR_BILLING='off';});
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();env.devStubs=prior.stub;env.resendKey=prior.key;});
  afterAll(async()=>{if(prior.billing===undefined)delete process.env.RADAR_BILLING;else process.env.RADAR_BILLING=prior.billing;await F.cleanup();if(recipients.length)await db.delete(schema.outboxEmails).where(inArray(schema.outboxEmails.to,recipients));});
  it('retries the same recipient inside the window using the original body, subject and provider key',async()=>{
    const {u}=await owner(), key='integration:'+u.id;
    const fake=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response('{"id":"accepted"}'));vi.stubGlobal('fetch',fake);
    await expect(sendMail(u.email,'Original subject','Original private text','<p>Original</p>',{idempotencyKey:key})).rejects.toThrow();
    await db.update(schema.outboxEmails).set({createdAt:new Date(now.getTime()-3600e3)}).where(eq(schema.outboxEmails.to,u.email));
    await sendMail(u.email,'Changed subject','Changed text','<p>Changed</p>',{idempotencyKey:key});
    expect(fake).toHaveBeenCalledTimes(2);expect(fake.mock.calls[0][1].body).toBe(fake.mock.calls[1][1].body);expect(fake.mock.calls[0][1].headers['Idempotency-Key']).toBe(key);
    expect(await rows(u.email)).toHaveLength(1);expect((await rows(u.email))[0]).toMatchObject({subject:'Original subject',text:'Original private text',status:'sent'});
  });
  it('blocks an unsent idempotent row at exactly23hours without another POST or key/body change',async()=>{
    const {u}=await owner(), key='expired:'+u.id,fake=vi.fn(async()=>new Response('',{status:503}));vi.stubGlobal('fetch',fake);
    await expect(sendMail(u.email,'Original','Private',undefined,{idempotencyKey:key})).rejects.toThrow();
    await db.update(schema.outboxEmails).set({createdAt:new Date(now.getTime()-23*3600e3)}).where(eq(schema.outboxEmails.to,u.email));
    await expect(sendMail(u.email,'Changed','Changed',undefined,{idempotencyKey:key})).rejects.toMatchObject({code:'mail_retry_expired'});expect(fake).toHaveBeenCalledTimes(1);expect((await rows(u.email))[0].text).toBe('Private');
  });
  it('keeps sent/logged short circuits harmless even after age and requested recipient change',async()=>{
    const {u}=await owner(), key='sent:'+u.id,fake=vi.fn(async()=>new Response('{"id":"accepted"}'));vi.stubGlobal('fetch',fake);
    await sendMail(u.email,'Sent','Accepted content',undefined,{idempotencyKey:key});
    await db.update(schema.outboxEmails).set({createdAt:new Date(now.getTime()-40*864e5)}).where(eq(schema.outboxEmails.to,u.email));
    await sendMail('new-mailbox@test.local','Changed','New content',undefined,{idempotencyKey:key});expect(fake).toHaveBeenCalledTimes(1);
    await db.update(schema.outboxEmails).set({status:'logged'}).where(eq(schema.outboxEmails.to,u.email));await sendMail('another@test.local','Changed','New content',undefined,{idempotencyKey:key});expect(fake).toHaveBeenCalledTimes(1);
  });
  it('refuses unverified handoff owners before creating a mail row or calling a provider',async()=>{
    const {u,ctx}=await handoff();await db.update(schema.users).set({emailVerifiedAt:null}).where(eq(schema.users.id,u.id));const fake=vi.fn();vi.stubGlobal('fetch',fake);
    expect(await deliverHandoff(ctx)).toEqual({skipped:'unverified_owner'});expect(fake).not.toHaveBeenCalled();expect(await rows(u.email)).toHaveLength(0);
  });
  it('turns stale-recipient and expired handoff retries into controlled permanent failures',async()=>{
    const {u,b,ctx}=await handoff(),fake=vi.fn(async()=>new Response('',{status:503}));vi.stubGlobal('fetch',fake);await expect(deliverHandoff(ctx)).rejects.toThrow();
    const newEmail='changed-'+u.email;recipients.push(newEmail);await db.update(schema.users).set({email:newEmail,emailVerifiedAt:now}).where(eq(schema.users.id,u.id));
    await expect(deliverHandoff({...ctx,attempt:2})).rejects.toBeInstanceOf(PermanentJobError);expect(fake).toHaveBeenCalledTimes(1);expect((await getBiz(b.id)).autopilot.lastError).toContain('email address changed');expect((await rows(u.email))[0].text).toContain('Private saved reply');
    await db.update(schema.users).set({email:u.email}).where(eq(schema.users.id,u.id));await db.update(schema.outboxEmails).set({createdAt:new Date(now.getTime()-23*3600e3)}).where(eq(schema.outboxEmails.to,u.email));
    await expect(deliverHandoff({...ctx,attempt:3})).rejects.toBeInstanceOf(PermanentJobError);expect(fake).toHaveBeenCalledTimes(1);expect((await getBiz(b.id)).autopilot.lastError).toContain('retry window expired');
  });
  it('does not capture delegated work and suppresses work captured before master activation',async()=>{
    const {u,b}=await owner(),id='article-'+u.id;await db.insert(schema.calendarEntries).values({id,businessId:b.id,title:'A real article',kw:'topic',type:'Guide',date:'2026-11-10',status:'review'});await db.insert(schema.articles).values({entryId:id,businessId:b.id,data:{generated:true,body:[['p','Saved article']]}});
    await master(b.id,true);await recordEngagement(db,{businessId:b.id,kind:'article_social',ref:id,now:new Date(now.getTime()-3*3600e3)});expect(await db.select().from(schema.engagementEvents).where(eq(schema.engagementEvents.userId,u.id))).toHaveLength(0);
    await master(b.id,false);await recordEngagement(db,{businessId:b.id,kind:'article_social',ref:id,now:new Date(now.getTime()-3*3600e3)});expect((await collectWorkUpdates(now,[u.id])).queued).toBe(1);
    await master(b.id,true);const fake=vi.fn();await dispatchLifecycleBatch({userIds:[u.id],now,fetch:fake,sleep:async()=>{}});expect(fake).not.toHaveBeenCalled();
    const [mail]=await db.select().from(schema.lifecycleEmails).where(and(eq(schema.lifecycleEmails.userId,u.id),eq(schema.lifecycleEmails.type,'work_update')));expect(mail.status).toBe('suppressed');
  });
  it('manual calendar adoption clears Autopilot provenance and resolves the captured reminder atomically',async()=>{
    const {u,b}=await owner(),id='topic-'+u.id,generatedAt=new Date(now.getTime()-25*3600e3);await db.update(schema.businesses).set({calendarGeneratedAt:generatedAt}).where(eq(schema.businesses.id,b.id));await db.insert(schema.calendarEntries).values({id,businessId:b.id,title:'A saved topic',kw:'topic',type:'Guide',date:'2026-11-10',status:'proposed',autopilotActivationId:'old-activation'});
    await recordEngagement(db,{businessId:b.id,kind:'calendar_review',ref:generatedAt.toISOString(),entryIds:[id],now:generatedAt});
    await calendarActions['calendar.approve'].run({user:{...u,appearance:'system'},bid:b.id,role:'Owner',biz:await getBiz(b.id)} as any,{entryId:id});
    const [entry]=await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id,id));expect(entry).toMatchObject({status:'approved',autopilotActivationId:null});
    const [event]=await db.select().from(schema.engagementEvents).where(eq(schema.engagementEvents.userId,u.id));expect(event.resolvedReason).toBe('action_taken');expect(event.resolvedAt).not.toBeNull();
  });
});
