// Team invites (02-system.md §14): signed, single-use links. Only the sha256 of the token is stored (members.token_hash).
import crypto from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import { randomToken, sha256 } from '../../crypto';
import { sendMail } from '../mail';
import type { Role } from '@/lib/types';

/** Invites expire after this many days. */
export const INVITE_DAYS = 14;

function signingKey(): string {
  if (env.secretKey) return env.secretKey;
  if (env.isProd) throw new Error('RADAR_SECRET_KEY is required in production');
  return 'radar-dev-only-key';
}
const sig = (body: string) => crypto.createHmac('sha256', signingKey()).update('invite:' + body).digest('base64url').slice(0, 22);

/** New invite token: `{random}.{hmac}`. The HMAC lets the accept route reject forged links before touching the DB. */
export function newInviteToken(): { token: string; hash: string } {
  const r = randomToken(24);
  const token = `${r}.${sig(r)}`;
  return { token, hash: sha256(token) };
}
export function verifyTokenShape(token: string): boolean {
  const [r, s] = String(token || '').split('.');
  if (!r || !s || r.length < 20) return false;
  const want = sig(r);
  return s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want));
}
export const inviteUrl = (token: string) => `${env.appUrl}/api/invites/${encodeURIComponent(token)}`;

export async function sendInviteEmail(opts: { to: string; token: string; inviter: string; business: string; domain: string; role: Role }) {
  const link = inviteUrl(opts.token);
  const roleLine = opts.role === 'Admin' ? 'As an Admin you can manage settings, publishing and the team.'
    : opts.role === 'Editor' ? 'As an Editor you can edit the profile, calendar, articles and social packs, and approve articles.'
    : 'As a Viewer you can see everything, but can’t approve or publish.';
  const text = [
    `${opts.inviter} invited you to ${opts.business} (${opts.domain}) on Radar.`,
    '', roleLine, '',
    `Accept the invite: ${link}`, '',
    `This link works once and expires in ${INVITE_DAYS} days. If you weren’t expecting it, you can ignore this email.`,
  ].join('\n');
  const html = `<p>${esc(opts.inviter)} invited you to <strong>${esc(opts.business)}</strong> (${esc(opts.domain)}) on Radar.</p><p>${esc(roleLine)}</p><p><a href="${esc(link)}">Accept the invite</a></p><p style="color:#777">This link works once and expires in ${INVITE_DAYS} days. If you weren’t expecting it, you can ignore this email.</p>`;
  await sendMail(opts.to, `${opts.inviter} invited you to ${opts.business} on Radar`, text, html);
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export type AcceptResult = { ok: true; businessId: string } | { ok: false; reason: 'invalid' | 'expired' };

/** Find a pending invite by its token. */
export async function findInvite(token: string) {
  if (!verifyTokenShape(token)) return null;
  const r = await db.select({ m: schema.members, status: schema.businesses.status }).from(schema.members)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.members.businessId))
    .where(and(eq(schema.members.tokenHash, sha256(token)), eq(schema.members.status, 'invited'))).limit(1);
  return r[0] || null;
}

/**
 * Accept an invite for a signed-in user.
 * Policy (logged in docs/divergences/platform.md): the link itself is the credential — any signed-in user holding a valid,
 * unexpired, single-use token joins with the invited role, even if their account email differs from the invited address
 * (people are often invited at a work alias and sign in with another address). The member row takes the account's email.
 */
export async function acceptInvite(token: string, user: { id: string; email: string }): Promise<AcceptResult> {
  const hit = await findInvite(token);
  if (!hit) return { ok: false, reason: 'invalid' };
  const m = hit.m;
  const at = m.invitedAt || m.createdAt;
  if (Date.now() - at.getTime() > INVITE_DAYS * 864e5) return { ok: false, reason: 'expired' };
  const email = user.email.toLowerCase();
  // Already an active member of this business (e.g. invited twice under two addresses): consume this invite.
  const existing = await db.select().from(schema.members).where(and(eq(schema.members.businessId, m.businessId), eq(schema.members.userId, user.id), eq(schema.members.status, 'active'))).limit(1);
  if (existing[0]) {
    await db.delete(schema.members).where(eq(schema.members.id, m.id));
    return { ok: true, businessId: m.businessId };
  }
  // Another pending row for the account's own email would collide with the unique (business, email) index — drop it.
  if (email !== m.email) await db.delete(schema.members).where(and(eq(schema.members.businessId, m.businessId), eq(schema.members.email, email), ne(schema.members.id, m.id), eq(schema.members.status, 'invited')));
  const clash = email !== m.email ? await db.select({ id: schema.members.id }).from(schema.members).where(and(eq(schema.members.businessId, m.businessId), eq(schema.members.email, email), ne(schema.members.id, m.id))).limit(1) : [];
  await db.update(schema.members).set({ userId: user.id, status: 'active', tokenHash: null, ...(clash[0] ? {} : { email }) }).where(eq(schema.members.id, m.id));
  console.log(`[team] invite ${m.id} accepted by user ${user.id}${email !== m.email ? ` (invited ${m.email}, account ${email})` : ''}`);
  return { ok: true, businessId: m.businessId };
}
