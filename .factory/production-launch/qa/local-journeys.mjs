import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const base=process.env.QA_BASE||'http://localhost:3900';
assert.equal(new URL(base).hostname,'localhost','Mutating QA runs only against localhost');
const out='.data/production-launch/qa';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c=await b.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),p=await c.newPage();
p.setDefaultTimeout(30000);p.setDefaultNavigationTimeout(45000);
const results=[],errors=[],responses=[];p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)responses.push({path:new URL(r.url()).pathname,status:r.status()});});
const check=async(name,fn)=>{try{results.push({name,pass:true,detail:await fn()});}catch(e){await p.screenshot({path:`${out}/local-failure-${results.length}.png`}).catch(()=>{});results.push({name,pass:false,error:e.message});}console.log(JSON.stringify(results.at(-1)));};
const email=`launch-qa-${Date.now()}@radar.test`,password='Launch-qa-2026!';
const startedAt=new Date().toISOString();
await check('Account-first signup, normalization and session persistence',async()=>{
 await p.goto(base+'/signup',{waitUntil:'networkidle'});
 await p.locator('input[autocomplete="name"]').fill('Launch QA');await p.locator('input[type="email"]').fill('  '+email.toUpperCase()+'  ');await p.locator('input[type="password"]').fill(password);
 await p.getByRole('button',{name:'Create account',exact:true}).click();await p.waitForURL('**/onboarding',{waitUntil:'domcontentloaded'});await p.getByRole('heading',{name:'Let’s get to know your business.'}).waitFor();
 const me=await c.request.get(base+'/api/me');assert.equal(me.status(),200);const data=await me.json();assert.equal(data.user.email,email);
 await p.reload({waitUntil:'domcontentloaded'});await p.getByRole('heading',{name:'Let’s get to know your business.'}).waitFor();
 const cookies=await c.cookies();const session=cookies.find(x=>x.name==='radar_session');assert(session?.httpOnly);assert.equal(session.sameSite,'Lax');
 return{normalizedEmail:true,sessionPersists:true,httpOnly:true,sameSite:session.sameSite};
});
await check('Website validation, complete analysis, profile edit and resume',async()=>{
 await p.getByRole('textbox',{name:'Website domain'}).fill('invalid');await p.getByRole('button',{name:'Analyze website',exact:true}).click();assert(await p.getByRole('alert').filter({hasText:'Enter a domain'}).isVisible());
 await p.getByRole('textbox',{name:'Website domain'}).fill('fieldnote.app');await p.getByRole('button',{name:'Analyze website',exact:true}).click();
 await p.getByRole('button',{name:'Review what Radar found',exact:true}).waitFor({timeout:120000});await p.getByRole('button',{name:'Review what Radar found',exact:true}).click();
 await p.getByRole('heading',{name:'Here’s what Radar found.'}).waitFor();
 const inputs=await p.locator('input').evaluateAll(es=>es.map(e=>({value:e.value,type:e.type})));
 const nameIndex=inputs.findIndex(e=>e.value==='Fieldnote');assert(nameIndex>=0);await p.locator('input').nth(nameIndex).fill('Radar Launch QA');
 await p.getByRole('button',{name:'Looks right',exact:true}).click();await p.getByRole('heading',{name:'Connect Google Search Console'}).waitFor();
 await p.reload({waitUntil:'domcontentloaded'});await p.getByRole('heading',{name:'Connect Google Search Console'}).waitFor();
 await p.getByRole('button',{name:'Skip for now',exact:true}).click();await p.getByRole('heading',{name:'Your Business Profile is ready.'}).waitFor();assert(await p.getByText('Radar Launch QA',{exact:true}).isVisible());
 await p.getByRole('button',{name:'Save profile & continue',exact:true}).click();await p.waitForURL('**/start-trial',{waitUntil:'domcontentloaded'});await p.getByRole('heading',{name:'Start your free trial',exact:true}).waitFor();await p.waitForLoadState('networkidle');
 return{analysisCompleted:true,editPersisted:true,resumedAtSavedStep:true,savedToTrial:true};
});
const fillCard=async number=>{await p.locator('input[autocomplete="cc-number"]').fill(number);await p.locator('input[autocomplete="cc-exp"]').fill('12/29');await p.locator('input[autocomplete="cc-csc"]').fill('123');await p.locator('input[autocomplete="postal-code"]').fill('12345');};
await check('Trial empty validation and declined-card recovery',async()=>{
 const trialText=await p.locator('body').innerText();assert(trialText.includes('3 days free, then $50/month'));
 assert(/\$49/.test(trialText));assert(/credited/.test(trialText));assert(/cancel/i.test(trialText));
 await p.screenshot({path:`${out}/local-trial-disclosures.png`});
 await p.getByRole('button',{name:'Pay $1 and start trial',exact:true}).click();await p.locator('input[autocomplete="cc-number"][aria-invalid="true"]').waitFor();
 await fillCard('4000000000000002');await p.getByRole('button',{name:'Pay $1 and start trial',exact:true}).click();await p.getByRole('alert').filter({hasText:'Your card was declined.'}).waitFor();assert.equal(new URL(p.url()).pathname,'/start-trial');
 const state=await(await c.request.get(base+'/api/billing/state')).json();assert.equal(state.access,false);assert.equal(state.status,'none');await p.screenshot({path:`${out}/local-decline.png`});
 return{emptyCardInvalid:true,declineShown:true,noAccessAfterDecline:true};
});
await check('Stub payment success, dashboard persistence and billing own status',async()=>{
 const prefix='424242'+String(Date.now()).slice(-9);let checksum=0;for(let i=0;i<prefix.length;i++){let digit=Number(prefix[i]);if(i%2===0){digit*=2;if(digit>9)digit-=9;}checksum+=digit;}const successCard=prefix+String((10-checksum%10)%10);
 await fillCard(successCard);await p.getByRole('button',{name:'Pay $1 and start trial',exact:true}).click();await p.getByRole('heading',{name:'Your free trial has started.',exact:true}).waitFor();
 const state=await(await c.request.get(base+'/api/billing/state')).json();assert.equal(state.access,true);assert.equal(state.status,'trialing');assert.equal(state.trialDays,3);assert.equal(state.priceCents,5000);
 await p.getByRole('button',{name:'Open dashboard',exact:true}).click();await p.waitForURL('**/dashboard?started=trial',{waitUntil:'domcontentloaded'});await p.getByRole('main').waitFor();
 const me=await(await c.request.get(base+'/api/me')).json();assert(me.currentId);assert.equal(me.businesses.find(x=>x.id===me.currentId).name,'Radar Launch QA');
 await p.reload({waitUntil:'domcontentloaded'});await p.getByRole('main').waitFor();assert.equal(new URL(p.url()).pathname,'/dashboard');
 await p.goto(base+'/settings?section=billing',{waitUntil:'domcontentloaded'});await p.getByRole('heading',{name:/^Billing/}).waitFor();assert((await p.locator('body').innerText()).includes('$50'));
 await p.screenshot({path:`${out}/local-billing-trial-desktop.png`});await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);await p.screenshot({path:`${out}/local-billing-trial-mobile.png`});
 return{status:state.status,trialEnd:state.trialEnd,currentBusinessCorrect:true,dashboardReload:true,mobileWidth:390};
});
await check('New account duplicate error, signin failure, signin success and signout',async()=>{
 const other=await b.newContext();const q=await other.newPage();
 await q.goto(base+'/signup',{waitUntil:'networkidle'});await q.locator('input[autocomplete="name"]').fill('Duplicate');await q.locator('input[type="email"]').fill(email);await q.locator('input[type="password"]').fill(password);await q.getByRole('button',{name:'Create account',exact:true}).click();await q.getByText('An account with this email already exists. Sign in instead.',{exact:true}).waitFor();
 await q.goto(base+'/signin',{waitUntil:'networkidle'});await q.locator('input[type="email"]').fill(email);await q.locator('input[type="password"]').fill('Wrong password');await q.getByRole('button',{name:'Sign in',exact:true}).click();await q.getByText('That email and password don’t match.',{exact:true}).waitFor();await q.locator('input[type="password"]').fill(password);await q.getByRole('button',{name:'Sign in',exact:true}).click();await q.waitForURL('**/dashboard',{waitUntil:'domcontentloaded'});
 await other.request.post(base+'/api/auth/signout',{headers:{origin:base}});await q.goto(base+'/dashboard',{waitUntil:'domcontentloaded'});await q.waitForURL('**/signup',{waitUntil:'domcontentloaded'});await other.close();
 return{duplicate409:true,invalidSigninHandled:true,correctSignin:true,signoutRevokes:true};
});
await check('Local health, legal claims and browser errors',async()=>{
 const health=await c.request.get(base+'/api/health');assert.equal(health.status(),200);assert.deepEqual(await health.json(),{ok:true});assert.equal(health.headers()['cache-control'],'no-store');
 const legal=[];
 for(const path of['/terms','/privacy','/bot']){await p.goto(base+path,{waitUntil:'domcontentloaded'});await p.locator('h1').waitFor();const text=await p.locator('body').innerText();if(path==='/terms'){for(const claim of['US$50','US$1','US$49','three-day','automatically','cancel','refund'])assert(text.includes(claim),claim);}if(path==='/privacy'){assert(text.includes('Stripe'));assert(text.includes('OpenRouter'));}const contacts=await p.locator('a[href^="mailto:"]').evaluateAll(es=>es.map(e=>e.getAttribute('href')));assert(contacts.length>0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);legal.push({path,text,contacts});await p.screenshot({path:`${out}/local-${path.slice(1)}.png`});}
 await fs.writeFile(`${out}/local-legal-visible.json`,JSON.stringify(legal,null,2));
 assert.deepEqual(errors,[]);return{health:true,errors};
});
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','src','package.json','package-lock.json','railway.web.json'],{encoding:'utf8'}).trim().split('\n'))];
const hash=createHash('sha256');for(const f of files.sort()){hash.update(f+'\0');hash.update(await fs.readFile(f));hash.update('\0');}
await fs.writeFile(`${out}/local-journey-results.json`,JSON.stringify({base,startedAt,finishedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),trackedSourceFingerprint:hash.digest('hex'),results,errors,responses},null,2));
await b.close();console.log('TOTAL',results.filter(r=>r.pass).length,'PASS',results.filter(r=>!r.pass).length,'FAIL');process.exitCode=results.some(r=>!r.pass)?1:0;
