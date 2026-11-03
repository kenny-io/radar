import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const out='.factory/lifecycle-emails/qa/copy-refinement';
await mkdir(out,{recursive:true});
const names=['welcome','founder_note','password_reset','workspace_ready','trial_started','trial_ending','invoice_paid','payment_failed','cancellation_scheduled','subscription_ended'];
const shots=new Set(['welcome','founder_note','trial_started','invoice_paid']);
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage();const checks=[];
try{
 for(const width of [390,600]){
  await page.setViewportSize({width,height:1000});
  for(const name of names){
   await page.setContent(await readFile(`.factory/lifecycle-emails/previews/${name}.html`,'utf8'));
   await page.evaluate(()=>scrollTo(0,0));
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,h1:document.querySelectorAll('h1').length,language:document.documentElement.lang,links:[...document.querySelectorAll('a')].map(a=>a.href),text:document.body.innerText}));
   const pass=!result.overflow&&result.h1===1&&result.language==='en'&&result.links.every(x=>x.startsWith('https://radar.thally.io/')||x.startsWith('mailto:'));
   checks.push({name,width,pass,...result});
   if(!pass)throw Error(`Preview failed: ${name} at${width}`);
   if(shots.has(name))await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});
  }
 }
 // One side-by-side artifact lets the owner assess the two conversational emails together.
 await page.setViewportSize({width:1240,height:880});
 const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
 const html=await Promise.all(['welcome','founder_note'].map(async name=>`<iframe title="${name}" srcdoc="${escape(await readFile(`.factory/lifecycle-emails/previews/${name}.html`,'utf8'))}"></iframe>`));
 await page.setContent(`<html><head><style>body{margin:0;background:#f5f5f2}main{display:grid;grid-template-columns:600px 600px;gap:20px;padding:10px}iframe{border:0;width:600px;height:850px}</style></head><body><main>${html.join('')}</main></body></html>`);
 await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);
 await page.screenshot({path:`${out}/welcome-founder-desktop.png`});
}finally{await browser.close();await writeFile(`${out}/results.json`,JSON.stringify({environment:'installed Google Chrome, local HTML setContent only, no server or provider',checks},null,2)+'\n');}
console.log(JSON.stringify({passed:checks.filter(x=>x.pass).length,total:checks.length}));
