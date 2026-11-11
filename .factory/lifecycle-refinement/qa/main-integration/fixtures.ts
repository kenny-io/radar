import {eq} from 'drizzle-orm';
import {vi} from 'vitest';
import {db,schema} from '@/server/db';
import {Fixtures} from '@/server/testing/fixtures';
import {dispatchLifecycleBatch} from '@/server/services/lifecycle/dispatch';
import {decrypt} from '@/server/crypto';
import type {LifecyclePayload} from '@/server/services/lifecycle/queue';
export const BASE=new Date('2026-11-10T12:00:00Z'),DAY=864e5;
export function requireLocalDatabase(){if(!process.env.DATABASE_URL?.endsWith('/radar_lc2_main_integration_qa_20261110'))throw Error('Fresh LC2 QA database required');}
export const messages=(uid:string)=>db.select().from(schema.lifecycleEmails).where(eq(schema.lifecycleEmails.userId,uid));
export const payload=(row:typeof schema.lifecycleEmails.$inferSelect)=>decrypt<LifecyclePayload>(row.payloadEnc)!;
export const fakeProvider=()=>vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='GET'?new Response('',{status:404}):new Response('{"id":"qa-provider-acceptance-not-inbox"}'));
export const posts=(fetcher:ReturnType<typeof fakeProvider>)=>fetcher.mock.calls.filter(([,init])=>init?.method==='POST');
export const dispatch=(ids:string[],at=BASE,fetcher=fakeProvider())=>dispatchLifecycleBatch({userIds:ids,now:at,clock:()=>at,fetch:fetcher as typeof fetch,sleep:async()=>{}});
export async function owner(F:Fixtures){const u=await F.user();await F.account(u.id,{comp:true});const b=await F.biz(u);await db.update(schema.businesses).set({timezone:'UTC'}).where(eq(schema.businesses.id,b.id));return {u,b};}
