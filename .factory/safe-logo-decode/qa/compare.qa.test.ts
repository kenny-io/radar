// The scenarios of scenarios.ts through detectBrand on the revision under test. Writes evidence/compare-new.json; the
// base's answers for the same inputs come from compare.base.test.ts (vitest.base.config.ts), and compare-report.mjs
// lists the differences. The only assertion here is the one every input must meet: detectBrand resolves.
import { afterAll, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ fetchUrl: (..._a: any[]): any => null, puts: [] as any[] }));
vi.mock('@/server/services/analysis/crawl', async original => ({ ...(await original<any>()), fetchUrl: (...a: any[]) => H.fetchUrl(...a) }));
vi.mock('@/server/services/storage', async original => ({ ...(await original<any>()), putObject: async (key: string, body: Buffer, type: string) => { H.puts.push({ key, body, type }); return '/api/files/' + key; } }));
import fs from 'node:fs';
import path from 'node:path';
import { detectBrand } from '@/server/services/analysis/brand';
import { QA_DIR } from './fixtures';
import { ORIGIN, sha, site } from './harness';
import { scenarios } from './scenarios';

const rows: Record<string, any> = {};
afterAll(() => fs.writeFileSync(path.join(QA_DIR, 'evidence/compare-new.json'), JSON.stringify(rows, null, 1)));
describe('scenarios on the revision under test', () => {
  it.each(scenarios().map(s => [s.name, s] as const))('%s', async (name, s) => {
    H.puts.length = 0; const st = site(s.files); H.fetchUrl = st.fetchUrl;
    const r = await detectBrand('qa', s.html, ORIGIN);
    const put = H.puts[H.puts.length - 1];
    rows[name] = { logo: put ? { ext: put.key.split('.').pop(), type: put.type, from: Object.entries(s.files).find(([, f]) => sha(Buffer.from(f.body as Buffer)) === sha(put.body))?.[0] ?? 'inline', bytes: put.body.length } : null, puts: H.puts.length, primary: r.primary, secondary: r.secondary, language: r.language, asked: st.asked };
    expect(r.logo === null).toBe(!put);
  }, 30_000);
});
