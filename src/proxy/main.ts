import '../worker/env'; // must be first: loads .env / .env.local before anything reads process.env
// Radar model proxy: the only host a publishing sandbox may reach (.factory/sandbox-publisher/architecture.md §4).
// `npm run model-proxy`. A dedicated Railway service on its own domain, because Daytona restricts sandbox egress by host
// name, not by path: sharing the web service's host would put every public Radar route within a sandbox's reach.
//
// Needs RADAR_PUBLISH_CAPABILITY_SECRET (the same value as the worker), ANTHROPIC_API_KEY, DATABASE_URL and PORT, and
// refuses to start without them. It should be given nothing else: not RADAR_SECRET_KEY, not the Daytona key.
// One replica: the per-run budget lives in this process (see ModelProxyState).
// Logs carry run, entry and business ids, counts and fixed words. Never a capability, a key or a body.
import { createServer } from 'node:http';
import { pool } from '../server/db';
import { recordAiCallNow } from '../server/ai/record';
import { reportFailure } from '../server/observability/failures';
import { ModelProxyState, readModelProxyEnvironment, serveModelProxyRequest, type ModelProxyDeps, type ModelProxyEvent } from '../server/services/publishing/sandbox/modelProxy';

/** How long a stop waits for calls in flight and their ai_calls rows. Kept under the service's draining time
 *  (railway.model-proxy.json), after which the platform kills the process anyway. */
const STOP_GRACE_MS = 25_000;

function observe(event: ModelProxyEvent): void {
  const { error, ...safe } = event;
  if (event.event === 'usage-unrecorded') {
    // The call was answered and counted against the run's budget; only its ai_calls row is missing.
    void reportFailure(error, { source: 'ai', operation: 'model-proxy.record', businessId: event.businessId, ref: event.entryId, provider: 'Anthropic', incidentKey: 'model-proxy.record', degraded: true });
    return;
  }
  console.warn('[model-proxy]', JSON.stringify(safe));
}

async function main() {
  const environment = readModelProxyEnvironment(process.env);
  if (!environment.ok) {
    // Names only. The process exits non-zero so the platform shows the deployment as failed rather than serving 401s.
    console.error(`[model-proxy] not started: missing or invalid ${environment.missing.join(', ')}`);
    process.exit(1);
  }
  if (environment.unexpected.length && process.env.NODE_ENV === 'production') console.warn(`[model-proxy] variables this service should not hold: ${environment.unexpected.join(', ')}`);

  const state = new ModelProxyState();
  const deps: ModelProxyDeps = {
    capabilitySecret: environment.capabilitySecret,
    providerKey: environment.providerKey,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    record: recordAiCallNow,
    state,
    log: observe,
  };
  const server = createServer((req, res) => { void serveModelProxyRequest(req, res, deps); });
  server.on('clientError', (_error, socket) => { socket.destroy(); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(environment.port, () => { server.off('error', reject); resolve(); }); });
  console.log(`[model-proxy] listening on ${environment.port}`);

  // Usage rows are the one thing the database is for here. A database that is down does not stop the proxy from
  // answering (each lost row is reported); saying so at start makes a wrong DATABASE_URL visible at once.
  pool.query('select 1').then(
    () => console.log('[model-proxy] database reachable'),
    error => reportFailure(error, { source: 'system', operation: 'model-proxy.database', incidentKey: 'model-proxy.database', degraded: true }),
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[model-proxy] stopping');
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeIdleConnections();
    const grace = new Promise<void>(resolve => setTimeout(resolve, STOP_GRACE_MS).unref());
    await Promise.race([closed.then(() => state.settled()), grace]);
    process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

const fatal = async (error: unknown, operation: string) => { await reportFailure(error, { source: 'system', operation }); process.exit(1); };
process.on('uncaughtException', error => { void fatal(error, 'model-proxy.uncaughtException'); });
// A stray rejection belongs to one exchange. Exiting would cut every run in flight and zero every run's budget, so it
// is reported and the service keeps answering.
process.on('unhandledRejection', error => { void reportFailure(error, { source: 'system', operation: 'model-proxy.unhandledRejection', incidentKey: 'model-proxy.unhandledRejection' }); });
main().catch(error => fatal(error, 'model-proxy.startup'));
