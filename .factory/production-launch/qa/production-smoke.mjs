import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.QA_BASE||'http://localhost:3901',out='.data/production-launch/qa';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c=await b.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),p=await c.newPage();const errors=[],failures=[],results=[];
p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)failures.push({path:new URL(r.url()).pathname,status:r.status()});});
const startedAt=new Date().toISOString();
try{
 for(const width of[1440,360]){
  await p.setViewportSize({width,height:900});
  for(const path of['/','/signup','/signin','/terms','/privacy','/bot']){
   const r=await p.goto(base+path,{waitUntil:'networkidle'});assert.equal(r.status(),200,path);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width,path);
   if(path==='/terms'){const text=await p.locator('body').innerText();for(const claim of['Fairspleet LLC','348 Business Bay','US$50','US$49','three-day','refund'])assert(text.includes(claim),claim);}
   if(path==='/privacy'){const text=await p.locator('body').innerText();for(const claim of['Fairspleet LLC','Stripe','OpenRouter'])assert(text.includes(claim),claim);}
   if(path==='/signup'||path==='/signin'){
    const submit=p.getByRole('button',{name:path==='/signup'?'Create account':'Sign in',exact:true});assert(await submit.isEnabled());await submit.click();await p.getByText('Enter a valid email',{exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,path);
   }
   results.push({path,width,pass:true,title:await p.title()});
   if(width===360&&['/signin','/terms'].includes(path))await p.screenshot({path:`${out}/production-${path.slice(1)}-mobile.png`});
  }
 }
 await p.goto(base+'/dashboard',{waitUntil:'networkidle'});assert.equal(new URL(p.url()).pathname,'/signup');results.push({name:'Anonymous dashboard gate',pass:true});
 const health=await c.request.get(base+'/api/health');assert.equal(health.status(),200);assert.deepEqual(await health.json(),{ok:true});assert.equal(health.headers()['cache-control'],'no-store');results.push({name:'Database readiness',pass:true});
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);results.push({name:'No browser or asset errors',pass:true});
}catch(e){results.push({pass:false,error:e.message});process.exitCode=1;}
await fs.writeFile(`${out}/production-smoke-results.json`,JSON.stringify({base,startedAt,finishedAt:new Date().toISOString(),results,errors,failures},null,2));console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,errors,failures,results},null,2));await b.close();
