// GET ?url=<stored url> → the bytes of an image Radar stored for this business, same-origin. Downloads read through here:
// the bucket's public URLs show in <img> but the page can't fetch them (no CORS headers).
import { gateBusiness, requireActor, requireRole } from '@/server/access';
import { handle } from '@/server/http/handle';
import { notFound } from '@/server/errors';
import { readStored } from '@/server/services/storage';

export const GET = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const a = await requireActor();
  await requireRole(bid, a.id, 'Viewer');
  await gateBusiness(a, bid);
  const f = await readStored(bid, new URL(req.url).searchParams.get('url') || '');
  if (!f) throw notFound('That file');
  return new Response(new Uint8Array(f.body), { headers: { 'content-type': f.type, 'content-disposition': 'attachment', 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600' } });
});
