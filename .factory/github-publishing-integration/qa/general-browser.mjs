import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
const temp=process.env.QA_GENERAL_TEMP;
assert(temp,'QA_GENERAL_TEMP required');
const set=process.env.QA_ARTIFACT_SET||'artifacts';
const configs=[{id:'astro',dist:'products/guide-web/dist',index:'/notes/',route:'/notes/reliable-publishing/'},{id:'jekyll',dist:'_site',index:'/',route:'/journal/reliable-publishing/'},{id:'custom',dist:'packages/field-notes/dist',index:'/',route:'/reading/reliable-publishing/'}];
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
try{for(const config of configs){
 const root=path.join(temp,set,config.id,config.dist);
 try{await fs.access(root);}catch{continue;}
 if(set==='live-artifacts'){const plan=JSON.parse(await fs.readFile(path.join(temp,`live-plan-${config.id}.json`),'utf8'));config.route=plan.route;}
 const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)&&file!==root)throw Error('invalid');const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,'index.html');const value=await fs.readFile(file);res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream'});res.end(value);}catch{res.writeHead(404);res.end('Missing');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
 try{
  assert.equal((await page.goto(base+config.index)).status(),200);
  const link=page.getByRole('link',{name:'How reliable publishing reaches readers',exact:true});assert.equal(await link.count(),1);checks.push('Exactly one public listing link to the generated article');
  await link.focus();await page.keyboard.press('Enter');await page.waitForURL(base+config.route);
  assert.equal(await page.getByRole('heading',{level:1}).textContent(),'How reliable publishing reaches readers');assert.match(await page.locator('article').textContent(),/The generated article is linked from the existing website/);checks.push('Keyboard index navigation opens complete generated article in the actual framework build');
  await page.reload();assert.match(await page.locator('article').textContent(),/Verified integration/);checks.push('Direct article route survives browser reload');
  const fresh=await browser.newPage();await fresh.goto(base+config.route);assert.equal(await fresh.getByRole('heading',{level:1}).textContent(),'How reliable publishing reaches readers');await fresh.close();checks.push('Fresh browser page resolves generated article directly');
  await page.setViewportSize({width:390,height:844});await page.goto(base+config.index);await page.getByRole('link',{name:'How reliable publishing reaches readers',exact:true}).click();assert(await page.getByRole('heading',{level:1}).isVisible());assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth>innerWidth+2),false);checks.push('Mobile listing navigation renders article without horizontal overflow');
  assert.deepEqual(errors,[]);results.push({fixture:config.id,set,base,route:config.route,checks,pageErrors:errors});
 }finally{await page.close();await new Promise(resolve=>server.close(resolve));}
}}finally{await browser.close();}
assert(results.length>=(set==='live-artifacts'?1:2),'Expected complete framework builds must be exercised');
await fs.writeFile(`.factory/github-publishing-integration/qa/general-browser-${set}.json`,JSON.stringify({results,scope:'Actual framework/static-site build output produced from production planner result. Mocked planning for artifacts; live configured AI planning for live-artifacts. No remote writes.'},null,2)+'\n');
console.log(JSON.stringify({fixtures:results.length,checks:results.reduce((n,r)=>n+r.checks.length,0),results},null,2));
