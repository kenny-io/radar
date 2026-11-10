// Read-only actual-source provider check. Environment is injected by authenticated Railway CLI; no keys are saved.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:1/radar_qa_no_database';
process.env.RADAR_DEV_STUBS = '0';
process.env.RADAR_FAILURE_ALERTS = 'off';
process.env.RESEND_API_KEY = '';
const root = process.argv[2];
if (!root) throw new Error('A pinned local destination clone is required');
const out = path.resolve('.data/refresh-publishing');
await fs.mkdir(out, { recursive: true, mode: 0o700 });
const payload = JSON.parse(await fs.readFile(path.join(out, 'expected-payload.json'), 'utf8'));
if (payload.qaWritingModel) process.env.RADAR_AI_WRITING_MODEL = payload.qaWritingModel;
delete payload.qaWritingModel;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const entries = execFileSync('git', ['ls-tree', '-rlz', head], { cwd: root, encoding: 'utf8', maxBuffer: 5_000_000 }).split('\0').filter(Boolean).map(line => {
  const m = /^(\d+) (\S+) ([a-f0-9]+)\s+(\d+|-)\t([\s\S]+)$/.exec(line);
  if (!m) throw new Error('Unexpected snapshot tree record');
  return { mode: m[1], type: m[2], sha: m[3], ...(m[4] === '-' ? {} : { size: Number(m[4]) }), path: m[5] };
});
const actualFetch = globalThis.fetch;
const allowed = new Set(['openrouter.ai', 'api.openai.com', 'api.anthropic.com', 'api.x.ai']);
let requests = 0;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!allowed.has(u.hostname) || ++requests > 12) throw new Error('Read-only QA provider request limit');
  return actualFetch(input, init);
};
const { ai } = await import('../../src/server/ai');
const { pool } = await import('../../src/server/db');
const { planRepositoryPost } = await import('../../src/server/services/publishing/connectors/nextjs-agent');
const original = ai.run;
const captured: any[] = [];
ai.run = async (task, input, options) => {
  const result = await original(task, input, { ...options, businessId: undefined, retries: 0 });
  captured.push({ purpose: input.purpose, model: result.model, provider: result.provider, prompt: JSON.parse(input.prompt), response: result.json });
  await fs.writeFile(path.join(out, 'live-trace.json'), JSON.stringify(captured), { mode: 0o600 });
  console.log(JSON.stringify({ completed: input.purpose, model: result.model }));
  return result;
};
const started = Date.now();
try {
  const plan = await planRepositoryPost('apps/web/app/blog', payload, {
    entries,
    read: async name => execFileSync('git', ['show', `${head}:${name}`], { cwd: root, encoding: 'utf8', maxBuffer: 1_000_000 }),
  }, { businessId: undefined as any, deadlineAt: Date.now() + 270_000 });
  await fs.writeFile(path.join(out, 'live-plan.json'), JSON.stringify(plan), { mode: 0o600 });
  const evidence = { status: 'approved-source-plan', destinationHead: head, plannerSha256: createHash('sha256').update(await fs.readFile('src/server/services/publishing/connectors/nextjs-agent.ts')).digest('hex'), route: plan.route, articlePath: plan.path, files: plan.files.map(f => f.path), requests, calls: captured.map(c => c.purpose), elapsedMs: Date.now() - started, runtimeVerified: plan.review.runtimeVerified, scope: 'Real configured providers, pinned local Git source and exact saved payload; DB deliberately unreachable; network restricted to AI providers; no destination writes. Full trace and proposed files remain private ignored local evidence.' };
  await fs.writeFile('.factory/refresh-publishing/live-plan-result.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} catch (error: any) {
  console.log(JSON.stringify({ status: 'failed-safely', code: error?.diagnostic?.code, reason: error?.diagnostic?.reason || 'Provider check failed', elapsedMs: Date.now() - started }));
  process.exitCode = 1;
} finally { await pool.end(); }
