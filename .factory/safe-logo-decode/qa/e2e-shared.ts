// The end-to-end run shared by e2e.db.qa.test.ts (revision under test) and e2e.db.base.test.ts (base): the real
// onboarding analysis job (`analysis.site`, src/server/services/analysis/jobs.ts) through the real job queue
// (enqueue + runJobNow), a real Postgres database and local-disk storage, in development-stub mode: the stub site
// answers the crawler (no network) and the stub extraction stands in for the AI providers (no keys). Only the stub
// site's answers for the logo files, the stylesheet and the home page are changed, per scenario, by the test file.
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { enqueue, getJob, runJobNow } from '@/server/jobs/queue';
import '@/server/services/analysis/jobs';
import { Fixtures, uniq } from '@/server/testing/fixtures';
import { readStored } from '@/server/services/storage';
import { defaultProfile } from '@/server/workspace';
import type { Profile } from '@/lib/types';

export type StubAnswer = { status: number; type: string; body: Buffer; url: string };
export type Rewrite = (path: string, real: () => Promise<StubAnswer>, url: string) => Promise<StubAnswer> | StubAnswer | undefined;
export const F = new Fixtures();
export async function analyse(rewrite: { current: Rewrite | null }, how: Rewrite | null, domain = `qa-logo-${uniq()}.test`) {
  rewrite.current = how;
  const owner = await F.user(); const biz = await F.biz(owner, { status: 'onboarding', domain, profile: defaultProfile(domain) });
  const id = await enqueue('analysis.site', {}, { businessId: biz.id });
  const t = Date.now(); await runJobNow(id as string); const ms = Date.now() - t;
  const job = (await getJob(id as string))!;
  const row = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id)))[0];
  const profile = row.profile as Profile;
  const stored = profile.brand.logo ? await readStored(biz.id, profile.brand.logo) : null;
  rewrite.current = null;
  return { domain, biz, job, ms, profile, stored, defaults: defaultProfile(domain).brand, progress: job.progress as any };
}
export const image = (type: string, body: Buffer, url: string): StubAnswer => ({ status: 200, type, body, url });
