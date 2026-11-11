import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
const env = JSON.parse(await fs.readFile('.data/autopilot/local-env.json', 'utf8'));
assert.equal(new URL(env.DATABASE_URL).pathname, '/radar_autopilot_release_qa');
const db = new pg.Pool({ connectionString: env.DATABASE_URL });
const source = JSON.parse(await fs.readFile('.data/autopilot/fixture.json', 'utf8'));
const template = (await db.query('SELECT profile FROM businesses WHERE id=$1', [source.businessId])).rows[0].profile;
const tag = crypto.randomUUID();
const user = (await db.query('INSERT INTO users(name,email) VALUES($1,$2) RETURNING id,email', ['Two business owner QA', `switcher-${tag}@test.local`])).rows[0];
const biz = [];
for (const [name, time] of [['Thally QA', '08:00'], ['Lived QA', '11:30']]) {
 const profile = { ...template, business: { ...template.business, name }, domain: name.toLowerCase().replaceAll(' ', '-') + '-' + tag + '.test' };
 const row = (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone,social_auto) VALUES($1,$2,'active',$3,'UTC',$4) RETURNING id,domain,profile,social_auto", [user.id, profile.domain, profile, { on: false, time, platforms: ['x'] }])).rows[0];
 await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,'Owner','active')", [row.id,user.id,user.email]); biz.push(row);
}
const token = crypto.randomBytes(32).toString('base64url'); await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(token).digest('hex'),user.id]);
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await c.addCookies([{name:'radar_session',value:token,url:env.APP_URL},{name:'radar_biz',value:biz[0].id,url:env.APP_URL}]);
const p = await c.newPage(); p.setDefaultTimeout(30000); const results=[], errors=[]; p.on('pageerror',e=>errors.push(e.message));
const check=async(name,fn)=>{try{results.push({name,pass:true,detail:await fn()})}catch(e){results.push({name,pass:false,error:e.stack});await p.screenshot({path:'.factory/autopilot/qa/switcher-failure.png',fullPage:true}).catch(()=>{})}console.log(JSON.stringify(results.at(-1)))};
const sw=()=>p.getByRole('switch',{name:'Autopilot',exact:true});
const clickToggle=async()=>{const next=await sw().getAttribute('aria-checked')==='true'?'false':'true';const r=p.waitForResponse(r=>r.url().endsWith('/act')&&r.request().postDataJSON()?.action==='settings.autopilot'&&r.status()===200);await sw().click();await r;await p.waitForFunction(next=>document.querySelector('[role=switch][aria-label=Autopilot]')?.getAttribute('aria-checked')===next,next)};
const openSettings=async()=>{await p.locator('.side').getByRole('button',{name:'Settings',exact:true}).click();await sw().waitFor()};
const switchTo=async i=>{await p.locator('.side button[aria-haspopup="menu"]').first().click();await p.locator('.pop-i').filter({hasText:biz[i].domain}).click();await p.waitForURL('**/dashboard');await p.locator('.side button[aria-haspopup="menu"]').first().filter({hasText:biz[i].profile.business.name}).waitFor();await openSettings()};
const states=async()=> (await db.query('SELECT id,autopilot,social_auto FROM businesses WHERE id=ANY($1::uuid[])',[biz.map(x=>x.id)])).rows;
try{
 await check('AC1/8 Real business switcher keeps Autopilot and saved preferences independent',async()=>{
  await p.goto(env.APP_URL+'/settings?section=autopilot');await sw().waitFor();assert.equal(await sw().getAttribute('aria-checked'),'false');await p.getByText('Applies only to this business.',{exact:false}).waitFor();
  await clickToggle();assert.equal(await sw().getAttribute('aria-checked'),'true');
  await switchTo(1);assert.equal(await sw().getAttribute('aria-checked'),'false');await p.getByText(biz[1].profile.business.name+' · '+biz[1].domain,{exact:true}).waitFor();
  await clickToggle();await switchTo(0);assert.equal(await sw().getAttribute('aria-checked'),'true');await clickToggle();
  await switchTo(1);assert.equal(await sw().getAttribute('aria-checked'),'true');await p.reload();await sw().waitFor();assert.equal(await sw().getAttribute('aria-checked'),'true');
  const saved=await states();assert.equal(saved.find(x=>x.id===biz[0].id).autopilot.enabled,false);assert.equal(saved.find(x=>x.id===biz[1].id).autopilot.enabled,true);
  for(const b of biz)assert.deepEqual(saved.find(x=>x.id===b.id).social_auto,b.social_auto);
  const jobs=(await db.query("SELECT business_id,payload FROM jobs WHERE business_id=ANY($1::uuid[]) AND kind='autopilot.run'",[biz.map(x=>x.id)])).rows;assert.equal(jobs.length,2);for(const j of jobs)assert.equal(j.payload.activationId,saved.find(x=>x.id===j.business_id).autopilot.activationId);
  await p.screenshot({path:'.factory/autopilot/qa/switcher-business-b-on.png',fullPage:true});return{aOff:true,bOn:true,refreshPersisted:true,preferencesAndJobsBusinessScoped:true};
 });
 await check('AC7 Switching business during pending save cannot apply the old business response to the new workspace',async()=>{
  if(await sw().getAttribute('aria-checked')==='true')await clickToggle();
  await switchTo(0);assert.equal(await sw().getAttribute('aria-checked'),'false');
  let ready,release;const intercepted=new Promise(r=>{ready=r}),held=new Promise(r=>{release=r});
  await p.route('**/api/b/'+biz[0].id+'/act',async route=>{if(route.request().postDataJSON()?.action==='settings.autopilot'){const response=await route.fetch();ready();await held;await route.fulfill({response})}else await route.continue()});
  await sw().click();await intercepted;await switchTo(1);assert.equal(await sw().getAttribute('aria-checked'),'false');release();await p.waitForTimeout(500);
  assert.equal(await sw().getAttribute('aria-checked'),'false');await p.getByText(biz[1].profile.business.name+' · '+biz[1].domain,{exact:true}).waitFor();
  const saved=await states();assert.equal(saved.find(x=>x.id===biz[0].id).autopilot.enabled,true);assert.equal(saved.find(x=>x.id===biz[1].id).autopilot.enabled ?? false,false);return{oldResponseDidNotChangeNewWorkspace:true,newBusinessControlsNotStuck:true};
 });
 await check('AC7 Multi-business browser has no runtime errors',async()=>{assert.deepEqual(errors,[]);return{count:0}});
}finally{
 await browser.close();await db.query("UPDATE businesses SET autopilot=autopilot || '{\"enabled\":false}'::jsonb WHERE id=ANY($1::uuid[])",[biz.map(x=>x.id)]);await db.end();
 await fs.writeFile('.factory/autopilot/qa/switcher-results.json',JSON.stringify({at:new Date().toISOString(),businesses:biz.map(b=>({id:b.id,name:b.profile.business.name})),results},null,2));
}
process.exit(results.some(r=>!r.pass)?1:0);
