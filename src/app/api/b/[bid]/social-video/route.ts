import { z } from 'zod';
import { gateBusiness, requireActor, requireRole } from '@/server/access';
import { handle, json } from '@/server/http/handle';
import { RadarError } from '@/server/errors';
import { socialOn } from '@/server/flags';
import { COPY } from '@/lib/socialPublish';
import { attachVideo, videoForm, VIDEO_PLATFORMS } from '@/server/services/social/publish/video';

export const runtime = 'nodejs';
export const POST = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const actor = await requireActor();
  await requireRole(bid, actor.id, 'Editor');
  const biz = await gateBusiness(actor, bid);
  if (!(await socialOn(biz))) throw new RadarError(COPY.notEnabled, 404, 'not_enabled');
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw new RadarError('Upload the video from Radar.', 403, 'forbidden');
  const form = await videoForm(req);
  const input = z.object({ packId: z.string().min(1).max(64), platform: z.enum(VIDEO_PLATFORMS) }).parse({ packId: form.get('packId'), platform: form.get('platform') });
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new RadarError('Choose a video to upload.', 400, 'invalid_video');
  const video = await attachVideo(biz, input.packId, input.platform, Buffer.from(await file.arrayBuffer()));
  return json({ ok: true, video });
});
