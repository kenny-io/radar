// WebGL dot-field behind the marketing hero. Port of prototype/home-field.js.
// home.js only ever drives it in 'story' mode at rest (hp = u = f = 0, day = 0), so that is the path ported here; the
// 'chapters' and 'final' branches were unreachable. createField() builds its own canvases and labels inside `host` and
// returns null when WebGL is unavailable (the caller then shows the solid #111318 hero).
const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FS = `precision highp float;
uniform vec2 uRes;uniform float uDpr,uTime,uZoom,uNet,uReach,uRing,uDay,uKick,uMotion,uYouA;uniform vec2 uYou,uCam,uFm;uniform vec3 uF;uniform vec3 uMouse;uniform vec3 uN[16];
const vec3 NIGHT=vec3(.067,.075,.094);const vec3 PAPER=vec3(.98,.976,.965);const vec3 SIG=vec3(.93,.376,.094);const vec3 WARM=vec3(1.,.93,.86);const vec3 DOTN=vec3(.76,.79,.85);const vec3 INK=vec3(.15,.16,.2);
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
void main(){
vec2 p=vec2(gl_FragCoord.x,uRes.y*uDpr-gl_FragCoord.y)/uDpr;vec2 ctr=uRes*.5;
float dY=length(p-uYou);
float day=uDay;float edge=0.;
if(uFm.y>0.){float dF=length(p-uF.xy);float s=smoothstep(uF.z-uFm.y,uF.z,dF);day=uFm.x>.5?s:1.-s;edge=exp(-pow((dF-uF.z+uFm.y*.5)/130.,2.));}
vec3 bg=mix(NIGHT,PAPER,day);
bg=mix(bg,mix(SIG,PAPER,.45),edge*(uFm.x>.5?.22:.42));
float vig=smoothstep(.35,1.35,length((p-ctr)/max(ctr.x,ctr.y)));bg*=1.-vig*.35*(1.-day);
float cs=26.;vec2 f=(p-ctr)/uZoom+uCam;vec2 id=floor(f/cs);
float h1=hash(id),h2=hash(id+17.31),h3=hash(id+41.7);
vec2 c=(vec2(h1,h2)*.64+.18)*cs;vec2 dp=ctr+(id*cs+c-uCam)*uZoom;
float rad=(.6+h3*.8)*clamp(uZoom,.85,1.4);float d=length(p-dp);
float dotA=(1.-smoothstep(rad-.75,rad+.75,d))*step(.3,h3);
float dd=length(dp-uYou);
float tw=mix(1.,.5+.5*sin(uTime*(.45+h1*1.6)+h2*6.283),uMotion);
float net=(1.-smoothstep(uNet*.5,uNet,dd))*uYouA;
float ms=uMouse.z*(1.-smoothstep(0.,180.,length(dp-uMouse.xy)));
float ring=0.,rl=0.;
for(int k=0;k<3;k++){float r=fract(uTime*.11+float(k)/3.)*uReach;float fd=1.-r/uReach;fd*=fd;ring+=exp(-pow((dd-r)/28.,2.))*fd;rl+=exp(-pow((dY-r)/1.3,2.))*fd;}
ring*=uRing*uYouA;rl*=uRing*uYouA;
float kr=uKick*820.;float kf=clamp(1.-uKick/1.15,0.,1.);kf*=kf;ring+=exp(-pow((dd-kr)/34.,2.))*kf*1.3;rl+=exp(-pow((dY-kr)/1.4,2.))*kf;
float ng=0.,bl=0.;
for(int i=0;i<16;i++){vec3 n=uN[i];if(n.z<.002)continue;ng+=n.z*(1.-smoothstep(8.,84.,length(dp-n.xy)));bl+=n.z*exp(-pow(length(p-n.xy)/74.,2.));}
ng=min(ng,1.);bl=min(bl,1.);ring=min(ring,1.);
float lit=max(max(net*.92,ms*.6),ng);
vec3 nc=mix(mix(DOTN,WARM,lit),SIG,ring);float na=clamp(.11*tw+lit*.8+ring*.95,0.,1.);
vec3 cN=mix(bg,nc,dotA*na);
vec3 dc=mix(INK,SIG,clamp(ring+ng,0.,1.));float da=clamp(.085*tw+(ring+ng)*.62+net*.12,0.,1.);
vec3 cD=mix(bg,dc,dotA*da);
vec3 col=mix(cN,cD,day);
col+=(WARM*.07+SIG*.06)*bl*(1.-day);col=mix(col,SIG,bl*.06*day);
float yg=exp(-pow(dY/38.,2.))*uYouA;col+=SIG*yg*.38*(1.-day);col=mix(col,SIG,yg*.12*day);
col=mix(col,SIG,min(rl,1.)*.13*(1.-day*.35));
gl_FragColor=vec4(col,1.);}`;

type Group = 'search' | 'ai' | 'talk' | 'feed' | 'peer';
const NODES: [string, number, number, Group, number][] = [['Google', -.95, -.62, 'search', .13],
  ['ChatGPT', .62, -.74, 'ai', .21], ['Perplexity', 1.12, -.6, 'ai', .24], ['Gemini', 1.42, -.2, 'ai', .27], ['Claude', 1.22, .22, 'ai', .3], ['Grok', .82, -.25, 'ai', .33],
  ['Reddit', -1.38, -.05, 'talk', .39], ['X', -.7, -.12, 'talk', .42], ['Hacker News', -1.02, .38, 'talk', .45], ['Quora', -.55, .55, 'talk', .48],
  ['LinkedIn', .5, .55, 'feed', .53], ['Facebook', 1.0, .55, 'feed', .56],
  ['', -.28, .3, 'peer', 0], ['', .33, .24, 'peer', 0], ['', .2, -.32, 'peer', 0], ['', -.36, -.17, 'peer', 0]];
const N = NODES.length, FAR = .42, YOU = 'Your product';
const UNIFORMS = ['uRes', 'uDpr', 'uTime', 'uZoom', 'uNet', 'uReach', 'uRing', 'uDay', 'uKick', 'uMotion', 'uYouA', 'uYou', 'uCam', 'uMouse', 'uN', 'uF', 'uFm'] as const;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function bez(ax: number, ay: number, bx: number, by: number, t: number) { const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay; const qx = mx + dy * .2, qy = my - dx * .2; const u = 1 - t; return [u * u * ax + 2 * u * t * qx + t * t * bx, u * u * ay + 2 * u * t * qy + t * t * by]; }

interface Label { e: HTMLSpanElement; w: number; o: number; x: number; y: number; on: boolean | null; dk: boolean | null }
export interface Field { setName(t: string): void; kick(): void; measure(): void; destroy(): void }

/** `paused()` mirrors home.js RS.update(): the field stops drawing once the hero has scrolled away. `onLost` fires on context loss. */
export function createField(host: HTMLElement, { paused, onLost }: { paused: () => boolean; onLost: () => void }): Field | null {
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const cv = document.createElement('canvas'), fx = document.createElement('canvas'), lab = document.createElement('div');
  cv.className = 'fgl'; fx.className = 'ffx'; lab.className = 'flabels';
  [cv, fx, lab].forEach(n => n.setAttribute('aria-hidden', 'true'));
  let gl: WebGLRenderingContext | null = null;
  try { gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }); } catch { gl = null; }
  if (!gl) return null;
  const sh = (t: number, s: string) => { const o = gl!.createShader(t)!; gl!.shaderSource(o, s); gl!.compileShader(o); if (!gl!.getShaderParameter(o, gl!.COMPILE_STATUS)) { console.warn(gl!.getShaderInfoLog(o)); return null; } return o; };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const pr = gl.createProgram()!; gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const al = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
  const U = {} as Record<typeof UNIFORMS[number], WebGLUniformLocation | null>;
  UNIFORMS.forEach(n => { U[n] = gl!.getUniformLocation(pr, n === 'uN' ? 'uN[0]' : n); });
  host.append(cv, fx, lab);

  const mk = (text: string, cls: string): Label => { const e = document.createElement('span'); e.className = cls; e.textContent = text; lab.appendChild(e); return { e, w: 0, o: -1, x: 0, y: 0, on: null, dk: null }; };
  const L = NODES.map(n => (n[0] ? mk(n[0], 'fl') : null));
  const YL = mk(YOU, 'fl you');
  const measureLabels = () => { L.forEach(l => { if (l) l.w = l.e.offsetWidth; }); YL.w = YL.e.offsetWidth; };
  const t0 = performance.now(); let kickAt = -1e9, raf = 0, last = t0, dead = false;
  const c2 = fx.getContext('2d')!;
  let W = 0, H = 0, GD = 1, FD = 1, R = 1;
  const wake = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };
  function resize() {
    const d = window.devicePixelRatio || 1; GD = Math.min(d, 1.5); FD = Math.min(d, 2); W = innerWidth; H = innerHeight; R = Math.min(W, H) / 2;
    cv.width = Math.round(W * GD); cv.height = Math.round(H * GD); fx.width = Math.round(W * FD); fx.height = Math.round(H * FD); gl!.viewport(0, 0, cv.width, cv.height); measureLabels(); wake();
  }
  const wpos = (n: typeof NODES[number]) => { let x = n[1], y = n[2]; if (W / H < .9) { const t = x; x = y * .85; y = t * .8; } else { x *= clamp((W / 2 / R - .12) / 1.45, .62, 1); } return [x, y]; };
  const S = { cx: 0, cy: 0, z: 1, net: 0, reach: .3, ring: .4, youA: 1, ylab: 1, lit: new Float32Array(N), arc: new Float32Array(N), mx: 0, my: 0, mz: 0, mzT: 0, init: false };
  const T = { cx: 0, cy: 0, z: 1, net: 0, reach: .3, ring: .4, youA: 1, ylab: 1, lit: new Float32Array(N), arc: new Float32Array(N) };

  function targets(now: number) { // 'story' mode at rest: hp = u = f = 0
    const portrait = W / H < .9;
    T.z = portrait ? .96 : .92; T.cx = 0; T.cy = (.5 - .42) * H / (R * T.z);
    const intro = RM.matches ? 1 : (now - t0) / 1000;
    for (let i = 0; i < N; i++) {
      const g = NODES[i][3], th = NODES[i][4]; if (g === 'peer') { T.lit[i] = 0; T.arc[i] = 0; continue; }
      const ia = RM.matches ? 1 : ss(.3 + th * 2.2, .75 + th * 2.2, intro);
      T.lit[i] = lerp(FAR, 1, ia); T.arc[i] = ia;
    }
    T.net = .3; T.ring = 1; T.reach = 3.6; T.youA = 1; T.ylab = 1;
  }
  function place(l: Label, x: number, y: number, o: number, on: boolean, dk: boolean) {
    if (Math.abs(o - l.o) > .004) { l.e.style.opacity = o.toFixed(3); l.o = o; }
    if (o > 0 && (Math.abs(x - l.x) > .1 || Math.abs(y - l.y) > .1)) { l.e.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)'; l.x = x; l.y = y; }
    if (on !== l.on) { l.e.classList.toggle('on', on); l.on = on; }
    if (dk !== l.dk) { l.e.classList.toggle('dk', dk); l.dk = dk; }
  }
  function frame(now: number) {
    raf = 0; const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
    if (dead || paused()) return;
    targets(now);
    const inst = RM.matches || !S.init; S.init = true;
    const kc = inst ? 1 : 1 - Math.exp(-dt * 7), kl = inst ? 1 : 1 - Math.exp(-dt * 10), km = 1 - Math.exp(-dt * 4);
    let moving = false;
    const ap = (o: number, key: 'cx' | 'cy' | 'z' | 'net' | 'reach' | 'ring' | 'youA' | 'ylab') => { const d = T[key] - S[key]; if (Math.abs(d) > 1e-4) moving = true; S[key] += d * o; };
    ap(kc, 'cx'); ap(kc, 'cy'); ap(kc, 'z'); (['net', 'reach', 'ring', 'youA', 'ylab'] as const).forEach(k => ap(kl, k));
    for (let i = 0; i < N; i++) { const a = T.lit[i] - S.lit[i], b = T.arc[i] - S.arc[i]; if (Math.abs(a) > 1e-4 || Math.abs(b) > 1e-4) moving = true; S.lit[i] += a * kl; S.arc[i] += b * kl; }
    S.mz += (S.mzT - S.mz) * km; if (Math.abs(S.mzT - S.mz) > 1e-3) moving = true;
    const z = S.z; const day = 0;
    const scr = (w: number[]) => [W / 2 + (w[0] - S.cx) * R * z, H / 2 + (w[1] - S.cy) * R * z];
    const Y = scr([0, 0]), yr = 5;
    const pos = NODES.map(n => scr(wpos(n)));
    const time = RM.matches ? 7.3 : now / 1000; const kick = (now - kickAt) / 1000;
    const g = gl!;
    g.uniform2f(U.uRes, W, H); g.uniform1f(U.uDpr, GD); g.uniform1f(U.uTime, time); g.uniform1f(U.uZoom, z);
    g.uniform1f(U.uNet, S.net * R * z); g.uniform1f(U.uReach, Math.max(1, S.reach * R * z)); g.uniform1f(U.uRing, S.ring);
    g.uniform1f(U.uDay, day); g.uniform3f(U.uF, 0, 0, 0); g.uniform2f(U.uFm, 0, -1);
    g.uniform1f(U.uKick, kick); g.uniform1f(U.uMotion, RM.matches ? 0 : 1); g.uniform1f(U.uYouA, S.youA);
    g.uniform2f(U.uYou, Y[0], Y[1]); g.uniform2f(U.uCam, S.cx * R, S.cy * R); g.uniform3f(U.uMouse, S.mx, S.my, S.mz * (1 - day));
    const nv = new Float32Array(N * 3); for (let i = 0; i < N; i++) { nv[i * 3] = pos[i][0]; nv[i * 3 + 1] = pos[i][1]; nv[i * 3 + 2] = S.lit[i]; } g.uniform3fv(U.uN, nv);
    g.drawArrays(g.TRIANGLES, 0, 3);
    c2.setTransform(FD, 0, 0, FD, 0, 0); c2.clearRect(0, 0, W, H); c2.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      const a = S.arc[i]; if (a < .003) continue; const [bx, by] = pos[i];
      c2.beginPath(); const n = 36, m = Math.ceil(n * a); for (let j = 0; j <= m; j++) { const t = Math.min(j / n, a); const q = bez(Y[0], Y[1], bx, by, t); if (j) c2.lineTo(q[0], q[1]); else c2.moveTo(q[0], q[1]); }
      c2.strokeStyle = 'rgba(237,96,24,' + (.5 * S.youA) + ')'; c2.setLineDash(NODES[i][3] === 'peer' ? [2, 4] : []); c2.stroke();
      if (a > .97 && !RM.matches) { const t = (time * .24 + i * .371) % 1; const q = bez(Y[0], Y[1], bx, by, t); c2.beginPath(); c2.arc(q[0], q[1], 1.8, 0, 6.283); c2.fillStyle = 'rgba(255,214,186,' + Math.sin(Math.PI * t) + ')'; c2.fill(); }
    }
    c2.setLineDash([]);
    for (let i = 0; i < N; i++) {
      const l = S.lit[i], lb = L[i]; if (l < .01) { if (lb) place(lb, lb.x, lb.y, 0, !!lb.on, !!lb.dk); continue; }
      const [x, y] = pos[i]; const full = ss(.5, 1, l);
      c2.beginPath(); c2.arc(x, y, 2 + 1.6 * full, 0, 6.283); c2.fillStyle = 'rgba(255,240,228,' + Math.min(1, .5 + l) + ')'; c2.fill();
      if (full > .5 && !RM.matches) { const f = (time * .45 + i * .17) % 1; c2.beginPath(); c2.arc(x, y, 5 + f * 16, 0, 6.283); c2.strokeStyle = 'rgba(255,200,170,' + ((1 - f) * .32 * full) + ')'; c2.stroke(); }
      if (lb) place(lb, x - lb.w / 2, y + 10, clamp(.25 + .75 * l, 0, 1) * ss(.01, .12, l), l > .78 || S.arc[i] > .5, false);
    }
    if (S.youA > .01) {
      c2.beginPath(); c2.arc(Y[0], Y[1], yr, 0, 6.283); c2.fillStyle = 'rgba(237,96,24,' + S.youA + ')'; c2.fill();
      if (!RM.matches) { const f = (time * .5) % 1; c2.beginPath(); c2.arc(Y[0], Y[1], yr + 3 + f * 14, 0, 6.283); c2.strokeStyle = 'rgba(237,96,24,' + ((1 - f) * .45 * S.youA) + ')'; c2.stroke(); }
      place(YL, Y[0] - YL.w / 2, Y[1] + 16, S.ylab * S.youA, true, false);
    } else place(YL, YL.x, YL.y, 0, true, !!YL.dk);
    if ((!RM.matches && !document.hidden) || moving || kick < 1.3) wake();
  }

  const onMove = (e: PointerEvent) => { if (e.pointerType === 'touch') return; S.mx = e.clientX; S.my = e.clientY; S.mzT = 1; wake(); };
  const onLeave = () => { S.mzT = 0; wake(); };
  const onVis = () => { if (!document.hidden) { last = performance.now(); wake(); } };
  const onLostCtx = (e: Event) => { e.preventDefault(); dead = true; onLost(); };
  addEventListener('resize', resize); addEventListener('pointermove', onMove, { passive: true }); addEventListener('scroll', wake, { passive: true });
  document.addEventListener('pointerleave', onLeave); document.addEventListener('visibilitychange', onVis);
  cv.addEventListener('webglcontextlost', onLostCtx);
  resize();
  if (document.fonts) document.fonts.ready.then(() => { if (!dead) measureLabels(); });
  wake();

  return {
    setName(t) { YL.e.textContent = t || YOU; YL.w = YL.e.offsetWidth; wake(); },
    kick() { if (!RM.matches) { kickAt = performance.now(); wake(); } },
    measure: measureLabels,
    destroy() {
      dead = true; if (raf) cancelAnimationFrame(raf); raf = 0;
      removeEventListener('resize', resize); removeEventListener('pointermove', onMove); removeEventListener('scroll', wake);
      document.removeEventListener('pointerleave', onLeave); document.removeEventListener('visibilitychange', onVis);
      cv.removeEventListener('webglcontextlost', onLostCtx);
      gl!.getExtension('WEBGL_lose_context')?.loseContext();
      cv.remove(); fx.remove(); lab.remove();
    },
  };
}
