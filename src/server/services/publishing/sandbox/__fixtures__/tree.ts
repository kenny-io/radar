// A pinned repository tree and an agent run, as the control plane would hand them to the gate. In-memory only.
import { createHash } from 'node:crypto';
import type { RepoEntry, RepositoryPostOptions } from '../../connectors/nextjs-agent';
import type { PublishPayload } from '../../types';
import type { AgentReport, PublicationGateInput, RunnerResult } from '../types';

export const blobSha = (data: Buffer) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
const buffer = (value: string | Buffer) => (typeof value === 'string' ? Buffer.from(value, 'utf8') : value);

export interface FixtureTree {
  entries: Map<string, RepoEntry>;
  readBlob(sha: string): Promise<Buffer>;
  /** Blob SHAs the gate asked for, in order. */
  reads: string[];
  text(path: string): string;
}
/** Builds the recursive tree GitHub returns for a commit: a `tree` entry per directory, a `blob` entry with its real
 *  git hash per file, plus any `extra` entries (symbolic links are blobs with mode 120000, submodules are commits). */
export function treeOf(files: Map<string, string | Buffer>, extra: RepoEntry[] = []): FixtureTree {
  const entries = new Map<string, RepoEntry>();
  const blobs = new Map<string, Buffer>();
  for (const [path, value] of files) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join('/');
      if (!entries.has(directory)) entries.set(directory, { path: directory, type: 'tree', mode: '040000', sha: blobSha(Buffer.from('tree ' + directory)) });
    }
    const data = buffer(value); const sha = blobSha(data);
    blobs.set(sha, data);
    entries.set(path, { path, type: 'blob', mode: '100644', sha, size: data.length });
  }
  for (const entry of extra) entries.set(entry.path, entry);
  const reads: string[] = [];
  return {
    entries, reads,
    async readBlob(sha) { reads.push(sha); const data = blobs.get(sha); if (!data) throw new Error('blob not in fixture: ' + sha); return data; },
    text(path) { const entry = entries.get(path); const data = entry && blobs.get(entry.sha); if (!data) throw new Error('file not in fixture: ' + path); return data.toString('utf8'); },
  };
}

export const CAPABILITY = 'rdrcap1.eyJ2IjoxLCJhdWQiOiJyYWRhci1wdWJsaXNoLW1vZGVsIiwicnVuSWQiOiJmaXh0dXJlIn0.c2lnbmF0dXJlLWZvci1maXh0dXJlcy1vbmx5';

export interface AgentOutput { files: Record<string, string | Buffer>; articlePath: string; route: string; slug?: string; report?: Partial<AgentReport>; result?: Partial<RunnerResult> }
/** The gate input for one hand-written agent output: `files` are what the control plane downloaded from the sandbox. */
export function gateInput(tree: FixtureTree, payload: PublishPayload, output: AgentOutput, options: Partial<RepositoryPostOptions> = {}): PublicationGateInput {
  const finals = new Map(Object.entries(output.files).map(([path, value]) => [path, buffer(value)]));
  const report: AgentReport = {
    version: 1, status: 'integrated', slug: output.slug ?? payload.slug, articlePath: output.articlePath, route: output.route,
    summary: 'Added the article using the conventions found in the repository.',
    evidence: [{ role: 'content', path: output.articlePath, note: 'Existing articles live here.' }],
    conventions: [], deviations: [], reason: null, ...output.report,
  };
  const result: RunnerResult = {
    version: 1, status: 'completed', agentError: null, sessionId: 'session-fixture', turns: 12,
    changed: [...finals].map(([path, data]) => ({ path, bytes: data.length })), ...output.result,
  };
  return { payload, hint: 'content', entries: tree.entries, report, result, finals, readBlob: tree.readBlob, options: { businessId: 'b_fixture', ...options }, capability: CAPABILITY };
}
