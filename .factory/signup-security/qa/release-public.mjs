import{chromium}from'playwright';
import fs from'node:fs/promises';
import assert from'node:assert/strict';
const base='https://radar.thally.io';
const expectedCommit=process.env.QA_DEPLOYED_COMMIT||'';
assert.match(expectedCommit,/^[a-f0-9]{40}$/,'PM-confirmed deployed commit required before live checks');
const phase=process.env.QA_PHASE||'deployed';assert.match(phase,/^[a-z-]+$/);
const out='.data/signup-security/release-qa';await fs.mkdir(out,{recursive:true,mode:0o700});
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c=await b.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),p=await c.newPage();
p.setDefaultTimeout(25000);p.setDefaultNavigationTimeout(45000);
const results=[],errors=[],applicationMutations=[],challengeRequests=[],httpFailures=[];let marker;
const startedAt=new Date().toISOString();
const observe=page=>{
 page.on('pageerror',e=>errors.push(e.message.replace(/#token=[A-Za-z0-9_-]+/g,'#token=[redacted]')));
 page.on('request',r=>{const u=new URL(r.url());if(u.origin===base&&['POST','PUT','PATCH','DELETE'].includes(r.method()))applicationMutations.push({method:r.method(),path:u.pathname});if(u.hostname==='challenges.cloudflare.com')challengeRequests.push({path:u.pathname});});
 page.on('response',r=>{const u=new URL(r.url());if(r.status()>=400)httpFailures.push({status:r.status(),path:u.pathname});});
};observe(p);
const check=async(name,fn)=>{try{results.push({name,pass:true,detail:await fn()});}catch(e){results.push({name,pass:false,error:e.message.replace(/#token=[A-Za-z0-9_-]+/g,'#token=[redacted]')});}console.log(JSON.stringify(results.at(-1)));};
const screenshot=async(page,name)=>page.screenshot({path:`${out}/${phase}-${name}.png`,fullPage:true});
const cleanToken=async()=>p.waitForFunction(()=>!location.hash&&!JSON.stringify(history.state).includes('#token='));
try{
 await check('Live desktop/mobile signup has no initial password and no challenge dependency',async()=>{
  const detail=[];
  for(const width of[1440,390]){
   await p.setViewportSize({width,height:width===390?844:1000});const r=await p.goto(base+'/signup',{waitUntil:'networkidle'});assert.equal(r.status(),200);await p.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
   assert(await p.getByRole('textbox',{name:'Name',exact:true}).isEnabled());assert(await p.getByRole('textbox',{name:'Work email',exact:true}).isEnabled());assert.equal(await p.locator('input[type=password]').count(),0);assert(await p.getByRole('button',{name:'Create account',exact:true}).isEnabled());assert(await p.getByRole('button',{name:'Continue with Google',exact:true}).isEnabled());assert.equal(await p.locator('script[src*="challenges.cloudflare.com"]').count(),0);assert.equal(await p.locator('[aria-label="Security check"]').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);await p.getByText('We’ll email you a link to confirm your address and choose your password.',{exact:true}).waitFor();
   if(width===1440){const h=await r.allHeaders();marker={publicAssetUrls:await p.locator('script[src]').evaluateAll(es=>es.map(e=>e.src)),headers:Object.fromEntries(Object.entries(h).filter(([key])=>['date','etag','x-railway-request-id','x-frame-options','referrer-policy'].includes(key)))};}
   await screenshot(p,'signup-'+width);detail.push({width,noPassword:true,enabledAfterHydration:true,noChallengeSdk:true,noOverflow:true});
  }return detail;
 });
 await check('Live invalid signup/signin and Google collision guidance are usable without API submission',async()=>{
  for(const[path,label]of[['/signup','Create account'],['/signin','Sign in']]){await p.goto(base+path,{waitUntil:'networkidle'});await p.getByRole('button',{name:label,exact:true}).click();await p.getByText('Enter a valid email',{exact:true}).waitFor();if(path==='/signup')await p.getByText('Add your name',{exact:true}).waitFor();else await p.getByText('Enter your password',{exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,path);}
  await p.goto(base+'/signin?error=google_link',{waitUntil:'networkidle'});await p.getByRole('alert').filter({hasText:'another sign-in method'}).waitFor();assert(await p.getByRole('button',{name:'Need to confirm your email?',exact:true}).isEnabled());await p.getByRole('button',{name:'Need to confirm your email?',exact:true}).click();await p.getByRole('heading',{name:'Confirm your email',exact:true}).waitFor();assert.equal(await p.locator('input[type=password]').count(),0);return{clientValidation:true,collisionGuidance:true,legacyRecoveryEntryWithoutPassword:true};
 });
 await check('Live confirmation GET stays explicit, private headers and token-free history work',async()=>{
  const r=await p.goto(base+'/verify-email',{waitUntil:'networkidle'});assert.equal(r.status(),200);await p.getByText('If you refreshed this page, reopen the link from your email or request a new one below.',{exact:true}).waitFor();const h=await r.allHeaders();assert.equal(h['referrer-policy'],'no-referrer');assert(h['cache-control'].includes('no-store'));assert(h['x-robots-tag'].includes('noindex'));assert.equal(await p.locator('meta[name=referrer]').getAttribute('content'),'no-referrer');
  // Public syntactic fixture only. Never submits or consumes a real confirmation credential.
  const link=base+'/verify-email#token='+'A'.repeat(43);await p.goto(link,{waitUntil:'networkidle'});await p.getByRole('heading',{name:'Choose your password',exact:true}).waitFor();await cleanToken();assert.equal(await p.locator('input[type=password]').count(),1);assert(await p.getByRole('button',{name:'Confirm email and continue',exact:true}).isEnabled());await screenshot(p,'confirmation-mobile');
  await p.reload({waitUntil:'networkidle'});await p.getByText('If you refreshed this page, reopen the link from your email or request a new one below.',{exact:true}).waitFor();await p.goto(link,{waitUntil:'networkidle'});await p.getByRole('heading',{name:'Choose your password',exact:true}).waitFor();await cleanToken();return{GETNoActivationRequests:true,headers:{referrerPolicy:h['referrer-policy'],cacheControl:h['cache-control'],robots:h['x-robots-tag']},syntheticFragmentScrubbed:true,reopenAfterRefresh:true};
 });
 await check('Anonymous app/API boundaries remain enforced',async()=>{
  const detail=[];for(const path of['/dashboard','/settings?section=billing','/start-trial']){await p.goto(base+path,{waitUntil:'networkidle'});assert.equal(new URL(p.url()).pathname,'/signup');detail.push({from:path,to:'/signup'});}const r=await c.request.get(base+'/api/me');assert.equal(r.status(),401);return{redirects:detail,anonymousMe401:true};
 });
 await check('Cold live auth controls prevent native submission before hydration',async()=>{
  const detail=[];
  for(const[path,label]of[['/signup','Create account'],['/signin','Sign in']]){
   const fresh=await b.newContext({viewport:{width:1440,height:1000}}),q=await fresh.newPage();observe(q);let release;const gate=new Promise(r=>release=r);let blocked=0;
   await q.route('**/_next/static/**/*.js',async r=>{blocked++;await gate;await r.continue();});
   try{await q.goto(base+path,{waitUntil:'commit'});const submit=q.getByRole('button',{name:label,exact:true});await submit.waitFor();assert(await submit.isDisabled());for(const input of await q.locator('input').all())assert(await input.isDisabled());assert(await q.getByRole('button',{name:'Continue with Google',exact:true}).isDisabled());release();await q.waitForFunction(label=>[...document.querySelectorAll('button')].some(e=>e.textContent===label&&!e.disabled),label);await q.unroute('**/_next/static/**/*.js');await submit.click();await q.getByText('Enter a valid email',{exact:true}).waitFor();detail.push({path,blockedScripts:blocked,disabledBefore:true,enabledAfter:true});}finally{release();await fresh.close();}
  }return detail;
 });
 await check('No live mutations, challenge requests or browser exceptions',async()=>{assert.deepEqual(applicationMutations,[]);assert.deepEqual(challengeRequests,[]);assert.deepEqual(errors,[]);assert.deepEqual(httpFailures,[]);return{applicationMutations,challengeRequests,errors,httpFailures};});
}finally{
 const result={base,phase,expectedCommit,commitProvenance:'PM-confirmed successful deployment metadata; public page has no Git SHA',scope:'Anonymous read-only browser checks and synthetic fragment fixture only; no signup/signin/confirmation/email/payment/analysis/publishing mutation',startedAt,finishedAt:new Date().toISOString(),marker,results,applicationMutations,challengeRequests,errors,httpFailures};await fs.writeFile(`${out}/${phase}-public-results.json`,JSON.stringify(result,null,2),{mode:0o600});await c.close();await b.close();console.log('TOTAL',results.filter(x=>x.pass).length,'PASS',results.filter(x=>!x.pass).length,'FAIL');process.exitCode=results.some(x=>!x.pass)?1:0;
}
