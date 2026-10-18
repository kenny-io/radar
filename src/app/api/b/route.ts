// Create a business (starts onboarding). The analysis job is started by the 'onboarding.analyze' action.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { requireUser } from '@/server/access';
import { handle, json } from '@/server/http/handle';
import { RadarError } from '@/server/errors';
import { cleanDomain, DOMAIN_RE } from '@/lib/format';
import { defaultProfile } from '@/server/workspace';

export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const { domain: raw } = z.object({ domain: z.string() }).parse(await req.json());
  const domain = cleanDomain(raw);
  if (!DOMAIN_RE.test(domain)) throw new RadarError('Enter a domain like yourcompany.com');
  // Reuse this user's unfinished onboarding business, if any, so retries don't pile up.
  const pending = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(and(eq(schema.businesses.ownerId, u.id), eq(schema.businesses.status, 'onboarding'))).limit(1);
  let id: string;
  if (pending[0]) {
    id = pending[0].id;
    await db.update(schema.businesses).set({ domain, profile: defaultProfile(domain), edited: {}, site: {}, kwSuggestions: [] }).where(eq(schema.businesses.id, id));
  } else {
    const [b] = await db.insert(schema.businesses).values({ ownerId: u.id, domain, status: 'onboarding', profile: defaultProfile(domain) }).returning({ id: schema.businesses.id });
    id = b.id;
    await db.insert(schema.members).values({ businessId: id, userId: u.id, email: u.email, role: 'Owner', status: 'active' });
  }
  return json({ ok: true, id });
});
