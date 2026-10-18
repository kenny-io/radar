'use client';
// WebGL radar background — port of prototype/radar-gl.jsx. Adds prefers-reduced-motion (static frame) per 03-design-system.md.
import React, { useEffect, useRef, useState } from 'react';

const RADAR_FRAG = `precision highp float;
uniform vec2 res;uniform float t;uniform float energy;uniform vec3 bg;uniform vec3 fg;uniform vec3 sig;uniform vec2 ctr;uniform float scale;uniform vec4 bl[8];uniform float dens;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 uv=(gl_FragCoord.xy-ctr*res)/min(res.x,res.y)*scale;
  float r=length(uv);float a=atan(uv.y,uv.x);
  float sw=mod(-t*(0.55+energy*0.9),6.28318);
  float d=mod(a-sw,6.28318);
  float trail=exp(-d*(2.6-energy*1.2));
  vec2 g=uv*dens;vec2 f=fract(g)-.5;vec2 id=floor(g);float hh=h(id);
  float dm=smoothstep(.085,.035,length(f));
  float lit=hh>.82?1.:hh>.5?.45:.18;
  float fade=smoothstep(1.55,.15,r);
  float rd=abs(fract(r*3.2+.5)-.5)/3.2;
  float ring=smoothstep(.0035,.0008,rd)*step(r,1.3);
  float line=smoothstep(.006,.0,d*max(r,.05))*smoothstep(1.4,.0,r);
  float amt=dm*(.07+trail*lit*.75*(.35+energy))*fade+ring*.07*fade;
  vec3 col=mix(bg,fg,clamp(amt,0.,1.));
  float s=trail*.16*(.4+energy)*fade*smoothstep(0.,.5,r)+line*.85+dm*trail*step(.93,hh)*fade*.9;
  for(int i=0;i<8;i++){vec4 b=bl[i];if(b.w>0.){float age=t-b.z;if(age>0.){float dd=length(uv-b.xy);s+=smoothstep(.022,.006,dd)*(.55+.45*exp(-age*.5))+smoothstep(.006,.0,abs(dd-age*.22))*exp(-age*1.4)*.9;}}}
  col=mix(col,sig,clamp(s,0.,1.));
  gl_FragColor=vec4(col,1.);
}`;
const THEMES = { night: { bg: [.078, .082, .098], fg: [.93, .94, .96], sig: [1, .47, .22] }, paper: { bg: [.986, .984, .976], fg: [.16, .17, .2], sig: [.95, .42, .18] } };
export interface Blip { x: number; y: number; at: number }

export function RadarField({ theme = 'night', energy = .4, blips = [], center = [.5, .5], scale = 1.6, dens = 26, style, className }: { theme?: 'night' | 'paper'; energy?: number; blips?: Blip[]; center?: [number, number]; scale?: number; dens?: number; style?: React.CSSProperties; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ energy, blips, center, scale, dens }); live.current = { energy, blips, center, scale, dens };
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const c = ref.current!; let gl: WebGLRenderingContext | null = null;
    try { gl = c.getContext('webgl', { antialias: false, preserveDrawingBuffer: false }); } catch { /* */ }
    if (!gl) { setFallback(true); return; }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sh = (type: number, src: string) => { const s = gl!.createShader(type)!; gl!.shaderSource(s, src); gl!.compileShader(s); return s; };
    const pr = gl.createProgram()!; gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}')); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, RADAR_FRAG)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { setFallback(true); return; }
    gl.useProgram(pr); const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl!.getUniformLocation(pr, n); const th = THEMES[theme];
    gl.uniform3fv(U('bg'), th.bg); gl.uniform3fv(U('fg'), th.fg); gl.uniform3fv(U('sig'), th.sig);
    const start = performance.now(); let raf = 0, vis = true, e = live.current.energy;
    const resize = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); const w = c.clientWidth, h = c.clientHeight; c.width = Math.max(1, w * dpr); c.height = Math.max(1, h * dpr); gl!.viewport(0, 0, c.width, c.height); if (reduce) frame(); };
    const ro = new ResizeObserver(resize); ro.observe(c);
    const io = new IntersectionObserver(([en]) => { vis = en.isIntersecting; if (vis && !reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } }); io.observe(c);
    function frame() {
      const L = live.current; const t = reduce ? 2.2 : (performance.now() - start) / 1000; e += (L.energy - e) * .04; if (reduce) e = L.energy;
      gl!.uniform2f(U('res'), c.width, c.height); gl!.uniform1f(U('t'), t); gl!.uniform1f(U('energy'), e); gl!.uniform2fv(U('ctr'), L.center); gl!.uniform1f(U('scale'), L.scale); gl!.uniform1f(U('dens'), L.dens);
      const arr = new Float32Array(32);
      if (!reduce) (L.blips || []).slice(-8).forEach((b, i) => { arr[i * 4] = b.x; arr[i * 4 + 1] = b.y; arr[i * 4 + 2] = (b.at - start) / 1000; arr[i * 4 + 3] = 1; });
      gl!.uniform4fv(U('bl'), arr);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }
    function draw() { frame(); if (vis) raf = requestAnimationFrame(draw); }
    resize(); frame(); if (!reduce) raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); const x = gl!.getExtension('WEBGL_lose_context'); x && x.loseContext(); };
  }, [theme]);
  const bgc = theme === 'night' ? 'var(--night)' : 'var(--paper)';
  return <div className={className} style={{ position: 'relative', overflow: 'hidden', background: bgc, ...style }}>
    <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} aria-hidden="true" />
    {fallback && <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at ${center[0] * 100}% ${100 - center[1] * 100}%, oklch(0.66 0.19 42 / .18), transparent 55%)` }} />}
  </div>;
}
