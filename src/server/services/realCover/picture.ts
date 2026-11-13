// What a fetched picture must be before it becomes a cover, and how it is drawn at 1200×628.
// The decoder cannot be trusted with a file from someone else's server (see ../untrustedImage.ts, which this shares
// with logo detection): the type, the pixel size and completeness are read from the bytes first, and the decode and
// the draw run in a short-lived child process. A crash there is one refused picture.
import { IMAGE_MAX_PIXELS, IMAGE_MAX_SIDE, ImageRefused, decodeInChild, overPixelLimits, probeImage } from '../untrustedImage';
import { SitePictureError, type OwnResponse, type SitePictureCode } from './fetch';

export { probeImage, type Probe } from '../untrustedImage';
export const PICTURE_MAX_PIXELS = IMAGE_MAX_PIXELS, PICTURE_MAX_SIDE = IMAGE_MAX_SIDE, PICTURE_MIN_W = 600, PICTURE_MIN_H = 314;
export const COVER_W = 1200, COVER_H = 628, CROP_KEEPS_AT_LEAST = 0.6;
/** A decoded picture is blank when, drawn `sample` pixels on its longer side (never enlarged), nothing in it is
 *  visible (alpha under `alpha` everywhere), or everything visible is one colour (no channel varies by `flat` or
 *  more). The sample is large enough that a thin or small object on a plain background is seen. */
export const BLANK = { sample: 512, alpha: 16, flat: 8 };
/** How long one decode and draw may take before its process is stopped. */
export const DECODE_TIMEOUT_MS = 20_000;

const HEADER_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp']);
/** The response header's type, lower-cased, with parameters removed. */
export const headerType = (type: string) => String(type || '').split(';')[0].trim().toLowerCase();

export interface Cover { png: Buffer; w: number; h: number; fit: 'crop' | 'backdrop' }

// What the child process does with the decoded image (the process itself is ../untrustedImage.ts). It answers with a
// JSON head and, on success, the PNG.
// The size is read from the decoded image: the decoder applies EXIF rotation, so a camera file stored on its side is
// judged and drawn upright.
// A blank result is refused, as 'blank_picture': a file whose picture data is damaged can decode, without an error,
// to nothing at all (fully transparent) or to one flat colour. The decoded picture is looked at on a smaller
// transparent canvas first.
// Transparent areas alone are fine (a product cut-out). A file damaged part of the way through, which decodes to a
// picture that is partly blank, is not detected.
// The draw rule: white first (a transparent source must not leave transparent or black areas), then a centre crop
// when the crop keeps most of the picture; otherwise the whole picture on a blurred, darkened copy of itself. The
// blurred copy is drawn larger than the canvas: at exactly the canvas size the blur reads past the picture's edge and
// leaves a pale band along two sides.
const DRAW = `
    const w = img.width, h = img.height;
    if (!(w >= o.minW && h >= o.minH)) return reply({ code: 'too_small' });
    const shrink = Math.min(1, o.sample / Math.max(w, h)); const sw = Math.max(1, Math.round(w * shrink)), sh = Math.max(1, Math.round(h * shrink));
    const small = createCanvas(sw, sh); const look = small.getContext('2d');
    look.drawImage(img, 0, 0, sw, sh);
    const px = look.getImageData(0, 0, sw, sh).data; const lo = [255, 255, 255], hi = [0, 0, 0]; let visible = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < o.alpha) continue;
      visible++;
      for (let c = 0; c < 3; c++) { if (px[i + c] < lo[c]) lo[c] = px[i + c]; if (px[i + c] > hi[c]) hi[c] = px[i + c]; }
    }
    if (!visible || Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) < o.flat) return reply({ code: 'blank_picture' });
    const canvas = createCanvas(o.W, o.H); const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, o.W, o.H);
    const rs = w / h, rt = o.W / o.H;
    const fit = Math.min(rs, rt) / Math.max(rs, rt) >= o.keeps ? 'crop' : 'backdrop';
    const centred = scale => ctx.drawImage(img, (o.W - w * scale) / 2, (o.H - h * scale) / 2, w * scale, h * scale);
    const cover = Math.max(o.W / w, o.H / h);
    if (fit === 'crop') centred(cover);
    else {
      ctx.filter = 'blur(28px)'; centred(cover * 1.3); ctx.filter = 'none';
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, o.W, o.H);
      centred(Math.min(o.W / w, o.H / h, 1));
    }
    reply({ w, h, fit }, canvas.toBuffer('image/png'));
`;
const DRAW_OPTIONS = { W: COVER_W, H: COVER_H, minW: PICTURE_MIN_W, minH: PICTURE_MIN_H, keeps: CROP_KEEPS_AT_LEAST, ...BLANK };
const MAX_OUTPUT = 32 * 1024 * 1024;

/** Decode and draw in the child process. Any way the picture can make the child fail (it crashed, it took too long, its
 *  answer makes no sense) is 'not_a_picture'. A child that cannot be started, or cannot load the canvas library, is
 *  not the picture's fault: that stays a plain Error, so it is reported as a fault and never remembered as "no picture". */
async function decodeAndDraw(body: Buffer): Promise<Cover> {
  const refused = (code: SitePictureCode = 'not_a_picture') => new SitePictureError(code);
  const { head, data: png } = await decodeInChild(body, DRAW, DRAW_OPTIONS, { timeoutMs: DECODE_TIMEOUT_MS, maxOutput: MAX_OUTPUT })
    .catch(error => { throw error instanceof ImageRefused ? refused() : error; });
  if (head.code === 'too_small' || head.code === 'blank_picture') throw refused(head.code);
  const made = probeImage(png);
  if (head.code || !made || made.type !== 'image/png' || !made.complete || made.width !== COVER_W || made.height !== COVER_H || !(head.w > 0 && head.h > 0) || (head.fit !== 'crop' && head.fit !== 'backdrop')) throw refused();
  return { png, w: head.w, h: head.h, fit: head.fit };
}

/** The 1200×628 PNG for a fetched picture. Throws SitePictureError('not_a_picture' | 'too_large' | 'too_small' | 'blank_picture'); a
 *  plain Error only when the decoder itself could not run. */
export async function readPicture(res: OwnResponse): Promise<Cover> {
  // The header and the bytes need not name the same one of the three (servers mislabel); the bytes decide.
  if (!HEADER_TYPES.has(headerType(res.type))) throw new SitePictureError('not_a_picture');
  const probe = probeImage(res.body);
  if (!probe || !probe.complete || probe.animated || !(probe.width > 0 && probe.height > 0)) throw new SitePictureError('not_a_picture');
  // Before any decode: the decoder allocates the whole bitmap on load, so a small file declaring a huge size is stopped here.
  if (overPixelLimits(probe)) throw new SitePictureError('too_large');
  return decodeAndDraw(res.body);
}
