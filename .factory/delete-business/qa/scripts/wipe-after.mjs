import fs from 'node:fs';
import { chromium, session, call, db, A, Bz, BASE } from './lib.mjs'; import { files, mentions, world, diffWorld } from './wipe-lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e', P = 'e109d5fa-e0b2-4bfb-9dc6-c98a933e2037';
const before = JSON.parse(fs.readFileSync(new URL('./wipe-before2.json', import.meta.url).pathname, 'utf8'));
const pool = db(); const ok = (name, pass, detail = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
for (let i = 0; i < 60; i++) { if (!(await pool.query('select 1 from businesses where id=$1', [A])).rows.length) break; await new Promise(r => setTimeout(r, 2000)); }
const job = (await pool.query("select status, result, ref, created_at, finished_at from jobs where kind='business.purge' order by created_at desc limit 1")).rows[0];
console.log('the job the cron enqueued:', JSON.stringify(job));
console.log('cron marks:', (await pool.query("select key from cron_marks where key like 'biz-purge%' order by 1")).rows.map(r => r.key).join(', '));
ok('PUR-1 the worker\'s own cron enqueued the job and it wiped the business', !(await pool.query('select 1 from businesses where id=$1', [A])).rows.length && job.status === 'done' && job.result.wiped === 1);
ok('PUR-5 the job result is counts only', JSON.stringify(Object.keys(job.result).sort()) === JSON.stringify(['due', 'failed', 'filesDeleted', 'filesKept', 'wiped']) && Object.values(job.result).every(v => typeof v === 'number'), JSON.stringify(job.result));
const m = await mentions(pool, A);
ok('PUR-2 no row in any table mentions the business id', Object.keys(m).length === 0, 'tables still mentioning it: ' + (JSON.stringify(m)));
for (const [needle, label] of [['fieldnote.app', 'domain'], ['Fieldnote', 'name']]) console.log(`  rows still naming the ${label} "${needle}" (kept list, decision D, and other accounts' records):`, JSON.stringify(await mentions(pool, needle)));
// files
const now = files(); const mine = k => k.startsWith(A + '/');
const expectKept = [`${A}/hero/1794841785350-s9JH4szR.png`, `${A}/hero/1794841785377-U9VzgzAR.png`, `${A}/hero/1794841899837-af3INa38.png`, `${A}/body/e1-a.png`, `${A}/body/e1-b.png`].sort();
const left = Object.keys(now).filter(k => mine(k) && !k.endsWith('.type')).sort(); const leftAll = Object.keys(now).filter(mine).sort();
ok('decision A/K: the files left under the prefix are exactly the covers and body images of published (or written-to-site) articles', JSON.stringify(left) === JSON.stringify(expectKept), 'left: ' + left.map(k => k.replace(A + '/', '')).join(', '));
ok('each kept file still has its content-type sidecar and nothing else is left', leftAll.length === expectKept.length * 2 && expectKept.every(k => now[k] === before.files[k] && now[k + '.type'] === before.files[k + '.type']), `${leftAll.length} files`);
ok('the job counted them: filesKept = 5, filesDeleted = every other file', job.result.filesKept === 5 && job.result.filesDeleted === Object.keys(before.files).filter(k => mine(k) && !k.endsWith('.type')).length - 5, `kept ${job.result.filesKept}, deleted ${job.result.filesDeleted}, before ${Object.keys(before.files).filter(k => mine(k) && !k.endsWith('.type')).length}`);
const others = Object.keys(before.files).filter(k => !mine(k)); const changed = others.filter(k => now[k] !== before.files[k]);
ok('every file outside the prefix is untouched, byte for byte (other businesses, the id that differs in one character, folders that only share the prefix, the symlink\'s target)', changed.length === 0 && others.length > 0, `${others.length} files compared; changed: ${changed.join(', ') || 'none'}`);
console.log('  neighbour folders:', [...new Set(others.map(k => k.split('/')[0]))].join(', '));
for (const k of expectKept) { const r = await fetch(`${BASE}/api/files/${k}`); if (r.status !== 200 || !/image\/png/.test(r.headers.get('content-type') || '')) ok('kept file served: ' + k, false, String(r.status)); }
ok('the kept files are still served at the same URLs', (await Promise.all(expectKept.map(k => fetch(`${BASE}/api/files/${k}`).then(r => r.status)))).every(s => s === 200));
const goneUrls = Object.keys(before.files).filter(k => mine(k) && !k.endsWith('.type') && !expectKept.includes(k));
const st = await Promise.all(goneUrls.map(k => fetch(`${BASE}/api/files/${k}`).then(r => r.status)));
ok('every other file of the business answers 404 (draft cover and body image, logo, social images, replaced image)', st.every(s => s === 404), goneUrls.map((k, i) => k.replace(A + '/', '') + '=' + st[i]).join(' '));
// neighbours and the account
const after = await world(pool, { B: Bz, Solo: SOLO, P });
const d = diffWorld(before.world, after); const noise = /\.(jobs|events|notifications|ai_calls|businesses|proposals) /;
console.log('  differences outside the wiped business:', d.join(' ; ') || 'none');
ok('the neighbouring businesses\' rows are untouched (other business of the owner, another account\'s business, the one-character neighbour)', d.filter(x => !noise.test(x)).length === 0, 'only their own background work and the proposals naming the wiped business changed');
ok('the owner\'s account, sessions and billing row are intact', ['users', 'billing_accounts', 'sessions'].every(t => JSON.stringify(before.world[t]) === JSON.stringify(after[t])), JSON.stringify({ users: after.users.n, billing: after.billing_accounts.n, sessions: after.sessions.n }));
const props = (await pool.query("select left(business_id::text,8) biz, direction, partner_business_id is not null has_partner, decision from proposals order by 1,2")).rows;
console.log('  proposals before:', JSON.stringify(before.props)); console.log('  proposals after: ', JSON.stringify(props));
ok('DEL-6/PUR-2 other accounts: undecided proposals naming it are gone; the decided one stays without the id; their live link stays', props.length === 1 && props[0].biz === '36b937ef' && props[0].decision === 'approved' && props[0].has_partner === false && Number((await pool.query('select count(*) n from live_links where business_id=$1', [SOLO])).rows[0].n) === 1, `${props.length} proposal(s) left`);
const c = (await pool.query("select (select count(*) from events) events, (select count(*) from ai_calls) ai_calls from businesses limit 1")).rows[0];
const bare = (await pool.query("select count(*) n from events where business_id is null and user_id is null and ref is null and props = '{}'::jsonb")).rows[0].n;
ok('decision E: its events are kept as bare counters and its AI calls without the id', Number(c.ai_calls) >= Number(before.counts.ai_calls) && Number(bare) >= Number(before.counts.events_a) && Number(c.events) >= Number(before.counts.events), `events ${before.counts.events}→${c.events} (bare: ${bare}), ai_calls ${before.counts.ai_calls}→${c.ai_calls}`);
ok('lifecycle guide state keeps the account row without the business', (await pool.query("select source_business_id from lifecycle_guide_states where guide_id='article_workflow'")).rows[0]?.source_business_id === null);
// the people
const b = await chromium.launch(); const own = await session(b, 'dev@radar.local'); const p = own.page; await p.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
const me = (await call(p, 'GET', '/api/me')).body;
ok('the owner still signs in and has their other business', me.businesses.length === 1 && me.businesses[0].id === Bz && me.deleted.length === 0 && /Lumenstudio/.test(await p.evaluate(() => document.body.innerText)));
let r = await call(p, 'POST', '/api/b/restore', { id: A }); ok('RES-3 restore after the wipe: not found', r.status === 404 && r.body?.code === 'restore_not_found', `${r.status} ${JSON.stringify(r.body)}`);
r = await call(p, 'GET', `/api/b/${A}/workspace`); ok('after the wipe its routes answer the plain not found (as for an id that never existed)', r.status === 404 && r.body?.code === 'not_found', `${r.status} ${r.body?.code}`);
const adm = await session(b, 'admin.qa@radar.local'); await adm.page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
ok('the former Admin has no trace of it', (await call(adm.page, 'GET', '/api/me')).body.businesses.length === 0, adm.page.url().replace(BASE, ''));
await b.close(); await pool.end();
