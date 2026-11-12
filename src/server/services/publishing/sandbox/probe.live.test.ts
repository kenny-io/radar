// Live: egress and credential probes in a real Daytona sandbox created from the configured runner snapshot
// (.factory/sandbox-publisher/architecture.md §5, §11: SBX-2, SBX-3, SBX-6). No model call, no repository content, no
// GitHub access. Skipped unless RADAR_IT_SANDBOX_PROBE=1 and the worker's sandbox variables are set (DAYTONA_API_KEY,
// RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID, RADAR_PUBLISH_MODEL_PROXY_URL, RADAR_PUBLISH_CAPABILITY_SECRET):
//   RADAR_IT_SANDBOX_PROBE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/services/publishing/sandbox/probe.live.test.ts
// It creates one sandbox exactly as a publishing attempt does (same snapshot, labels, allow-list and TTL), runs the
// trusted egress probe, then searches the sandbox for the worker's secrets. The search happens here, on data pulled
// out of the sandbox: no secret is ever sent in to be looked for. Nothing from this file prints a secret; a finding
// is reported by variable name and location only. The sandbox is deleted at the end and its absence is checked.
// Setup has its own time limit (Vitest's default of 10 s is shorter than a slow create), and whatever setup leaves
// behind when it fails or runs out of time is deleted afterwards: the handle if there is one, a create that answers
// late, and anything Daytona registered under this run's labels without handing it back.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintPublishCapability } from './capability';
import { sandboxPublisher } from './config';
import { DAYTONA_API_URL, daytonaProvider } from './daytona';
import { RUNNER_MANIFEST, SANDBOX_COMMANDS, SANDBOX_ENV } from './run';
import { RUNNER_COMMANDS, RUNNER_ENV, RUNNER_SCRIPTS, RUNNER_SOURCE_DIR, SANDBOX_BUDGET, SANDBOX_PATHS, SANDBOX_WORKLOAD, type SandboxHandle, type SandboxProvider, type SandboxPublisherConfig } from './types';

const ON = process.env.RADAR_IT_SANDBOX_PROBE === '1' && !!(process.env.DAYTONA_API_KEY && process.env.RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID && process.env.RADAR_PUBLISH_MODEL_PROXY_URL && process.env.RADAR_PUBLISH_CAPABILITY_SECRET);
/** Secrets a worker process holds. Whichever of them this process has is searched for; none may be in the sandbox. */
const WORKER_SECRETS = ['DAYTONA_API_KEY', 'RADAR_PUBLISH_CAPABILITY_SECRET', 'RADAR_SECRET_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'OPEN_ROUTER_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GITHUB_CLIENT_SECRET', 'RADAR_IT_GITHUB_TOKEN'];
const BUSINESS = '00000000-0000-4000-8000-000000000000';
const ENTRY = `e_probe_${Date.now().toString(36)}`;
const SCAN_SCRIPT = '/tmp/radar-probe/scan.mjs';
const SCAN_OUTPUT = '/tmp/radar-probe/scan.json';
const MARKER_FILE = '/tmp/radar-probe/marker.txt';
const HOLDS_KEY_SCRIPT = '/tmp/radar-probe/holds-key.mjs';
const SCAN_MAX_BYTES = 60_000_000;
/** Setup: the create at its own budget, the runner upload at its own, and a margin. Never Vitest's 10 s default. */
const SETUP_TIMEOUT_MS = (SANDBOX_BUDGET.createSec + SANDBOX_BUDGET.uploadSec + 30) * 1000;
/** Cleanup: a late create is waited for this long, then one delete and one sweep by label, each at the teardown budget. */
const LATE_CREATE_WAIT_MS = 60_000;
const CLEANUP_TIMEOUT_MS = LATE_CREATE_WAIT_MS + (2 * SANDBOX_BUDGET.destroySec + 30) * 1000;

/** Runs inside the sandbox as the agent's user. Collects this process's environment, every process's arguments and
 *  environment, and every regular file written since the sandbox was created; the control plane does the searching.
 *  Files older than the sandbox belong to the snapshot image, which is built from sandbox/publisher with no secret. */
const SCAN_SOURCE = `
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const OUTPUT = ${JSON.stringify(SCAN_OUTPUT)};
const LIMIT = { file: 2_000_000, total: 24_000_000 };
const since = Date.now() - Number(process.env.RADAR_PROBE_AGE_MS);
const runs = (file, args) => { try { execFileSync(file, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const out = { user: process.getuid(), git: runs('git', ['--version']), env: process.env, processes: [], files: [], skipped: { large: [], unreadable: 0 }, truncated: false };
for (const pid of readdirSync('/proc').filter(name => /^\\d+$/.test(name))) {
  const read = file => { try { return readFileSync('/proc/' + pid + '/' + file).toString('latin1'); } catch { return null; } };
  out.processes.push({ pid, cmdline: read('cmdline'), environ: read('environ') });
}
let total = 0;
const walk = directory => {
  let names;
  try { names = readdirSync(directory); } catch { out.skipped.unreadable += 1; return; }
  for (const name of names) {
    if (out.truncated) return;
    const file = directory === '/' ? '/' + name : directory + '/' + name;
    if (file === '/proc' || file === '/sys' || file === '/dev' || file === OUTPUT) continue;
    let stat;
    try { stat = lstatSync(file); } catch { out.skipped.unreadable += 1; continue; }
    if (stat.isDirectory()) { walk(file); continue; }
    if (!stat.isFile() || stat.mtimeMs < since) continue;
    if (stat.size > LIMIT.file) { out.skipped.large.push({ path: file, size: stat.size }); continue; }
    let data;
    try { data = readFileSync(file); } catch { out.skipped.unreadable += 1; continue; }
    if (total + data.length > LIMIT.total) { out.truncated = true; return; }
    total += data.length;
    out.files.push({ path: file, data: data.toString('latin1') });
  }
};
walk('/');
writeFileSync(OUTPUT, JSON.stringify(out));
process.stdout.write('scan files=' + out.files.length + ' processes=' + out.processes.length + '\\n');
`;
interface Scan {
  user: number; git: boolean; env: Record<string, string>; truncated: boolean;
  processes: { pid: string; cmdline: string | null; environ: string | null }[];
  files: { path: string; data: string }[];
  skipped: { large: { path: string; size: number }[]; unreadable: number };
}

describe.skipIf(!ON)('Publishing sandbox probes (live)', { timeout: 420_000 }, () => {
  let config: SandboxPublisherConfig;
  let provider: SandboxProvider;
  let sandbox: SandboxHandle | null = null;
  /** The create call itself, kept so that cleanup can delete a sandbox that arrives after setup failed or timed out. */
  let creating: Promise<SandboxHandle> | null = null;
  let proxyHost = '';
  let createdAt = 0;
  const labels = { workload: SANDBOX_WORKLOAD, env: 'development', entry: ENTRY, run: randomUUID() };

  beforeAll(async () => {
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'all');
    const selected = sandboxPublisher(BUSINESS);
    vi.unstubAllEnvs();
    if (!selected.enabled) throw new Error(`The sandbox publisher is not configured for the probe. Missing or invalid: ${(selected.missing || []).join(', ')}`);
    config = selected;
    proxyHost = config.proxyUrl.hostname.toLowerCase();
    provider = daytonaProvider(config.daytonaKey);
    createdAt = Date.now();
    creating = provider.create({ snapshotId: config.snapshotId, allowDomain: proxyHost, ttlMinutes: SANDBOX_BUDGET.ttlMinutes, labels, env: { ...SANDBOX_ENV }, timeoutSec: SANDBOX_BUDGET.createSec });
    creating.catch(() => {});
    sandbox = await creating;
    // The runner scripts, installed and verified the way an attempt installs them.
    const directory = path.resolve(process.cwd(), RUNNER_SOURCE_DIR);
    const scripts = await Promise.all(RUNNER_SCRIPTS.map(async name => ({ name, data: await readFile(path.join(directory, name)) })));
    const manifest = scripts.map(script => `${createHash('sha256').update(script.data).digest('hex')}  ${script.name}\n`).join('');
    await sandbox.upload([...scripts.map(script => ({ path: `${SANDBOX_PATHS.runnerDir}/${script.name}`, data: script.data })), { path: `${SANDBOX_PATHS.runnerDir}/${RUNNER_MANIFEST}`, data: Buffer.from(manifest) }], SANDBOX_BUDGET.uploadSec);
  }, SETUP_TIMEOUT_MS);
  // Runs whether setup passed, threw or timed out. Nothing here can fail the run; what could not be deleted is printed
  // by id and state so it can be removed by hand.
  afterAll(async () => {
    if (!provider) return;
    // A setup that timed out leaves the create call pending; the sandbox it eventually returns is this file's too.
    const late = sandbox ?? (creating ? await Promise.race([creating.catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), LATE_CREATE_WAIT_MS))]) : null);
    await late?.destroy(SANDBOX_BUDGET.destroySec).catch(() => {});
    // A create that failed or was abandoned can still have registered a sandbox: look it up by this run's labels.
    const stuck: string[] = [];
    await provider.destroyMatching({ ...labels }, SANDBOX_BUDGET.destroySec, leftover => { stuck.push(`${leftover.id} (state ${leftover.state ?? 'unknown'})`); })
      .catch(error => { stuck.push(`the lookup by label failed (${error instanceof Error ? error.name : 'Error'})`); });
    if (stuck.length) console.warn('[probe.live] not deleted, remove by hand:', stuck.join('; '));
  }, CLEANUP_TIMEOUT_MS);

  it('the sandbox reports the requested allow-list and runs the uploaded runner unmodified', async () => {
    expect(sandbox!.id).toBeTruthy();
    if (sandbox!.appliedAllowDomain !== null) expect(sandbox!.appliedAllowDomain.trim().toLowerCase()).toBe(proxyHost);
    const verified = await sandbox!.exec(SANDBOX_COMMANDS.verifyRunner, { cwd: SANDBOX_PATHS.runnerDir, timeoutSec: 30 });
    expect(verified.exitCode, verified.output).toBe(0);
  });

  it('reaches the model proxy health route and none of the canary hosts (SBX-3)', async () => {
    const probe = await sandbox!.exec(RUNNER_COMMANDS.probe, { cwd: SANDBOX_PATHS.runnerDir, env: { [RUNNER_ENV.proxyUrl]: config.proxyUrl.href.replace(/\/$/, '') }, timeoutSec: SANDBOX_BUDGET.probeSec + 30 });
    console.info('[probe.live] egress probe:', probe.output.trim());
    expect(probe.exitCode, probe.output).toBe(0);
  });

  it('holds none of the worker’s secrets in its environment, processes or files, including after a runner exec (SBX-2)', async () => {
    // A throwaway capability, passed the only way a real one is: in one exec's environment. It must not outlive that exec.
    const capability = mintPublishCapability({ runId: randomUUID(), bid: BUSINESS, entryId: ENTRY, model: config.model.apiId, maxUsd: 0.01, maxCalls: 1, exp: Math.floor(Date.now() / 1000) + 120 }, config.capabilitySecret);
    await sandbox!.upload([{ path: HOLDS_KEY_SCRIPT, data: Buffer.from(`process.exit((process.env.${RUNNER_ENV.capability} || '').startsWith('rdrcap1.') ? 0 : 3);\n`) }], 60);
    const ran = await sandbox!.exec(`node ${HOLDS_KEY_SCRIPT}`, { cwd: SANDBOX_PATHS.runnerDir, env: { [RUNNER_ENV.capability]: capability, [RUNNER_ENV.proxyUrl]: config.proxyUrl.href.replace(/\/$/, '') }, timeoutSec: 30 });
    expect(ran.exitCode, 'the exec environment did not reach the process').toBe(0);

    // Positive controls: a marker in a file and a marker in the scan's own environment must both be found.
    const fileMarker = `radar-probe-file-${randomBytes(12).toString('hex')}`; const envMarker = `radar-probe-env-${randomBytes(12).toString('hex')}`;
    await sandbox!.upload([{ path: SCAN_SCRIPT, data: Buffer.from(SCAN_SOURCE) }, { path: MARKER_FILE, data: Buffer.from(fileMarker) }], 60);
    const scanned = await sandbox!.exec(`node ${SCAN_SCRIPT}`, { cwd: '/tmp', env: { RADAR_PROBE_AGE_MS: String(Date.now() - createdAt + 120_000), RADAR_PROBE_MARKER: envMarker }, timeoutSec: 120 });
    expect(scanned.exitCode, scanned.output).toBe(0);
    const scan: Scan = JSON.parse((await sandbox!.download(SCAN_OUTPUT, SCAN_MAX_BYTES, 120)).toString('utf8'));
    console.info('[probe.live] scan:', JSON.stringify({ user: scan.user, envNames: Object.keys(scan.env).length, processes: scan.processes.length, processEnvironmentsRead: scan.processes.filter(process => process.environ !== null).length, filesSinceCreation: scan.files.length, tooLarge: scan.skipped.large.length, unreadable: scan.skipped.unreadable, truncated: scan.truncated }));
    expect(scan.truncated).toBe(false);
    expect(scan.user).not.toBe(0);
    expect(scan.env.RADAR_PROBE_MARKER).toBe(envMarker);
    expect(scan.files.some(file => file.path === MARKER_FILE && file.data.includes(fileMarker))).toBe(true);
    expect(scan.processes.some(process => (process.environ || '').includes(envMarker))).toBe(true);
    // The uploaded runner scripts are among the scanned files, so the scan covers what an attempt writes.
    expect(scan.files.some(file => file.path === `${SANDBOX_PATHS.runnerDir}/run.mjs`)).toBe(true);

    const needles = [...WORKER_SECRETS.map(name => ({ name, value: process.env[name] || '' })), { name: 'the throwaway capability', value: capability }].filter(needle => needle.value.length >= 8);
    expect(needles.map(needle => needle.name)).toEqual(expect.arrayContaining(['DAYTONA_API_KEY', 'RADAR_PUBLISH_CAPABILITY_SECRET', 'the throwaway capability']));
    const found: string[] = [];
    for (const needle of needles) {
      for (const [name, value] of Object.entries(scan.env)) if (String(value).includes(needle.value)) found.push(`${needle.name} in environment variable ${name}`);
      for (const process of scan.processes) {
        if ((process.cmdline || '').includes(needle.value)) found.push(`${needle.name} in the arguments of process ${process.pid}`);
        if ((process.environ || '').includes(needle.value)) found.push(`${needle.name} in the environment of process ${process.pid}`);
      }
      for (const file of scan.files) if (file.data.includes(needle.value)) found.push(`${needle.name} in file ${file.path}`);
    }
    expect(found).toEqual([]);
    // Secret-bearing variable names are absent too, whatever their values.
    expect(Object.keys(scan.env).filter(name => WORKER_SECRETS.includes(name) || /DAYTONA.*KEY|RADAR_PUBLISH_CAPABILITY|RADAR_SECRET/i.test(name))).toEqual([]);
    // Nothing in the image lets the sandbox write to Git: there is no git binary.
    expect(scan.git).toBe(false);
  });

  it('is gone after it is destroyed (SBX-6)', async () => {
    const id = sandbox!.id;
    await sandbox!.destroy(SANDBOX_BUDGET.destroySec);
    sandbox = null;
    // Daytona's label listing trails a completed deletion by a few seconds (measured: still listed at 2 s, gone by 7 s),
    // so the listing is polled for a bounded time. It is read-only: nothing here deletes what it finds.
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const listed = async () => { const ids: string[] = []; for await (const item of client.list({ labels: { workload: labels.workload, env: labels.env, entry: labels.entry } })) ids.push(item.id); return ids; };
    let remaining = await listed();
    for (const startedAt = Date.now(); remaining.length && Date.now() - startedAt < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remaining = await listed(); }
    expect(remaining).toEqual([]);
    console.info('[probe.live] sandbox destroyed and no longer listed:', id);
  });
});
