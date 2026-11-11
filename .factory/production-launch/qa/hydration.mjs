import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://localhost:3900',out='.data/production-launch/qa';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
const check=async(path,label,authenticated=false)=>{
 const c=await b.newContext();
 if(authenticated){const r=await c.request.post(base+'/api/auth/signup',{data:{name:'Hydration QA',email:`hydration-${Date.now()}@radar.test`,password:'Hydration-qa-2026!'},headers:{origin:base,'x-forwarded-for':'10.99.42.11'}});assert.equal(r.status(),200,await r.text());}
 const p=await c.newPage();p.setDefaultTimeout(30000);let release;const gate=new Promise(r=>release=r);const posted=[];let blocked=0;
 p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/'))posted.push(new URL(r.url()).pathname);});
 await p.route('**/_next/static/**/*.js',async route=>{blocked++;await gate;await route.continue();});
 await p.goto(base+path,{waitUntil:'commit'});const submit=p.getByRole('button',{name:label,exact:true});await submit.waitFor();assert(await submit.isDisabled());
 const inputs=p.locator('input');assert((await inputs.count())>0);for(const input of await inputs.all())assert(await input.isDisabled());
 const before=p.url();await submit.evaluate(e=>e.click());assert.equal(p.url(),before);assert.deepEqual(posted,[]);await p.screenshot({path:`${out}/hydration-${path.slice(1)}-before.png`});
 release();await p.waitForLoadState('networkidle');await p.unroute('**/_next/static/**/*.js');await p.waitForFunction(label=>[...document.querySelectorAll('button')].some(e=>e.textContent===label&&!e.disabled),label);
 for(const input of await inputs.all())assert(await input.isEnabled());await submit.click();
 if(path==='/signup')await p.getByText('Add your name',{exact:true}).waitFor();else if(path==='/signin')await p.getByText('Enter your password',{exact:true}).waitFor();else await p.locator('input[autocomplete="cc-number"][aria-invalid="true"]').waitFor();
 assert.equal(p.url(),before);assert.deepEqual(posted,[]);await p.screenshot({path:`${out}/hydration-${path.slice(1)}-after.png`});
 results.push({path,pass:true,blockedScripts:blocked,initiallyDisabled:true,enabledAfterHydration:true,nativeNavigation:false,handledValidation:true});console.log(JSON.stringify(results.at(-1)));await c.close();
};
try{await check('/signup','Create account');await check('/signin','Sign in');await check('/start-trial','Pay $1 and start trial',true);}catch(e){results.push({pass:false,error:e.message});console.log(JSON.stringify(results.at(-1)));process.exitCode=1;}
await fs.writeFile(`${out}/hydration-results.json`,JSON.stringify({base,finishedAt:new Date().toISOString(),results},null,2));await b.close();
