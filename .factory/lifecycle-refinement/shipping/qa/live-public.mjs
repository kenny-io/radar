import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const origin='https://radar.thally.io',out='.factory/lifecycle-refinement/shipping/qa';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c=await b.newContext({viewport:{width:390,height:844}});const results=[];const errors=[];let writes=0;
await c.route('**/*',r=>{if(!['GET','HEAD'].includes(r.request().method())){writes++;return r.abort();}return r.continue();});
try {
 const h=await c.request.get(origin+'/api/health');results.push({path:'/api/health',status:h.status(),body:await h.json(),cacheControl:h.headers()['cache-control']});
 for(const path of ['/signin','/forgot-password','/email-preferences','/settings?section=autopilot']){
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));const r=await p.goto(origin+path,{waitUntil:'networkidle',timeout:45000});
  results.push({path,status:r?.status(),finalPath:new URL(p.url()).pathname,headings:await p.getByRole('heading').allTextContents(),forms:await p.locator('form').count(),viewportFits:await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),noindex:r?.headers()['x-robots-tag']||null,noReferrer:r?.headers()['referrer-policy']||null});
  if(path==='/signin')await p.screenshot({path:out+'/live-signin-mobile.png',fullPage:true});await p.close();
 }
}finally{await b.close();await writeFile(out+'/live-public.json',JSON.stringify({observedAt:new Date().toISOString(),origin,environment:'Unauthenticated real production Chrome; read-only routes; all non-GET/HEAD browser traffic blocked; no test account supplied',deployedRevision:'Unknown: public health has no revision marker',writes,errors,results},null,2)+'\n');}
console.log(JSON.stringify({checks:results.length,writes,errors,results}));
