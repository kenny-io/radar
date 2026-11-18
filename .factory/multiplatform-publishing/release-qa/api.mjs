import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {request} from 'playwright';
const output='.factory/multiplatform-publishing/release-qa',runtime='.data/multiplatform-release-qa',base='http://localhost:3841';
const fixture=JSON.parse(await fs.readFile(runtime+'/fixture.json','utf8')),env=JSON.parse(await fs.readFile(runtime+'/local-env.json','utf8'));
const db=new pg.Pool({connectionString:env.DATABASE_URL});const results=[];
const check=async(name,fn)=>{try{results.push({name,pass:true,detail:await fn()})}catch(e){results.push({name,pass:false,error:e.stack})}console.log(JSON.stringify(results.at(-1)))};
const clients={};for(const role of ['Owner','Viewer','Outsider','Anonymous'])clients[role]=await request.newContext({baseURL:base,extraHTTPHeaders:role==='Anonymous'?{}:{cookie:`radar_session=${fixture.sessions[role]}; radar_biz=${fixture.businessId}`}});
const source=(await db.query('SELECT data FROM social_packs WHERE id=$1',[fixture.packId])).rows[0].data;
const packId='qa-upload-security-'+crypto.randomUUID();await db.query('INSERT INTO social_packs(id,business_id,data) VALUES($1,$2,$3)',[packId,fixture.businessId,{...source,id:packId}]);
const upload=async(role,buffer,mimeType='video/mp4',extra={})=>clients[role].post(`/api/b/${fixture.businessId}/social-video`,{multipart:{packId,platform:'youtube',file:{name:'qa-video.mp4',mimeType,buffer}},...extra});
const bytes=await fs.readFile(runtime+'/fixture.mp4');
try{
for(const [role,status] of [['Anonymous',401],['Viewer',403],['Outsider',404]])await check('AC5 '+role+' video upload denied before storage',async()=>{const r=await upload(role,bytes);assert.equal(r.status(),status);return{status:r.status()}});
await check('AC5 Foreign Origin upload refused',async()=>{const r=await upload('Owner',bytes,'video/mp4',{headers:{origin:'https://untrusted.example'}});assert.equal(r.status(),403);return{status:r.status()}});
await check('AC5 Forged MP4 and HEIC MIME cannot masquerade as video',async()=>{for(const body of [Buffer.from('This is not a video'),Buffer.from('000000186674797068656963000000006d69663168656963','hex'),Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex')]){const r=await upload('Owner',body);assert.equal(r.status(),400);assert.equal((await r.json()).code,'invalid_video')}return{invalidFilesRejected:3}});
await check('AC5 Sniff actual MP4 despite forged browser MIME; metadata persists',async()=>{const r=await upload('Owner',bytes,'image/png');assert.equal(r.status(),200);const j=await r.json();assert.equal(j.video.meta.type,'video/mp4');assert.equal(j.video.meta.bytes,bytes.length);assert(j.video.durationSec>1);const data=(await db.query('SELECT data FROM social_packs WHERE id=$1',[packId])).rows[0].data;assert(data.posts.youtube.video.url.includes(fixture.businessId));return{realMime:j.video.meta.type,duration:j.video.durationSec}});
await check('AC5 Foreign pack and foreign account ids refused',async()=>{const r=await clients.Owner.post(`/api/b/${fixture.businessId}/social-video`,{multipart:{packId:fixture.foreignPackId,platform:'youtube',file:{name:'qa.mp4',mimeType:'video/mp4',buffer:bytes}}});assert.equal(r.status(),404);const c=await clients.Owner.post(`/api/b/${fixture.businessId}/act`,{data:{action:'social.tiktokCreatorInfo',input:{acctId:crypto.randomUUID()}}});assert.equal(c.status(),404);return{foreignPack:r.status(),foreignAccount:c.status()}});
}finally{for(const c of Object.values(clients))await c.dispose();await db.end();await fs.writeFile(output+'/api-results.json',JSON.stringify({at:new Date().toISOString(),results},null,2))}
process.exitCode=results.some(r=>!r.pass)?1:0;
