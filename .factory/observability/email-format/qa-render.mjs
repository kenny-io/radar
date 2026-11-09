import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('.factory/observability/email-format');
const names = ['test', 'credit-failure', 'fallback', 'long-diagnostics'];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];
await fs.mkdir(path.join(root, 'screenshots'), { recursive: true });
try {
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [960, 320, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme, reducedMotion: 'reduce' });
      await context.route(/^https?:/, route => route.abort());
      const page = await context.newPage();
      for (const name of names) {
        const html = await fs.readFile(path.join(root, 'previews', name + '.html'), 'utf8');
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const result = await page.evaluate(() => {
          const rgb = value => { const values = value.match(/[\d.]+/g)?.map(Number); return values?.length >= 3 ? [...values.slice(0, 3), values[3] ?? 1] : [255, 255, 255, 1]; };
          const luminance = color => color.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
          const composite = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3])).concat(1);
          const background = element => {
            const layers = []; let current = element;
            while (current) { const color = rgb(getComputedStyle(current).backgroundColor); layers.push(color); if (color[3] === 1) break; current = current.parentElement; }
            return layers.reverse().reduce((back, front) => composite(front, back), [255, 255, 255, 1]);
          };
          const failures = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node; let minContrast = 100;
          while (node = walker.nextNode()) {
            if (!node.textContent.trim()) continue;
            const el = node.parentElement, style = getComputedStyle(el), rect = el.getBoundingClientRect();
            if (rect.width <= 1 || rect.height <= 1 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || Number.parseFloat(style.fontSize) < 5) continue;
            const bg = background(el), fg = composite(rgb(style.color), bg);
            const a = luminance(fg), b = luminance(bg), ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
            minContrast = Math.min(minContrast, ratio);
            const size = Number.parseFloat(style.fontSize), bold = Number.parseInt(style.fontWeight) >= 700;
            const required = size >= 24 || size >= 18.66 && bold ? 3 : 4.5;
            if (ratio + .02 < required) failures.push({ text: node.textContent.trim().slice(0,80), ratio: Number(ratio.toFixed(2)), required, color: style.color, background: bg.slice(0,3), fontSize: style.fontSize });
          }
          return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, heading: document.querySelector('h1')?.textContent, h1Count: document.querySelectorAll('h1').length, lang: document.documentElement.lang, tableCount: document.querySelectorAll('table').length, presentationTableCount: document.querySelectorAll('table[role="presentation"]').length, bodyBackground: getComputedStyle(document.body).backgroundColor, scripts: document.querySelectorAll('script').length, eventAttributes: [...document.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name)).map(a => a.name)), minContrast: Number(minContrast.toFixed(2)), contrastFailures: failures };
        });
        results.push({ fixture: name, colorScheme, width, ...result });
        const capture = colorScheme === 'light' && (width === 960 || width === 320 && ['test','long-diagnostics'].includes(name) || width === 375 && name === 'credit-failure') || colorScheme === 'dark' && (width === 960 && ['test','credit-failure'].includes(name) || width === 375 && name === 'long-diagnostics');
        if (capture) await page.screenshot({ path: path.join(root, 'screenshots', `${name}-${colorScheme}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(root, 'qa-render-results.json'), JSON.stringify(results, null, 2) + '\n');
}
for (const result of results) {
  assert(result.scrollWidth <= result.width + 1, `Horizontal overflow: ${result.fixture}/${result.colorScheme}/${result.width}`);
  assert.equal(result.h1Count, 1, 'One clear semantic h1 required');
  assert.equal(result.lang, 'en');
  assert.equal(result.tableCount, result.presentationTableCount, 'Layout tables should be presentational');
  assert.equal(result.scripts, 0, 'Email should not contain scripts');
  assert.equal(result.eventAttributes.length, 0, 'Email should not contain event-handler attributes');
  assert.equal(result.contrastFailures.length, 0, `Text contrast failures: ${result.fixture}/${result.colorScheme}/${result.width}: ${JSON.stringify(result.contrastFailures)}`);
}
console.log(JSON.stringify({ pass: true, renderedCases: results.length, fixtures: names, viewports: [960,320,375], colorSchemes: ['light','dark'], evidence: root }, null, 2));
