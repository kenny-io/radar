import { readLocal } from '@/server/services/storage';
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const f = await readLocal(key.join('/'));
  if (!f) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(f.body), { headers: { 'content-type': f.type, 'cache-control': 'public, max-age=31536000, immutable' } });
}
