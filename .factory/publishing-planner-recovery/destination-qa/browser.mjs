import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [base,route,label,head]=process.argv.slice(2);
assert(base&&route&&label&&head,'Usage: browser.mjs base route evidence-label head');
assert(/^https?:\/\//.test(base)&&route.startsWith('/blog/'));
const output='.factory/publishing-planner-recovery/destination-qa';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const p=await c.newPage();p.setDefaultTimeout(25000);
const errors=[],results=[],failedAssets=[];
p.on('pageerror',e=>errors.push(e.message));
p.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))failedAssets.push({url:r.url(),status:r.status()});});
const check=async(name,fn)=>{try{results.push({name,pass:true,detail:await fn()});}catch(e){results.push({name,pass:false,error:e.stack});}console.log(JSON.stringify(results.at(-1)));};
try{
 await check('ordinary reader follows blog listing into article',async()=>{
  await p.goto(base+'/blog');
  const a=p.locator(`a[href="${route}"]`).first();await a.waitFor();
  await a.scrollIntoViewIfNeeded();await a.hover();await a.focus();assert(await a.evaluate(el=>el===document.activeElement));
  await p.screenshot({path:`${output}/${label}-listing.png`,fullPage:true});
  await p.keyboard.press('Enter');await p.waitForURL(base+route);
  await p.locator('main h1').waitFor();return {listingLink:true,hover:true,keyboard:true};
 });
 await check('article renders one title, body, canonical, byline, and public navigation',async()=>{
  const h1=p.locator('main h1');assert.equal(await h1.count(),1);const title=(await h1.innerText()).trim();assert(title.length>10);
  const prose=p.locator('main .prose');const body=await prose.innerText();assert(body.length>4000);assert.doesNotMatch(body,/\{\{RADAR_|undefined|\[object Object\]/);
  assert(await prose.locator('h2').count()>0);
  const canonical=await p.locator('link[rel=canonical]').getAttribute('href');assert.equal(new URL(canonical).pathname,route);
  const author=p.locator('a[rel=author]').first();await author.waitFor();const authorPath=await author.getAttribute('href');assert(authorPath?.startsWith('/'));assert.equal((await c.request.get(base+authorPath)).status(),200);
  await p.screenshot({path:`${output}/${label}-article-desktop.png`,fullPage:true});return {title,bodyCharacters:body.length,headings:await prose.locator('h2').count(),canonicalPath:new URL(canonical).pathname,authorPath};
 });
 await check('existing tab reload and fresh tab retain full article',async()=>{const text=(await p.locator('main .prose').innerText()).trim();await p.reload();await p.locator('main .prose').waitFor();assert.equal((await p.locator('main .prose').innerText()).trim(),text);const fresh=await c.newPage();await fresh.goto(base+route);assert.equal((await fresh.locator('main .prose').innerText()).trim(),text);await fresh.close();return {reload:true,fresh:true};});
 await check('mobile article fits and blog breadcrumb remains keyboard reachable',async()=>{await p.setViewportSize({width:390,height:844});await p.goto(base+route);await p.locator('main .prose').waitFor();const size=await p.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert(size.scroll<=size.client+1);const crumb=p.getByRole('navigation',{name:'Breadcrumb'}).getByRole('link',{name:'Blog',exact:true});await crumb.focus();assert(await crumb.evaluate(el=>el===document.activeElement));await p.screenshot({path:`${output}/${label}-article-mobile.png`,fullPage:true});await p.screenshot({path:`${output}/${label}-article-mobile-viewport.png`});return size;});
 await check('no browser runtime or first-party asset failures',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);return {runtimeErrors:0,failedFirstPartyAssets:0};});
}finally{await browser.close();await fs.writeFile(`${output}/${label}-browser.json`,JSON.stringify({at:new Date().toISOString(),base,route,head,results,errors,failedAssets},null,2)+'\n');}
process.exitCode=results.some(r=>!r.pass)?1:0;
