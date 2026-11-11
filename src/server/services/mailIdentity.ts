export interface MailSenderMeta { from: string; replyTo?: string }

export const FOUNDER_REPLY_TO = 'team@thally.io';
/** Change the display name only; the deployment's verified sending mailbox remains authoritative. */
export function founderFrom(configuredFrom: string): string {
  if (/[\u0000-\u001f\u007f]/.test(configuredFrom)) throw new Error('Invalid configured mail sender');
  const configured = configuredFrom.trim();
  const address = configured.match(/^[^<>]*<([^<>]+)>$/)?.[1] || configured;
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(address) || (configured.includes('<') && /[^\s<>,;]+@[^\s<>,;]+/.test(configured.slice(0, configured.indexOf('<'))))) throw new Error('Invalid configured mail sender');
  return `Ekene from Radar <${address}>`;
}
