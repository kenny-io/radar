import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const out='.factory/weekly-education/qa/renders';await mkdir(out,{recursive:true});
const lessons=['ai_visibility','daily_brief','backlinks','organic_search','social_marketing'];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const checks=[];
try{for(const width of [390,600])for(const access of ['workspace','start_trial','restart','setup'])for(const [i,lesson]of lessons.entries()){
 const name=`${i+1}-${lesson}-${access}`;const page=await browser.newPage({viewport:{width,height:1200}});
 await page.setContent(await readFile(`.factory/weekly-education/previews/${name}.html`,'utf8'));
 await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
 const r=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,h1:document.querySelectorAll('h1').length,actions:document.querySelectorAll('ol li').length,links:[...document.querySelectorAll('a')].map(a=>({text:a.textContent,href:a.href})),logo:[...document.images].map(i=>({natural:i.naturalWidth,width:i.width})),progress:document.body.innerText.includes('Check progress:')}));
 const pass=!r.overflow&&r.h1===1&&r.actions===2&&r.progress&&r.logo[0]?.natural===224&&r.logo[0]?.width===28&&r.links.some(a=>access==='workspace'?a.href.includes('/email/learn?lesson='+lesson):new URL(a.href).pathname===(access==='setup'?'/onboarding':'/start-trial'))&&r.links.some(a=>/Stop weekly education/.test(a.text));
 checks.push({name,width,pass,...r});if(!pass)throw Error(`${name}@${width}`);
 const height=await page.evaluate(()=>Math.ceil(document.body.firstElementChild.getBoundingClientRect().bottom));await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:`${out}/${name}-${width}.png`});await page.close();
}}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify({environment:'Installed Google Chrome headless; local HTML; embedded deployable first-party logo; no provider or inbox claim',checks},null,2)+'\n');}
console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,total:checks.length}));
