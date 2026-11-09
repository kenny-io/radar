import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
const env=JSON.parse(await fs.readFile('.data/autopilot/local-env.json','utf8'));assert.equal(new URL(env.DATABASE_URL).pathname,'/radar_autopilot_release_qa');const db=new pg.Pool({connectionString:env.DATABASE_URL});
const template=(await db.query('SELECT profile FROM businesses LIMIT 1')).rows[0].profile;const tag=crypto.randomUUID(),email=`handoff-login-${tag}@test.local`,password='QAOnlyLogin123!';
const user=(await db.query('INSERT INTO users(name,email,password_hash,email_verified_at) VALUES($1,$2,$3,now()) RETURNING id',['Handoff login QA',email,await bcrypt.hash(password,4)])).rows[0];const businesses=[];
for(const name of ['Intended email business','Previously selected business']){const profile={...template,business:{...template.business,name},domain:name.toLowerCase().replaceAll(' ','-')+'-'+tag+'.test'};const b=(await db.query("INSERT INTO businesses(owner_id,domain,status,profile) VALUES($1,$2,'active',$3) RETURNING id",[user.id,profile.domain,profile])).rows[0];await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,'Owner','active')",[b.id,user.id,email]);businesses.push(b)}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),c=await browser.newContext({viewport:{width:1440,height:1000}});await c.addCookies([{name:'radar_biz',value:businesses[1].id,url:env.APP_URL}]);const p=await c.newPage();p.setDefaultTimeout(30000);const results=[];
const check=async(name,fn)=>{try{results.push({name,pass:true,detail:await fn()})}catch(e){results.push({name,pass:false,error:e.stack})}console.log(JSON.stringify(results.at(-1)))};
try{
 await check('AC5 Signed-out email link signs in and returns to the intended owned business',async()=>{
  const next='/settings?section=autopilot',hop='/api/b/current?id='+businesses[0].id+'&next='+encodeURIComponent(next);await p.goto(env.APP_URL+hop);await p.getByRole('heading',{name:'Sign in',exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,'/signin');
  assert.equal(new URL(p.url()).searchParams.get('next'),hop);await p.locator('input[type=email]').fill(email);await p.locator('input[type=password]').fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.getByRole('switch',{name:'Autopilot',exact:true}).waitFor();
  assert.equal((await(await c.request.get(env.APP_URL+'/api/me')).json()).currentId,businesses[0].id);await p.getByText('Intended email business ·',{exact:false}).waitFor();await p.screenshot({path:'.factory/autopilot/release-qa/signedout-handoff-return.png',fullPage:true});return{signedOutRedirectedToLogin:true,exactBusinessHopPreserved:true,previousBusinessOverriddenAfterAuth:true};
 });
 await check('AC8 Unauthenticated POST current-business change remains unauthorized',async()=>{const anonymous=await browser.newContext();const response=await anonymous.request.post(env.APP_URL+'/api/b/current',{data:{id:businesses[0].id}});assert.equal(response.status(),401);await anonymous.close();return{post401:true}});
 await check('AC8 Arbitrary API next through login remains rejected',async()=>{const response=await c.request.post(env.APP_URL+'/api/auth/signin',{data:{email,password,next:'/api/health'}});assert.equal(response.status(),200);assert.equal((await response.json()).next,'/dashboard');return{arbitraryApiNextFallsBackToDashboard:true}});
}finally{await browser.close();await db.end();await fs.writeFile('.factory/autopilot/release-qa/signedout-results.json',JSON.stringify({at:new Date().toISOString(),results},null,2))}process.exit(results.some(r=>!r.pass)?1:0);
