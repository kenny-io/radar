import { afterAll, expect, it, vi } from 'vitest';
const H=vi.hoisted(()=>{process.env.RADAR_DEV_STUBS='1';return {jar:new Map<string,string>()};});
vi.mock('next/headers',async()=>(await import('@/server/testing/jar')).headersMock(()=>H.jar));
import {db,schema} from '@/server/db';
import {eq} from 'drizzle-orm';
import {Fixtures} from '@/server/testing/fixtures';
import {hashPassword} from '@/server/auth/session';
import {finishAuth} from '@/server/auth/claim';
const F=new Fixtures('independent-qa-stale-'+Date.now());
afterAll(()=>F.cleanup());
it('rejecting an obsolete password proof must leave both account and guest drafts unchanged',async()=>{
 const oldHash=await hashPassword('old-password');
 const user=await F.user({password:oldHash});
 const own=await F.biz(user,{status:'onboarding'});
 const guest=await F.user({guest:true});
 const incoming=await F.biz(guest,{status:'onboarding'});
 await F.signIn(guest,H.jar);
 await db.update(schema.users).set({passwordHash:await hashPassword('new-password')}).where(eq(schema.users.id,user.id));
 await expect(finishAuth(user,undefined,oldHash)).rejects.toMatchObject({code:'invalid_credentials'});
 const original=(await db.select().from(schema.businesses).where(eq(schema.businesses.id,own.id)))[0];
 const moved=(await db.select().from(schema.businesses).where(eq(schema.businesses.id,incoming.id)))[0];
 expect({originalExists:!!original,incomingOwner:moved?.ownerId,guestExists:!!(await db.select().from(schema.users).where(eq(schema.users.id,guest.id)))[0]})
 .toEqual({originalExists:true,incomingOwner:guest.id,guestExists:true});
});
