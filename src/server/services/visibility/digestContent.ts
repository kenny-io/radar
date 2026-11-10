import type { VisibilitySummary } from './history';
import { FOUNDER_REPLY_TO } from '../mailIdentity';

type DigestSummary = Pick<VisibilitySummary, 'weekly' | 'weeklyBiggestMiss'>;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const preheader = 'This week’s collected answers, with the previous period alongside.';

function paragraphs(summary: DigestSummary): string[] {
  const { weekly: w, weeklyBiggestMiss: miss } = summary;
  const lastDay = new Date(new Date(w.end + 'T00:00:00Z').getTime() - 86400e3).toISOString().slice(0, 10);
  const share = (period: typeof w.current) => period.share === null ? 'No answers were collected.' : `Your business was mentioned in ${period.mentioned} of ${period.collected} collected answers (${Math.round(period.share * 100)}%).`;
  // Collection is weekly, and an off-cycle run can make the data older than the report: always say when it was collected.
  const on = (w.days || []).filter(d => d.collected > 0).map(d => d.day).sort();
  const collectedOn = !on.length ? [] : [`Radar checks your tracked questions once a week. These answers were collected ${on.length === 1 ? `on ${on[0]}` : `between ${on[0]} and ${on[on.length - 1]}`}.`];
  return [
    `This week covers ${w.start} through ${lastDay}, using completed UTC days.`,
    ...collectedOn,
    `This week: ${share(w.current)}`,
    `Previous week, using the same tracked questions: ${share(w.previous)}`,
    w.delta === null ? 'There isn’t enough comparable data to show a change yet. Adding or changing tracked questions starts a new comparison.' : `That’s a change of ${w.delta >= 0 ? '+' : ''}${(w.delta * 100).toFixed(1)} percentage points.`,
    miss ? `Most missed question: “${miss.prompt}”` : 'This report has no missed question to highlight.',
    miss?.entryId ? 'A topic based on this question is saved in your Content Calendar for review. Review the answers before deciding what to publish.' : miss ? 'I’d read the answers to this question before choosing what to write or update.' : 'I’d read the answers to see how the assistants described your business.',
    'Missing or failed collections are excluded from these figures. AI answers can change between checks.',
  ];
}

export function recommendationDigestText(summary: DigestSummary, appUrl: string, preferencesUrl?: string, reviewUrl = `${appUrl}/performance?tab=ai`): string {
  const sections = paragraphs(summary);
  return [...sections, `Review all answers: ${reviewUrl}`, `Ekene\nFounder, Radar\n${FOUNDER_REPLY_TO}`, `Email preferences: ${preferencesUrl || `${appUrl}/performance`}`].join('\n\n');
}

/** Pure formatter shared by the actual queue and local previews. URLs are supplied, never generated here. */
export function recommendationDigestContent(summary: DigestSummary, appUrl: string, preferencesUrl: string, reviewUrl = `${appUrl}/performance?tab=ai`): { text: string; html: string; preheader: string } {
  const sections = paragraphs(summary);
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your weekly AI recommendation report</title></head><body style="margin:0;padding:0;overflow-wrap:anywhere;word-break:break-word"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all" aria-hidden="true">${escapeHtml(preheader)}</div><main style="font-family:Arial,sans-serif;line-height:1.6;width:100%;max-width:560px;box-sizing:border-box;margin:0 auto;padding:24px;color:#222">${sections.map(p => `<p>${escapeHtml(p)}</p>`).join('')}<p><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;padding:12px 18px;background:#222;color:#fff;border-radius:6px;text-decoration:none">Review all answers</a></p><p>Ekene<br><span style="font-size:14px;color:#555">Founder, Radar</span><br><a href="mailto:${escapeHtml(FOUNDER_REPLY_TO)}">${escapeHtml(FOUNDER_REPLY_TO)}</a></p><p><a href="${escapeHtml(preferencesUrl)}" style="color:#333;font-size:14px;text-decoration:underline">Email preferences</a></p></main></body></html>`;
  return { text: recommendationDigestText(summary, appUrl, preferencesUrl, reviewUrl), html, preheader };
}
