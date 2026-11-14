// The crop sizes each corpus file is asked for, shared by the old-behaviour runner and the probes so they compare like
// with like. IMG_SIZES in src/lib/constants.ts: hero, linkedin, facebook, quora 1200×628; x 1200×675; reddit 1200×900.
// Article body images and Daily Brief visuals are 1200×675.
export const REAL = [[1200, 628], [1200, 675], [1200, 900]];
/** Shapes no caller asks for today, to show the crop itself is the same code: tall, tiny, larger than the source, one pixel. */
export const ODD = [[400, 900], [628, 1200], [1, 1], [37, 1200], [3000, 2000], [1200, 1]];
export function cropsFor(f) {
  if (f.group === 'good') return /canvas-(1536x1024|1024x1536|1024x1024|301x199|3x2|1x1|4000x250|250x4000)\.|transparent|orientation-(1|6|8)|png16-|palette-1536|progressive|lossless-1536/.test(f.name) ? [...REAL, ...ODD] : REAL;
  if (f.group === 'unusual') return REAL;
  return [[1200, 628]];
}
