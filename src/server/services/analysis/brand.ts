// Brand detection (02-system.md §3 "brand"): logo, primary/secondary colors and language.
// Logo order: <link rel=icon> large sizes → apple-touch-icon → header img/svg → og:image. Stored via storage; null if none.
import * as cheerio from 'cheerio';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { fetchUrl } from './crawl';
import { objectKey, putObject } from '../storage';
import { langs } from '@/lib/constants';

export interface BrandDetect { logo: string | null; primary: string | null; secondary: string | null; language: string | null; htmlLang: string | null }

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
export function normColor(v: string): string | null {
  v = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v); if (m) return ('#' + m[1].split('').map(c => c + c).join('')).toUpperCase();
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v); if (m) return ('#' + m[1]).toUpperCase();
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v); if (m) return toHex(+m[1], +m[2], +m[3]);
  return null;
}
function rgb(hex: string) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function sat(hex: string) { const [r, g, b] = rgb(hex).map(x => x / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }
function lum(hex: string) { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
const neutral = (hex: string) => sat(hex) < 0.12 || lum(hex) > 0.96 || lum(hex) < 0.04;
function dist(a: string, b: string) { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }

/** Colors from CSS custom properties (inline <style> + up to 3 same-site stylesheets) and theme-color. */
async function cssColors($: cheerio.CheerioAPI, origin: string): Promise<{ primary: string[]; secondary: string[]; any: string[] }> {
  let css = $('style').map((_, el) => $(el).text()).get().join('\n');
  const hrefs = $('link[rel="stylesheet"]').map((_, el) => $(el).attr('href')).get().filter(Boolean).slice(0, 3);
  for (const h of hrefs) { try { const u = new URL(h!, origin); if (u.origin !== origin) continue; const r = await fetchUrl(u.toString(), 'text/css'); if (r.status < 400) css += '\n' + r.body.toString('utf8').slice(0, 300000); } catch { /* */ } }
  const out = { primary: [] as string[], secondary: [] as string[], any: [] as string[] };
  const re = /--([\w-]+)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const name = m[1].toLowerCase(); const c = normColor(m[2]); if (!c) continue;
    if (/primary|brand|main/.test(name) && !/text|fg|foreground|bg|background|border/.test(name)) out.primary.push(c);
    else if (/secondary|accent|highlight/.test(name) && !/text|fg|foreground|border/.test(name)) out.secondary.push(c);
    else out.any.push(c);
  }
  const theme = normColor($('meta[name="theme-color"]').attr('content') || '');
  if (theme) out.primary.push(theme);
  return out;
}

/** Dominant non-neutral colors of a logo (SVG: declared fills; raster: pixel histogram). */
async function logoColors(body: Buffer, type: string): Promise<string[]> {
  if (/svg/.test(type)) {
    const s = body.toString('utf8'); const counts = new Map<string, number>();
    for (const m of s.matchAll(/(?:fill|stop-color|stroke|color)\s*[=:]\s*["']?(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)) { const c = normColor(m[1]); if (c && !neutral(c)) counts.set(c, (counts.get(c) || 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }
  try {
    const img = await loadImage(body); const c = createCanvas(48, 48); const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 48, 48); const d = ctx.getImageData(0, 0, 48, 48).data; const counts = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; const q = toHex(Math.round(d[i] / 24) * 24, Math.round(d[i + 1] / 24) * 24, Math.round(d[i + 2] / 24) * 24); if (!neutral(q)) counts.set(q, (counts.get(q) || 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  } catch { return []; }
}

const maxSize = (s?: string) => Math.max(0, ...String(s || '').split(/\s+/).map(x => (x === 'any' ? 512 : parseInt(x.split('x')[0]) || 0)));

/** Candidate logo URLs in the designed order. */
function logoCandidates($: cheerio.CheerioAPI, base: string): string[] {
  const abs = (h?: string) => { try { return h ? new URL(h, base).toString() : null; } catch { return null; } };
  const icons = $('link[rel~="icon"]').map((_, el) => ({ href: abs($(el).attr('href')), size: maxSize($(el).attr('sizes')), svg: /svg/.test($(el).attr('type') || '') || /\.svg(\?|$)/.test($(el).attr('href') || '') })).get()
    .filter(i => i.href && (i.size >= 96 || i.svg)).sort((a, b) => b.size - a.size).map(i => i.href!);
  const apple = $('link[rel~="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').map((_, el) => abs($(el).attr('href'))).get().filter(Boolean) as string[];
  const headerImgs = $('header img, [class*="logo"] img, img[class*="logo"], img[alt*="logo" i], img[src*="logo" i]').map((_, el) => abs($(el).attr('src'))).get().filter(Boolean) as string[];
  const og = abs($('meta[property="og:image"]').attr('content'));
  return [...new Set([...icons, ...apple, ...headerImgs, ...(og ? [og] : [])])];
}

/** Inline header SVG (serialized) when no URL candidate works. */
function inlineHeaderSvg($: cheerio.CheerioAPI): string | null {
  const el = $('header svg, [class*="logo"] svg').first();
  if (!el.length) return null;
  const html = $.html(el); if (html.length > 200000) return null;
  return html.includes('xmlns') ? html : html.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

/** "en-US" → "English (US)" etc., matched against the Language select options. Null if unknown. */
export function langFromHtml(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const t = tag.trim().replace('_', '-'); const [base, region] = t.split('-'); const b = base.toLowerCase(); const r = (region || '').toUpperCase();
  const special: Record<string, string> = { en: r === 'GB' || r === 'UK' ? 'English (UK)' : r === 'AU' ? 'English (Australia)' : 'English (US)', es: r === 'MX' ? 'Spanish (Mexico)' : 'Spanish', pt: r === 'PT' ? 'Portuguese (PT)' : 'Portuguese (BR)', zh: r === 'TW' || r === 'HK' ? 'Chinese (Traditional)' : 'Chinese (Simplified)' };
  const L = langs();
  if (special[b] && L.includes(special[b])) return special[b];
  try { const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(b); if (n && L.includes(n)) return n; } catch { /* */ }
  return null;
}

export async function detectBrand(bid: string, homeHtml: string, origin: string): Promise<BrandDetect> {
  const $ = cheerio.load(homeHtml);
  let logo: string | null = null; let logoCols: string[] = [];
  for (const u of logoCandidates($, origin).slice(0, 6)) {
    try {
      const r = await fetchUrl(u, 'image/*');
      if (r.status >= 400 || !/^image\//.test(r.type) || r.body.length < 80 || r.body.length > 3 * 1024 * 1024) continue;
      const type = r.type.split(';')[0].trim();
      if (!/svg/.test(type)) { try { const img = await loadImage(r.body); if (Math.min(img.width, img.height) < 48) continue; } catch { continue; } }
      const ext = /svg/.test(type) ? 'svg' : type.split('/')[1].replace('jpeg', 'jpg').replace('x-icon', 'ico').replace('vnd.microsoft.icon', 'ico');
      logo = await putObject(objectKey(bid, 'logo', ext), r.body, type);
      logoCols = await logoColors(r.body, type);
      break;
    } catch { /* next */ }
  }
  if (!logo) {
    const svg = inlineHeaderSvg($);
    if (svg) { const b = Buffer.from(svg); logo = await putObject(objectKey(bid, 'logo', 'svg'), b, 'image/svg+xml'); logoCols = await logoColors(b, 'image/svg+xml'); }
  }
  const css = await cssColors($, origin);
  const cand = [...css.primary, ...logoCols, ...css.secondary, ...css.any].filter(c => !neutral(c));
  const primary = css.primary.find(c => !neutral(c)) || logoCols[0] || cand[0] || null;
  const secondary = [...css.secondary, ...logoCols, ...cand].find(c => !neutral(c) && (!primary || dist(c, primary) > 60)) || null;
  const htmlLang = $('html').attr('lang') || null;
  return { logo, primary, secondary, language: langFromHtml(htmlLang), htmlLang };
}
