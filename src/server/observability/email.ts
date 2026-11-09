import type { FailureEvent } from './failures';

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const plain = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const providerName = (provider?: string) => ({ openrouter: 'OpenRouter', openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI', spacex: 'xAI' }[provider?.toLowerCase() || ''] || provider || '');
const operations: Record<string, string> = {
  'article.draft': 'Article draft', 'article.outline': 'Article outline', 'article.research': 'Article research', 'article.bodyImages': 'Article images',
  'image.generate': 'Image generation', 'image.render': 'Image rendering', 'image.store': 'Image storage',
  'social.generate': 'Social post generation', 'social.publish': 'Social post publishing', 'social.send': 'Social post publishing',
  'social.autoRun': 'Daily social drafts', 'social.autoSchedule': 'Social post scheduling', 'publishing.entry': 'Article publishing',
  'brief.scan': 'Daily Brief scan', 'brief.source': 'Daily Brief scan', 'brief.draftReply': 'Daily Brief reply', 'brief.draftPosts': 'Daily Brief posts',
  'visibility.collect': 'AI visibility check', 'visibility.run': 'AI visibility check', 'mail.send': 'Email delivery', 'mail.auth': 'Confirmation email',
};
function operationName(event: FailureEvent): string {
  return operations[event.context.operation] || operations[event.rootOperation] || (event.context.source === 'image' ? 'Image generation' : event.context.source === 'ai' ? 'AI generation' : 'Radar action');
}
function utcTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? plain(timestamp) : `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC', hourCycle: 'h23' }).format(date)} UTC`;
}
type Detail = [label: string, value: string];
const diagnosticStyle = 'font-size:13px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;';

/** Render once when creating an envelope. Retries must use the stored text and HTML without re-rendering. */
export function renderFailureEmail(event: FailureEvent): { subject: string; text: string; html: string } {
  const test = event.error.name === 'SyntheticTest';
  const degraded = !test && !!event.context.degraded;
  const fallback = degraded && !!event.context.provider && event.context.retrying === true && ['ai', 'image', 'visibility'].includes(event.context.source);
  const provider = providerName(event.context.provider);
  const operation = operationName(event);
  const status = test ? 'Test alert' : fallback ? 'Provider fallback' : degraded ? 'Needs attention' : 'Action failed';
  const title = test ? 'Your test alert has arrived' : fallback ? `${operation} needs a fallback` : degraded ? `${operation} needs attention` : `${operation} failed`;
  const subject = test ? '[Radar] Test alert' : plain(`[Radar] ${operation} ${fallback ? 'needs a fallback' : degraded ? 'needs attention' : 'failed'}${provider ? ` (${provider})` : ''}`).slice(0, 220);
  const summary = test ? 'This is a test of Radar’s operational alerts. No customer action or AI provider failed.' : fallback ? 'A provider attempt failed. Radar is trying an alternative; this does not confirm that the overall action failed.' : degraded ? 'Part of this action needs attention. Some work may already be saved or completed; the issue below needs investigation.' : 'Radar could not complete this action. The issue is recorded below so you can investigate.';
  const nextStep = test ? `No action needed. This confirms Radar can send alerts from ${plain(event.service)} in ${plain(event.environment)}.` : event.hint;
  const time = utcTime(event.timestamp);
  const facts: Detail[] = [['Environment', event.environment], ['Service', event.service], ['Time', time]];
  const details: Detail[] = [['Operation', event.context.operation]];
  if (event.rootOperation !== event.context.operation) details.push(['Root operation', event.rootOperation]);
  for (const [key, label] of [['businessId', 'Business ID'], ['userId', 'User ID'], ['ref', 'Resource ID'], ['jobId', 'Job ID'], ['requestId', 'Request ID'], ['model', 'Model']] as const) {
    const value = event.context[key]; if (value != null && value !== '' && !(key === 'ref' && value === event.id)) details.push([label, value]);
  }
  if (event.context.attempt != null) details.push(['Attempt', `${event.context.attempt}${event.context.maxAttempts != null ? ` of ${event.context.maxAttempts}` : ''}`]);
  if (event.context.retrying != null && !test) details.push(['Retry planned', event.context.retrying ? 'Yes' : 'No']);
  details.push(['Alert ID', event.id]);
  const diagnostics: Detail[] = [];
  if (!test) {
    if (provider) diagnostics.push(['Provider', provider]);
    if (event.error.status != null || event.context.status != null) diagnostics.push(['HTTP status', String(event.error.status ?? event.context.status)]);
    if (event.error.code || event.context.code) diagnostics.push(['Code', event.error.code || event.context.code!]);
    diagnostics.push(['Issue', event.error.message]);
    if (event.error.cause) diagnostics.push(['Cause', event.error.cause]);
  }
  const text = [
    `RADAR · ${status.toUpperCase()}`, '', title, '', summary,
    ...(diagnostics.length ? ['', 'WHAT HAPPENED', ...diagnostics.map(([label, value]) => `${label}: ${value}`)] : []),
    '', test ? 'NO ACTION NEEDED' : 'NEXT STEP', nextStep,
    '', 'AT A GLANCE', ...facts.map(([label, value]) => `${label}: ${value}`),
    '', 'DETAILS', ...details.map(([label, value]) => `${label}: ${value}`),
  ].join('\n');
  const rows = (items: Detail[], diagnostic = false) => items.map(([label, value]) => `<tr><td class="muted" style="width:100px;padding:7px 12px 7px 0;vertical-align:top;color:#65645d;font-size:13px;line-height:20px;">${escapeHtml(label)}</td><td class="${diagnostic ? 'diagnostic' : 'copy'}" style="padding:7px 0;vertical-align:top;color:${diagnostic ? '#5e5d57' : '#363630'};${diagnosticStyle}">${escapeHtml(value)}</td></tr>`).join('');
  const diagnosticFacts = diagnostics.filter(([label]) => label !== 'Issue' && label !== 'Cause');
  const issueBlocks = diagnostics.filter(([label]) => label === 'Issue' || label === 'Cause').map(([label, value]) => `<h2 class="muted" style="margin:20px 0 6px;color:#65645d;font-size:13px;line-height:20px;font-weight:700;">${escapeHtml(label)}</h2><p class="copy" style="margin:0;color:#45443f;font-size:15px;line-height:24px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(value)}</p>`).join('');
  const badgeColor = test ? '#24583a' : degraded ? '#755016' : '#9b352a';
  const badgeBackground = test ? '#eaf4ec' : degraded ? '#fff3d9' : '#fceceb';
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(subject)}</title>
<style>@media (max-width:480px){.content{padding:24px!important}.outer{padding:24px 12px!important}}@media (prefers-color-scheme:dark){body,.canvas{background-color:#171715!important}.card{background-color:#242421!important;border-color:#44433d!important}.primary{color:#f4f3ed!important}.copy{color:#deddd5!important}.muted,.diagnostic{color:#b9b8af!important}.rule{border-color:#44433d!important}.next{background-color:#353029!important;border-color:#66503d!important}.next-title{color:#ffb58d!important}}</style></head>
<body style="margin:0;padding:0;background-color:#faf9f6;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;"><table lang="en" dir="ltr" role="presentation" class="canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#faf9f6;font-family:Arial,Helvetica,sans-serif;"><tr><td class="outer" align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;table-layout:fixed;"><tr><td style="padding:0 0 24px;"><span class="primary" style="color:#1b1b18;font-size:26px;line-height:32px;font-weight:700;letter-spacing:-1px;">Radar<span aria-hidden="true" style="color:#ed6018;">.</span></span></td></tr>
<tr><td class="card" style="background-color:#ffffff;border:1px solid #e7e4dc;border-top:3px solid #ed6018;border-radius:12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;"><tr><td class="content" style="padding:32px;">
<span style="display:inline-block;padding:5px 10px;border-radius:20px;background-color:${badgeBackground};color:${badgeColor};font-size:12px;line-height:18px;font-weight:700;">${escapeHtml(status)}</span>
<h1 class="primary" style="margin:20px 0 12px;color:#1b1b18;font-size:28px;line-height:35px;font-weight:700;letter-spacing:-0.6px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(title)}</h1>
<p class="copy" style="margin:0;color:#45443f;font-size:16px;line-height:25px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(summary)}</p>
${diagnosticFacts.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;margin-top:20px;">${rows(diagnosticFacts)}</table>` : ''}${issueBlocks}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;margin-top:28px;"><tr><td class="next" style="padding:20px;background-color:#fff5ed;border:1px solid #f1d4c0;border-radius:8px;"><h2 class="next-title" style="margin:0 0 8px;color:#933b12;font-size:15px;line-height:22px;font-weight:700;">${test ? 'No action needed' : 'Next step'}</h2><p class="copy" style="margin:0;color:#45443f;font-size:15px;line-height:24px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(nextStep)}</p></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="rule" style="width:100%;table-layout:fixed;margin-top:28px;padding-top:16px;border-top:1px solid #e7e4dc;">${rows(facts)}</table>
</td></tr></table></td></tr>
<tr><td style="padding:24px 8px 0;"><h2 class="muted" style="margin:0 0 8px;color:#65645d;font-size:13px;line-height:20px;font-weight:700;">Diagnostic details</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;">${rows(details, true)}</table></td></tr></table>
</td></tr></table></body></html>`;
  return { subject, text, html };
}
