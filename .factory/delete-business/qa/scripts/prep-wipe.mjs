// Make Fieldnote a full wipe victim: the app's own actions where they exist, SQL and files for the rest.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { chromium, session, act, call, ws, db, A, Bz, BASE } from './lib.mjs';
const ROOT = '/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/radar-delete-business-36eee1/.data/qa-uploads';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e'; const P = 'e109d5fa-e0b2-4bfb-9dc6-c98a933e2037';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const put = (key, tag) => { const f = path.join(ROOT, key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.concat([PNG, Buffer.from(tag)])); fs.writeFileSync(f + '.type', 'image/png'); return '/api/files/' + key; };
const pool = db(); const b = await chromium.launch();
const { page } = await session(b, 'dev@radar.local'); await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
let w = await ws(page, A);
// logo upload and a feature request, through the app
const profile = JSON.parse(JSON.stringify(w.profile)); profile.brand.logo = 'data:image/png;base64,' + PNG.toString('base64');
let r = await act(page, A, 'profile.update', { profile, editedKeys: ['brand.logo'] }); console.log('logo upload', r.status, r.body?.error || '', '→', (await ws(page, A)).profile.brand.logo);
r = await act(page, A, 'feature.request', { text: 'QA fixture: please add a dark calendar.' }); console.log('feature.request', r.status, r.body?.error || '');
const u = async e => (await pool.query('select id from users where email=$1', [e])).rows[0].id;
const owner = await u('dev@radar.local'), solo = await u('solo.qa@radar.local'), stranger = await u('stranger.qa@radar.local');
// body images: a published article (kept), a draft in review (deleted)
const e1a = put(`${A}/body/e1-a.png`, 'e1a'), e1b = put(`${A}/body/e1-b.png`, 'e1b'), e3a = put(`${A}/body/e3-a.png`, 'e3a');
put(`${A}/hero/replaced-before-publish.png`, 'orphan'); put(`${A}/social/sub/deep/nested.png`, 'nested');
fs.writeFileSync(path.join(ROOT, A, 'hero', 'orphan-sidecar.png.type'), 'image/png');
const bLogo = fs.readdirSync(path.join(ROOT, Bz, 'logo')).find(f => !f.endsWith('.type'));
fs.symlinkSync(path.join(ROOT, Bz, 'logo', bLogo), path.join(ROOT, A, 'hero', 'link-to-neighbour-logo.svg'));
const img = (url, i) => ({ url, alt: 'QA body image ' + i, after: i });
await pool.query("update articles set data = jsonb_set(data, '{bodyImages}', $2::jsonb) where business_id=$1 and entry_id='e_waMj3VQP'", [A, JSON.stringify([img(e1a, 1), img(e1b + '?v=2', 2), img('https://cdn.example.com/elsewhere.png', 3), img(`/api/files/${Bz}/logo/${bLogo}`, 4)])]);
await pool.query("update articles set data = jsonb_set(data, '{bodyImages}', $2::jsonb) where business_id=$1 and entry_id='e_w2DSDWGN'", [A, JSON.stringify([img(e3a, 1)])]);
// decision K: an entry Radar wrote to the site as a draft (publish_remote set) counts as published
await pool.query("update calendar_entries set publish_remote = $2::jsonb where business_id=$1 and id='e_y3_opmo8'", [A, JSON.stringify({ id: 'wp-draft-77', connId: w.blog.conns[0].id })]);
// rows without a foreign key, and rows in other accounts
await pool.query("insert into oauth_states (state, user_id, business_id, provider, data) values ('qa-state-A', $1, $2, 'gsc', '{}')", [owner, A]);
await pool.query("insert into lifecycle_guide_states (user_id, guide_id, due_at, source_business_id, status) values ($1, 'qa_fixture_guide', now() + interval '30 days', $2, 'pending') on conflict do nothing", [owner, A]).catch(e => console.log('guide state insert:', e.message));
await pool.query("insert into billing_accounts (user_id, stripe_customer_id, status, comp, comp_reason) values ($1, 'cus_QA_FIXTURE', 'active', true, 'qa fixture') on conflict (user_id) do nothing", [owner]);
const prop = (biz, dir, partner, decision) => pool.query("insert into proposals (business_id, direction, partner_business_id, data, decision, decided_at) values ($1,$2,$3,$4,$5,$6)", [biz, dir, partner, JSON.stringify({ partner: 'Fieldnote', domain: 'fieldnote.app', anchor: 'time tracking', target: 'https://fieldnote.app/freelance-invoice-template/', from: 'https://solobakery.test/blog/a' }), decision, decision ? new Date() : null]);
await prop(SOLO, 'in', A, null); await prop(SOLO, 'out', A, 'approved'); await prop(A, 'in', SOLO, null); await prop(A, 'out', SOLO, 'approved'); await prop(Bz, 'in', A, null);
await pool.query("insert into live_links (business_id, from_url, to_url, anchor, rel, since, status) values ($1, 'https://fieldnote.app/freelance-invoice-template/', 'https://solobakery.test/', 'bakery', 'follow', current_date, 'live'), ($2, 'https://solobakery.test/blog/a', 'https://fieldnote.app/', 'time tracking', 'follow', current_date, 'live')", [SOLO, A]);
// a neighbour whose id differs from Fieldnote's in the last character only, in another account, with files; and folders that only share the prefix
await pool.query("insert into businesses (id, owner_id, domain, status, profile) values ($1, $2, 'prefix-neighbour.test', 'active', $3) on conflict do nothing", [P, stranger, JSON.stringify({ domain: 'prefix-neighbour.test', business: { name: 'Prefix Neighbour' }, brand: {} })]);
await pool.query("insert into members (business_id, user_id, email, role, status) select $1, $2, 'stranger.qa@radar.local', 'Owner', 'active' where not exists (select 1 from members where business_id=$1)", [P, stranger]);
put(`${P}/logo/p.png`, 'p-logo'); put(`${P}/hero/p-hero.png`, 'p-hero'); put(`${A}x/logo/suffix.png`, 'suffix'); put(`${A.slice(0, -1)}/logo/shorter.png`, 'shorter');
w = await ws(page, A);
console.log('entries with files:', (await pool.query("select e.id, e.status, e.published_url is not null pub, e.publish_remote is not null remote, a.data->'img'->>'url' cover, jsonb_array_length(coalesce(a.data->'bodyImages','[]')) body from calendar_entries e join articles a on a.entry_id=e.id where e.business_id=$1 and (a.data->'img'->>'url' is not null) order by e.date", [A])).rows.map(r => Object.values(r).join('|')).join('\n'));
await b.close(); await pool.end();
