// Brand visual templates — port of drawVisual (prototype/radar-article.jsx).
// Works on any CanvasRenderingContext2D-compatible context: the browser (previews) and @napi-rs/canvas (server PNGs).
// "PHOTO PLACEHOLDER" label removed (README §2.4). Photography / Illustration use an image model when configured;
// these templates are the brand-rendered fallback and the instant preview.
export interface VisualOpts { w: number; h: number; style: string; brand: { primary: string; secondary: string }; headline: string; seed?: number; name?: string; fontFamily?: string }

export function lum(hex: string) { const n = parseInt((hex || '#000').slice(1), 16); const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
export const onColor = (hex: string) => (lum(hex) > .4 ? '#17181C' : '#FFFFFF');
function wrapText(ctx: any, text: string, maxW: number) { const words = String(text).split(' '); const lines: string[] = []; let l = ''; words.forEach(w => { const t = l ? l + ' ' + w : w; if (ctx.measureText(t).width > maxW && l) { lines.push(l); l = w; } else l = t; }); if (l) lines.push(l); return lines; }
export function mulberry(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** Number of "Branded graphic" compositions (the seed picks one). */
export const BRANDED_LAYOUTS = 5;
/** Number of "Infographic" compositions (the seed picks one). */
export const INFOGRAPHIC_LAYOUTS = 5;
export function drawVisual(ctx: any, { w, h, style, brand, headline, seed = 1, name, fontFamily }: VisualOpts) {
  const R = mulberry(seed * 9973); let P = brand.primary, S = brand.secondary; const F = fontFamily || '"Geist", system-ui, sans-serif';
  ctx.clearRect(0, 0, w, h); const u = Math.min(w, h) / 100;
  const text = (t: string, x: number, y: number, size: number, color: string, maxW: number, weight = 600, lh = 1.08) => { ctx.font = `${weight} ${size}px ${F}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; const ls = wrapText(ctx, t, maxW).slice(0, 4); ls.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh)); return ls.length * size * lh; };
  if (style === 'branded') {
    // Five compositions; the seed picks one (Regenerate steps the seed by 11, so every regenerate shows a new layout),
    // and every other cycle swaps the brand colors. Shapes are decorative; the headline always sits on a solid fill.
    const L = BRANDED_LAYOUTS, n = Math.floor(Math.abs(seed)), layout = n % L;
    const swap = Math.floor(n / L) % 2 === 1 && lum(S) < .4; // only swap to a background that keeps white text readable
    const bg = swap ? S : P, fg = swap ? P : S, oc = onColor(bg);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const sizeH = u * 8, maxW = w - u * 16;
    const lines = () => { ctx.font = `600 ${sizeH}px ${F}`; return wrapText(ctx, headline, maxW).slice(0, 4).length; };
    const bottomHead = () => { const top = h - u * 14 - lines() * u * 8.6; text(headline, u * 7, top + u * 8, sizeH, oc, maxW); };
    const topHead = (y0 = u * 20) => text(headline, u * 7, y0, sizeH, oc, maxW);
    ctx.fillStyle = fg;
    if (layout === 0) { // sun: one disc top-right, rule top-left, headline bottom-left
      ctx.beginPath(); ctx.arc(w * (.78 + R() * .1), h * (.2 + R() * .1), u * (16 + R() * 10), 0, 7); ctx.fill();
      ctx.fillRect(u * 7, u * 8, u * 10, u * 1.4); bottomHead();
    } else if (layout === 1) { // rings: concentric arcs from the bottom-right corner, headline top-left
      ctx.strokeStyle = fg; ctx.lineWidth = u * (1.6 + R()); const r0 = u * (18 + R() * 8);
      for (let i = 0; i < 5; i++) { ctx.globalAlpha = 1 - i * .16; ctx.beginPath(); ctx.arc(w, h, r0 + i * u * 9, Math.PI, Math.PI * 1.5); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillRect(u * 7, u * 8, u * 4, u * 4); topHead(u * 24);
    } else if (layout === 2) { // band: a diagonal stripe across the top half, headline bottom-left
      const y = h * (.08 + R() * .06), t = u * (6 + R() * 3); // left edge stays above the headline
      ctx.beginPath(); ctx.moveTo(0, y + t * 2); ctx.lineTo(w, y - t); ctx.lineTo(w, y + t); ctx.lineTo(0, y + t * 4); ctx.closePath(); ctx.fill();
      bottomHead();
    } else if (layout === 3) { // dots: a grid of dots on the right, headline top-left
      const cols = 6, gap = u * (6 + R() * 2), r = u * (1.2 + R() * .8), x0 = w - u * 8 - (cols - 1) * gap, y0 = h - u * 8 - (cols - 1) * gap;
      for (let i = 0; i < cols; i++) for (let j = 0; j < cols; j++) { if (i + j < cols - 2) continue; ctx.beginPath(); ctx.arc(x0 + i * gap, y0 + j * gap, r, 0, 7); ctx.fill(); }
      ctx.fillRect(u * 7, u * 8, u * 10, u * 1.4); topHead(u * 22);
    } else { // blocks: overlapping squares top-right, headline bottom-left
      const s = u * (20 + R() * 8), x = w - u * 8 - s, y = u * 8;
      ctx.globalAlpha = .45; ctx.fillRect(x - s * .35, y + s * .35, s, s); ctx.globalAlpha = 1; ctx.fillRect(x, y, s, s);
      bottomHead();
    }
    ctx.font = `500 ${u * 3.6}px ${F}`; ctx.fillStyle = oc; ctx.globalAlpha = .8;
    ctx.fillText(name || '', u * 7, h - u * 7); ctx.globalAlpha = 1;
  } else if (style === 'infographic') {
    // Five chart compositions picked by the seed (Regenerate steps the seed by 11 → a new one each time). A big number
    // is shown only when the headline really contains one: the template never invents a statistic.
    ctx.fillStyle = '#FAF8F3'; ctx.fillRect(0, 0, w, h);
    const n = Math.floor(Math.abs(seed)), layout = n % INFOGRAPHIC_LAYOUTS;
    const stat = (headline.match(/\b\d+(?:[.,]\d+)?\s?(?:%|x|×)?/i) || [null])[0]?.trim() || null;
    if (stat) { ctx.font = `600 ${u * 26}px ${F}`; ctx.fillStyle = P; ctx.fillText(stat, u * 7, u * 32); text(headline, u * 7, u * 44, u * 5.2, '#17181C', w * .55, 500, 1.2); }
    else { ctx.fillStyle = P; ctx.fillRect(u * 7, u * 8, u * 10, u * 1.4); text(headline, u * 7, u * 22, u * 7, '#17181C', w * .52, 600, 1.12); }
    const gx = w * .6, gw = w * .34, base = h - u * 10, top = h * .3;
    if (layout === 0) { // bars
      const bars = 5; for (let i = 0; i < bars; i++) { const bh = (.25 + R() * .6) * (base - top); const bw = gw / bars; ctx.fillStyle = i === bars - 1 ? P : S; ctx.globalAlpha = i === bars - 1 ? 1 : .55; ctx.fillRect(gx + i * bw * 1.1, base - bh, bw * .8, bh); } ctx.globalAlpha = 1;
      ctx.fillStyle = '#17181C'; ctx.fillRect(gx - w * .02, base, gw + w * .04, 1.5);
    } else if (layout === 1) { // ring with one highlighted share
      const cx = gx + gw / 2, cy = (top + base) / 2, r = Math.min(gw, base - top) * .4, lw = r * .32, a0 = -Math.PI / 2, a1 = a0 + (.25 + R() * .45) * Math.PI * 2;
      ctx.lineWidth = lw; ctx.strokeStyle = S; ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.strokeStyle = P; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    } else if (layout === 2) { // three-step flow
      const cy = (top + base) / 2 + (R() - .5) * u * 6, rr = Math.min(gw / 9, u * 7), xs = [gx + rr, gx + gw / 2, gx + gw - rr];
      ctx.strokeStyle = '#17181C'; ctx.lineWidth = Math.max(1.5, u * .5);
      for (let i = 0; i < 2; i++) { const x1 = xs[i] + rr + u * 1.5, x2 = xs[i + 1] - rr - u * 1.5; ctx.beginPath(); ctx.moveTo(x1, cy); ctx.lineTo(x2, cy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x2, cy); ctx.lineTo(x2 - u * 2, cy - u * 1.5); ctx.lineTo(x2 - u * 2, cy + u * 1.5); ctx.closePath(); ctx.fillStyle = '#17181C'; ctx.fill(); }
      xs.forEach((x, i) => { ctx.fillStyle = i === 2 ? P : S; ctx.globalAlpha = i === 2 ? 1 : .7; ctx.beginPath(); ctx.arc(x, cy, rr, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
    } else if (layout === 3) { // waffle grid
      const k = 5, cell = Math.min(gw, base - top) / k, x0 = gx + (gw - cell * k) / 2, y0 = base - cell * k, on = 4 + Math.floor(R() * 14);
      for (let i = 0; i < k * k; i++) { const c = i % k, rI = Math.floor(i / k); ctx.fillStyle = i < on ? P : S; ctx.globalAlpha = i < on ? 1 : .5; ctx.fillRect(x0 + c * cell + cell * .08, y0 + (k - 1 - rI) * cell + cell * .08, cell * .84, cell * .84); } ctx.globalAlpha = 1;
    } else { // rising line
      const pts = 6, ys: number[] = []; let v = .15 + R() * .15; for (let i = 0; i < pts; i++) { ys.push(base - v * (base - top)); v = Math.min(.95, v + .06 + R() * .16); }
      const xAt = (i: number) => gx + (gw * i) / (pts - 1);
      ctx.fillStyle = S; ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(xAt(0), base); ys.forEach((y, i) => ctx.lineTo(xAt(i), y)); ctx.lineTo(xAt(pts - 1), base); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = P; ctx.lineWidth = Math.max(2, u * .8); ctx.beginPath(); ys.forEach((y, i) => (i ? ctx.lineTo(xAt(i), y) : ctx.moveTo(xAt(i), y))); ctx.stroke();
      ys.forEach((y, i) => { ctx.fillStyle = i === pts - 1 ? P : '#FAF8F3'; ctx.beginPath(); ctx.arc(xAt(i), y, u * 1.4, 0, 7); ctx.fill(); ctx.strokeStyle = P; ctx.lineWidth = Math.max(1.5, u * .4); ctx.stroke(); });
      ctx.fillStyle = '#17181C'; ctx.fillRect(gx - w * .02, base, gw + w * .04, 1.5);
    }
    ctx.font = `500 ${u * 3.2}px ${F}`; ctx.fillStyle = '#6B6E78'; ctx.fillText(name || '', u * 7, h - u * 7);
  // New styles (UPDATE-2026-10-21-image-options): instant previews and the fallback when no image model is configured.
  } else if (style === 'editorial'||style==='flat'||style==='render3d'||style==='handdrawn'){
    // Regenerate steps the seed by 11: across 4 variants that is always a new one (mirrored and/or brand colors swapped).
    const nv = Math.floor(Math.abs(seed)) % 4; if (nv & 2) [P, S] = [S, P];
    ctx.save(); if (nv & 1) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        const W2=w,H2=h,m=Math.min(w,h),cx=w*(.5+(R()-.5)*.12),cy=h*.5;
    if(style==='editorial'){
      ctx.fillStyle='#EEE7DA';ctx.fillRect(0,0,W2,H2);
      ctx.fillStyle=S;ctx.fillRect(0,H2*.7,W2,H2*.3);
      ctx.fillStyle=P;ctx.beginPath();ctx.arc(cx+m*.12,H2*.4,m*.24,0,7);ctx.fill();
      ctx.strokeStyle='#1B1D22';ctx.lineWidth=Math.max(2,u*1.1);ctx.lineCap='round';const lx=cx-m*.28,ly=H2*.92,tx=cx-m*.02,ty=H2*.22,g=u*6;
      ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(tx,ty);ctx.moveTo(lx+g,ly);ctx.lineTo(tx+g,ty);ctx.stroke();
      for(let i=1;i<10;i++){const t=i/10;ctx.beginPath();ctx.moveTo(lx+(tx-lx)*t,ly+(ty-ly)*t);ctx.lineTo(lx+g+(tx-lx)*t,ly+(ty-ly)*t);ctx.stroke()}
      ctx.fillStyle='#1B1D22';ctx.beginPath();ctx.arc(tx+g/2,ty-u*6,u*2.6,0,7);ctx.fill();ctx.fillRect(tx+g/2-u*1.2,ty-u*3.6,u*2.4,u*4);
    }else if(style==='flat'){
      ctx.fillStyle='#F2EEE6';ctx.fillRect(0,0,W2,H2);
      ctx.fillStyle=S;ctx.beginPath();ctx.arc(W2*.82,H2*.24,m*.1,0,7);ctx.fill();
      const fy=H2*.7;ctx.fillStyle=P;ctx.fillRect(W2*.1,fy,W2*.8,u*2.6);
      ctx.fillStyle='#1B1D22';ctx.fillRect(cx-m*.02,fy-m*.2,m*.3,m*.19);ctx.fillRect(cx-m*.06,fy-u*1.4,m*.38,u*1.4);
      ctx.fillStyle='#F2EEE6';ctx.fillRect(cx+m*.01,fy-m*.17,m*.24,m*.13);
      const px=cx-m*.24;ctx.fillStyle=P;if(ctx.roundRect){ctx.beginPath();ctx.roundRect(px-m*.08,fy-m*.3,m*.16,m*.3,[m*.08,m*.08,0,0]);ctx.fill()}else ctx.fillRect(px-m*.08,fy-m*.3,m*.16,m*.3);
      ctx.fillStyle='#E7B48C';ctx.beginPath();ctx.arc(px,fy-m*.37,m*.06,0,7);ctx.fill();
      ctx.fillStyle='#1B1D22';ctx.beginPath();ctx.arc(px,fy-m*.39,m*.062,Math.PI,0);ctx.fill();
      ctx.fillStyle=S;ctx.fillRect(W2*.78,fy-m*.1,m*.08,m*.1);ctx.fillStyle=P;[[-.03,-.2],[.03,-.24],[.09,-.19]].forEach(([dx,dy])=>{ctx.beginPath();ctx.ellipse(W2*.78+m*.04+m*dx,fy+m*dy,m*.03,m*.07,dx*8,0,7);ctx.fill()});
    }else if(style==='render3d'){
      const g=ctx.createLinearGradient(0,0,0,H2);g.addColorStop(0,'#ECEAF1');g.addColorStop(1,'#C8C3D3');ctx.fillStyle=g;ctx.fillRect(0,0,W2,H2);
      const r=m*.22,sx=cx-m*.06,sy=cy;
      ctx.save();try{ctx.filter='blur('+Math.round(u*3)+'px)'}catch{};ctx.fillStyle='rgba(30,25,45,.28)';ctx.beginPath();ctx.ellipse(sx+r*.2,sy+r*1.12,r*1.05,r*.2,0,0,7);ctx.fill();ctx.restore();
      const sg=ctx.createRadialGradient(sx-r*.4,sy-r*.45,r*.05,sx,sy,r*1.05);sg.addColorStop(0,'#ffffff');sg.addColorStop(.25,P);sg.addColorStop(1,'#0E0F14');ctx.fillStyle=sg;ctx.beginPath();ctx.arc(sx,sy,r,0,7);ctx.fill();
      ctx.save();ctx.translate(sx+r*.9,sy-r*.2);ctx.rotate(-.5);const rg=ctx.createLinearGradient(-r,0,r,0);rg.addColorStop(0,'rgba(255,255,255,.9)');rg.addColorStop(.5,S);rg.addColorStop(1,'rgba(255,255,255,.6)');ctx.strokeStyle=rg;ctx.lineWidth=u*3.2;ctx.globalAlpha=.85;ctx.beginPath();ctx.ellipse(0,0,r*.75,r*.28,0,0,7);ctx.stroke();ctx.restore();
      ctx.fillStyle='rgba(255,255,255,.55)';ctx.beginPath();ctx.ellipse(sx-r*.38,sy-r*.42,r*.14,r*.08,-.6,0,7);ctx.fill();
    }else{
      ctx.fillStyle='#F5F0E3';ctx.fillRect(0,0,W2,H2);
      const img=ctx.getImageData(0,0,W2,H2);for(let i=0;i<img.data.length;i+=4){const n=(R()-.5)*14;img.data[i]+=n;img.data[i+1]+=n;img.data[i+2]+=n}ctx.putImageData(img,0,0);
      ctx.fillStyle=S;ctx.globalAlpha=.35;ctx.beginPath();ctx.ellipse(cx+m*.08,cy-m*.06,m*.26,m*.2,.4,0,7);ctx.fill();ctx.globalAlpha=1;
      ctx.strokeStyle='#23262C';ctx.lineCap='round';
      const ccx=cx+m*.1,ccy=cy-m*.12,cr=m*.13;for(let pass=0;pass<3;pass++){ctx.lineWidth=u*(.5+R()*.4);ctx.beginPath();for(let a=0;a<=6.5;a+=.2){const rr=cr+(R()-.5)*u*1.4;const x=ccx+Math.cos(a)*rr,y=ccy+Math.sin(a)*rr;a?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke()}
      ctx.lineWidth=u*.45;for(let i=0;i<9;i++){const o=i*u*2.2;ctx.beginPath();ctx.moveTo(ccx-cr*.2+o,ccy+cr*.9);ctx.lineTo(ccx+cr*.9,ccy-cr*.2+o*.1+(R()-.5)*u);ctx.stroke()}
      for(let k=0;k<2;k++){ctx.lineWidth=u*(.7+k*.2);ctx.beginPath();for(let x=0;x<=W2;x+=u*2){const y=H2*(.72+k*.08)+Math.sin(x/(u*14)+k)*u*3+(R()-.5)*u*.8;x?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke()}
    }
    ctx.restore();
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
