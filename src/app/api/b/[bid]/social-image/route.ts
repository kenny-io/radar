// Custom posts: upload the user's own image for one platform of a custom pack (.factory/custom-post-scheduling/architecture.md §5.2).
// Not behind the publishing flag: images are for copy and download too (decision D2). Video stays on /social-video.
import { z } from 'zod';
import { gateBusiness, requireActor, requireRole } from '@/server/access';
import { handle, json } from '@/server/http/handle';
import { RadarError } from '@/server/errors';
import { assertAuthOrigin } from '@/server/auth/requests';
import { MAX_IMAGE_BYTES } from '@/lib/socialPublish';
import { UPLOAD_COPY, attachImage, imageForm } from '@/server/services/social/publish/upload';

const PlatformZ = z.enum(['linkedin', 'x', 'facebook', 'reddit', 'quora', 'instagram', 'tiktok', 'youtube']);

export const runtime = 'nodejs';
export const POST = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  assertAuthOrigin(req);
  const { bid } = await params;
  const actor = await requireActor();
  await requireRole(bid, actor.id, 'Editor');
  const biz = await gateBusiness(actor, bid);
  const form = await imageForm(req);
  const input = z.object({ packId: z.string().min(1).max(64), platform: PlatformZ }).parse({ packId: form.get('packId'), platform: form.get('platform') });
  if (input.platform === 'youtube') throw new RadarError(UPLOAD_COPY.youtube, 400, 'invalid_image');
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size) throw new RadarError(UPLOAD_COPY.choose, 400, 'invalid_image');
  if (file.size > MAX_IMAGE_BYTES) throw new RadarError(UPLOAD_COPY.tooLarge, 413, 'too_large');
  const image = await attachImage(biz, input.packId, input.platform, Buffer.from(await file.arrayBuffer()), actor.id);
  return json({ ok: true, image });
});
