import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { reportFailure, shouldReportFailure, withFailureContext } from '../observability/failures';
import { RadarError } from '../errors';

export function json(data: any, status = 200) { return NextResponse.json(data, { status }); }
// Invalid/aborted client JSON is a bad request, while internal/provider JSON failures remain incidents.
export async function requestJson(req: Request): Promise<any> {
  try { return await req.json(); }
  catch (error) {
    if ((error as any)?.name === 'SyntaxError' || (error as any)?.name === 'AbortError') throw new RadarError('Some fields aren’t valid.', 400, 'invalid');
    throw error;
  }
}

/** Wrap a route handler: RadarError → its user copy + status; anything else → generic 500 (logged). */
export function handle<A extends any[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    const request = a[0] as Request | undefined;
    let operation = 'http.request';
    try { if (request?.url) operation = `${request.method || 'GET'} ${new URL(request.url).pathname.replace(/(\/api\/invites\/)[^/]+/i, '$1[token]').replace(/(\/api\/files\/).*/i, '$1[key]')}`; } catch { /* No untrusted URL details. */ }
    return withFailureContext({ source: 'http', operation, requestId: randomUUID() }, async () => {
      try { return await fn(...a); }
      catch (e: any) {
        if (shouldReportFailure(e)) await reportFailure(e, { source: 'http', operation });
        if (e instanceof RadarError) return json({ ok: false, error: e.userMessage, code: e.code }, e.status);
        if (e?.name === 'ZodError') return json({ ok: false, error: 'Some fields aren’t valid.', code: 'invalid', issues: e.issues }, 400);
        return json({ ok: false, error: 'Radar couldn’t finish this. Try again.', code: 'server' }, 500);
      }
    });
  };
}
