import type { VisibilitySummary } from './history';

type DigestSummary = Pick<VisibilitySummary, 'weekly' | 'weeklyBiggestMiss'>;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const preheader = 'Your collected answers, the previous-week comparison and what to review next.';

function paragraphs(summary: DigestSummary): string[] {
  const { weekly: w, weeklyBiggestMiss: miss } = summary;
  const lastDay = new Date(new Date(w.end + 'T00:00:00Z').getTime() - 86400e3).toISOString().slice(0, 10);
  const share = (period: typeof w.current) => period.share === null ? 'No answers were collected.' : `Your business was mentioned in ${period.mentioned} of ${period.collected} collected answers (${Math.round(period.share * 100)}%).`;
  return [
    'Your weekly AI recommendation report',
    `This week covers ${w.start} through ${lastDay}, using completed UTC days.`,
    `This week: ${share(w.current)}`,
    `Previous week, using the same tracked questions: ${share(w.previous)}`,
    w.delta === null ? 'There isn’t enough comparable data to show a change yet. Adding or changing tracked questions starts a new comparison.' : `That’s a change of ${w.delta >= 0 ? '+' : ''}${(w.delta * 100).toFixed(1)} percentage points.`,
    miss ? `Most missed question: “${miss.prompt}”` : 'This report has no missed question to highlight.',
    miss?.entryId ? 'A topic based on this question is saved in your Content Calendar for review. Review the answers before deciding what to publish.' : miss ? 'Review the answers to this question before choosing what to write or update.' : 'Review the answers to see how the assistants described your business.',
    'Missing or failed collections are excluded from these figures. AI answers can change between checks.',
  ];
}

export function recommendationDigestText(summary: DigestSummary, appUrl: string, preferencesUrl?: string): string {
  const sections = paragraphs(summary);
  return [...sections, `Review all answers: ${appUrl}/performance`, 'Radar by Thally', `Email preferences: ${preferencesUrl || `${appUrl}/performance`}`].join('\n\n');
}

/** Pure formatter shared by the actual queue and local previews. URLs are supplied, never generated here. */
export function recommendationDigestContent(summary: DigestSummary, appUrl: string, preferencesUrl: string): { text: string; html: string; preheader: string } {
  const sections = paragraphs(summary);
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your weekly AI recommendation report</title></head><body style="margin:0;padding:0;overflow-wrap:anywhere;word-break:break-word"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all" aria-hidden="true">${escapeHtml(preheader)}</div><main style="font-family:Arial,sans-serif;line-height:1.6;width:100%;max-width:560px;box-sizing:border-box;margin:0 auto;padding:24px;color:#222"><h1 style="font-size:24px;line-height:1.3">${escapeHtml(sections[0])}</h1>${sections.slice(1).map(p => `<p>${escapeHtml(p)}</p>`).join('')}<p><a href="${escapeHtml(appUrl + '/performance')}" style="display:inline-block;padding:12px 18px;background:#222;color:#fff;border-radius:6px;text-decoration:none">Review all answers</a></p><p style="font-size:14px;color:#555">Radar by Thally</p><p><a href="${escapeHtml(preferencesUrl)}" style="display:inline-block;padding:10px 14px;border:1px solid #777;border-radius:6px;color:#333;font-size:14px">Email preferences</a></p></main></body></html>`;
  return { text: recommendationDigestText(summary, appUrl, preferencesUrl), html, preheader };
}
