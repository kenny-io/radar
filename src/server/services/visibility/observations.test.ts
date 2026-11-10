import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, pool, schema } from '@/server/db';
import { Fixtures } from '@/server/testing/fixtures';
import { randomUUID } from 'node:crypto';
const transport = vi.hoisted(()=>({ask:vi.fn(),extract:vi.fn()}));
vi.mock('./engines',()=>({askEngine:transport.ask,EngineUnavailable:class extends Error{}}));
vi.mock('@/server/ai',()=>({ai:{run:transport.extract}}));
import { collectOne } from './collect';
import { currentPromptSeries, visibilitySummary } from './history';
const F = new Fixtures(), O = schema.aiObservations, R = schema.aiResults;
async function cell() {
  const u=await F.user(), b=await F.biz(u,{profile:{domain:'fieldnote.test',business:{name:'Fieldnote'},audience:{competitors:[]}}});
  const [p]=await db.insert(schema.aiPrompts).values({businessId:b.id,prompt:'Which software helps a small team?',source:'user'}).returning();
  const [r]=await db.insert(R).values({businessId:b.id,promptId:p.id,engine:'ChatGPT'}).returning();return{u,b,p,r};
}
describe.skipIf(!process.env.DATABASE_URL)('real append-only observation persistence (all model calls mocked)',()=>{
  beforeEach(()=>{transport.ask.mockReset().mockResolvedValue({text:'Fieldnote is a useful product.',cites:['https://fieldnote.test/'],raw:{fake:true}});transport.extract.mockReset().mockResolvedValue({json:{products:['Fieldnote']}});});
  afterAll(()=>F.cleanup());
  it('commits a success and latest result together with a frozen series and exact UTC day',async()=>{
    const {b,p,r}=await cell();const series=await currentPromptSeries(b.id);await db.insert(schema.aiPrompts).values({businessId:b.id,prompt:'Another buyer question?',source:'user'});
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-15T23:59:59Z'));
    try {await collectOne(r.id,{manual:true,series});const [obs]=await db.select().from(O).where(eq(O.businessId,b.id));expect(obs).toMatchObject({promptId:p.id,series,day:'2026-11-15',status:'mentioned',pos:1,measuredAt:new Date('2026-11-15T23:59:59Z')});expect((await db.select().from(R).where(eq(R.id,r.id)))[0]).toMatchObject({status:'mentioned',collectedAt:obs.measuredAt});}
    finally{vi.useRealTimers();}
  });
  it('does not copy a prior success into a later failed UTC day or treat failure as zero visibility',async()=>{
    const {b,r}=await cell();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-14T23:00:00Z'));
    try{await collectOne(r.id,{manual:true});vi.setSystemTime(new Date('2026-11-15T00:01:00Z'));transport.ask.mockRejectedValue(new Error('fake failed collection'));await collectOne(r.id,{manual:true});
      const rows=await db.select().from(O).where(eq(O.businessId,b.id)).orderBy(O.day);expect(rows.map(x=>[x.day,x.status])).toEqual([['2026-11-14','mentioned'],['2026-11-15','not-collected']]);expect((await db.select().from(R).where(eq(R.id,r.id)))[0].status).toBe('mentioned');const summary=await visibilitySummary(b.id,new Date('2026-11-16T12:00:00Z'));expect(summary.weekly.current).toMatchObject({collected:1,mentioned:1,share:1});}
    finally{vi.useRealTimers();}
  });
  it('rolls back the latest success if its observation insert fails rather than recording an unhistoried success',async()=>{
    const {b,r}=await cell();const name='obs_test_'+randomUUID().replace(/-/g,'');const c=await pool.connect();
    try{await c.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fake persistence failure'; END$$`);await c.query(`CREATE TRIGGER ${name} BEFORE INSERT ON ai_observations FOR EACH ROW WHEN (NEW.business_id='${b.id}'::uuid) EXECUTE FUNCTION ${name}()`);
      await expect(collectOne(r.id,{manual:true})).rejects.toMatchObject({cause:expect.objectContaining({message:'fake persistence failure'})});expect((await db.select().from(R).where(eq(R.id,r.id)))[0]).toMatchObject({status:'not-collected',collectedAt:null});expect(await db.select().from(O).where(and(eq(O.businessId,b.id),eq(O.status,'mentioned')))).toHaveLength(0);
    }finally{await c.query(`DROP TRIGGER IF EXISTS ${name} ON ai_observations`);await c.query(`DROP FUNCTION IF EXISTS ${name}()`);c.release();}
  });
});
