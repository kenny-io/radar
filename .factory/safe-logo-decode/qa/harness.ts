// Shared by the QA probes: the state the module mocks write to, and the page and site builders.
// Each test file declares the mocks itself (vi.mock is per file) and points them at `H` from vi.hoisted.
import crypto from 'node:crypto';
export interface SpawnRecord { command: string; args: string[]; options: any; pid: number | undefined; startedAt: number; ended: { status: number | null; signal: string | null; at: number } | null }
export interface PutRecord { key: string; body: Buffer; type: string }
export type Served = { type: string; body: Buffer | string; status?: number };
export const ORIGIN = 'https://logo-qa.example';
export const sha = (b: Buffer | string) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
/** The site: what each path answers with; anything else is a 404 page. Returns the fetchUrl stand-in and the paths asked for. */
export function site(files: Record<string, Served>) {
  const asked: string[] = [];
  const fetchUrl = async (url: string) => {
    const u = new URL(url); asked.push(u.pathname);
    const f = files[u.pathname];
    return f ? { status: f.status ?? 200, type: f.type, body: Buffer.from(f.body as Buffer), url } : { status: 404, type: 'text/html', body: Buffer.from('<html><body>Not found</body></html>'), url };
  };
  return { fetchUrl, asked };
}
export const CSS_PRIMARY = '#2563EB';
/** A home page whose logo candidates are apple-touch-icon links, in order, with one brand colour in CSS and lang=fr. */
export const page = (candidates: string[], o: { styled?: boolean; head?: string; body?: string } = {}) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Site</title>${o.styled === false ? '' : '<style>:root{--brand-primary:#2563eb}</style>'}${candidates.map(h => `<link rel="apple-touch-icon" href="${h}">`).join('')}${o.head ?? ''}</head><body>${o.body ?? '<main><h1>Hello</h1></main>'}</body></html>`;
