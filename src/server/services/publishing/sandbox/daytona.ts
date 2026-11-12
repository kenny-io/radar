// SandboxProvider on @daytona/sdk 0.207.0 (.factory/sandbox-publisher/architecture.md §1.2, §5, §8). The SDK is loaded
// only through `await import()`, so nothing pulls in its OpenTelemetry and AWS dependencies until a sandbox run starts.
// The SDK calls and their argument order follow Thally's daytona-runner.ts (buildTrackPublicRunSandboxParameters,
// runTrackPublicRunSandbox, remoteFileSize) and the typings in node_modules/@daytona/sdk/esm.
// Every SDK timeout is in seconds and 0 means "no timeout", so no call here ever passes less than 1.
import type { CreateSandboxFromSnapshotParams } from '@daytona/sdk';
import { SANDBOX_USER, SANDBOX_WORKLOAD, type SandboxHandle, type SandboxLeftover, type SandboxProvider, type SandboxSpec } from './types';

/** Pinned so an ambient SDK variable (DAYTONA_API_URL, DAYTONA_SERVER_URL, a .env file) cannot redirect the key. */
export const DAYTONA_API_URL = 'https://app.daytona.io/api';
/** Exec output is untrusted and may quote repository text; callers get a bounded prefix. */
export const EXEC_OUTPUT_MAX_CHARS = 2000;
/** Longest provider error kept for a sandbox that could not be deleted. */
export const LEFTOVER_ERROR_CHARS = 300;

const SNAPSHOT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** One host name: no scheme, port, path, wildcard, comma or space. Daytona's domainAllowList is comma-separated. */
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Sandbox-wide variables are visible to every process in the sandbox, so a credential-shaped name is refused. */
const CREDENTIAL_NAME = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTHORIZATION|DATABASE_URL/i;

/** The exact value passed to `Daytona.create`. Pure, so the isolation settings are unit-tested without the SDK:
 *  ephemeral with no auto-stop and a hard TTL (Daytona deletes it by wall clock whatever happens to the worker), egress
 *  limited to one host, the unprivileged user, and nothing but labels and non-secret settings. Throws on a spec that
 *  would weaken any of that. */
export function buildSandboxCreateParameters(spec: SandboxSpec): CreateSandboxFromSnapshotParams {
  if (!SNAPSHOT_UUID.test(spec.snapshotId)) throw new Error('sandbox spec: the snapshot must be an immutable UUID');
  if (!HOST_NAME.test(spec.allowDomain)) throw new Error('sandbox spec: the allowed domain must be a single host name');
  if (!Number.isInteger(spec.ttlMinutes) || spec.ttlMinutes < 1) throw new Error('sandbox spec: the TTL must be a positive whole number of minutes');
  const credential = Object.keys(spec.env).find(name => CREDENTIAL_NAME.test(name));
  if (credential) throw new Error(`sandbox spec: ${credential} must not be a sandbox-wide variable`);
  return {
    snapshot: spec.snapshotId,
    user: SANDBOX_USER,
    ephemeral: true,
    autoStopInterval: 0,
    ttlMinutes: spec.ttlMinutes,
    domainAllowList: spec.allowDomain,
    envVars: { ...spec.env },
    labels: { ...spec.labels },
  };
}

// The part of the SDK this module uses, so a test can stub the module without the real classes.
interface DaytonaSandbox {
  id: string;
  /** Lifecycle state as the API reports it (`started`, `creating`, `error`, ...). */
  state?: string;
  labels?: Record<string, string>;
  domainAllowList?: string;
  fs: {
    uploadFiles(files: { source: string | Buffer; destination: string }[], timeout?: number): Promise<void>;
    uploadFile(localPath: string, remotePath: string, timeout?: number): Promise<void>;
    getFileDetails(path: string): Promise<{ size: number; isDir: boolean }>;
    downloadFile(remotePath: string, timeout?: number): Promise<Buffer>;
  };
  process: { executeCommand(command: string, cwd?: string, env?: Record<string, string>, timeout?: number): Promise<{ exitCode: number; result: string }> };
  delete(timeout?: number, wait?: boolean): Promise<void>;
}
interface DaytonaClient {
  create(params: CreateSandboxFromSnapshotParams, options: { timeout: number }): Promise<DaytonaSandbox>;
  list(query: { labels: Record<string, string> }): AsyncIterable<DaytonaSandbox>;
}
export interface DaytonaSdk {
  Daytona: new (config: { apiKey: string; apiUrl: string }) => DaytonaClient;
  /** HTTP 404 from the API or the sandbox daemon. */
  DaytonaNotFoundError: abstract new (...args: never[]) => Error;
}
async function loadDaytonaSdk(): Promise<DaytonaSdk> {
  const loaded: DaytonaSdk & { default?: DaytonaSdk } = await import('@daytona/sdk');
  return loaded.Daytona ? loaded : loaded.default!;
}

const seconds = (value: number) => (Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1);

function handleOf(sandbox: DaytonaSandbox, sdk: DaytonaSdk): SandboxHandle {
  const missing = (error: unknown) => error instanceof sdk.DaytonaNotFoundError;
  const stat = async (path: string) => {
    let details: { size: number; isDir: boolean };
    try { details = await sandbox.fs.getFileDetails(path); } catch (error) { if (missing(error)) return null; throw error; }
    const size = Number(details.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('daytona: the sandbox reported an invalid file size');
    return { size, isDir: details.isDir === true };
  };
  return {
    id: sandbox.id,
    appliedAllowDomain: typeof sandbox.domainAllowList === 'string' && sandbox.domainAllowList.trim() ? sandbox.domainAllowList.trim() : null,
    upload: (files, timeoutSec) => sandbox.fs.uploadFiles(files.map(file => ({ source: file.data, destination: file.path })), seconds(timeoutSec)),
    // A string source is read with fs.createReadStream by the SDK on Node, so the archive never sits in memory.
    uploadFile: (localPath, remotePath, timeoutSec) => sandbox.fs.uploadFile(localPath, remotePath, seconds(timeoutSec)),
    exec: async (command, o) => {
      const done = await sandbox.process.executeCommand(command, o.cwd, o.env && Object.keys(o.env).length ? { ...o.env } : undefined, seconds(o.timeoutSec));
      const exitCode = Number(done.exitCode);
      return { exitCode: Number.isInteger(exitCode) ? exitCode : -1, output: String(done.result ?? '').slice(0, EXEC_OUTPUT_MAX_CHARS) };
    },
    stat,
    download: async (path, maxBytes, timeoutSec) => {
      const found = await stat(path);
      if (!found) throw new Error('daytona: the sandbox file does not exist');
      if (found.isDir) throw new Error('daytona: the sandbox path is a directory');
      if (found.size > maxBytes) throw new Error(`daytona: the sandbox file is ${found.size} bytes; the limit is ${maxBytes}`);
      const data = await sandbox.fs.downloadFile(path, seconds(timeoutSec));
      if (!Buffer.isBuffer(data) || data.byteLength !== found.size) throw new Error('daytona: the sandbox file changed size while it was downloaded');
      return data;
    },
    destroy: async timeoutSec => {
      try { await sandbox.delete(seconds(timeoutSec), true); } catch (error) { if (!missing(error)) throw error; }
    },
  };
}

/** One client per provider, created on first use. The key goes to the SDK client and nowhere else. */
export function daytonaProvider(apiKey: string, load: () => Promise<DaytonaSdk> = loadDaytonaSdk): SandboxProvider {
  let opened: Promise<{ sdk: DaytonaSdk; client: DaytonaClient }> | undefined;
  const open = () => (opened ??= load().then(sdk => ({ sdk, client: new sdk.Daytona({ apiKey, apiUrl: DAYTONA_API_URL }) })));
  return {
    async create(spec) {
      const parameters = buildSandboxCreateParameters(spec);
      if (apiKey && JSON.stringify(parameters).includes(apiKey)) throw new Error('sandbox spec: the provider key must not enter a sandbox');
      const { sdk, client } = await open();
      return handleOf(await client.create(parameters, { timeout: seconds(spec.timeoutSec) }), sdk);
    },
    async destroyMatching(labels, timeoutSec, onLeftover) {
      // An empty or partial filter would match other workloads in the same organization.
      if (labels.workload !== SANDBOX_WORKLOAD || !labels.entry) throw new Error('daytona: leftover deletion needs the workload and entry labels');
      const { sdk, client } = await open();
      const endsAt = Date.now() + seconds(timeoutSec) * 1000;
      let deleted = 0;
      for await (const sandbox of client.list({ labels: { ...labels } })) {
        // Never delete on the strength of the server-side filter alone.
        if (!Object.entries(labels).every(([name, value]) => sandbox.labels?.[name] === value)) continue;
        // A sandbox Daytona is still creating, or one in an error state, can refuse deletion ("state change in
        // progress"). With a listener that one is reported and the rest are still deleted; one stuck sandbox must not
        // keep the others alive.
        const leftover = (error: string): SandboxLeftover => ({ id: String(sandbox.id), state: typeof sandbox.state === 'string' && sandbox.state ? sandbox.state : null, error });
        if (onLeftover && Date.now() >= endsAt) { onLeftover(leftover('not attempted: the sweep ran out of time')); continue; }
        try { await sandbox.delete(seconds((endsAt - Date.now()) / 1000), true); } catch (error) {
          if (!(error instanceof sdk.DaytonaNotFoundError)) {
            if (!onLeftover) throw error;
            onLeftover(leftover(`${error instanceof Error ? error.name : 'Error'}: ${error instanceof Error ? error.message : String(error)}`.slice(0, LEFTOVER_ERROR_CHARS)));
            continue;
          }
        }
        deleted++;
      }
      return deleted;
    },
  };
}
