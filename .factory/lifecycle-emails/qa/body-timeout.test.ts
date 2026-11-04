import {expect,it} from 'vitest';
import http from 'node:http';
import {eq} from 'drizzle-orm';
import {db,schema} from '@/server/db';
import {env} from '@/server/env';
import {Fixtures} from '@/server/testing/fixtures';
import {queueLifecycle} from '@/server/services/lifecycle/queue';
import {dispatchLifecycleBatch} from '@/server/services/lifecycle/dispatch';

it('bounds a real provider response whose JSON body stalls after HTTP200 headers',async()=>{
 const F=new Fixtures('qa-body-timeout-'+Date.now());
 const prior={key:env.resendKey,stub:env.devStubs};
 const server=http.createServer((req,res)=>{req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.write('{"id":');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  env.devStubs=false;env.resendKey='fake-local-provider-only';
  const user=await F.user();
  await queueLifecycle(db,{type:'welcome',userId:user.id,eventKey:'body-timeout:'+user.id,data:{}});
  const addr=server.address() as {port:number};const started=Date.now();
  await dispatchLifecycleBatch({limit:1,userIds:[user.id],sleep:async()=>{},fetch:async(_url,init)=>fetch(`http://127.0.0.1:${addr.port}`,init)});
  const elapsed=Date.now()-started;
  const [row]=await db.select().from(schema.lifecycleEmails).where(eq(schema.lifecycleEmails.userId,user.id));
  expect(elapsed).toBeGreaterThanOrEqual(9500);expect(elapsed).toBeLessThan(14000);
  expect(row.status).toBe('queued');expect(row.providerId).toBeNull();expect(row.attempts).toBe(1);
 }finally{env.resendKey=prior.key;env.devStubs=prior.stub;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await F.cleanup();}
},20000);
