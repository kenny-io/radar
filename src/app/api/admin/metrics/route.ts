// Impact metrics for reporting (internal). GET /api/admin/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&by=week|month&format=json|csv
// Signed-in users whose email is in ADMIN_EMAILS only; everyone else gets 404.
import { requireUser } from '@/server/access';
import { env } from '@/server/env';
import { IMPACT } from '@/server/events';
import { impactMetrics } from '@/server/metrics';
import { handle, json } from '@/server/http/handle';
import { notFound } from '@/server/errors';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const GET = handle(async (req: Request) => {
  const u = await requireUser();
  if (!env.adminEmails.includes(String(u.email).toLowerCase())) throw notFound('Page');
  const q = new URL(req.url).searchParams;
  const from = DAY.test(q.get('from') || '') ? q.get('from')! : '2000-01-01';
  const to = DAY.test(q.get('to') || '') ? q.get('to')! : new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const by = q.get('by') === 'month' ? 'month' : 'week';
  const { metrics, derived, series } = await impactMetrics(from, to, by);
  if (q.get('format') === 'csv') {
    const rows = [['period', 'metric', 'label', 'count'], ...series.map(s => [s.period, s.kind, IMPACT[s.kind as keyof typeof IMPACT] || s.kind, String(s.n)])];
    const csv = rows.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="radar-impact-${from}-to-${to}.csv"` } });
  }
  return json({ ok: true, from, to, by, metrics, derived, series });
});
