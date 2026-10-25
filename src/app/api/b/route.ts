// Create or reset the actor's onboarding draft (one per owner). The analysis job is started by 'onboarding.analyze'.
// No session at all → a guest is created here (rate-limited per IP, human-check seam), architecture B2.
// Same domain as the draft → reset as before, keeping Search Console. Another domain → also revoke and delete the draft's
// Search Console connection and crawled pages, and clear its onboarding state (architecture §19.1).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { createGuest, currentActor, touchGuest } from '@/server/auth/session';
import { handle, json } from '@/server/http/handle';
import { RadarError } from '@/server/errors';
import { cleanDomain, DOMAIN_RE } from '@/lib/format';
import { defaultProfile } from '@/server/workspace';
import { clientIp } from '@/server/abuse/ip';
import { limitGuestCreation } from '@/server/abuse/rateLimit';
import { verifyHuman } from '@/server/abuse/human';
import { loadTokens, revoke } from '@/server/services/gsc/client';

export const POST = handle(async (req: Request) => {
  const b = z.object({ domain: z.string(), turnstileToken: z.string().max(4096).optional() }).parse(await req.json());
  const domain = cleanDomain(b.domain);
  if (!DOMAIN_RE.test(domain)) throw new RadarError('Enter a domain like yourcompany.com');
  let actor = await currentActor();
  if (!actor) {
    const ip = clientIp(req);
    await limitGuestCreation(ip);
    if (!(await verifyHuman(b.turnstileToken, ip))) throw new RadarError('Radar couldn’t confirm you’re a person. Reload the page and try again.', 403, 'human_check_failed');
    actor = await createGuest();
  } else if (actor.guest) await touchGuest();
  const B = schema.businesses;
  const pending = await db.select({ id: B.id, domain: B.domain }).from(B).where(and(eq(B.ownerId, actor.id), eq(B.status, 'onboarding'))).limit(1);
  let id: string;
  if (pending[0]) {
    id = pending[0].id;
    const other = pending[0].domain !== domain;
    if (other) {
      await revoke(await loadTokens(id));
      await db.delete(schema.gscConnections).where(eq(schema.gscConnections.businessId, id));
      await db.delete(schema.crawlPages).where(eq(schema.crawlPages.businessId, id));
    }
    await db.update(B).set({ domain, profile: defaultProfile(domain), edited: {}, site: {}, kwSuggestions: [], ...(other ? { onboarding: {} } : {}) }).where(eq(B.id, id));
  } else {
    const [row] = await db.insert(B).values({ ownerId: actor.id, domain, status: 'onboarding', profile: defaultProfile(domain) }).returning({ id: B.id });
    id = row.id;
    await db.insert(schema.members).values({ businessId: id, userId: actor.id, email: actor.email.toLowerCase(), role: 'Owner', status: 'active' });
  }
  return json({ ok: true, id, guest: actor.guest });
});
