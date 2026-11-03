import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { Fixtures } from '@/server/testing/fixtures';
import { defaultProfile } from '@/server/workspace';
import { enqueueScan } from '@/server/services/brief/jobs';
import { getJob, runJobNow } from '@/server/jobs/queue';
import { withDay } from '@/server/services/brief/store';
import { updateEngagementPreferences } from '@/server/services/lifecycle/preferences';
import { collectWorkUpdates } from '@/server/services/lifecycle/engagement';
const F=new Fixtures('engagement-independent-hooks'), now=new Date('2026-11-04T12:00:00Z'), day='2026-11-04';
const prior=env.devStubs;
const events=(uid:string)=>db.select().from(schema.engagementEvents).where(eq(schema.engagementEvents.userId,uid));
async function owner(platforms:string[]=['reddit']){
 const user=await F.user();await F.account(user.id,{comp:true});
 const profile=defaultProfile('hook-fixture.test');profile.business={...profile.business,name:'Fieldnote',description:'Time tracking and invoicing for freelance designers.',offerings:['Time tracking','Project invoices'],industry:'Productivity software',differentiators:['Tracks calendar time']};profile.audience={segments:['Freelance designers'],buyers:['Studio owner'],needs:['Bill accurately'],competitors:['Other timers']};profile.keywords={list:[{kw:'time tracking for designers',priority:true} as any,{kw:'scope creep'} as any]};
 const business=await F.biz(user,{profile});await db.update(schema.businesses).set({timezone:'UTC',briefSettings:{platforms,time:'06:00',mention:'relevant',accounts:['founder']}}).where(eq(schema.businesses.id,business.id));
 await updateEngagementPreferences(user.id,{dailyBrief:true},new Date(now.getTime()-864e5));return {user,business};
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);env.devStubs=true;process.env.RADAR_BILLING='on';});afterEach(()=>{vi.useRealTimers();env.devStubs=prior;delete process.env.BRIEF_STUB_FAIL;});afterAll(()=>F.cleanup());
describe('independent real brief-job source hook with billing enabled',()=>{
 it('captures one successful initial run, not a rescan, and a copied/reopened reply never revives the reminder',async()=>{
  const {user,business}=await owner();
  const first=await enqueueScan(business.id,day,'first');await runJobNow(first);
  expect((await getJob(first))?.status).toBe('done');const initial=await events(user.id);expect(initial).toHaveLength(1);
  expect(initial[0].eligibleAt.toISOString()).toBe('2026-11-04T13:00:00.000Z');expect(initial[0].expiresAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
  const again=await enqueueScan(business.id,day,'again');await runJobNow(again);expect(await events(user.id)).toHaveLength(1);
  await withDay(business.id,day,row=>({items:row.items.map(item=>item.kind==='reply'?{...item,st:'copied'}:item),ret:true}));
  await withDay(business.id,day,row=>({items:row.items.map(item=>item.kind==='reply'?{...item,st:'open'}:item),ret:true}));
  expect((await events(user.id))[0].resolvedReason).toBe('action_taken');
  expect((await collectWorkUpdates(new Date(now.getTime()+3600e3),[user.id])).queued).toBe(0);
 },45000);
 it('does not create a reminder for an empty or handled failed run',async()=>{
  const empty=await owner([]);const emptyJob=await enqueueScan(empty.business.id,day,'first');await runJobNow(emptyJob);expect((await getJob(emptyJob))?.status).toBe('done');expect(await events(empty.user.id)).toHaveLength(0);
  const failed=await owner();process.env.BRIEF_STUB_FAIL='reddit';const failedJob=await enqueueScan(failed.business.id,day,'first');await runJobNow(failedJob);expect((await getJob(failedJob))?.result).toMatchObject({failed:'reddit'});expect(await events(failed.user.id)).toHaveLength(0);
 },45000);
});
