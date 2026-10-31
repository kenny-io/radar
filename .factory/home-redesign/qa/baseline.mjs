import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const out = '.factory/home-redesign/qa';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
for(const width of [1440,375]){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',colorScheme:'light'});
 const page=await context.newPage();
 for(const slug of ['organic-search','ai-visibility','backlinks']){
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3900/features/'+slug,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{await document.fonts.ready;document.querySelectorAll('.rv').forEach(e=>e.classList.add('in'));});
  await page.waitForTimeout(500);
  await page.screenshot({path:`${out}/baseline-${slug}-${width}.png`,fullPage:true});
  results.push(await page.evaluate(({slug,width,errors})=>({slug,width,errors,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>({text:e.textContent,rect:JSON.stringify(e.getBoundingClientRect()),font:getComputedStyle(e).font,fontSpacing:getComputedStyle(e).letterSpacing})),sections:[...document.querySelectorAll('section')].map(e=>({id:e.id,rect:JSON.stringify(e.getBoundingClientRect())}))}),{slug,width,errors}));
 }
 await context.close();
}
await fs.writeFile(`${out}/baseline-layout.json`,JSON.stringify(results,null,2));
await browser.close();console.log('baseline captured',results.map(x=>({slug:x.slug,width:x.width,overflow:x.scrollWidth-x.clientWidth,errors:x.errors})));
