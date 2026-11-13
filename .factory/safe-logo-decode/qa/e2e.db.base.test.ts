// End to end on the BASE: the same onboarding analysis job, same database, same stub site, with one logo candidate
// replaced by a file that crashes the decoder. On the base the decode is in this process, so this test file's process
// is expected to END (vitest reports that its worker exited); the run is the evidence, not a pass.
//   QA_BASE_CHECKOUT=<base checkout> DATABASE_URL=... npx vitest run --config .factory/safe-logo-decode/qa/vitest.base.config.ts e2e
import { afterAll, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.STORAGE_DIR = '.data/safe-logo-qa-base'; process.env.RADAR_BILLING = 'off';
  for (const k of ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  return { rewrite: { current: null as any } };
});
vi.mock('@/server/services/analysis/devsite', async original => {
  const real = await original<any>();
  return { ...real, devFetch: async (url: string) => { const path = new URL(url).pathname; const answer = M.rewrite.current ? await M.rewrite.current(path, () => real.devFetch(url), url) : undefined; return answer ?? real.devFetch(url); } };
});
import fs from 'node:fs';
import path from 'node:path';
import { analyse, F, image } from './e2e-shared';
import { badFiles, QA_DIR } from './fixtures';

const out = path.join(QA_DIR, 'evidence/e2e-base.log'); const say = (line: string) => fs.appendFileSync(out, line + '\n');
afterAll(async () => { await F.cleanup(); fs.rmSync(path.resolve('.data/safe-logo-qa-base'), { recursive: true, force: true }); });
describe.skipIf(!process.env.DATABASE_URL)('BASE: onboarding analysis end to end', () => {
  it('control: the stub site as it is', async () => {
    fs.writeFileSync(out, `base e2e, pid ${process.pid}, brand.ts imports canvas: ${fs.readFileSync(process.env.QA_BASE_CHECKOUT + '/src/server/services/analysis/brand.ts', 'utf8').includes("from '@napi-rs/canvas'")}\n`);
    const r = await analyse(M.rewrite, null); say(`control: job ${r.job.status}, logo ${r.profile.brand.logo ? 'stored' : 'none'}`);
    expect(r.job.status).toBe('done');
  }, 120_000);
  it('the first logo candidate is a PNG whose header checksum is wrong', async () => {
    say('crash scenario: starting the job; if no line follows, the process ended inside it');
    const r = await analyse(M.rewrite, (p: string, _real: any, url: string) => (p === '/brand/logo.svg' ? image('image/png', badFiles()['png-ihdr-crc-wrong'].body, url) : undefined));
    say(`crash scenario: job ${r.job.status}, logo ${r.profile.brand.logo}`);
    expect(r.job.status).toBe('done');
  }, 120_000);
});
