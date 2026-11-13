// The scenarios of scenarios.ts through the BASE checkout's detectBrand. Writes evidence/compare-base.json.
// Inputs marked unsafeOnBase are left out: the base decodes in this process and those end it.
import { afterAll, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ fetchUrl: (..._a: any[]): any => null, puts: [] as any[], base: process.env.QA_BASE_CHECKOUT! }));
vi.mock(H.base + '/src/server/services/analysis/crawl.ts', async original => ({ ...(await original<any>()), fetchUrl: (...a: any[]) => H.fetchUrl(...a) }));
vi.mock(H.base + '/src/server/services/storage.ts', async original => ({ ...(await original<any>()), putObject: async (key: string, body: Buffer, type: string) => { H.puts.push({ key, body, type }); return '/api/files/' + key; } }));
import fs from 'node:fs';
import path from 'node:path';
import { QA_DIR } from './fixtures';
import { ORIGIN, sha, site } from './harness';
import { scenarios } from './scenarios';

const rows: Record<string, any> = {};
afterAll(() => fs.writeFileSync(path.join(QA_DIR, 'evidence/compare-base.json'), JSON.stringify(rows, null, 1)));
describe('scenarios on the base', () => {
  it('the module under test here is the base one (it still imports the canvas library)', () => {
    expect(fs.readFileSync(H.base + '/src/server/services/analysis/brand.ts', 'utf8')).toContain("from '@napi-rs/canvas'");
  });
  it.each(scenarios().filter(s => !s.unsafeOnBase).map(s => [s.name, s] as const))('%s', async (name, s) => {
    const { detectBrand } = await import(/* @vite-ignore */ H.base + '/src/server/services/analysis/brand.ts');
    H.puts.length = 0; const st = site(s.files); H.fetchUrl = st.fetchUrl;
    const r = await detectBrand('qa', s.html, ORIGIN);
    const put = H.puts[H.puts.length - 1];
    rows[name] = { logo: put ? { ext: put.key.split('.').pop(), type: put.type, from: Object.entries(s.files).find(([, f]) => sha(Buffer.from(f.body as Buffer)) === sha(put.body))?.[0] ?? 'inline', bytes: put.body.length } : null, puts: H.puts.length, primary: r.primary, secondary: r.secondary, language: r.language, asked: st.asked };
    expect(r.logo === null).toBe(!put);
  }, 30_000);
});
