// Partner notices for the backlinks network: approvals (the partner's editor places the link), decline notes,
// removal requests (7-day window) and lost links (both sides). Decision notices are delayed so the toast's Undo can cancel them.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { enqueue } from '../../jobs/queue';
import { sendMail } from '../mail';
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
    const text = [
      `${nameOf(me)} (${me?.domain}) approved a partner link on your page ${absUrl(d.page)}.`,
      '', 'The proposed sentence:', sentence, '',
      `Links to: ${absUrl(d.target)}`, `Anchor: ${d.anchor}`, `Attribute: ${d.rel}`, `Disclosure: ${d.disclosure}`, '',
      'You’re the editor: place it as written, adjust the sentence, or skip it. Please keep the attribute and the disclosure.',
      counterpart && !counterpart.decision ? 'You can also approve it in Radar → Backlinks → Links from you, and Radar adds it the next time that article publishes.' : '',
      'Radar checks the page and reports the link to both sides once it’s live.',
    ].filter(x => x !== null).join('\n');
    await sendMail(to.email, `${nameOf(me)} approved a partner link on ${displayUrl(d.page)}`, text);
    return { sent: 'approved' };
  }
  if (decision === 'rejected' && row.note) {
    const text = [`${nameOf(me)} (${me?.domain}) passed on the proposed link on ${absUrl(d.page)}:`, '', sentence, '', `Their note: “${row.note}”`].join('\n');
    await sendMail(to.email, `${nameOf(me)} passed on a partner link`, text);
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
  const text = [
    `${nameOf(requester)} (${requester.domain}) asked Radar to remove a link on your site.`, '',
    `Page: ${absUrl(link.from)}`, `Link to: ${absUrl(link.to)}`, `Anchor: “${link.anchor}”`, '',
    'Please remove the link within 7 days. Radar re-checks the page and confirms the removal to both sides.',
  ].join('\n');
  await sendMail(to.email, `Link removal request from ${nameOf(requester)}`, text);
  return true;
}

/** Lost (or un-qualified) links are reported to both sides. */
export async function sendLostNotice(link: { from: string; to: string; anchor: string; rel: string }, ownerBizId: string, reason: 'missing' | 'rel') {
  const owner = await biz(ownerBizId); const host = await hostBusiness(link.from);
  const why = reason === 'rel' ? `The link is there but no longer carries rel="${link.rel === 'nofollow' ? 'nofollow' : 'sponsored'}", which network links require.` : 'Radar couldn’t find the link on the page anymore.';
  const text = [`A partner link needs attention.`, '', `Page: ${absUrl(link.from)}`, `Link to: ${absUrl(link.to)}`, `Anchor: “${link.anchor}”`, '', why, 'If it was removed on purpose, no action is needed. Otherwise, restore it as placed.'].join('\n');
  const recipients = new Set<string>();
  for (const b of [owner, host]) { if (!b) continue; const e = await editorEmail(b.id); if (e) recipients.add(e.email); }
  for (const r of recipients) await sendMail(r, `Partner link not found on ${displayUrl(link.from)}`, text);
}
