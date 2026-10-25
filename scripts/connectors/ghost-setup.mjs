// DEV ONLY (called by ghost-up.sh). First-run owner setup on a fresh Ghost, then a "Radar" custom integration created
// through the admin session API. Prints KEY={id}:{secret} (the integration's Admin API key). No dependencies.
// Env: GHOST_URL, OWNER_EMAIL, OWNER_PASS.
const base = process.env.GHOST_URL.replace(/\/+$/, '');
const api = base + '/ghost/api/admin';
const origin = new URL(base).origin;
const email = process.env.OWNER_EMAIL, password = process.env.OWNER_PASS;
let cookie = '';

async function call(path, init = {}) {
  const res = await fetch(api + path, { ...init, headers: { 'content-type': 'application/json', origin, 'accept-version': 'v5.0', ...(cookie ? { cookie } : {}), ...(init.headers || {}) } });
  const set = res.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map(c => c.split(';')[0]).join('; ');
  const txt = await res.text();
  let body; try { body = txt ? JSON.parse(txt) : {}; } catch { body = txt; }
  return { status: res.status, body };
}
const fail = (what, r) => { console.error(`${what} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`); process.exit(1); };

const setup = await call('/authentication/setup/');
if (setup.body?.setup?.[0]?.status === false) {
  const r = await call('/authentication/setup/', { method: 'POST', body: JSON.stringify({ setup: [{ name: 'Radar Owner', email, password, blogTitle: 'Radar Ghost harness' }] }) });
  if (r.status >= 300) fail('Owner setup', r);
}
const s = await call('/session/', { method: 'POST', body: JSON.stringify({ username: email, password }) });
if (s.status >= 300) fail('Sign-in (if the owner password was lost, run ghost-down.sh then ghost-up.sh)', s);

const list = await call('/integrations/?include=api_keys&limit=all');
if (list.status >= 300) fail('List integrations', list);
let integ = (list.body.integrations || []).find(i => i.name === 'Radar' && i.type === 'custom');
if (!integ) {
  const r = await call('/integrations/?include=api_keys,webhooks', { method: 'POST', body: JSON.stringify({ integrations: [{ name: 'Radar' }] }) });
  if (r.status >= 300) fail('Create integration', r);
  integ = r.body.integrations[0];
}
const key = (integ.api_keys || []).find(k => k.type === 'admin');
if (!key) fail('Admin API key', { status: 0, body: integ });
// Ghost 5.x returns an admin key's `secret` already in the "{id}:{hex secret}" form the admin UI shows; older
// versions return the hex secret alone.
console.log(`KEY=${String(key.secret).includes(':') ? key.secret : `${key.id}:${key.secret}`}`);
