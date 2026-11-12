// QA-1 browser smoke, step 1: an isolated local database with synthetic accounts and articles.
//   node .factory/sandbox-publisher/qa/browser-setup.mjs
// Needs a local Postgres that accepts `postgres` on 127.0.0.1:54331 (QA used a throwaway cluster made with initdb).
// Writes .data/sandbox-publisher/qa/browser/{local-env.json,fixture.json} (git-ignored, mode 600). The test password is
// generated here and stored only in fixture.json. Every provider key is blank: dev stubs, no email, no billing.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import pg from 'pg';

const output = '.data/sandbox-publisher/qa/browser';
const PORT = 3853;
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const database = 'radar_lantern_qa';
const local = 'postgres://postgres@127.0.0.1:54331/postgres';
const admin = new pg.Pool({ connectionString: local });
await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${database}`);
await admin.end();

// Blank every key the app knows about, then set only what a local stubbed run needs.
const blank = {};
for (const filename of ['.env.example', '.env', '.env.local']) {
  const source = await fs.readFile(filename, 'utf8').catch(() => '');
  for (const line of source.split('\n')) { const match = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line); if (match) blank[match[1]] = ''; }
}
const url = new URL(local); url.pathname = '/' + database;
const environment = {
  ...blank, DATABASE_URL: url.href, NODE_ENV: 'development', RADAR_DEV_STUBS: '1', RADAR_BILLING: 'off', RADAR_REAL_CONNECTORS: '', RADAR_SECRET_KEY: 'lantern-local-qa-only-' + crypto.randomBytes(8).toString('hex'),
  APP_URL: `http://localhost:${PORT}`, PORT: String(PORT), NEXT_DIST_DIR: '.next-publishing', NEXT_TELEMETRY_DISABLED: '1', STORAGE_DIR: `${output}/uploads`,
  // The switch is ON for every business here, with nothing configured behind it, to show that the UI is the same either way.
  RADAR_PUBLISH_SANDBOX: 'all',
};
await fs.writeFile(`${output}/local-env.json`, JSON.stringify(environment), { mode: 0o600 });
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...environment };
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/db/migrate.ts'], { env: childEnv, encoding: 'utf8' });
await fs.writeFile(`${output}/migration.log`, migration.stdout + migration.stderr);
if (migration.status !== 0) throw new Error('migration failed; see the git-ignored migration.log');

const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
const profile = { domain: 'lantern-qa.test', business: { name: 'Lantern QA Co', description: 'Synthetic business for a QA smoke test.', offerings: ['Testing'], industry: 'Software', positioning: 'Synthetic', differentiators: ['Synthetic'] }, audience: { segments: ['Testers'], buyers: ['Testers'], needs: ['Tests'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain', language: 'English (US)', markets: ['United States'] } };
const label = 'lanternqa-' + Date.now().toString(36);
const password = 'Qa-' + crypto.randomBytes(12).toString('base64url');
const users = {};
for (const role of ['Owner', 'Viewer', 'Outsider']) {
  users[role] = (await db.query('INSERT INTO users(name,email,email_verified_at,password_hash) VALUES($1,$2,now(),$3) RETURNING id,email', [`QA ${role}`, `${label}-${role.toLowerCase()}@test.local`, role === 'Owner' ? await bcrypt.hash(password, 11) : null])).rows[0];
}
const business = (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone) VALUES($1,$2,'active',$3,'UTC') RETURNING id", [users.Owner.id, profile.domain, profile])).rows[0];
for (const role of ['Owner', 'Viewer']) await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,$4,'active')", [business.id, users[role].id, users[role].email, role]);
// Viewer and Outsider use provisioned sessions for the authorization checks; the Owner signs in through the form.
const sessions = {};
for (const role of ['Viewer', 'Outsider']) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [crypto.createHash('sha256').update(token).digest('hex'), users[role].id]);
  sessions[role] = token;
}
const conn = (await db.query("INSERT INTO connections(business_id,type,url,target,fields,status) VALUES($1,'nextjs','https://github.com/qa/site','qa/site',$2,'ok') RETURNING id", [business.id, { repo: 'qa/site', path: 'content/posts' }])).rows[0];

// Failures as publishEntry persists them for the new engine: every string that must never reach a customer carries a
// sentinel, so the browser check can search pages and responses for it.
const S = 'QASENTINEL';
const failures = {
  fidelity: { http: 422, message: '422 Unprocessable Entity', platform: 'GitHub', source: 'radar', hint: `the article was not carried over faithfully: 1 of 13 paragraphs and list items have changed or dropped words: paragraph 8 ${S}-FIDELITY`,
    diagnostic: { code: 'article-fidelity', stage: 'repair', reason: `the article was not carried over faithfully ${S}-FIDELITY-REASON sandbox agent`, path: `apps/web/app/blog/posts.ts-${S}-PATH`, issues: [`paragraph 8 ${S}-ISSUE`], origin: { code: 'article-fidelity', stage: 'validation', reason: `first refusal ${S}-ORIGIN` } } },
  egress: { http: 503, message: '503 Service Unavailable', platform: 'GitHub', source: 'radar', hint: `Radar could not confirm that the sandbox reaches only the model proxy: the egress probe failed (${S}-EGRESS code=canary_reachable host=api.github.com). No repository content was uploaded.`,
    diagnostic: { code: 'sandbox-egress-unverified', stage: 'plan', reason: `Radar could not confirm that the sandbox reaches only the model proxy ${S}-EGRESS-REASON` } },
  agent: { http: 422, message: '422 Unprocessable Entity', platform: 'GitHub', source: 'radar', hint: `The agent run ended with an error (AgentApiError:400) after 3 turns. The provider said: invalid_request_error: ${S}-PROVIDER this client does not support this model`,
    diagnostic: { code: 'agent-failed', stage: 'plan', reason: `The agent run ended with an error (AgentApiError:400) ${S}-AGENT-REASON` } },
  declined: { http: 422, message: '422 Unprocessable Entity', platform: 'GitHub', source: 'radar', hint: `the agent reported that it could not integrate the article. Its explanation, not verified by Radar, was ${S}-AGENT-TEXT the repository has no blog`,
    diagnostic: { code: 'agent-declined', stage: 'validation', reason: `the agent reported that it could not integrate the article ${S}-DECLINED-REASON` } },
  budget: { http: 422, message: '422 Unprocessable Entity', platform: 'GitHub', source: 'radar', hint: `The agent run reached its model budget before finishing (AgentBudgetExhausted). ${S}-BUDGET`,
    diagnostic: { code: 'agent-budget', stage: 'plan', reason: `The agent run reached its model budget ${S}-BUDGET-REASON`, actual: 200, limit: 200 } },
  teardown: { http: 502, message: '502 Bad Gateway', platform: 'GitHub', source: 'radar', hint: `Creating the sandbox failed (DaytonaError: ${S}-DAYTONA quota).`,
    diagnostic: { code: 'sandbox-unavailable', stage: 'plan', reason: `Creating the sandbox failed ${S}-DAYTONA-REASON` } },
};
// Titles, ids and bodies use neutral labels, so that an operator word found in a page can only have come from a failure record.
const LABEL = { fidelity: 'one', egress: 'two', agent: 'three', declined: 'four', budget: 'five', teardown: 'six' };
const entries = {};
const article = (id, slug, text) => ({ entryId: id, generated: true, body: [['p', text], ['h2', 'A second section'], ['p', 'The complete synthetic article stays available after publishing fails.']], brief: { angle: 'QA fixture', outline: [], words: 900 }, seo: { title: 'Synthetic article', meta: 'QA', slug }, img: { style: 'branded', seed: 1, prompt: '', alt: '', url: null }, videos: [], videoMeta: [], sources: [], claims: [] });
for (const [kind, error] of Object.entries(failures)) {
  const id = `e_lanternqa_${LABEL[kind]}`; entries[kind] = id;
  await db.query("INSERT INTO calendar_entries(id,business_id,title,kw,type,date,dest,status,publish_error,publish_attempts) VALUES($1,$2,$3,'lantern qa','How-to',current_date,$4,'failed',$5,1)", [id, business.id, `Synthetic failed article ${LABEL[kind]}`, conn.id, error]);
  await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [id, business.id, article(id, `lanternqa-${LABEL[kind]}`, `Synthetic body of article ${LABEL[kind]}, written for a QA smoke test.`)]);
}
entries.publishing = 'e_lanternqa_seven';
await db.query("INSERT INTO calendar_entries(id,business_id,title,kw,type,date,dest,status) VALUES($1,$2,$3,'lantern qa','How-to',current_date,$4,'publishing')", [entries.publishing, business.id, 'Synthetic article seven', conn.id]);
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.publishing, business.id, article(entries.publishing, 'lanternqa-seven', 'Synthetic body of article seven, written for a QA smoke test.')]);
await db.query('UPDATE businesses SET blog=$2 WHERE id=$1', [business.id, { defaultId: conn.id }]);
await fs.writeFile(`${output}/fixture.json`, JSON.stringify({ base: environment.APP_URL, businessId: business.id, users, password, sessions, entries, labels: LABEL, connId: conn.id, sentinel: S }), { mode: 0o600 });
await db.end();
console.log('QA database migrated and seeded: one owner (password sign-in), one viewer, one outsider, six failed articles, one publishing article.');
