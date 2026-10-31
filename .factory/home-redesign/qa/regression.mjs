import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const out='.factory/home-redesign/qa';
const before=JSON.parse(await fs.readFile(`${out}/baseline-layout.json`,'utf8'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
for(const width of [1440,375]){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',colorScheme:'light'});
 const page=await context.newPage();
 for(const slug of ['organic-search','ai-visibility','backlinks']){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3900/features/'+slug,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{await document.fonts.ready;document.querySelectorAll('.rv').forEach(e=>e.classList.add('in'));});
  await page.waitForTimeout(500);
  const screenshot=await page.screenshot({path:`${out}/after-${slug}-${width}.png`,fullPage:true});
  const actual=await page.evaluate(({slug,width,errors})=>({slug,width,errors,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>({text:e.textContent,rect:JSON.stringify(e.getBoundingClientRect()),font:getComputedStyle(e).font,fontSpacing:getComputedStyle(e).letterSpacing})),sections:[...document.querySelectorAll('section')].map(e=>({id:e.id,rect:JSON.stringify(e.getBoundingClientRect())}))}),{slug,width,errors});
  const baseline=before.find(x=>x.slug===slug&&x.width===width);
  const digest=b=>createHash('sha256').update(b).digest('hex');
  results.push({slug,width,layoutEqual:JSON.stringify(actual)===JSON.stringify(baseline),imageEqual:digest(screenshot)===digest(await fs.readFile(`${out}/baseline-${slug}-${width}.png`)),actual});
 }
 await context.close();
}
// A client navigation from a new home stylesheet must not alter a feature page.
const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});const page=await ctx.newPage();
await page.goto('http://localhost:3900/',{waitUntil:'networkidle'});
await page.locator('.foot a[href="/features/organic-search"]').click();
await page.waitForURL('**/features/organic-search');
await page.evaluate(async()=>{await document.fonts.ready;document.querySelectorAll('.rv').forEach(e=>e.classList.add('in'));});
await page.waitForTimeout(500);
const client=await page.evaluate(()=>({headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>({text:e.textContent,font:getComputedStyle(e).font,fontSpacing:getComputedStyle(e).letterSpacing})),scrollWidth:document.documentElement.scrollWidth}));
const base=before.find(x=>x.slug==='organic-search'&&x.width===1440);
results.push({clientNavigation:true,stylesEqual:JSON.stringify(client.headings)===JSON.stringify(base.headings.map(({rect,...rest})=>rest)),overflow:client.scrollWidth-1440});
await page.screenshot({path:`${out}/after-client-navigation-organic-search.png`,fullPage:true});
await fs.writeFile(`${out}/regression-results.json`,JSON.stringify(results,null,2));
console.log(results.map(({actual,...rest})=>rest));await browser.close();
