import { chromium, session, text, shot, db, BASE } from './lib.mjs';
const pool = db(); const b = await chromium.launch();
const { page } = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2 });
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
console.log('start', page.url());
const dlg = page.locator('[role=dialog]').last();
await dlg.locator('input').first().fill(process.argv[2] || 'solobakery.test');
await dlg.getByRole('button', { name: 'Analyze website' }).click();
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(2500);
  if (!(await dlg.count())) { console.log('dialog closed'); break; }
  const next = dlg.getByRole('button', { name: /^(review what radar found|looks right|skip for now|save profile)/i }).last();
  if (await next.count() && await next.isEnabled()) { console.log('click:', (await next.innerText()).replace(/\n/g, ' ')); await next.click(); }
}
await page.waitForTimeout(4000);
console.log('FINAL', page.url(), (await text(page)).slice(0, 120).replace(/\n/g, ' '));
console.log(JSON.stringify((await pool.query("select b.id, b.domain, b.status from businesses b join users u on u.id=b.owner_id where u.email='solo.qa@radar.local'")).rows));
await b.close(); await pool.end();
