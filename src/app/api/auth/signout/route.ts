import { destroySession } from '@/server/auth/session';
import { handle, json } from '@/server/http/handle';
export const POST = handle(async () => { await destroySession(); return json({ ok: true }); });
