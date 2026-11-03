import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { setProviderNameForTests } from '@/server/billing/config';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { updateEngagementPreferences } from '@/server/services/lifecycle/preferences';
import { recordEngagement, collectWorkUpdates } from '@/server/services/lifecycle/engagement';
import { dispatchLifecycleBatch } from '@/server/services/lifecycle/dispatch';
import { withDay } from '@/server/services/brief/store';
import type { LifecyclePayload } from '@/server/services/lifecycle/queue';
const F=new Fixtures('engagement-independent-dispatch'), now=new Date('2026-11-04T12:00:00Z'), hour=3600e3;
const prior={stub:env.devStubs,key:env.resendKey};
const mail=async(uid:string)=>(await db.select().from(schema.lifecycleEmails).where(and(eq(schema.lifecycleEmails.userId,uid),eq(schema.lifecycleEmails.type,'work_update'))))[0];
async function candidate(withBrief=false){
 const u=await F.user();await F.account(u.id,{comp:true});const b=await F.biz(u);await db.update(schema.businesses).set({timezone:'UTC'}).where(eq(schema.businesses.id,b.id));
 await updateEngagementPreferences(u.id,{dailyBrief:true,articleSocial:true},new Date(now.getTime()-48*hour));
 const id='qa-dispatch-'+u.id;
 await db.insert(schema.calendarEntries).values({id,businessId:b.id,title:'A useful generated article',kw:'test',type:'guide',date:'2026-11-07',status:'review'});
 await db.insert(schema.articles).values({entryId:id,businessId:b.id,data:{generated:true,body:[['p','A real body']]}});
 await recordEngagement(db,{businessId:b.id,kind:'article_social',ref:id,now:new Date(now.getTime()-2*hour)});
 if(withBrief){await db.insert(schema.briefDays).values({businessId:b.id,date:'2026-11-04',scannedAt:now.toISOString(),items:[{id:'reply-one',kind:'reply',st:'open',plat:'reddit',url:'https://reddit.com/r/test/comments/example'}]});await recordEngagement(db,{businessId:b.id,kind:'brief_reply',ref:'2026-11-04',now:new Date(now.getTime()-hour)});}
 expect((await collectWorkUpdates(now,[u.id])).queued).toBe(1);
 return {u,b,id};
}
const send=(uid:string,fetch:typeof globalThis.fetch,time=now)=>dispatchLifecycleBatch({userIds:[uid],limit:20,now:time,fetch,sleep:async()=>{}});
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);env.devStubs=false;env.resendKey='qa-not-a-real-provider-key';setProviderNameForTests('stub');process.env.RADAR_BILLING='on';});
afterEach(()=>{vi.useRealTimers();env.devStubs=prior.stub;env.resendKey=prior.key;setProviderNameForTests(null);});afterAll(()=>F.cleanup());
describe('independent optional work delivery policy',()=>{
 it('drops an acted-on section immediately before attempt1 and freezes only the remaining action',async()=>{
  const {u,b}=await candidate(true);
  await withDay(b.id,'2026-11-04',row=>({items:row.items.map(item=>({...item,st:'copied'})),ret:true}));
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:'qa-provider-ack'})));
  await send(u.id,fetcher as typeof fetch);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
  expect(body.subject).toBe('Turn your article into social posts');expect(body.html).not.toContain('Daily Brief');
  expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  const saved=await mail(u.id);const stored=decrypt<LifecyclePayload>(saved.payloadEnc)!;
  expect(saved.status).toBe('sent');expect(stored.data.workSections).toHaveLength(1);expect(stored.envelope).toEqual(body);
 });
 it('keeps identical provider body and idempotency key across a rate-limited retry',async()=>{
  const {u}=await candidate();
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:429,headers:{'retry-after':'120'}})).mockResolvedValueOnce(new Response(JSON.stringify({id:'qa-after-rate-limit'})));
  await send(u.id,fetcher);expect((await mail(u.id)).status).toBe('queued');
  await db.update(schema.users).set({name:'Changed after first attempt'}).where(eq(schema.users.id,u.id));
  await send(u.id,fetcher,new Date(now.getTime()+120000));
  expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
  expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(fetcher.mock.calls[0][1].headers['Idempotency-Key']);expect((await mail(u.id)).attempts).toBe(2);
 });
 it('suppresses the whole frozen retry if the expected action was taken after a failed provider attempt',async()=>{
  const {u,b,id}=await candidate(true);
  const fetcher=vi.fn(async()=>new Response('',{status:503}));await send(u.id,fetcher as typeof fetch);
  await db.insert(schema.socialPacks).values({id:'qa-finished-'+u.id,businessId:b.id,data:{source:{kind:'article',ref:id},posts:{x:{text:'Now created'}}}});
  await send(u.id,fetcher as typeof fetch,new Date(now.getTime()+60000));
  expect(fetcher).toHaveBeenCalledTimes(1);expect((await mail(u.id)).status).toBe('suppressed');
 });
 it('suppresses queued work after subscription access ends without changing billing state',async()=>{
  const {u}=await candidate();await F.account(u.id,{comp:false,status:'canceled'});
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:'must-not-send'})));
  await send(u.id,fetcher as typeof fetch);
  expect(fetcher).not.toHaveBeenCalled();expect((await mail(u.id)).status).toBe('suppressed');
  const [account]=await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId,u.id));
  expect(account.comp).toBe(false);expect(account.status).toBe('canceled');
 });
 it('defers a queued reminder without a provider attempt when another optional message used the daily cap',async()=>{
  const {u}=await candidate();
  await db.insert(schema.lifecycleEmails).values({userId:u.id,type:'founder_note',eventKey:'qa-delivery-founder-'+u.id,payloadEnc:'unused',status:'sent',providerId:'qa-founder',nextAttemptAt:now,expiresAt:new Date(now.getTime()+48*hour),firstAttemptAt:new Date(now.getTime()-hour),sentAt:new Date(now.getTime()-hour)});
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:'should-not-send'})));
  await send(u.id,fetcher as typeof fetch);
  const row=await mail(u.id);expect(fetcher).not.toHaveBeenCalled();expect(row.status).toBe('queued');expect(row.attempts).toBe(0);expect(row.nextAttemptAt.toISOString()).toBe(new Date(now.getTime()+23*hour).toISOString());
 });
});
