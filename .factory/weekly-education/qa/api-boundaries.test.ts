import { afterAll,beforeEach,describe,expect,it,vi } from 'vitest';
const H=vi.hoisted(()=>({jar:new Map<string,string>()}));
vi.mock('next/headers',async()=>(await import('@/server/testing/jar')).headersMock(()=>H.jar));
import { GET as get,PATCH as patch } from '@/app/api/me/education-preferences/route';
import { GET as learn } from '@/app/email/learn/route';
import { POST as unsubscribe } from '@/app/api/email-preferences/route';
import { db,schema } from '@/server/db';
import { eq } from 'drizzle-orm';
import { Fixtures } from '@/server/testing/fixtures';
import { env } from '@/server/env';
import { educationAllowed,educationPreferenceToken,educationPreferenceUser,preferenceToken,workPreferenceToken,updateEngagementPreferences,getEngagementPreferences,onboardingAllowed } from '@/server/services/lifecycle/preferences';
const F=new Fixtures('education-api-independent');const request=(path:string,data:any,headers:Record<string,string>={})=>new Request(new URL(path,env.appUrl),{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
beforeEach(()=>{H.jar.clear();process.env.RADAR_BILLING='on';env.devStubs=true;});afterAll(()=>F.cleanup());
describe('independent preference and landing access boundaries',()=>{
 it('requires ordinary session, validates exact boolean keys, enforces origin and changes only self',async()=>{
  expect((await get()).status).toBe(401);const u=await F.user(),other=await F.user();await F.signIn(u,H.jar);
  const result=await get();expect(result.headers.get('cache-control')).toBe('private, no-store');expect(await result.json()).toEqual({education:true});
  for(const data of [{education:'false'},{education:false,userId:other.id},{}, {education:false,extra:'x'.repeat(9000)}])expect((await patch(request('/api/me/education-preferences',data))).status).toBeGreaterThanOrEqual(400);
  expect((await patch(request('/api/me/education-preferences',{education:false},{origin:'https://evil.test'}))).status).toBe(403);
  expect((await patch(request('/api/me/education-preferences',{education:false}))).status).toBe(200);expect(await educationAllowed(u.id)).toBe(false);expect(await educationAllowed(other.id)).toBe(true);
 });
 it('education token is purpose scoped and signed; oneclick only disables education',async()=>{
  const u=await F.user();await updateEngagementPreferences(u.id,{dailyBrief:true,articleSocial:true,calendarReminders:true});const token=educationPreferenceToken(u.id);
  expect(educationPreferenceUser(token)).toBe(u.id);for(const bad of [token+'x',token.replace('.education.','.work.'),preferenceToken(u.id),workPreferenceToken(u.id)])expect(educationPreferenceUser(bad)).toBeNull();
  const path='/api/email-preferences?token='+encodeURIComponent(token);const form=(data:string)=>new Request(new URL(path,env.appUrl),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:data});
  expect((await unsubscribe(form('List-Unsubscribe=One-Click&education=true'))).status).toBe(400);expect(await educationAllowed(u.id)).toBe(true);
  expect((await unsubscribe(form('List-Unsubscribe=One-Click'))).status).toBe(200);expect(await educationAllowed(u.id)).toBe(false);expect(await onboardingAllowed(u.id)).toBe(true);expect(Object.values(await getEngagementPreferences(u.id)).every(Boolean)).toBe(true);
 });
 it('rejects duplicate/unknown landing keys and unauthorized business before cookie writes',async()=>{
  const u=await F.user(),other=await F.user();await F.account(u.id,{comp:true});const b=await F.biz(u),foreign=await F.biz(other);await F.signIn(u,H.jar);H.jar.set('radar_biz',b.id);
  const go=(q:string)=>learn(new Request(new URL('/email/learn?'+q,env.appUrl)));
  for(const q of ['lesson=ai_visibility&lesson=daily_brief','lesson=daily_brief&next=https://evil.test','lesson=nope','lesson=daily_brief&businessId=bad'])expect((await go(q)).status).toBeGreaterThanOrEqual(400);
  expect((await go('lesson=daily_brief&businessId='+foreign.id)).status).toBe(404);expect(H.jar.get('radar_biz')).toBe(b.id);
  await F.member(foreign.id,u,'Viewer');expect((await go('lesson=daily_brief&businessId='+foreign.id)).status).toBe(404);expect(H.jar.get('radar_biz')).toBe(b.id);
  const ok=await go('lesson=ai_visibility&businessId='+b.id);expect(ok.status).toBe(303);expect(ok.headers.get('cache-control')).toBe('private, no-store');expect(ok.headers.get('referrer-policy')).toBe('no-referrer');expect(ok.headers.get('location')).toContain('performance');
 });
 it('access-lost and draft targets enter normal gates without choosing the addressed business',async()=>{
  const u=await F.user();await F.account(u.id,{status:'canceled',stripeSubscriptionId:'sub_local'});const b=await F.biz(u);await F.signIn(u,H.jar);const before=H.jar.get('radar_biz');const response=await learn(new Request(new URL('/email/learn?lesson=backlinks&businessId='+b.id,env.appUrl)));expect(response.status).toBe(303);expect(new URL(response.headers.get('location')!).pathname).toBe('/start-trial');expect(H.jar.get('radar_biz')).toBe(before);
 });
});
