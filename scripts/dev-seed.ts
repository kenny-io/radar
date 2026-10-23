// DEV ONLY. Creates a local test account + one active business so screens can be exercised without running onboarding.
// Usage: DATABASE_URL=... npx tsx scripts/dev-seed.ts   → sign in as dev@radar.local / radar-dev-1
// Social channels: with RADAR_DEV_STUBS=1 and RADAR_SOCIAL_PUBLISHING on for this business (e.g. =all), the stub X account,
// LinkedIn profile and LinkedIn page are connected too (idempotent; also runs on an already-seeded database).
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db, pool, schema } from '../src/server/db';
import { env } from '../src/server/env';
import { socialOn } from '../src/server/flags';
import { encrypt } from '../src/server/crypto';
import { stubIdentity, stubTokens } from '../src/server/services/social/publish/stubs';
import type { SocialChannel } from '../src/lib/types';

/** Connect the three stub social accounts (dev stubs + flag on only). Existing connections are left alone. */
async function seedSocial(b: typeof schema.businesses.$inferSelect, u: typeof schema.users.$inferSelect) {
  if (!env.devStubs || !(await socialOn(b))) return;
  const name = (b.profile as any)?.business?.name || b.domain; let n = 0;
  for (const ch of ['x', 'li_profile', 'li_page'] as SocialChannel[]) {
    const id = ch === 'li_page' ? { remoteId: 'stub-pg1', name, handle: null } : stubIdentity(ch, { businessName: name, userName: u.name, userId: u.id });
    const t = stubTokens(ch);
    const r = await db.insert(schema.socialAccounts).values({ businessId: b.id, ch, remoteId: id.remoteId, name: id.name, handle: id.handle ?? null, tokensEnc: encrypt(t), expiresAt: t.expires_at ? new Date(t.expires_at) : null, connectedBy: u.id })
      .onConflictDoNothing({ target: [schema.socialAccounts.businessId, schema.socialAccounts.ch] }).returning({ id: schema.socialAccounts.id });
    n += r.length;
  }
  console.log(`Social channels: ${n} stub account(s) connected`);
}

const profile = {
  domain: 'fieldnote.app',
  business: { name: 'Fieldnote', description: 'Time tracking and invoicing for independent designers and small studios.', offerings: ['Calendar-based time tracking', 'Project budgets', 'One-click invoicing', 'Client portal'], industry: 'B2B software · Productivity', positioning: 'The calm alternative to enterprise time trackers — built for people who bill by the hour, not managers who monitor them.', differentiators: ['Tracks time from your calendar, no timers', 'Invoices straight from tracked hours', 'Flat pricing with no per-seat fees'] },
  audience: { segments: ['Freelance designers', 'Small design studios (2–15 people)', 'Independent consultants'], buyers: ['Studio owner', 'Solo freelancer'], needs: ['Bill accurately without micromanaging', 'Spend less time on admin', 'Know which projects are profitable'], competitors: ['Tallyhour', 'Billable', 'Hourwise'] },
  keywords: { list: [
    { kw: 'calendar time tracking', intent: 'Commercial', vol: 720, kd: 18, src: 'site', priority: true },
    { kw: 'time tracking for designers', intent: 'Commercial', vol: 3600, kd: 47, src: 'site', priority: true },
    { kw: 'track billable hours', intent: 'Informational', vol: 1900, kd: 34, src: 'site', priority: true },
    { kw: 'freelance invoice template', intent: 'Commercial', vol: 9900, kd: 39, src: 'site', priority: false },
    { kw: 'scope creep', intent: 'Informational', vol: 4400, kd: 41, src: 'site', priority: false },
    { kw: 'project profitability', intent: 'Informational', vol: 1300, kd: 38, src: 'site', priority: false },
  ] },
  brand: { logo: 'detected', primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain-spoken and warm. Practical over clever. Talks to designers as peers, never down to them.', language: 'English (US)', markets: ['United States', 'United Kingdom', 'Canada'] },
};

async function main() {
  const email = process.env.SEED_EMAIL || 'dev@radar.local';
  let u = (await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0];
  if (!u) [u] = await db.insert(schema.users).values({ name: 'Maya Chen', email, passwordHash: await bcrypt.hash('radar-dev-1', 10) }).returning();
  const existing = await db.select().from(schema.businesses).where(eq(schema.businesses.ownerId, u.id));
  const seeded = existing.find(b => b.domain === 'fieldnote.app');
  if (seeded) { await seedSocial(seeded, u); console.log('Already seeded. Sign in as', email, '/ radar-dev-1'); await pool.end(); return; }
  const [b] = await db.insert(schema.businesses).values({ ownerId: u.id, domain: 'fieldnote.app', status: 'active', profile, edited: { 'business.positioning': true }, site: { pages: 42, articles: 18, ranking: null, analyzedAt: new Date().toISOString() } }).returning();
  await db.insert(schema.members).values({ businessId: b.id, userId: u.id, email, role: 'Owner', status: 'active' });
  await db.insert(schema.gscConnections).values({ businessId: b.id, status: 'skipped' });
  await seedSocial(b, u);
  console.log('Seeded business', b.id, '— sign in as', email, '/ radar-dev-1');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
