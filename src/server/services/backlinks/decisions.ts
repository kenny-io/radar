// Partner notices for the backlinks network: approvals (the partner's editor places the link), decline notes,
// removal requests (7-day window) and lost links (both sides). Decision notices are delayed so the toast's Undo can cancel them.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { enqueue } from '../../jobs/queue';
import { sendMail } from '../mail';
import { env } from '../../env';
import { backlinkApprovedEmail, backlinkDeclinedEmail, backlinkLostEmail, backlinkRemovalEmail } from '../legacyContent';
import { absUrl, displayUrl, editorEmail, hostOf } from './network';
import type { Profile } from '@/lib/types';

/** Undo window: toasts live 4.2s; give a comfortable margin before anything leaves Radar. */
export const NOTICE_DELAY_MS = 20_000;

async function biz(id: string | null | undefined) {
  if (!id) return null;
  return (await db.select().from(schema.businesses).where(eq(schema.businesses.id, id)).limit(1))[0] || null;
}
const nameOf = (b: { profile: any; domain: string } | null) => (b ? ((b.profile as Profile)?.business?.name || b.domain) : 'A partner');

export async function scheduleDecisionNotice(proposalId: string, decision: 'approved' | 'rejected', key: string) {
  const r = (await db.select({ businessId: schema.proposals.businessId }).from(schema.proposals).where(eq(schema.proposals.id, proposalId)).limit(1))[0];
  if (!r) return;
  await enqueue('backlinks.notice', { proposalId, decision, key }, { businessId: r.businessId, ref: proposalId, runAt: new Date(Date.now() + NOTICE_DELAY_MS) });
}

/** Runs NOTICE_DELAY_MS after a decision. Skips when the decision was undone or changed since (noticeKey mismatch). */
export async function runDecisionNotice({ proposalId, decision, key }: { proposalId: string; decision: 'approved' | 'rejected'; key: string }) {
  const row = (await db.select().from(schema.proposals).where(eq(schema.proposals.id, proposalId)).limit(1))[0];
  if (!row || row.data?.noticeKey !== key) return { skipped: true };
  const d = row.data || {};
  const me = await biz(row.businessId); const partner = await biz(row.partnerBusinessId);
  if (!partner) return { skipped: true };
  const to = await editorEmail(partner.id);
  if (!to) return { skipped: true };
  const sentence = `${d.before || ''}[${d.anchor}](${absUrl(d.target)})${d.after || ''}`;
  if (decision === 'approved' && row.direction === 'in') {
    // The partner hosts the link. Tell its editor where and how to place it.
    const counterpart = d.pairId ? (await db.select().from(schema.proposals).where(and(eq(schema.proposals.businessId, partner.id), eq(schema.proposals.direction, 'out'))).then(rs => rs.find(r => r.data?.pairId === d.pairId))) : null;
    const mail = backlinkApprovedEmail({ appUrl: env.appUrl, business: nameOf(me), domain: me?.domain || '', page: absUrl(d.page), displayPage: displayUrl(d.page), sentence, target: absUrl(d.target), anchor: d.anchor, rel: d.rel, disclosure: d.disclosure, canApproveInRadar: !!counterpart && !counterpart.decision });
    await sendMail(to.email, mail.subject, mail.text);
    await db.update(schema.proposals).set({ data: { ...d, approvedNoticeSent: true } }).where(eq(schema.proposals.id, row.id));
    return { sent: 'approved' };
  }
  if (decision === 'rejected' && row.note) {
    const mail = backlinkDeclinedEmail({ appUrl: env.appUrl, business: nameOf(me), domain: me?.domain || '', page: absUrl(d.page), sentence, note: row.note });
    await sendMail(to.email, mail.subject, mail.text);
    return { sent: 'rejected' };
  }
  return { skipped: true };
}

/** The business that hosts a page (by domain), if it is a Radar business. */
export async function hostBusiness(fromUrl: string) {
  const host = hostOf(fromUrl);
  const rows = await db.select().from(schema.businesses).where(eq(schema.businesses.domain, host)).limit(5);
  return rows.find(r => r.status === 'active') || rows[0] || null;
}

export async function sendRemovalRequest(link: { from: string; to: string; anchor: string }, requester: { profile: any; domain: string }) {
  const host = await hostBusiness(link.from);
  const to = host ? await editorEmail(host.id) : null;
  if (!to) { console.warn('[backlinks] removal requested but no contact for', link.from); return false; }
  const mail = backlinkRemovalEmail({ appUrl: env.appUrl, business: nameOf(requester), domain: requester.domain, page: absUrl(link.from), target: absUrl(link.to), anchor: link.anchor });
  await sendMail(to.email, mail.subject, mail.text);
  return true;
}

/** Lost (or un-qualified) links are reported to both sides. */
export async function sendLostNotice(link: { from: string; to: string; anchor: string; rel: string }, ownerBizId: string, reason: 'missing' | 'rel') {
  const owner = await biz(ownerBizId); const host = await hostBusiness(link.from);
  const mail = backlinkLostEmail({ appUrl: env.appUrl, page: absUrl(link.from), displayPage: displayUrl(link.from), target: absUrl(link.to), anchor: link.anchor, rel: link.rel, reason });
  const recipients = new Set<string>();
  for (const b of [owner, host]) { if (!b) continue; const e = await editorEmail(b.id); if (e) recipients.add(e.email); }
  for (const r of recipients) await sendMail(r, mail.subject, mail.text);
}
