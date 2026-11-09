// Anonymous Chrome against the complete isolated destination source and genuine components.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base='http://localhost:3948';
const slug='qa-reachable-publishing', title='QA: Reachable publishing from Radar';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const failedRequests=[];page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))failedRequests.push({status:r.status(),url:r.url()});});
const checks=[];
try{
  const response=await page.goto(base+'/blog',{waitUntil:'networkidle',timeout:120000});assert.equal(response.status(),200);
  const card=page.locator(`a[href="/blog/${slug}"]`).first();assert(await card.isVisible());checks.push('Real destination BlogIndex displays generated registry article card');
  await card.focus();await page.keyboard.press('Enter');await page.waitForURL(base+'/blog/'+slug,{timeout:120000});
  await page.getByRole('heading',{name:title,exact:true}).waitFor({state:'visible',timeout:120000});
  assert.match(await page.locator('body').textContent(),/This body came from the production integration planner/);
  assert.match(await page.title(),/QA Radar Integration/);checks.push('Keyboard article-card navigation renders real PostShell, generated MDX and SEO title');
  await page.reload({waitUntil:'networkidle',timeout:120000});assert(await page.getByRole('heading',{name:title,exact:true}).isVisible());checks.push('Real Next route works after reload');
  await page.getByRole('navigation',{name:'Breadcrumb'}).getByRole('link',{name:'Blog',exact:true}).click();await page.waitForURL(base+'/blog');
  assert(await page.locator(`a[href="/blog/${slug}"]`).first().isVisible());checks.push('Real breadcrumb returns to populated real blog index');
  await page.setViewportSize({width:390,height:844});await page.locator(`a[href="/blog/${slug}"]`).first().click();await page.waitForURL(base+'/blog/'+slug);
  assert(await page.getByRole('heading',{name:title,exact:true}).isVisible());assert.equal(await page.locator('body').evaluate(n=>n.scrollWidth>innerWidth+2),false);checks.push('Mobile real destination article renders without horizontal overflow');
  const fresh=await browser.newPage();await fresh.goto(base+'/blog/'+slug,{waitUntil:'networkidle',timeout:120000});assert(await fresh.getByRole('heading',{name:title,exact:true}).isVisible());await fresh.close();checks.push('Fresh browser page resolves generated article directly');
  const image=await page.goto(base+'/blog/'+slug+'/opengraph-image',{waitUntil:'networkidle',timeout:120000});assert.equal(image.status(),200);assert.match(image.headers()['content-type'],/^image\/png/);assert(await page.locator('img').evaluate(n=>n.complete&&n.naturalWidth===1200&&n.naturalHeight===630));checks.push('Generated real Open Graph image route renders a 1200×630 PNG in Chrome');
  const result={base,checks,pageErrors:errors,failedLocalResponses:failedRequests,destinationRevision:'c44cde2f12d5170a2fbaf4e038b467b12efb161f',runtime:'Next.js16.3.5 webpack dev, complete isolated destination snapshot with real existing components; generated plan files overlaid; no remote mutation'};
  await fs.writeFile('.factory/github-publishing-integration/qa/real-destination-result.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[]);
}finally{await browser.close();}
