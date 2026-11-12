// QA-1 fixtures, written independently of src/server/services/publishing/sandbox/__fixtures__. Everything here is
// synthetic: invented places, no people, no businesses, placeholder credentials made for these tests.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Block } from '@/lib/types';
import type { PublishPayload } from '@/server/services/publishing/types';
import type { RepoEntry, RepositoryPostOptions } from '@/server/services/publishing/connectors/nextjs-agent';
import type { AgentReport, PublicationGateInput, RunnerResult } from '@/server/services/publishing/sandbox/types';

export const blobSha = (data: Buffer) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

/** A QA-written article. One em dash, curly quotes, an ampersand, digits with separators, an accented word. */
export const QA_BLOCKS: Block[] = [
  ['p', 'Tidewater Row is a terrace of forty narrow houses beside the old rope works, and this test article describes how a household can keep one of them dry through a wet winter — without spending more than 300 on materials.'],
  ['p', 'Nothing here is advice from a surveyor. It is synthetic content written to test a publishing pipeline, and every number in it was invented for that purpose.'],
  ['h2', 'Start with the gutters'],
  ['p', 'Most damp in a terrace begins above the windows. Clear the gutters before the first storm of October, check that each downpipe runs freely, and look for the green streak on the brickwork that shows where water has been overflowing for a season or more.'],
  ['ul', [
    'Clear leaves from every gutter run twice before December',
    'Flush each downpipe with a hose and watch where the water goes',
    'Re-seat any bracket that has pulled more than 5 mm from the fascia',
  ]],
  ['h2', 'Ventilation & heating'],
  ['p', 'A house that is heated in bursts and never aired will grow mould however sound its roof is. Keep the trickle vents open, run the extractor for twenty minutes after a shower, and hold the living rooms at a steady 17 degrees rather than swinging between cold and hot.'],
  ['h3', 'What a hygrometer tells you'],
  ['p', 'A hygrometer costs about 12 and removes the guesswork. If the reading stays above 65% for more than three days in a row, the room needs more air, more heat, or both; the café owner next door calls this “the three-day rule”.'],
  ['ul', [
    'Below 50%: dry enough, no action needed',
    'Between 50% and 65%: watch it and air the room daily',
    'Above 65%: act within three days',
  ]],
  ['h2', 'When to call someone'],
  ['p', 'Call a roofer if a ceiling stain grows after rain, and a plumber if it grows when nobody has used the bathroom. A stain that never changes is usually old, and painting over it with a stain block is all it needs.'],
  ['p', 'Keep a dated photograph of every mark you find. Six photographs taken a month apart will tell a tradesperson more than any description, and they cost nothing.'],
];

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const toHtml = (blocks: Block[]) => blocks.map(([kind, value]) => kind === 'ul' ? `<ul>${(value as string[]).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<${kind}>${escapeHtml(value as string)}</${kind}>`).join('\n');
export const toMarkdown = (blocks: Block[]) => blocks.map(([kind, value]) => kind === 'ul' ? (value as string[]).map(item => `- ${item}`).join('\n') : kind === 'h2' ? `## ${value}` : kind === 'h3' ? `### ${value}` : String(value)).join('\n\n') + '\n';

export function payloadOf(blocks: Block[] = QA_BLOCKS, overrides: Partial<PublishPayload> = {}): PublishPayload {
  return {
    entryId: 'e_qa_Zk81', title: 'QA test article: keeping a terrace house dry', slug: 'qa-keeping-a-terrace-house-dry', html: toHtml(blocks), markdown: toMarkdown(blocks), blocks,
    bodyImages: [], meta: 'Synthetic test content about keeping a terrace house dry in winter.', seoTitle: 'Keeping a Terrace House Dry (QA Test)', keyword: 'keep terrace house dry', date: '2026-11-12',
    image: null, canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'QA Fixture Co', ...overrides,
  };
}

export interface QaTree { entries: Map<string, RepoEntry>; blobs: Map<string, Buffer>; readBlob(sha: string): Promise<Buffer> }
export function treeOf(files: Record<string, string | Buffer>, extra: RepoEntry[] = []): QaTree {
  const entries = new Map<string, RepoEntry>(); const blobs = new Map<string, Buffer>();
  for (const [path, value] of Object.entries(files)) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth++) { const directory = parts.slice(0, depth).join('/'); if (!entries.has(directory)) entries.set(directory, { path: directory, type: 'tree', mode: '040000', sha: blobSha(Buffer.from('tree ' + directory)) }); }
    const data = typeof value === 'string' ? Buffer.from(value, 'utf8') : value; const sha = blobSha(data);
    blobs.set(sha, data); entries.set(path, { path, type: 'blob', mode: '100644', sha, size: data.length });
  }
  for (const entry of extra) entries.set(entry.path, entry);
  return { entries, blobs, async readBlob(sha) { const data = blobs.get(sha); if (!data) throw new Error('blob not in QA tree: ' + sha); return data; } };
}

/** A capability-shaped placeholder (not signed with any real secret). */
export const QA_CAPABILITY = 'rdrcap1.' + Buffer.from(JSON.stringify({ qa: 'placeholder-claims-not-a-real-capability' })).toString('base64url') + '.' + Buffer.from('qa-placeholder-signature-0123456789').toString('base64url');

export interface QaOutput { files: Record<string, string | Buffer>; articlePath: string; route: string; slug?: string; report?: Partial<AgentReport>; result?: Partial<RunnerResult> }
export function gateInput(tree: QaTree, payload: PublishPayload, output: QaOutput, options: Partial<RepositoryPostOptions> = {}): PublicationGateInput {
  const finals = new Map(Object.entries(output.files).map(([path, value]) => [path, typeof value === 'string' ? Buffer.from(value, 'utf8') : value]));
  const report: AgentReport = { version: 1, status: 'integrated', slug: output.slug ?? payload.slug, articlePath: output.articlePath, route: output.route, summary: 'QA scripted output.', evidence: [], conventions: [], deviations: [], reason: null, ...output.report };
  const result: RunnerResult = { version: 1, status: 'completed', agentError: null, sessionId: null, turns: 3, changed: [...finals].map(([path, data]) => ({ path, bytes: data.length })), ...output.result };
  return { payload, hint: 'content', entries: tree.entries, report, result, finals, readBlob: tree.readBlob, options: { businessId: 'b_qa', ...options }, capability: QA_CAPABILITY };
}

/** Deterministic filler sentences for peer records (no real names). */
export function filler(seed: number, sentences: number): string {
  const words = ['harbour', 'ledger', 'window', 'copper', 'lantern', 'meadow', 'timber', 'quarry', 'saddle', 'thistle', 'anchor', 'barley', 'cobble', 'drift', 'ember', 'fathom', 'gable', 'hollow', 'inlet', 'juniper', 'kiln', 'loom', 'mortar', 'nettle', 'orchard', 'pebble', 'quill', 'rafter', 'sluice', 'tallow'];
  let state = seed >>> 0; const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const out: string[] = [];
  for (let s = 0; s < sentences; s++) { const n = 9 + (next() % 9); const sentence: string[] = []; for (let w = 0; w < n; w++) sentence.push(words[next() % words.length]); out.push(sentence.join(' ').replace(/^./, ch => ch.toUpperCase()) + '.'); }
  return out.join(' ');
}

export async function gateFailure(run: () => Promise<unknown>): Promise<{ code: string; reason: string; diagnostic: any; error: any }> {
  try { await run(); } catch (error: any) { return { code: error?.diagnostic?.code ?? 'no-diagnostic', reason: String(error?.diagnostic?.reason ?? error?.message), diagnostic: error?.diagnostic, error }; }
  throw new Error('expected the gate to refuse this output, but it accepted it');
}

/** A gzip-compressed ustar archive with one top-level directory, the shape of a GitHub tarball (used by live checks). */
export function archiveOf(files: Record<string, string>, root: string): Buffer {
  const header = (name: string, size: number, type: '0' | '5') => {
    const block = Buffer.alloc(512);
    block.write(name, 0, 100, 'utf8'); block.write(type === '5' ? '0000755\0' : '0000644\0', 100); block.write('0000000\0', 108); block.write('0000000\0', 116);
    block.write(size.toString(8).padStart(11, '0') + '\0', 124); block.write('00000000000\0', 136); block.write('        ', 148); block.write(type, 156); block.write('ustar\0' + '00', 257);
    let sum = 0; for (const byte of block) sum += byte;
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return block;
  };
  const parts: Buffer[] = [header(`${root}/`, 0, '5')]; const directories = new Set<string>();
  for (const [file, content] of Object.entries(files)) {
    const segments = file.split('/');
    for (let depth = 1; depth < segments.length; depth++) { const directory = segments.slice(0, depth).join('/'); if (!directories.has(directory)) { directories.add(directory); parts.push(header(`${root}/${directory}/`, 0, '5')); } }
    const data = Buffer.from(content, 'utf8');
    parts.push(header(`${root}/${file}`, data.length, '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
