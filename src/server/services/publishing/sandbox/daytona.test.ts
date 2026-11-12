import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxSpec } from './types';

// The SDK module is stubbed: these tests contact nothing. Placeholders only, none is a real key, snapshot or host.
const KEY = 'placeholder-daytona-key-0123456789';
const SNAPSHOT = '0f8fad5b-d9cb-469f-a165-70867728950e';
const HOST = 'model-proxy.example.test';
const LABELS = { workload: 'radar-publisher', env: 'development', entry: 'e_test', run: '5b0c7f0e-3a51-4c0e-9d1f-2f6a8f1f4b10' };
const spec = (over: Partial<SandboxSpec> = {}): SandboxSpec => ({
  snapshotId: SNAPSHOT, allowDomain: HOST, ttlMinutes: 30, labels: { ...LABELS },
  env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTO_COMPACT: '1', USE_API_CONTEXT_MANAGEMENT: '0' }, timeoutSec: 120, ...over,
});

const sdk = vi.hoisted(() => {
  class DaytonaNotFoundError extends Error {}
  class OtherError extends Error {}
  type Remote = { id: string; labels: Record<string, string>; domainAllowList?: string; fs: Record<string, any>; process: Record<string, any>; delete: any };
  const state = {
    configs: [] as unknown[],
    created: [] as { params: any; options: any }[],
    listed: [] as unknown[],
    files: new Map<string, { size: number; isDir: boolean; bytes: Buffer }>(),
    sandboxes: [] as Remote[],
    next: null as Remote | null,
  };
  const remote = (id: string, labels: Record<string, string>, domainAllowList?: string): Remote => ({
    id, labels, domainAllowList,
    fs: {
      uploadFiles: vi.fn(async () => {}),
      uploadFile: vi.fn(async () => {}),
      getFileDetails: vi.fn(async (path: string) => {
        const file = state.files.get(path);
        if (!file) throw new DaytonaNotFoundError('no such file');
        return { size: file.size, isDir: file.isDir };
      }),
      downloadFile: vi.fn(async (path: string) => state.files.get(path)!.bytes),
    },
    process: { executeCommand: vi.fn(async () => ({ exitCode: 0, result: 'ok' })) },
    delete: vi.fn(async () => {}),
  });
  class Daytona {
    constructor(config: unknown) { state.configs.push(config); }
    async create(params: any, options: any) {
      state.created.push({ params, options });
      return state.next ?? remote('sandbox-1', params.labels, params.domainAllowList);
    }
    async *list(query: unknown) { state.listed.push(query); yield* state.sandboxes; }
  }
  return { state, remote, Daytona, DaytonaNotFoundError, OtherError };
});
vi.mock('@daytona/sdk', () => ({ Daytona: sdk.Daytona, DaytonaNotFoundError: sdk.DaytonaNotFoundError }));

import { buildSandboxCreateParameters, DAYTONA_API_URL, daytonaProvider, EXEC_OUTPUT_MAX_CHARS } from './daytona';

beforeEach(() => {
  sdk.state.configs.length = 0; sdk.state.created.length = 0; sdk.state.listed.length = 0; sdk.state.sandboxes.length = 0;
  sdk.state.files.clear(); sdk.state.next = null;
});

describe('create parameters', () => {
  it('are an ephemeral, hard-TTL sandbox whose only egress is the proxy host and whose variables hold no credential', () => {
    expect(buildSandboxCreateParameters(spec())).toEqual({
      snapshot: SNAPSHOT,
      user: 'radar-agent',
      ephemeral: true,
      autoStopInterval: 0,
      ttlMinutes: 30,
      domainAllowList: HOST,
      envVars: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTO_COMPACT: '1', USE_API_CONTEXT_MANAGEMENT: '0' },
      labels: LABELS,
    });
  });

  it('never set another network policy, a public preview or a provider-side secret', () => {
    const parameters = buildSandboxCreateParameters(spec()) as Record<string, unknown>;
    for (const name of ['networkBlockAll', 'networkAllowList', 'outboundProxyUrl', 'public', 'secrets', 'volumes']) expect(parameters).not.toHaveProperty(name);
  });

  it.each([['a URL', 'https://model-proxy.example.test'], ['a host with a port', 'model-proxy.example.test:443'], ['a host with a path', 'model-proxy.example.test/model'],
    ['two hosts', 'model-proxy.example.test,api.github.com'], ['a wildcard', '*.example.test'], ['nothing', '']])(
    'refuse %s as the allow-list', (_label, allowDomain) => {
      expect(() => buildSandboxCreateParameters(spec({ allowDomain }))).toThrow(/single host name/);
    });

  it('refuse a snapshot name, because a name can be repointed', () => {
    expect(() => buildSandboxCreateParameters(spec({ snapshotId: 'radar-publisher-latest' }))).toThrow(/immutable UUID/);
  });

  it.each([0, -5, 1.5, Number.NaN])('refuse a TTL of %s minutes, which would leave no wall-clock bound', ttlMinutes => {
    expect(() => buildSandboxCreateParameters(spec({ ttlMinutes }))).toThrow(/TTL/);
  });

  it.each(['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'DATABASE_URL', 'RADAR_SECRET_KEY', 'RADAR_PUBLISH_CAPABILITY_SECRET'])(
    'refuse %s as a sandbox-wide variable', name => {
      expect(() => buildSandboxCreateParameters(spec({ env: { [name]: 'placeholder' } }))).toThrow(name);
    });
});

describe('the Daytona provider', () => {
  it('opens the client on the pinned API URL and creates with the built parameters and the stage timeout', async () => {
    const handle = await daytonaProvider(KEY).create(spec({ timeoutSec: 97 }));
    expect(sdk.state.configs).toEqual([{ apiKey: KEY, apiUrl: DAYTONA_API_URL }]);
    expect(DAYTONA_API_URL).toBe('https://app.daytona.io/api');
    expect(sdk.state.created).toEqual([{ params: buildSandboxCreateParameters(spec()), options: { timeout: 97 } }]);
    expect(JSON.stringify(sdk.state.created)).not.toContain(KEY);
    expect(handle.id).toBe('sandbox-1');
    expect(handle.appliedAllowDomain).toBe(HOST);
  });

  it('reports no applied allow-list when Daytona returns none, rather than assuming the requested one', async () => {
    sdk.state.next = sdk.remote('sandbox-2', LABELS, undefined);
    expect((await daytonaProvider(KEY).create(spec())).appliedAllowDomain).toBeNull();
  });

  it('refuses a spec that carries the provider key, before any request', async () => {
    await expect(daytonaProvider(KEY).create(spec({ labels: { ...LABELS, note: KEY } }))).rejects.toThrow(/provider key/);
    expect(sdk.state.created).toEqual([]);
  });

  it('counts a sandbox that is already gone as destroyed', async () => {
    const remote = sdk.remote('sandbox-3', LABELS, HOST); sdk.state.next = remote;
    remote.delete.mockRejectedValue(new sdk.DaytonaNotFoundError('sandbox not found'));
    const handle = await daytonaProvider(KEY).create(spec());
    await expect(handle.destroy(30)).resolves.toBeUndefined();
    // Waits for the destroyed state instead of returning when the request is accepted.
    expect(remote.delete).toHaveBeenCalledExactlyOnceWith(30, true);
  });

  it('surfaces any other delete failure so the run can report it', async () => {
    const remote = sdk.remote('sandbox-4', LABELS, HOST); sdk.state.next = remote;
    remote.delete.mockRejectedValue(new sdk.OtherError('delete failed'));
    await expect((await daytonaProvider(KEY).create(spec())).destroy(30)).rejects.toThrow('delete failed');
  });

  it('never passes a zero timeout, which the SDK reads as no timeout', async () => {
    const remote = sdk.remote('sandbox-5', LABELS, HOST); sdk.state.next = remote;
    const handle = await daytonaProvider(KEY).create(spec({ timeoutSec: 0 }));
    await handle.destroy(0);
    await handle.exec('node /opt/radar-agent/probe.mjs', { timeoutSec: 0.4 });
    await handle.upload([{ path: '/workspace/input/task.json', data: Buffer.from('{}') }], 0);
    await handle.uploadFile('/tmp/repo.tar.gz', '/workspace/input/repo.tar.gz', -3);
    expect(sdk.state.created[0].options).toEqual({ timeout: 1 });
    expect(remote.delete).toHaveBeenCalledWith(1, true);
    expect(remote.process.executeCommand).toHaveBeenCalledWith('node /opt/radar-agent/probe.mjs', undefined, undefined, 1);
    expect(remote.fs.uploadFiles).toHaveBeenCalledWith([{ source: Buffer.from('{}'), destination: '/workspace/input/task.json' }], 1);
    expect(remote.fs.uploadFile).toHaveBeenCalledWith('/tmp/repo.tar.gz', '/workspace/input/repo.tar.gz', 1);
  });

  it('passes the exec environment as a structured argument and bounds the untrusted output', async () => {
    const remote = sdk.remote('sandbox-6', LABELS, HOST); sdk.state.next = remote;
    remote.process.executeCommand.mockResolvedValue({ exitCode: 3, result: 'x'.repeat(EXEC_OUTPUT_MAX_CHARS + 500) });
    const handle = await daytonaProvider(KEY).create(spec());
    const done = await handle.exec('node /opt/radar-agent/run.mjs', { cwd: '/workspace/repo', env: { ANTHROPIC_API_KEY: 'rdrcap1.placeholder' }, timeoutSec: 540 });
    expect(remote.process.executeCommand).toHaveBeenCalledExactlyOnceWith('node /opt/radar-agent/run.mjs', '/workspace/repo', { ANTHROPIC_API_KEY: 'rdrcap1.placeholder' }, 540);
    expect(done.exitCode).toBe(3);
    expect(done.output).toHaveLength(EXEC_OUTPUT_MAX_CHARS);
  });

  it('treats a missing exit code as a failure', async () => {
    const remote = sdk.remote('sandbox-7', LABELS, HOST); sdk.state.next = remote;
    remote.process.executeCommand.mockResolvedValue({ result: '' });
    expect((await (await daytonaProvider(KEY).create(spec())).exec('node x', { timeoutSec: 5 })).exitCode).not.toBe(0);
  });

  describe('files', () => {
    const open = async () => { const remote = sdk.remote('sandbox-8', LABELS, HOST); sdk.state.next = remote; return { remote, handle: await daytonaProvider(KEY).create(spec()) }; };

    it('stat is null for a missing path and passes other failures on', async () => {
      const { remote, handle } = await open();
      sdk.state.files.set('/output/result.json', { size: 12, isDir: false, bytes: Buffer.alloc(12) });
      sdk.state.files.set('/output', { size: 0, isDir: true, bytes: Buffer.alloc(0) });
      expect(await handle.stat('/output/missing.json')).toBeNull();
      expect(await handle.stat('/output/result.json')).toEqual({ size: 12, isDir: false });
      expect(await handle.stat('/output')).toEqual({ size: 0, isDir: true });
      remote.fs.getFileDetails.mockRejectedValueOnce(new sdk.OtherError('daemon unreachable'));
      await expect(handle.stat('/output/result.json')).rejects.toThrow('daemon unreachable');
    });

    it('checks the size before downloading and refuses an oversized file without fetching it', async () => {
      const { remote, handle } = await open();
      sdk.state.files.set('/output/report.json', { size: 64_001, isDir: false, bytes: Buffer.alloc(64_001) });
      await expect(handle.download('/output/report.json', 64_000, 30)).rejects.toThrow(/limit is 64000/);
      expect(remote.fs.downloadFile).not.toHaveBeenCalled();
    });

    it('refuses a missing file and a directory without fetching', async () => {
      const { remote, handle } = await open();
      sdk.state.files.set('/workspace/repo/src', { size: 0, isDir: true, bytes: Buffer.alloc(0) });
      await expect(handle.download('/output/result.json', 64_000, 30)).rejects.toThrow(/does not exist/);
      await expect(handle.download('/workspace/repo/src', 64_000, 30)).rejects.toThrow(/directory/);
      expect(remote.fs.downloadFile).not.toHaveBeenCalled();
    });

    it('refuses bytes whose length differs from the size it checked', async () => {
      const { handle } = await open();
      sdk.state.files.set('/output/result.json', { size: 10, isDir: false, bytes: Buffer.alloc(900_000) });
      await expect(handle.download('/output/result.json', 64_000, 30)).rejects.toThrow(/changed size/);
    });

    it('returns the bytes of a file within the limit', async () => {
      const { remote, handle } = await open();
      sdk.state.files.set('/output/result.json', { size: 5, isDir: false, bytes: Buffer.from('hello') });
      expect((await handle.download('/output/result.json', 64_000, 12)).toString()).toBe('hello');
      expect(remote.fs.downloadFile).toHaveBeenCalledExactlyOnceWith('/output/result.json', 12);
    });
  });

  describe('leftover deletion', () => {
    const MATCH = { workload: 'radar-publisher', env: 'development', entry: 'e_test' };

    it('deletes every sandbox carrying the labels, counting one that is already gone', async () => {
      const first = sdk.remote('old-1', { ...MATCH, run: 'a' }); const second = sdk.remote('old-2', { ...MATCH, run: 'b' });
      second.delete.mockRejectedValue(new sdk.DaytonaNotFoundError('gone'));
      sdk.state.sandboxes.push(first, second);
      expect(await daytonaProvider(KEY).destroyMatching(MATCH, 30)).toBe(2);
      expect(sdk.state.listed).toEqual([{ labels: MATCH }]);
      expect(first.delete).toHaveBeenCalledExactlyOnceWith(expect.any(Number), true);
      expect(first.delete.mock.calls[0][0]).toBeGreaterThanOrEqual(1);
      expect(first.delete.mock.calls[0][0]).toBeLessThanOrEqual(30);
    });

    it('leaves alone a listed sandbox whose own labels do not match', async () => {
      const other = sdk.remote('thally-1', { workload: 'track-public-run', phase: 'live' });
      const otherEntry = sdk.remote('other-entry', { ...MATCH, entry: 'e_other' });
      sdk.state.sandboxes.push(other, otherEntry);
      expect(await daytonaProvider(KEY).destroyMatching(MATCH, 30)).toBe(0);
      expect(other.delete).not.toHaveBeenCalled();
      expect(otherEntry.delete).not.toHaveBeenCalled();
    });

    it.each([['no labels', {}], ['another workload', { workload: 'track-docs-agent', entry: 'e_test' }], ['no entry', { workload: 'radar-publisher', env: 'development' }]])(
      'refuses %s before listing anything', async (_label, labels) => {
        await expect(daytonaProvider(KEY).destroyMatching(labels as Record<string, string>, 30)).rejects.toThrow(/workload and entry/);
        expect(sdk.state.listed).toEqual([]);
      });

    it('stops on a delete failure that is not a 404 when the caller gave no listener', async () => {
      const stuck = sdk.remote('old-3', { ...MATCH, run: 'c' });
      stuck.delete.mockRejectedValue(new sdk.OtherError('delete refused'));
      sdk.state.sandboxes.push(stuck);
      await expect(daytonaProvider(KEY).destroyMatching(MATCH, 30)).rejects.toThrow('delete refused');
    });

    it('with a listener, hands over a sandbox it cannot delete, with its id and state, and still deletes the others (N5)', async () => {
      const creating = Object.assign(sdk.remote('stuck-creating', { ...MATCH, run: 'c' }), { state: 'creating' });
      creating.delete.mockRejectedValue(new sdk.OtherError('Sandbox state change in progress ' + 'x'.repeat(600)));
      const gone = sdk.remote('already-gone', { ...MATCH, run: 'd' });
      gone.delete.mockRejectedValue(new sdk.DaytonaNotFoundError('gone'));
      const stateless = sdk.remote('stuck-stateless', { ...MATCH, run: 'e' });
      stateless.delete.mockRejectedValue('refused');
      const healthy = sdk.remote('old-4', { ...MATCH, run: 'f' });
      sdk.state.sandboxes.push(creating, gone, stateless, healthy);
      const leftovers: unknown[] = [];
      expect(await daytonaProvider(KEY).destroyMatching(MATCH, 30, leftover => leftovers.push(leftover))).toBe(2);
      expect(healthy.delete).toHaveBeenCalledOnce();
      expect(leftovers).toEqual([
        { id: 'stuck-creating', state: 'creating', error: expect.stringMatching(/^Error: Sandbox state change in progress x+$/) },
        { id: 'stuck-stateless', state: null, error: 'Error: refused' },
      ]);
      expect((leftovers[0] as { error: string }).error).toHaveLength(300);
    });

    it('with a listener, still rejects when the sandboxes cannot be listed, and still refuses a partial filter', async () => {
      const provider = daytonaProvider(KEY, async () => ({ Daytona: class { list() { throw new Error('listing refused'); } }, DaytonaNotFoundError: sdk.DaytonaNotFoundError }) as never);
      await expect(provider.destroyMatching(MATCH, 30, () => {})).rejects.toThrow('listing refused');
      await expect(daytonaProvider(KEY).destroyMatching({ workload: 'radar-publisher' }, 30, () => {})).rejects.toThrow(/workload and entry/);
    });

    it('with a listener, reports what it had no time left to delete instead of calling delete with no time', async () => {
      const slow = sdk.remote('slow', { ...MATCH, run: 'g' }); const late = sdk.remote('late', { ...MATCH, run: 'h' });
      const realNow = Date.now; let now = realNow();
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      slow.delete.mockImplementation(async () => { now += 31_000; });
      sdk.state.sandboxes.push(slow, late);
      const leftovers: { id: string; error: string }[] = [];
      expect(await daytonaProvider(KEY).destroyMatching(MATCH, 30, leftover => leftovers.push(leftover))).toBe(1);
      expect(late.delete).not.toHaveBeenCalled();
      expect(leftovers).toEqual([{ id: 'late', state: null, error: 'not attempted: the sweep ran out of time' }]);
      vi.restoreAllMocks();
    });
  });
});
