import type { Role } from '@/lib/types';
import { FOUNDER_REPLY_TO } from './mailIdentity';

export interface LegacyEmail { subject: string; text: string; html?: string }
export const CONFIRMATION_SUBJECT = 'Confirm your email for Radar';
const name = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const preferences = (appUrl: string) => {
  const origin = new URL(appUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid Radar URL');
  return new URL('/email-preferences', origin).href;
};
const footer = (appUrl: string) => `Ekene\nFounder, Radar\n${FOUNDER_REPLY_TO}\n\nEmail preferences: ${preferences(appUrl)}`;

/** Pure copy builders shared by real senders and local previews. No tokens or addresses are logged here. */
export function confirmationEmail(p: { appUrl: string; link: string; minutes: number }): LegacyEmail {
  return { subject: CONFIRMATION_SUBJECT, text: [
    'Here’s your link to finish creating your Radar account and choose your password.',
    `Confirm my email: ${p.link}`,
    `This link works once and expires in ${p.minutes} minutes. Account access starts after you confirm.`,
    'If you didn’t request this, you can ignore the email.', footer(p.appUrl),
  ].join('\n\n') };
}

export function invitationEmail(p: { appUrl: string; inviter: string; business: string; domain: string; role: Role; link: string; days: number }): LegacyEmail {
  const inviter = name(p.inviter), business = name(p.business), domain = name(p.domain);
  const subject = `${inviter} invited you to ${business} on Radar`;
  const role = p.role === 'Admin' ? 'As an Admin, you can manage business settings, publishing and the team.'
    : p.role === 'Editor' ? 'As an Editor, you can edit the Business Profile, calendar, articles and social packs, and approve articles.'
    : 'As a Viewer, you can review the workspace. Approval and publishing controls are available to editors and admins.';
  const paragraphs = [`${inviter} invited you to join ${business} (${domain}) on Radar.`, role];
  const expiry = `Your invitation link works once and expires in ${p.days} days. If you weren’t expecting an invitation, you can ignore this email.`;
  const prefs = preferences(p.appUrl), logo = new URL('/brand/radar-mark-email.png', p.appUrl).href;
  const text = [...paragraphs, `Accept invitation: ${p.link}`, expiry, footer(p.appUrl)].join('\n\n');
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;background:#f5f5f2;color:#17181c;font:16px/1.6 Arial,sans-serif;overflow-wrap:anywhere;word-break:break-word"><div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(`Join the workspace as ${p.role} and review your invitation.`)}</div><table role="presentation" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td style="padding:32px 16px"><table role="presentation" style="width:100%;max-width:600px;table-layout:fixed;margin:auto;background:#fff;border:1px solid #deded8;border-radius:16px"><tr><td style="padding:32px"><p style="font-size:18px;font-weight:bold"><img src="${esc(logo)}" width="28" height="28" alt="" style="vertical-align:middle;margin-right:10px;background:#fff">Radar <span style="font-size:12px;font-weight:normal;color:#666">by Thally</span></p>${paragraphs.map(x => `<p>${esc(x)}</p>`).join('')}<p><a href="${esc(p.link)}" style="display:inline-block;padding:7px 16px;background:#17181c;color:#fff;border-radius:6px;font-size:14px;font-weight:bold;text-decoration:none">Accept invitation</a></p><p style="font-size:13px;color:#555">${esc(expiry)}</p><p>Ekene<br><span style="font-size:13px;color:#555">Founder, Radar</span><br><a href="mailto:${esc(FOUNDER_REPLY_TO)}" style="font-size:13px;color:#34343a">${esc(FOUNDER_REPLY_TO)}</a></p><hr style="border:0;border-top:1px solid #e4e4df;margin:28px 0 20px"><a href="${esc(prefs)}" style="color:#34343a;font-size:12px;text-decoration:underline">Email preferences</a></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export function backlinkApprovedEmail(p: { appUrl: string; business: string; domain: string; page: string; displayPage: string; sentence: string; target: string; anchor: string; rel: string; disclosure: string; canApproveInRadar: boolean }): LegacyEmail {
  const business = name(p.business);
  return { subject: `${business} approved a partner link on ${name(p.displayPage)}`, text: [
    `${business} (${name(p.domain)}) approved the proposed mention linking to their site from your page.`,
    `Page: ${p.page}`, 'Proposed sentence:', p.sentence,
    `Destination: ${p.target}\nAnchor: ${p.anchor}\nAttribute: ${p.rel}\nDisclosure: ${p.disclosure}`,
    'I’d read the sentence in context before adding it. You can use it as written, adjust it or skip the placement. Keep the link attribute and disclosure.',
    ...(p.canApproveInRadar ? ['For an article published through Radar, you can approve the proposal in Backlinks → Links from you. Radar adds the approved placement the next time that article publishes.'] : []),
    'After placement, check Backlinks → Live links for verification status.', footer(p.appUrl),
  ].join('\n\n') };
}

export function backlinkDeclinedEmail(p: { appUrl: string; business: string; domain: string; page: string; sentence: string; note: string }): LegacyEmail {
  const business = name(p.business);
  return { subject: `${business} passed on a partner link`, text: [
    `${business} (${name(p.domain)}) declined the proposed link on ${p.page}.`,
    'Proposed sentence:', p.sentence, `Their note:\n${p.note}`,
    'You can review your other proposals in Radar → Backlinks.', footer(p.appUrl),
  ].join('\n\n') };
}

export function backlinkRemovalEmail(p: { appUrl: string; business: string; domain: string; page: string; target: string; anchor: string }): LegacyEmail {
  const business = name(p.business);
  return { subject: `Link removal request from ${business}`, text: [
    `${business} (${name(p.domain)}) has asked for this link to be removed from your site.`,
    `Page: ${p.page}\nDestination: ${p.target}\nAnchor: ${p.anchor}`,
    'Please remove it within 7 days. Radar will re-check the page and update the link status in Backlinks.', footer(p.appUrl),
  ].join('\n\n') };
}

export function backlinkLostEmail(p: { appUrl: string; page: string; displayPage: string; target: string; anchor: string; rel: string; reason: 'missing' | 'rel' }): LegacyEmail {
  const detail = p.reason === 'rel' ? `The link is present, but it no longer has rel="${p.rel === 'nofollow' ? 'nofollow' : 'sponsored'}". Network links require that attribute.` : 'Radar couldn’t find the link on the page during its latest check.';
  return { subject: p.reason === 'rel' ? `Partner link attribute changed on ${name(p.displayPage)}` : `Partner link not found on ${name(p.displayPage)}`, text: [
    detail, `Page: ${p.page}\nDestination: ${p.target}\nAnchor: ${p.anchor}`,
    'If the change was intentional, you can leave it as it is. Otherwise, restore the link and its required attribute, then use Re-check in Backlinks to check it again.', footer(p.appUrl),
  ].join('\n\n') };
}

export interface AutopilotEmailItem { title: string; reason: string; href: string; text?: string; sourceUrl?: string }
/** Action details come from the saved Autopilot handoff, never an invented completion claim. */
export function autopilotHandoffEmail(p: { appUrl: string; businessName: string; items: AutopilotEmailItem[]; manageUrl: string }): LegacyEmail {
  const business = name(p.businessName), count = p.items.length;
  const source = (value?: string) => { try { const u = new URL(value || ''); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
  return { subject: `Radar Autopilot: ${count} ${count === 1 ? 'action needs' : 'actions need'} you · ${business}`, text: [
    `Autopilot needs your help with ${count === 1 ? 'this action' : `these ${count} actions`} for ${business}:`,
    ...p.items.map((item, index) => [
      `${index + 1}. ${item.title}`, item.reason,
      ...(source(item.sourceUrl) ? [`Open conversation: ${source(item.sourceUrl)}`] : []),
      `Review in Radar: ${item.href}`,
      ...(item.text ? [`Prepared draft:\n${item.text}`] : []),
    ].join('\n\n')),
    `Manage Autopilot: ${p.manageUrl}`,
    'You’re receiving this because Autopilot is on for this business. You can turn it off in Autopilot settings.',
    footer(p.appUrl),
  ].join('\n\n') };
}
