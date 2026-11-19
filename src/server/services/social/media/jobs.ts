import { defineJob,enqueue } from '@/server/jobs/queue';
import { defineCron } from '@/server/jobs/cron';
import { runMediaGeneration,reconcileMedia,collectMediaCache } from './index';
defineJob<{generationId:string}>({kind:'social.media',maxAttempts:3,timeoutMs:35*60e3,backoffMs:()=>30000,run:ctx=>runMediaGeneration(ctx.businessId!,ctx.payload.generationId)});
defineCron('social.media',async()=>{await reconcileMedia();});
defineJob({kind:'social.media.cache',maxAttempts:2,timeoutMs:6*60e3,run:async()=>{await collectMediaCache(AbortSignal.timeout(4*60e3));return {cleaned:true};}});
defineCron('social.media.cache',async now=>{if(now.getUTCMinutes()===17)await enqueue('social.media.cache',{}, {singletonKey:'social.media.cache',maxAttempts:2});});
