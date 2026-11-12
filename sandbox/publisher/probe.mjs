/**
 * Egress probe (.factory/sandbox-publisher/architecture.md, section 5). Runs before any repository byte is uploaded.
 *
 * Passes only when the model proxy's health route answers 200 AND every canary host is unreachable. Three of the
 * four canaries are "essential services" that stay reachable under a Daytona organization's default network
 * policy, so a sandbox whose allow-list was silently not applied fails here.
 *
 * Measured in a real restricted sandbox:
 *   - the first request to the allowed host can time out once right after creation and answer seconds later, so the
 *     health route is retried inside a short bounded window before it is declared unreachable;
 *   - a blocked host fails at connection level (the egress proxy answers CONNECT with 403), so any connection-level
 *     failure of a canary means blocked and any HTTP response from a canary means reachable.
 *
 * A canary is tried on both routes a client can take: directly, and as a CONNECT tunnel through the sandbox's
 * HTTPS_PROXY when one is set. Either route reaching it fails the probe.
 *
 * Invocation: `node /opt/radar-agent/probe.mjs` with ANTHROPIC_BASE_URL set to the proxy URL (https://<host>/model).
 * The sandbox's proxy and CA variables are inherited untouched. No credential is read or sent.
 * Output: exactly one bounded line. Exit code 0 on success, 1 on any other outcome.
 */

import { realpathSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

/** Mirrors MODEL_PROXY_BASE_PATH and MODEL_PROXY_ROUTES.health in types.ts; runner.test.ts fails on drift. */
export const PROXY_BASE_PATH = '/model';
export const PROXY_HEALTH_ROUTE = '/health';
/** The environment variable the probe reads the proxy URL from (RUNNER_ENV.proxyUrl). */
export const PROXY_URL_VARIABLE = 'ANTHROPIC_BASE_URL';
export const CANARY_HOSTS = Object.freeze(['api.github.com', 'registry.npmjs.org', 'api.anthropic.com', 'example.com']);
export const PROBE_TIMING = Object.freeze({
  /** Total time the health route may take to answer 200, across retries. */
  healthWindowMs: 20_000,
  healthAttemptMs: 5_000,
  healthPauseMs: 1_000,
  canaryMs: 5_000,
});

const MAX_LINE_LENGTH = 200;

function line(text) {
  return `${text.replace(/[^\x20-\x7e]/gu, '_').slice(0, MAX_LINE_LENGTH)}\n`;
}

/**
 * The health URL for a proxy URL, or null when the proxy URL breaks the rule the control plane applies: https, no
 * credentials, no query or hash, path ending in /model, and not one of the canary hosts.
 * @param {unknown} value
 * @returns {{ health: string, hostname: string } | null}
 */
export function resolveHealthUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/u, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  if (!path.endsWith(PROXY_BASE_PATH) || CANARY_HOSTS.includes(url.hostname)) return null;
  return { health: `${url.origin}${path}${PROXY_HEALTH_ROUTE}`, hostname: url.hostname };
}

/** One GET that never follows a redirect and never reads a body. Resolves with the status, or null on any failure. */
async function fetchStatus(fetchImpl, url, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel().catch(() => {});
    return Number.isInteger(response.status) ? response.status : null;
  } catch {
    return null;
  }
}

/**
 * Ask an HTTP(S) forward proxy for a CONNECT tunnel to host:443. Resolves with the proxy's status, or null when
 * the proxy could not be reached in time. A 2xx status means the tunnel was established.
 * @param {URL} proxy
 * @param {string} host
 * @param {number} timeoutMs
 * @returns {Promise<number | null>}
 */
export function connectThroughProxy(proxy, host, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let request = null;
    const settle = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request?.destroy();
      resolve(status);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    try {
      const transport = proxy.protocol === 'https:' ? https : http;
      const headers = { host: `${host}:443` };
      if (proxy.username) {
        // The sandbox's own proxy credentials, sent to that proxy only.
        const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
        headers['proxy-authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
      }
      request = transport.request({
        host: proxy.hostname,
        port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
        method: 'CONNECT',
        path: `${host}:443`,
        headers,
      });
    } catch {
      settle(null);
      return;
    }
    request.on('connect', (response, socket) => {
      socket.destroy();
      settle(response.statusCode ?? null);
    });
    request.on('response', (response) => {
      response.resume();
      settle(response.statusCode ?? null);
    });
    request.on('error', () => settle(null));
    request.end();
  });
}

/** The sandbox's HTTPS forward proxy, null when none is set, or 'invalid' when the variable does not parse. */
function readForwardProxy(environment) {
  const value = environment.HTTPS_PROXY || environment.https_proxy;
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const proxy = new URL(value);
    return proxy.protocol === 'http:' || proxy.protocol === 'https:' ? proxy : 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * Run the probe. Everything that touches the network or the clock is injectable so the decision logic is tested
 * without either.
 * @param {{
 *   environment?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   connectImpl?: typeof connectThroughProxy,
 *   timing?: typeof PROBE_TIMING,
 *   now?: () => number,
 *   sleep?: (milliseconds: number) => Promise<void>,
 * }} [options]
 * @returns {Promise<{ ok: boolean, line: string }>}
 */
export async function runProbe({
  environment = process.env,
  fetchImpl = fetch,
  connectImpl = connectThroughProxy,
  timing = PROBE_TIMING,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const failure = (text) => ({ ok: false, line: line(`radar-probe-failure ${text}`) });
  const target = resolveHealthUrl(environment[PROXY_URL_VARIABLE]);
  if (!target) return failure('code=proxy_url_invalid');
  const forwardProxy = readForwardProxy(environment);
  if (forwardProxy === 'invalid') return failure('code=proxy_env_invalid');

  const deadline = now() + timing.healthWindowMs;
  let attempts = 0;
  let lastStatus = null;
  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    attempts += 1;
    lastStatus = await fetchStatus(fetchImpl, target.health, Math.min(timing.healthAttemptMs, remaining));
    if (lastStatus === 200) break;
    const pause = Math.min(timing.healthPauseMs, deadline - now());
    if (pause <= 0) break;
    await sleep(pause);
  }
  if (lastStatus !== 200) {
    return failure(`code=health_unreachable status=${lastStatus ?? 'none'} attempts=${attempts}`);
  }

  const canaries = await Promise.all(
    CANARY_HOSTS.map(async (host) => {
      const [direct, tunnel] = await Promise.all([
        fetchStatus(fetchImpl, `https://${host}/`, timing.canaryMs),
        forwardProxy ? connectImpl(forwardProxy, host, timing.canaryMs) : Promise.resolve(null),
      ]);
      // Any HTTP response on the direct route is reachability, whatever its status. On the proxy route only an
      // established tunnel is: the proxy's own refusal (403) is the block working.
      if (direct !== null) return { host, route: 'direct', status: direct };
      if (tunnel !== null && tunnel >= 200 && tunnel < 300) return { host, route: 'proxy', status: tunnel };
      return null;
    }),
  );
  const reachable = canaries.find((canary) => canary !== null);
  if (reachable) {
    return failure(`code=canary_reachable host=${reachable.host} route=${reachable.route} status=${reachable.status}`);
  }
  return { ok: true, line: line(`radar-probe ok health_attempts=${attempts} canaries=${CANARY_HOSTS.length}`) };
}

// The controller reads only the exit code and the one line, so the guard must not fail open: compare real paths,
// because Node resolves links for the entry module while process.argv[1] is the path as typed.
const entryPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  let outcome;
  try {
    outcome = await runProbe();
  } catch {
    outcome = { ok: false, line: line('radar-probe-failure code=unexpected') };
  }
  process.stdout.write(outcome.line, () => process.exit(outcome.ok ? 0 : 1));
}
