// Brand visual templates — port of drawVisual (prototype/radar-article.jsx).
// Works on any CanvasRenderingContext2D-compatible context: the browser (previews) and @napi-rs/canvas (server PNGs).
// "PHOTO PLACEHOLDER" label removed (README §2.4). Photography / Illustration use an image model when configured;
// these templates are the brand-rendered fallback and the instant preview.
export interface VisualOpts { w: number; h: number; style: string; brand: { primary: string; secondary: string }; headline: string; seed?: number; name?: string; fontFamily?: string }

export function lum(hex: string) { const n = parseInt((hex || '#000').slice(1), 16); const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
export const onColor = (hex: string) => (lum(hex) > .4 ? '#17181C' : '#FFFFFF');
function wrapText(ctx: any, text: string, maxW: number) { const words = String(text).split(' '); const lines: string[] = []; let l = ''; words.forEach(w => { const t = l ? l + ' ' + w : w; if (ctx.measureText(t).width > maxW && l) { lines.push(l); l = w; } else l = t; }); if (l) lines.push(l); return lines; }
export function mulberry(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function drawVisual(ctx: any, { w, h, style, brand, headline, seed = 1, name, fontFamily }: VisualOpts) {
  const R = mulberry(seed * 9973); const P = brand.primary, S = brand.secondary; const F = fontFamily || '"Geist", system-ui, sans-serif';
  ctx.clearRect(0, 0, w, h); const u = Math.min(w, h) / 100;
  const text = (t: string, x: number, y: number, size: number, color: string, maxW: number, weight = 600, lh = 1.08) => { ctx.font = `${weight} ${size}px ${F}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; const ls = wrapText(ctx, t, maxW).slice(0, 4); ls.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh)); return ls.length * size * lh; };
  if (style === 'branded') {
    ctx.fillStyle = P; ctx.fillRect(0, 0, w, h); const oc = onColor(P);
    ctx.fillStyle = S; ctx.beginPath(); ctx.arc(w * (.78 + R() * .1), h * (.2 + R() * .1), u * (16 + R() * 10), 0, 7); ctx.fill();
    ctx.fillStyle = S; ctx.fillRect(u * 7, u * 8, u * 10, u * 1.4);
    ctx.font = `500 ${u * 3.6}px ${F}`; ctx.fillStyle = oc; ctx.globalAlpha = .8; ctx.fillText(name || '', u * 7, h - u * 7); ctx.globalAlpha = 1;
    ctx.font = `600 ${u * 8}px ${F}`; const ls = wrapText(ctx, headline, w - u * 16).slice(0, 4); const top = h - u * 14 - ls.length * u * 8.6; text(headline, u * 7, top + u * 8, u * 8, oc, w - u * 16);
  } else if (style === 'infographic') {
    ctx.fillStyle = '#FAF8F3'; ctx.fillRect(0, 0, w, h); const m = (headline.match(/\d+[%x]?/) || ['3x'])[0];
    ctx.font = `600 ${u * 26}px ${F}`; ctx.fillStyle = P; ctx.fillText(m, u * 7, u * 32);
    text(headline, u * 7, u * 44, u * 5.2, '#17181C', w * .55, 500, 1.2);
    const bars = 5; for (let i = 0; i < bars; i++) { const bh = (.25 + R() * .6) * h * .45; const bw = (w * .34) / bars; ctx.fillStyle = i === bars - 1 ? P : S; ctx.globalAlpha = i === bars - 1 ? 1 : .55; ctx.fillRect(w * .6 + i * bw * 1.1, h - u * 10 - bh, bw * .8, bh); } ctx.globalAlpha = 1;
    ctx.fillStyle = '#17181C'; ctx.fillRect(w * .58, h - u * 10, w * .38, 1.5); ctx.font = `500 ${u * 3.2}px ${F}`; ctx.fillStyle = '#6B6E78'; ctx.fillText(name || '', u * 7, h - u * 7);
  } else if (style === 'photography') {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#D9CBB8'); g.addColorStop(.55, '#A89582'); g.addColorStop(1, '#5E5248'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) { const rg = ctx.createRadialGradient(R() * w, R() * h, 0, R() * w, R() * h, u * (20 + R() * 40)); rg.addColorStop(0, `rgba(255,240,220,${.25 + R() * .3})`); rg.addColorStop(1, 'rgba(255,240,220,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h); }
    const img = ctx.getImageData(0, 0, w, h); for (let i = 0; i < img.data.length; i += 4) { const n = (R() - .5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; } ctx.putImageData(img, 0, 0);
    const gr = ctx.createLinearGradient(0, h * .45, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.font = `600 ${u * 6.6}px ${F}`; const ls = wrapText(ctx, headline, w - u * 14).slice(0, 3); text(headline, u * 6, h - u * 8 - (ls.length - 1) * u * 7.1, u * 6.6, '#fff', w - u * 14);
    ctx.fillStyle = S; ctx.fillRect(u * 6, h - u * 8 - ls.length * u * 7.1 - u * 1, u * 8, u * 1.1);
  } else {
    const light = style === 'custom' ? '#17181C' : '#F6F2EA'; ctx.fillStyle = light; ctx.fillRect(0, 0, w, h);
    const cols = [P, S, onColor(light) === '#FFFFFF' ? '#F6F2EA' : '#17181C'];
    for (let i = 0; i < 7; i++) { ctx.fillStyle = cols[i % 3]; ctx.globalAlpha = i % 3 === 2 ? .9 : 1; const x = w * .45 + R() * w * .5, y = R() * h * .75, r = u * (5 + R() * 16); if (R() > .5) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); } else { ctx.beginPath(); ctx.arc(x, y, r, Math.PI, 0); ctx.fill(); } }
    ctx.globalAlpha = 1; text(headline, u * 7, h - u * 24, u * 6.4, onColor(light), w * .6);
    ctx.font = `500 ${u * 3.2}px ${F}`; ctx.fillStyle = onColor(light); ctx.globalAlpha = .6; ctx.fillText(name || '', u * 7, h - u * 7); ctx.globalAlpha = 1;
  }
}
