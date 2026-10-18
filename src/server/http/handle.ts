import { NextResponse } from 'next/server';
import { RadarError } from '../errors';

export function json(data: any, status = 200) { return NextResponse.json(data, { status }); }
/** Wrap a route handler: RadarError → its user copy + status; anything else → generic 500 (logged). */
export function handle<A extends any[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try { return await fn(...a); }
    catch (e: any) {
      if (e instanceof RadarError) return json({ ok: false, error: e.userMessage, code: e.code }, e.status);
      if (e?.name === 'ZodError') return json({ ok: false, error: 'Some fields aren’t valid.', code: 'invalid', issues: e.issues }, 400);
      console.error('[api]', e);
      return json({ ok: false, error: 'Radar couldn’t finish this. Try again.', code: 'server' }, 500);
    }
  };
}
