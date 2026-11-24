// Q1 setup: throwaway DB radar_qa_r, synthetic users/businesses/sessions, stub social accounts. No real providers.
// Session tokens and env live in .data/custom-post-qa (git-ignored) and never enter evidence.
import fs from 'node:fs/promises';
import pg from 'pg';
import crypto from 'node:crypto';
const runtime = '.data/custom-post-qa';
await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
const blank = {};
for (const filename of ['.env.example']) {
  const source = await fs.readFile(filename, 'utf8').catch(() => '');
  for (const line of source.split('\n')) { const m = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line); if (m) blank[m[1]] = ''; }
}
const PORT = process.env.QA_PORT || '3871';
const environment = { ...blank, DATABASE_URL: 'postgres://postgres@127.0.0.1:55432/radar_qa_r', NODE_ENV: 'development', RADAR_DEV_STUBS: '1', RADAR_SOCIAL_PUBLISHING: 'all', RADAR_BILLING: 'off', RADAR_SECRET_KEY: 'custom-post-qa-local-only', APP_URL: 'http://localhost:' + PORT, NEXT_TELEMETRY_DISABLED: '1', STORAGE_DIR: runtime + '/uploads', RADAR_FAILURE_ALERTS: 'off' };
await fs.writeFile(runtime + '/local-env.json', JSON.stringify(environment), { mode: 0o600 });
Object.assign(process.env, environment);
const { encrypt } = await import('../../../src/server/crypto.ts');
const { stubTokens } = await import('../../../src/server/services/social/publish/stubs.ts');
const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
const profile = (name, domain) => ({ domain, business: { name, description: 'Calendar based time tracking for designers.', offerings: ['Time tracking'], industry: 'Software', positioning: 'Simple billable time tracking', differentiators: ['Calendar based'] }, audience: { segments: ['Designers'], buyers: ['Freelancers'], needs: ['Track billable time'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain', language: 'English (US)', markets: ['United States'] } });
const label = 'customqa-' + Date.now();
const users = {};
for (const role of ['Owner', 'Editor', 'Viewer', 'Outsider']) users[role] = (await db.query('INSERT INTO users(name,email,email_verified_at) VALUES($1,$2,now()) RETURNING id,email', ['Custom QA ' + role, label + '-' + role.toLowerCase() + '@test.local'])).rows[0];
const business = (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone,social_auto) VALUES($1,$2,'active',$3,'Asia/Dubai',$4) RETURNING id", [users.Owner.id, 'custom-qa.test', profile('Custom QA', 'custom-qa.test'), { on: false, platforms: ['x', 'linkedin'], style: 'branded', time: '08:00' }])).rows[0];
const other = (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone) VALUES($1,$2,'active',$3,'UTC') RETURNING id", [users.Outsider.id, 'other-custom-qa.test', profile('Other QA', 'other-custom-qa.test')])).rows[0];
for (const role of ['Owner', 'Editor', 'Viewer']) await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,$4,'active')", [business.id, users[role].id, users[role].email, role]);
await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,'Owner','active')", [other.id, users.Outsider.id, users.Outsider.email]);
const sessions = {};
for (const [role, user] of Object.entries(users)) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '2 day')", [crypto.createHash('sha256').update(token).digest('hex'), user.id]); sessions[role] = token;
}
for (const ch of ['x', 'li_profile', 'instagram', 'tiktok', 'youtube'])
  await db.query('INSERT INTO social_accounts(business_id,ch,remote_id,name,handle,tokens_enc,expires_at,connected_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [business.id, ch, 'stub-' + ch + '-qa', 'Custom QA', '@customqa', encrypt(stubTokens(ch)), new Date(Date.now() + 50 * 864e5), users.Owner.id]);
await fs.writeFile(runtime + '/fixture.json', JSON.stringify({ businessId: business.id, otherBusinessId: other.id, users, sessions }), { mode: 0o600 });
await db.end();
console.log('radar_qa_r seeded: business (Asia/Dubai) with Owner/Editor/Viewer, other business, stub accounts x/li_profile/instagram/tiktok/youtube.');
