// In-memory SandboxProvider for unit tests (.factory/sandbox-publisher/architecture.md §1.2). It contacts nothing, keeps
// each sandbox's files in a Map, runs a scripted exec handler in place of the runner, and records every call with its
// full arguments so a test can assert order (probe before upload, destroy before return) and the absence of secrets.
import { readFile } from 'node:fs/promises';
import type { SandboxExecResult, SandboxHandle, SandboxProvider, SandboxSpec } from './types';

export type FakeCall =
  | { op: 'destroyMatching'; labels: Record<string, string>; timeoutSec: number }
  | { op: 'create'; spec: SandboxSpec }
  | { op: 'upload'; sandboxId: string; files: { path: string; data: Buffer }[]; timeoutSec: number }
  /** `data` is what the local file held when it was uploaded. */
  | { op: 'uploadFile'; sandboxId: string; localPath: string; remotePath: string; data: Buffer; timeoutSec: number }
  | { op: 'exec'; sandboxId: string; command: string; cwd?: string; env?: Record<string, string>; timeoutSec: number }
  | { op: 'stat'; sandboxId: string; path: string }
  | { op: 'download'; sandboxId: string; path: string; maxBytes: number; timeoutSec: number }
  | { op: 'destroy'; sandboxId: string; timeoutSec: number };
export type FakeOp = FakeCall['op'];

export interface FakeSandbox {
  readonly id: string;
  readonly spec: SandboxSpec;
  /** Every file in the sandbox by absolute path. The exec handler reads uploads here and writes the runner's outputs. */
  readonly files: Map<string, Buffer>;
  destroyed: boolean;
}
export type FakeExecCall = Extract<FakeCall, { op: 'exec' }>;
/** Stands in for the runner scripts. Returning nothing means exit code 0 with no output. */
export type FakeExecHandler = (call: FakeExecCall, sandbox: FakeSandbox) => SandboxExecResult | void | Promise<SandboxExecResult | void>;

export interface FakeSandboxOptions {
  exec?: FakeExecHandler;
  /** Return an error to make that call reject (create failure, delete failure, a failed upload); undefined lets it run. */
  fail?: (call: FakeCall) => unknown;
  /** Return true to make that call never settle (a hung exec or a hung delete). */
  hang?: (call: FakeCall) => boolean;
  /** What the provider reports back as the applied allow-list. Default: the requested host. */
  appliedAllowDomain?: (spec: SandboxSpec) => string | null;
  /** How many leftover sandboxes destroyMatching reports as deleted. */
  leftovers?: number;
}

const copy = (value: Record<string, string> | undefined) => (value ? { ...value } : undefined);

export class FakeSandboxProvider implements SandboxProvider {
  /** Every provider and handle call, in the order it was made. */
  readonly calls: FakeCall[] = [];
  readonly sandboxes: FakeSandbox[] = [];
  constructor(public options: FakeSandboxOptions = {}) {}

  /** Records the call, then applies the scripted failure or hang. */
  private async enter(call: FakeCall): Promise<void> {
    this.calls.push(call);
    if (this.options.hang?.(call)) await new Promise<never>(() => {});
    const error = this.options.fail?.(call);
    if (error !== undefined) throw error;
  }

  async destroyMatching(labels: Record<string, string>, timeoutSec: number): Promise<number> {
    await this.enter({ op: 'destroyMatching', labels: { ...labels }, timeoutSec });
    return this.options.leftovers ?? 0;
  }

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    const kept: SandboxSpec = { ...spec, labels: { ...spec.labels }, env: { ...spec.env } };
    await this.enter({ op: 'create', spec: kept });
    const sandbox: FakeSandbox = { id: `fake-sandbox-${this.sandboxes.length + 1}`, spec: kept, files: new Map(), destroyed: false };
    this.sandboxes.push(sandbox);
    const applied = this.options.appliedAllowDomain ? this.options.appliedAllowDomain(kept) : kept.allowDomain;
    const use = async (call: FakeCall) => {
      await this.enter(call);
      if (sandbox.destroyed) throw new Error('fake sandbox: used after destroy');
    };
    const sizeOf = (path: string) => {
      const file = sandbox.files.get(path);
      if (file) return { size: file.byteLength, isDir: false };
      const prefix = path.endsWith('/') ? path : `${path}/`;
      return [...sandbox.files.keys()].some(name => name.startsWith(prefix)) ? { size: 0, isDir: true } : null;
    };
    return {
      id: sandbox.id,
      appliedAllowDomain: applied,
      upload: async (files, timeoutSec) => {
        const kept = files.map(file => ({ path: file.path, data: Buffer.from(file.data) }));
        await use({ op: 'upload', sandboxId: sandbox.id, files: kept, timeoutSec });
        for (const file of kept) sandbox.files.set(file.path, file.data);
      },
      uploadFile: async (localPath, remotePath, timeoutSec) => {
        const data = await readFile(localPath);
        await use({ op: 'uploadFile', sandboxId: sandbox.id, localPath, remotePath, data, timeoutSec });
        sandbox.files.set(remotePath, data);
      },
      exec: async (command, o) => {
        const call: FakeExecCall = { op: 'exec', sandboxId: sandbox.id, command, ...(o.cwd === undefined ? {} : { cwd: o.cwd }), ...(o.env ? { env: copy(o.env) } : {}), timeoutSec: o.timeoutSec };
        await use(call);
        return (await this.options.exec?.(call, sandbox)) ?? { exitCode: 0, output: '' };
      },
      stat: async path => {
        await use({ op: 'stat', sandboxId: sandbox.id, path });
        return sizeOf(path);
      },
      download: async (path, maxBytes, timeoutSec) => {
        await use({ op: 'download', sandboxId: sandbox.id, path, maxBytes, timeoutSec });
        const found = sizeOf(path);
        if (!found || found.isDir) throw new Error('fake sandbox: no such file');
        if (found.size > maxBytes) throw new Error('fake sandbox: file is larger than the download limit');
        return Buffer.from(sandbox.files.get(path)!);
      },
      destroy: async timeoutSec => {
        await this.enter({ op: 'destroy', sandboxId: sandbox.id, timeoutSec });
        sandbox.destroyed = true;
      },
    };
  }

  /** One short label per call, for order assertions: `exec:<command>`, `upload:<paths>`, `uploadFile:<remote path>`, or the op. */
  ops(): string[] {
    return this.calls.map(call => call.op === 'exec' ? `exec:${call.command}` : call.op === 'upload' ? `upload:${call.files.map(file => file.path).join(',')}`
      : call.op === 'uploadFile' ? `uploadFile:${call.remotePath}` : call.op === 'stat' || call.op === 'download' ? `${call.op}:${call.path}` : call.op);
  }
  count(op: FakeOp): number { return this.calls.filter(call => call.op === op).length; }
  execs(): FakeExecCall[] { return this.calls.filter((call): call is FakeExecCall => call.op === 'exec'); }
  /** Everything that crossed the provider boundary as one string: every argument of every call, with uploaded bytes
   *  decoded one byte per character so an ASCII secret is found wherever it sits. */
  transcript(): string {
    return JSON.stringify(this.calls, (_key, value) => Buffer.isBuffer(value) ? value.toString('latin1')
      : value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data) ? Buffer.from(value.data).toString('latin1') : value);
  }
}
