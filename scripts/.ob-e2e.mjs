// DEV QA: full onboarding flow. node scripts/.ob-e2e.mjs <domain> <outprefix> [width] [--gsc]
import { chromium } from 'playwright';
const [domain, out, width = '1440'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const withGsc = process.argv.includes('--gsc');
const base = 'http://localhost:3101';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: process.env.NOGPU ? ['--disable-gpu'] : [] });
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 } });
let page = await ctx.newPage();
const wire = pg => { pg.setDefaultTimeout(900000); pg.setDefaultNavigationTimeout(900000); pg.on('pageerror', e => console.log('[pageerror]', e.message)); pg.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 600)); }); };
wire(page);
const shot = async n => { await page.screenshot({ path: `${out}-${n}.png` }); console.log('shot', n); };
await page.goto(base + '/signup', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForTimeout(300); await shot('01-signup-errors');
const email = `qa+${Date.now()}@example.com`;
await page.getByLabel('Name').fill('Maya Chen'); await page.getByLabel('Work email').fill(email); await page.getByLabel('Password').fill('password123');
await page.route('**/dashboard', r => r.abort());
const [resp] = await Promise.all([page.waitForResponse(r => r.url().includes('/api/auth/signup')), page.getByRole('button', { name: 'Create account' }).click()]);
console.log('signup', resp.status());
await page.close(); page = await ctx.newPage(); wire(page);
await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded' });
await page.getByText('Let’s get to know your business.').waitFor();
await page.waitForTimeout(1200); await shot('02-domain');
await page.getByLabel('Website domain').fill('not a domain'); await page.getByRole('button', { name: 'Analyze website' }).click();
await page.waitForTimeout(300); await shot('03-domain-error');
await page.getByLabel('Website domain').fill('https://www.' + domain + '/about');
await page.getByRole('button', { name: 'Analyze website' }).click();
await page.getByText('Scanning').waitFor(); await page.waitForTimeout(2500); await shot('04-analyzing');
const r = await Promise.race([page.getByText('Review what Radar found').waitFor().then(() => 'done'), page.getByText('Change domain').waitFor().then(() => 'fail')]);
await page.waitForTimeout(800); await shot('05-analyzed-' + r);
if (r === 'fail') {
  await page.getByRole('button', { name: 'Try again' }).click(); await page.getByText('Change domain').waitFor(); await page.waitForTimeout(500); await shot('06-fail-again');
  await page.getByRole('button', { name: 'Change domain' }).click(); await page.waitForTimeout(500); await shot('07-change-domain');
  // reload resume check
  await page.reload({ waitUntil: 'commit' }); await page.waitForTimeout(4000); await shot('08-reload'); await browser.close(); process.exit(0);
}
await page.getByRole('button', { name: 'Review what Radar found' }).click();
await page.getByText('Here’s what Radar found.').waitFor(); await page.waitForTimeout(600); await shot('06-review-business');
const pos = page.locator('textarea').nth(1); await pos.fill('The calm time tracker for people who bill by the hour.');
await page.waitForTimeout(1500); await shot('07-review-edited');
// reload mid-onboarding → resumes on Review with edit kept
await page.reload({ waitUntil: 'commit' }); await page.getByText('Here’s what Radar found.').waitFor(); await page.waitForTimeout(1500); await shot('08-reload-resume');
await page.getByRole('button', { name: /^Audience/ }).first().click(); await page.waitForTimeout(500); await shot('09-review-audience');
await page.getByRole('button', { name: /^Keywords/ }).first().click(); await page.waitForTimeout(500);
await page.getByPlaceholder('Add a keyword your customers search for').fill('best invoice app for designers'); await page.getByRole('button', { name: 'Add', exact: true }).first().click();
await page.waitForTimeout(400); await shot('10-review-keywords-estimating');
await page.locator('button[aria-label="Make priority"]').first().click(); await page.waitForTimeout(300);
await page.getByRole('button', { name: /suggested keywords/ }).click(); await page.waitForTimeout(6000); await shot('11-review-keywords-estimated');
await page.getByRole('button', { name: /^Brand/ }).first().click(); await page.waitForTimeout(800); await shot('12-review-brand');
await page.getByRole('button', { name: 'Re-analyze' }).click(); await page.getByText('Scanning').waitFor(); await page.getByText('Review what Radar found').waitFor(); await page.waitForTimeout(500); await shot('13-reanalyzed');
await page.getByRole('button', { name: 'Review what Radar found' }).click(); await page.waitForTimeout(800); await shot('14-review-after-reanalyze');
await page.getByRole('button', { name: 'Looks right' }).click(); await page.getByText('Connect Google Search Console', { exact: true }).first().waitFor(); await page.waitForTimeout(600); await shot('15-gsc');
await page.getByRole('button', { name: 'Skip for now' }).click(); await page.getByText('Your Business Profile is ready.').waitFor(); await page.waitForTimeout(600); await shot('16-save');
await page.getByRole('button', { name: 'Save profile & open dashboard' }).click();
await page.getByText('Business Profile saved').waitFor(); await page.waitForTimeout(800); await shot('17-dashboard');
console.log('USER', email);
await browser.close();
