// DEV QA (not shipped): one onboarding/profile step per run (resumable). node scripts/.ob-step.mjs <email> <step> <outprefix> [width] [domain]
import { chromium } from 'playwright';
const [email, step, out, width = '1440', domain = 'fieldnote.app'] = process.argv.slice(2);
const base = 'http://localhost:3101';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: process.env.NOGPU ? ['--disable-gpu'] : [] });
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 } });
const page = await ctx.newPage(); page.setDefaultTimeout(600000); page.setDefaultNavigationTimeout(600000);
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' && !/hydrated but some attributes/.test(m.text())) console.log('[console]', m.text().slice(0, 400)); });
const shot = async (n, full) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}-${n}.png`, fullPage: !!full, timeout: 600000 }); console.log('shot', n); };
const r = await page.request.post(base + '/api/auth/signin', { data: { email, password: 'password123' } }); if (!r.ok()) throw new Error('login ' + r.status());
const go = async (p = '/dashboard') => { await page.goto(base + p, { waitUntil: 'domcontentloaded' }); };
const btn = n => page.getByRole('button', { name: n });
if (step === 'domain') {
  await go(); await page.getByText('Let’s get to know your business.').waitFor(); await shot('a-domain');
  await page.getByLabel('Website domain').fill('not a domain'); await btn('Analyze website').click(); await shot('b-domain-error');
  await page.getByLabel('Website domain').fill('https://www.' + domain + '/about'); await btn('Analyze website').click();
  await page.getByText('Scanning').waitFor(); await page.waitForTimeout(2600); await shot('c-analyzing');
  const res = await Promise.race([page.getByText('Review what Radar found').waitFor().then(() => 'done'), page.getByText('Change domain').waitFor().then(() => 'fail')]);
  await shot('d-' + res);
  if (res === 'fail') { await btn('Try again').click(); await page.waitForTimeout(500); await page.getByText('Change domain').waitFor(); await shot('e-fail-again'); await btn('Change domain').click(); await shot('f-change-domain'); }
} else if (step === 'resume') {
  await go(); await page.getByText(/Here’s what Radar found|Scanning|Analysis complete|Let’s get to know/).first().waitFor(); await page.waitForTimeout(2500); await shot('resume');
} else if (step === 'review') {
  await go(); await page.getByText('Here’s what Radar found.').waitFor(); await shot('a-review-business');
  await page.locator('textarea').nth(1).fill('The calm time tracker for people who bill by the hour, not managers who monitor them.');
  await page.waitForTimeout(2500); await shot('b-review-edited');
  await page.locator('.review-nav button').nth(1).click(); await shot('c-review-audience');
  await page.locator('.review-nav button').nth(3).click(); await shot('d-review-brand', true);
} else if (step === 'keywords') {
  await go(); await page.getByText('Here’s what Radar found.').waitFor(); await page.locator('.review-nav button').nth(2).click();
  await page.getByPlaceholder('Add a keyword your customers search for').fill('best invoice app for designers'); await page.locator('form button[type=submit]', { hasText: 'Add' }).click();
  await page.getByText('Estimating…').first().waitFor({ timeout: 20000 }).catch(() => console.log('no Estimating… seen'));
  await shot('a-kw-estimating');
  await page.locator('button[aria-label="Make priority"]').first().click(); await page.waitForTimeout(300); await page.locator('button[aria-label="Make priority"]').first().click();
  await btn(/suggested keywords/).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Estimating…'), null, { timeout: 300000 }).catch(() => console.log('still estimating'));
  await shot('b-kw-estimated', true);
} else if (step === 'reanalyze') {
  await go(); await page.getByText('Here’s what Radar found.').waitFor(); await btn('Re-analyze').click(); await page.getByText('Scanning').waitFor(); await shot('a-reanalyzing');
  await page.getByText('Review what Radar found').waitFor(); await shot('b-reanalyzed'); await btn('Review what Radar found').click(); await page.getByText('Here’s what Radar found.').waitFor(); await shot('c-after');
} else if (step === 'finish') {
  await go(); await page.getByText('Here’s what Radar found.').waitFor(); await btn('Looks right').click();
  await page.getByText('Read-only. Radar never changes your Search Console settings.').waitFor(); await shot('a-gsc');
  await btn('Skip for now').click(); await page.getByText('Your Business Profile is ready.').waitFor(); await shot('b-save', true);
  await btn('Save profile & open dashboard').click(); await page.getByText('Business Profile saved').waitFor(); await shot('c-dashboard');
} else if (step === 'profile') {
  await go('/profile'); await page.getByText('Re-analyze website').waitFor(); await shot('a-profile', true);
} else if (step === 'profile-edit') {
  await go('/profile'); await page.getByText('Re-analyze website').waitFor();
  await page.locator('input.input').nth(1).fill('B2B software · Time tracking'); await page.getByText('All changes saved').waitFor(); await page.waitForTimeout(2500); await shot('a-edited');
  await go('/profile'); await page.getByText('Re-analyze website').waitFor(); console.log('industry after reload:', await page.locator('input.input').nth(1).inputValue()); await shot('b-reloaded');
  await btn('Re-analyze website').click(); await page.waitForTimeout(1500); await shot('c-reanalyzing');
  await page.getByText(/Re-analyzed .* edits were kept\./).waitFor(); await shot('d-reanalyzed-toast');
  console.log('industry after reanalyze:', await page.locator('input.input').nth(1).inputValue());
}
await browser.close();
