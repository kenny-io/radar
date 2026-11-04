// Independent integration smoke: real Postgres worker slots occupied, local stub lifecycle delivery only.
import {writeFile} from 'node:fs/promises';
import {eq,inArray} from 'drizzle-orm';
import {db,pool,schema} from '@/server/db';
import {Fixtures} from '@/server/testing/fixtures';
import {defineJob,enqueue,startWorker} from '@/server/jobs/queue';
import {queueLifecycle} from '@/server/services/lifecycle/queue';
import {startLifecycleDispatcher} from '@/server/services/lifecycle/worker';
import {env} from '@/server/env';
if(!env.devStubs||!process.env.DATABASE_URL?.includes('127.0.0.1'))throw new Error('Local stub database required');
const F=new Fixtures('qa-capacity-'+Date.now()), jobs:string[]=[],kind='qa.busy.'+Date.now();
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let release!:()=>void;const blocked=new Promise<void>(r=>release=r);
defineJob({kind,run:()=>blocked});
let general:Awaited<ReturnType<typeof startWorker>>|undefined,mail:ReturnType<typeof startLifecycleDispatcher>|undefined;
const evidence:any={environment:'isolated local Postgres, stubs only, no provider calls',checks:[]};
try{
 for(let i=0;i<4;i++)jobs.push(await enqueue(kind,{}, {maxAttempts:1}));
 general=await startWorker({concurrency:4});
 const until=Date.now()+5000;let running=0;
 do{running=(await db.select().from(schema.jobs).where(inArray(schema.jobs.id,jobs))).filter(r=>r.status==='running').length;if(running===4)break;await pause(25);}while(Date.now()<until);
 if(running!==4)throw Error('Did not occupy four real worker slots');
 const u=await F.user();await queueLifecycle(db,{type:'welcome',userId:u.id,eventKey:'qa-capacity:'+u.id,data:{}});
 const started=Date.now();mail=startLifecycleDispatcher();let status='';
 do{status=(await db.select().from(schema.lifecycleEmails).where(eq(schema.lifecycleEmails.userId,u.id)))[0].status;if(status==='logged')break;await pause(25);}while(Date.now()-started<5000);
 running=(await db.select().from(schema.jobs).where(inArray(schema.jobs.id,jobs))).filter(r=>r.status==='running').length;
 evidence.checks.push({name:'mail dispatch while all four general worker slots are occupied',pass:status==='logged'&&running===4,status,runningJobs:running,elapsedMs:Date.now()-started});
 if(status!=='logged'||running!==4)throw Error('Mail waited for general worker capacity');
}finally{
 await mail?.stop();await general?.stop();release();await pause(100);
 await db.delete(schema.jobs).where(inArray(schema.jobs.id,jobs));await F.cleanup();await pool.end();
 await writeFile('.factory/lifecycle-emails/qa/worker-capacity-results.json',JSON.stringify(evidence,null,2));
}
