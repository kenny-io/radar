import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const out='.factory/lifecycle-emails/qa/brand-correction';
const names=['welcome','founder_note','password_reset','workspace_ready','trial_started','trial_ending','invoice_paid','payment_failed','cancellation_scheduled','subscription_ended'];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage();const checks=[];
const mark=await readFile('public/brand/radar-mark-email.png');
await page.route('https://radar.thally.io/brand/radar-mark-email.png',route=>route.fulfill({contentType:'image/png',body:mark}));
try{
 for(const width of [390,600]){
  await page.setViewportSize({width,height:1000});
  for(const name of names){
   await page.setContent(await readFile(`.factory/lifecycle-emails/previews/${name}.html`,'utf8'));
   await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
   const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,images:[...document.images].map(i=>({src:i.src,width:i.naturalWidth,height:i.naturalHeight,displayWidth:i.width})),heading:document.querySelector('h1')?.textContent,text:document.body.innerText}));
   const pass=!result.overflow&&result.images.length===1&&result.images[0].width===224&&result.images[0].displayWidth===28&&!result.text.includes('◉');
   checks.push({name,width,pass,...result});if(!pass)throw Error(`Bad preview ${name}@${width}`);
   await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});
  }
 }
 for(let n=0;n<names.length;n+=2){
  const pair=names.slice(n,n+2);
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
  const cards=await Promise.all(pair.map(async name=>`<iframe title="${name}" srcdoc="${escape(await readFile(`.factory/lifecycle-emails/previews/${name}.html`,'utf8'))}"></iframe>`));
  await page.setViewportSize({width:1240,height:1000});
  await page.setContent(`<!doctype html><html><head><style>body{margin:0;background:#f5f5f2}main{display:grid;grid-template-columns:600px 600px;gap:20px;padding:10px}iframe{width:600px;height:950px;border:0}</style></head><body><main>${cards.join('')}</main></body></html>`);
  await page.evaluate(()=>Promise.all([...document.querySelectorAll('iframe')].flatMap(f=>[...f.contentDocument.images].map(i=>i.decode()))));
  const height=await page.evaluate(()=>Math.max(...[...document.querySelectorAll('iframe')].map(f=>Math.ceil(f.contentDocument.body.firstElementChild.getBoundingClientRect().bottom))));
  await page.evaluate(h=>document.querySelectorAll('iframe').forEach(f=>f.style.height=h+'px'),height);
  await page.setViewportSize({width:1240,height:height+20});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.screenshot({path:`${out}/${pair.join('--')}.png`});
 }
}finally{await browser.close();await writeFile(`${out}/results.json`,JSON.stringify({environment:'isolated local Chrome; first-party PNG URL fulfilled from deployable local asset because not deployed yet; no sends',checks},null,2)+'\n');}
console.log(JSON.stringify({passed:checks.filter(x=>x.pass).length,total:checks.length}));
