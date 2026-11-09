// Local-only migration proof. Creates fresh isolated databases and never calls a provider.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const adminUrl = process.env.EDUCATION_LOCAL_ADMIN_URL || 'postgres://postgres@127.0.0.1:54329/postgres';
const local = new URL(adminUrl);
assert(['127.0.0.1', 'localhost'].includes(local.hostname));
assert.equal(local.pathname, '/postgres');
const canonical = execFileSync('git', ['show', 'origin/main:drizzle/0009_signup_security.sql']);
assert.deepEqual(await readFile('drizzle/0009_signup_security.sql'), canonical, 'Canonical shipped signup migration must remain byte-identical');
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
async function folderThrough(idx) {
  const dir = await mkdtemp(path.join(tmpdir(), 'radar-education-migrations-'));
  await mkdir(path.join(dir, 'meta'));
  const entries = journal.entries.filter(e => e.idx <= idx);
  await writeFile(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) await copyFile(`drizzle/${entry.tag}.sql`, path.join(dir, `${entry.tag}.sql`));
  return dir;
}
const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
const suffix = Date.now(); const results = [];
try {
  for (const mode of ['clean', 'upgrade']) {
    const name = `radar_education_${mode}_${suffix}`; assert(/^radar_education_\w+$/.test(name));
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(adminUrl); url.pathname = '/' + name;
    const pool = new pg.Pool({ connectionString: url.href });
    try {
      const db = drizzle(pool);
      if (mode === 'upgrade') {
        await migrate(db, { migrationsFolder: await folderThrough(9) });
        assert.equal(Number((await pool.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count), 10);
        await assert.rejects(pool.query('SELECT education FROM user_email_preferences LIMIT 0'));
        await migrate(db, { migrationsFolder: await folderThrough(11) });
        const uid = (await pool.query("INSERT INTO users(name,email,email_verified_at) VALUES('Old opted out','old@test.local',now()) RETURNING id")).rows[0].id;
        await pool.query('INSERT INTO user_email_preferences(user_id,daily_brief,calendar_reminders,article_social,onboarding) VALUES($1,false,false,false,false)', [uid]);
        await assert.rejects(pool.query('SELECT education FROM user_email_preferences LIMIT 0'));
      }
      await migrate(db, { migrationsFolder: 'drizzle' });
      assert.equal(Number((await pool.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count), 13);
      await pool.query('SELECT p.education,p.daily_brief_since,e.next_lesson,e.pending_email_id,m.payload_enc,m.claim_token,u.email_verified_at FROM user_email_preferences p CROSS JOIN education_enrollments e CROSS JOIN lifecycle_emails m CROSS JOIN users u LIMIT 0');
      if (mode === 'upgrade') {
        const old = (await pool.query('SELECT * FROM user_email_preferences')).rows[0];
        assert.equal(old.daily_brief, false); assert.equal(old.calendar_reminders, false); assert.equal(old.article_social, false); assert.equal(old.education, null); assert.equal(old.onboarding, false);
      }
      const uid = (await pool.query("INSERT INTO users(name,email,email_verified_at) VALUES('Fresh','fresh@test.local',now()) RETURNING id")).rows[0].id;
      const pref = (await pool.query('INSERT INTO user_email_preferences(user_id) VALUES($1) RETURNING *', [uid])).rows[0];
      assert(pref.daily_brief && pref.calendar_reminders && pref.article_social); assert.equal(pref.education, null);
      const mid = (await pool.query("INSERT INTO lifecycle_emails(user_id,event_key,type,payload_enc,expires_at) VALUES($1,$2,'weekly_education','test-only',now()+interval'30 days') RETURNING id", [uid, `migration:${uid}`])).rows[0].id;
      await pool.query('INSERT INTO education_enrollments(user_id,pending_email_id) VALUES($1,$2)', [uid, mid]);
      await assert.rejects(pool.query('DELETE FROM lifecycle_emails WHERE id=$1', [mid]));
      await pool.query('DELETE FROM users WHERE id=$1', [uid]);
      assert.equal((await pool.query('SELECT id FROM lifecycle_emails WHERE id=$1', [mid])).rowCount, 0);
      results.push({ mode, database: name, migrations: 13, readiness: 'passed', storedOptouts: mode === 'upgrade' ? 'preserved' : 'not-applicable', newWorkDefaults: 'on', pendingDeletion: 'restricted', accountCascade: 'passed' });
    } finally { await pool.end(); }
  }
} finally { await admin.end(); }
await writeFile('.factory/weekly-education/runtime-migrations.json', JSON.stringify({ canonicalSignupChecksum: 'byte-identical to origin/main', results }, null, 2) + '\n');
console.log(JSON.stringify({ results }, null, 2));
