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
  // New styles (UPDATE-2026-10-21-image-options): instant previews and the fallback when no image model is configured.
  } else if (style === 'editorial'||style==='flat'||style==='render3d'||style==='handdrawn'){
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
