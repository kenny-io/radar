import pg from 'pg';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

const target = new URL(process.env.LOAD_BASE_URL || 'http://127.0.0.1:3901');
const connection = process.env.DATABASE_URL || '';
const database = new URL(connection);
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host);
if (!loopback(target.hostname) || target.protocol !== 'http:' || target.port !== '3901' || target.pathname !== '/' || target.username || target.password || target.search || target.hash) throw new Error('Load target must be loopback http port 3901 root');
if (!loopback(database.hostname) || database.pathname !== '/radar_production_launch' || database.protocol !== 'postgres:') throw new Error('Dedicated loopback radar_production_launch database required');
const count = 200, durationMs = 35_000;
const run = `load-${Date.now()}-${randomBytes(3).toString('hex')}`;
const buildDirectory = process.env.LOAD_BUILD_DIR || '.next-launch-build';
const buildId = (await fs.readFile(`${buildDirectory}/BUILD_ID`, 'utf8')).trim();
const client = new pg.Client({ connectionString: connection, application_name: 'radar-launch-load', connectionTimeoutMillis: 5000, statement_timeout: 5000 });
const fixtures: { uid: string; bid: string; token: string }[] = [];
const outcomes: { group: string; status: number; ms: number; ok: boolean; reason?: string }[] = [];
const sse = { attempted: 0, opened: 0, firstFrames: 0, pings: 0, revisions: 0, errors: [] as string[], startupMs: [] as number[] };
const controllers: AbortController[] = [], streams: Promise<void>[] = [];
let sampling = true, sampleTask: Promise<void> | undefined, cleanup = false;
const dbStats = { samples: 0, peakTotalConnections: 0, peakOtherConnections: 0, peakActiveConnections: 0, maxConnections: 0, sampleErrors: 0 };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const percentiles = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y);
  const at = (p: number) => a.length ? Math.round(a[Math.min(a.length - 1, Math.ceil(a.length * p) - 1)] * 10) / 10 : null;
  return { n: a.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) };
};
const headers = (fixture: typeof fixtures[number]) => ({ cookie: `radar_session=${fixture.token}` });
async function request(path: string, group: string, fixture?: typeof fixtures[number], expected = 200) {
  const started = performance.now();
  let status = 0, ok = false, reason: string | undefined;
  try {
    const response = await fetch(new URL(path, target), { headers: fixture ? headers(fixture) : {}, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    status = response.status;
    if (status !== expected) throw new Error(`expected ${expected}, got ${status}`);
    if (group === 'me' || group === 'burst') {
      const data = await response.json();
      if (data.user?.id !== fixture?.uid || data.businesses?.length !== 1 || data.businesses[0]?.id !== fixture?.bid) throw new Error('account/business tenancy mismatch');
    } else if (group === 'workspace') {
      const data = await response.json();
      if (data.id !== fixture?.bid || data.role !== 'Owner' || data.team?.length !== 1 || data.team[0]?.userId !== fixture?.uid) throw new Error('workspace tenancy mismatch');
    } else { await response.arrayBuffer(); }
    ok = true;
  } catch (error) { reason = error instanceof Error ? error.message : 'request failed'; }
  outcomes.push({ group, status, ms: performance.now() - started, ok, ...(reason ? { reason } : {}) });
  return ok;
}
function openStream(fixture: typeof fixtures[number]) {
  sse.attempted++;
  const control = new AbortController(); controllers.push(control);
  let settle!: (ok: boolean) => void;
  const started = performance.now();
  const first = new Promise<boolean>(resolve => { settle = resolve; });
  const timer = setTimeout(() => { settle(false); control.abort(); }, 12_000);
  const task = (async () => {
    try {
      const response = await fetch(new URL(`/api/b/${fixture.bid}/events`, target), { headers: headers(fixture), signal: control.signal });
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error(`SSE HTTP ${response.status}`);
      sse.opened++;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', seen = false;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { if (!control.signal.aborted) throw new Error('SSE closed unexpectedly'); break; }
        buffer += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (!seen) { seen = true; sse.firstFrames++; sse.startupMs.push(performance.now() - started); clearTimeout(timer); settle(true); }
          if (frame.startsWith('event: ping')) sse.pings++;
          if (frame.startsWith('event: rev')) sse.revisions++;
        }
      }
    } catch (error) {
      if (!control.signal.aborted) sse.errors.push(error instanceof Error ? error.message : 'stream failed');
      settle(false);
    } finally { clearTimeout(timer); }
  })();
  streams.push(task);
  return first;
}
let start = new Date(), finish = start, fatal: string | undefined, burstMs = 0, sustainedMs = 0, sustainedFrom = 0, sustainedTo = 0;
try {
  await client.connect();
  if (!(await request('/api/health', 'preflight'))) throw new Error('Production build readiness failed');
  const settings = await client.query("SELECT current_setting('max_connections')::int AS maximum");
  dbStats.maxConnections = settings.rows[0].maximum;
  await client.query('BEGIN');
  for (let i = 0; i < count; i++) {
    const uid = randomUUID(), bid = randomUUID(), token = randomBytes(32).toString('base64url'), email = `${run}-${i}@load.invalid`;
    fixtures.push({ uid, bid, token });
    await client.query('INSERT INTO users (id,name,email) VALUES ($1,$2,$3)', [uid, `Local load ${i}`, email]);
    await client.query('INSERT INTO sessions (id,user_id,expires_at) VALUES ($1,$2,now()+interval \'1 hour\')', [createHash('sha256').update(token).digest('hex'), uid]);
    const profile = { domain: `${i}.${run}.invalid`, business: { name: `Local load ${i}`, description: '', offerings: [], industry: '', positioning: '', differentiators: [] }, audience: { segments: [], buyers: [], needs: [], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#17181C', secondary: '#EF6A2E', voice: '', language: 'English (US)', markets: ['United States'] } };
    await client.query("INSERT INTO businesses (id,owner_id,domain,status,profile) VALUES ($1,$2,$3,'active',$4)", [bid, uid, profile.domain, JSON.stringify(profile)]);
    await client.query("INSERT INTO members (business_id,user_id,email,role,status) VALUES ($1,$2,$3,'Owner','active')", [bid, uid, email]);
  }
  await client.query('COMMIT');
  // Proves the HTTP server reads this dedicated database before starting concurrent traffic.
  if (!(await request('/api/me', 'me', fixtures[0]))) throw new Error('Target server fixture/DB identity mismatch');
  sampleTask = (async () => {
    while (sampling) {
      try {
        const sample = await client.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE pid<>pg_backend_pid() AND application_name<>'radar-launch-load')::int AS other, count(*) FILTER (WHERE state='active' AND pid<>pg_backend_pid())::int AS active FROM pg_stat_activity WHERE datname=current_database()");
        const row = sample.rows[0]; dbStats.samples++;
        dbStats.peakTotalConnections = Math.max(dbStats.peakTotalConnections, row.total);
        dbStats.peakOtherConnections = Math.max(dbStats.peakOtherConnections, row.other);
        dbStats.peakActiveConnections = Math.max(dbStats.peakActiveConnections, row.active);
      } catch { dbStats.sampleErrors++; }
      await sleep(250);
    }
  })();
  const streamSuccess = await Promise.all(fixtures.map(openStream));
  if (streamSuccess.some(ok => !ok)) throw new Error('One or more of 200 SSE streams failed startup');
  const burstStart = performance.now();
  await Promise.all(fixtures.map(f => request('/api/me', 'burst', f)));
  burstMs = performance.now() - burstStart;
  await Promise.all(fixtures.slice(0, 10).map((f, i) => request(`/api/b/${fixtures[i + 1].bid}/workspace`, 'cross-tenant-denied', f, 404)));
  sustainedFrom = outcomes.length;
  const sustainedStart = performance.now(), deadline = sustainedStart + durationMs;
  const revisionTask = (async () => {
    while (performance.now() < deadline) {
      await client.query('UPDATE businesses SET rev=rev+1 WHERE id=ANY($1::uuid[])', [fixtures.slice(0, 10).map(f => f.bid)]);
      await sleep(5000);
    }
  })();
  await Promise.all(fixtures.map(async (f, index) => {
    let iteration = 0;
    while (performance.now() < deadline) {
      const choice = (iteration++ + index) % 10;
      if (choice < 5) await request('/api/me', 'me', f);
      else if (choice < 9) await request(`/api/b/${f.bid}/workspace`, 'workspace', f);
      else await request(['/', '/privacy', '/terms'][index % 3], 'public');
      await sleep(1000 + (index % 11) * 50);
    }
  }));
  sustainedTo = outcomes.length;
  await revisionTask;
  sustainedMs = performance.now() - sustainedStart;
  if (!(await request('/api/health', 'postflight'))) throw new Error('Readiness failed after load');
} catch (error) {
  fatal = error instanceof Error ? error.message : 'load failed';
  await client.query('ROLLBACK').catch(() => {});
} finally {
  controllers.forEach(c => c.abort());
  await Promise.allSettled(streams);
  sampling = false;
  await sampleTask;
  try {
    if (fixtures.length) {
      await client.query('BEGIN');
      await client.query('DELETE FROM businesses WHERE id=ANY($1::uuid[]) AND owner_id=ANY($2::uuid[])', [fixtures.map(f => f.bid), fixtures.map(f => f.uid)]);
      await client.query('DELETE FROM users WHERE id=ANY($1::uuid[]) AND email LIKE $2', [fixtures.map(f => f.uid), `${run}-%@load.invalid`]);
      await client.query('COMMIT');
      const remaining = await client.query('SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[])', [fixtures.map(f => f.uid)]);
      cleanup = remaining.rows[0].n === 0;
    } else cleanup = true;
  } catch { await client.query('ROLLBACK').catch(() => {}); fatal ||= 'Scoped fixture cleanup failed'; }
  await client.end().catch(() => {});
  finish = new Date();
}
const groups = Object.fromEntries([...new Set(outcomes.map(o => o.group))].map(group => {
  const rows = outcomes.filter(o => o.group === group);
  return [group, { ...percentiles(rows.map(o => o.ms)), errors: rows.filter(o => !o.ok).length }];
}));
const sustained = outcomes.slice(sustainedFrom, sustainedTo).filter(o => ['me', 'workspace', 'public'].includes(o.group));
const sustainedPercentiles = percentiles(sustained.map(o => o.ms));
const p95 = sustainedPercentiles.p95, p99 = sustainedPercentiles.p99;
const failures = outcomes.filter(o => !o.ok);
const checks = {
  noFatal: !fatal,
  noHttpOrTenancyErrors: failures.length === 0,
  all200Streams: sse.opened === count && sse.firstFrames === count,
  atLeastThreePingsPerStreamAverage: sse.pings >= count * 3,
  streamRevisionDelivery: sse.revisions >= 10,
  noUnexpectedStreamErrors: sse.errors.length === 0,
  sustainedP95Under2000ms: p95 !== null && p95 < 2000,
  sustainedP99Under5000ms: p99 !== null && p99 < 5000,
  actualDurationAtLeast35sec: sustainedMs >= durationMs,
  dbSamplerHealthy: dbStats.samples > 0 && dbStats.sampleErrors === 0,
  scopedFixturesRemoved: cleanup,
};
const result = { verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', run, startedAt: start.toISOString(), finishedAt: finish.toISOString(), target: target.origin, testedBuild: { directory: buildDirectory, buildId },
  environment: { node: process.version, platform: os.platform(), architecture: os.arch(), logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 1024 ** 3), sessions: count, uniqueBusinesses: count, worker: false, billing: 'off (server launch configuration supplied by PM)', fixtures: 'sparse active businesses; direct DB sessions, no password hashing/signin capacity claim' },
  checks, fatal, groups, sustained: { ...percentiles(sustained.map(o => o.ms)), elapsedMs: Math.round(sustainedMs), requestsPerSecond: sustainedMs ? Math.round(sustained.length * 1000 / sustainedMs * 10) / 10 : 0 }, burstMs: Math.round(burstMs), sse: { ...sse, startupMs: percentiles(sse.startupMs) }, db: dbStats, errors: failures.slice(0, 20),
  limitations: ['Local production build, loopback network and local Postgres only; not proof of Railway/production capacity.', 'Sparse datasets do not represent mature workspaces or large response payloads.', 'HTTP load reads HTML bodies without downloading browser subresources/hydrating JavaScript; browser behavior is separate QA.', 'GET-only application workload plus local fixture revision updates; no signup/bcrypt, crawl, AI, provider quotas, worker backlog, publishing, email or Stripe/payment capacity tested.', '200 active sessions use one SSE connection each plus mixed GETs around once per1–1.5seconds; not200 simultaneous expensive requests continuously.', 'Configured app pool max10 per process; sampled other connections may include separate Next route bundles/processes and are reported without assuming a10-connection ceiling.'] };
const report = `# Local production HTTP capacity test\n\n${result.verdict}. Run command: DATABASE_URL=<dedicated local DB> npx tsx .factory/production-launch/qa/load.mts. No remote target is accepted.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
await fs.appendFile('.factory/production-launch/qa/load.md', `\n${report}`);
console.log(JSON.stringify(result, null, 2));
if (result.verdict !== 'PASS') process.exitCode = 1;
