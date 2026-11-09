import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base='https://radar.thally.io',out='.factory/reddit-copy-redirect/qa',results=[],errors=[];
const sha=data=>createHash('sha256').update(data).digest('hex');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const p=await c.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));
async function check(name,fn){try{results.push({name,pass:true,detail:await fn()});}catch(e){results.push({name,pass:false,error:e.stack});}console.log(JSON.stringify(results.at(-1)));}
try {
 await check('Production database readiness health',async()=>{const r=await c.request.get(base+'/api/health');assert.equal(r.status(),200);const j=await r.json();assert.deepEqual(j,{ok:true});return{status:r.status(),json:j};});
 for(const path of ['/','/features/daily-brief','/signin'])await check('Production public browser '+path,async()=>{const r=await p.goto(base+path,{waitUntil:'domcontentloaded'});assert(r&&r.status()===200);await p.locator('body').waitFor();await p.waitForTimeout(700);const text=await p.locator('body').innerText();assert(text.trim().length>100);assert(!/Internal Server Error|Application error: a client-side exception/i.test(text));await p.screenshot({path:out+'/release-live-'+(path==='/'?'home':path.replaceAll('/','-').slice(1))+'.png',fullPage:false});return{status:r.status(),url:p.url(),title:await p.title(),headings:await p.locator('h1').allTextContents()};});
 await check('Unauthenticated production Daily Brief respects authentication',async()=>{await p.goto(base+'/brief',{waitUntil:'domcontentloaded'});assert(/\/(signin|signup)(?:\?|$)/.test(p.url()));return{url:p.url(),authenticatedFunctionalFlow:'not run: no existing authenticated session available to QA browser'};});
 await check('Production serves the exact release DailyBrief client bundle',async()=>{const manifest=JSON.parse(await fs.readFile('.next/app-build-manifest.json','utf8'));const assets=manifest.pages['/(app)/brief/page'];const path=process.env.RADAR_RELEASE_BRIEF_ASSET||assets.find(x=>x.includes('/brief/page-'));assert(path);const r=await c.request.get(base+'/_next/'+path);assert.equal(r.status(),200);const body=await r.text();const markers=['Try copying again before opening Reddit.','#comments','Copy reply','clipboard'];for(const marker of markers)assert(body.includes(marker),marker);const local=await fs.readFile('.next/'+path,'utf8');assert.equal(sha(body),sha(local));return{status:r.status(),path,sha256:sha(body),markers};});
 await check('No production browser runtime exceptions',async()=>{assert.deepEqual(errors,[]);return{errors};});
}finally{await browser.close();}
const record={at:new Date().toISOString(),base,releaseSha:process.env.RADAR_RELEASE_SHA||null,environment:'fresh unauthenticated Chrome context; no account creation, production business mutations, AI calls or external posts',results};await fs.writeFile(out+'/release-live-results.json',JSON.stringify(record,null,2));process.exitCode=results.some(x=>!x.pass)?1:0;
