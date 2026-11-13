#!/bin/bash
# What one crop cost before (inside the calling process) and what the child costs now (time and peak memory).
#   bash .factory/safe-provider-image-decode/qa/cost.sh <corpus dir>
# The child's program is evidence/child-program.js, captured from a real coverCrop call by paths.qa.test.ts.
# Run from the worktree root (the child resolves @napi-rs/canvas from the working directory, as in production).
C="$1"; E=.factory/safe-provider-image-decode/qa/evidence
echo "== before: the base's coverCrop inside one warm process, 30 crops of each file (ms: median)"
node -e '
const { createCanvas, loadImage } = require("@napi-rs/canvas"); const fs = require("fs");
async function coverCrop(raw, w, h) { const img = await loadImage(raw); const c = createCanvas(w, h); const ctx = c.getContext("2d"); const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s; ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh); return c.toBuffer("image/png"); }
(async () => { for (const f of process.argv.slice(1)) { const raw = fs.readFileSync(f); const ms = []; for (let i = 0; i < 30; i++) { const t = performance.now(); await coverCrop(raw, 1200, 628); ms.push(performance.now() - t); } ms.sort((a, b) => a - b); console.log("  " + f.split("/").pop().padEnd(28), Math.round(ms[15]) + " ms", " process peak " + Math.round(process.resourceUsage().maxRSS / 1024) + " MB so far"); } })();
' "$C/good/canvas-1536x1024.png" "$C/good/canvas-1536x1024.jpg" "$C/good/canvas-1536x1024.webp" "$C/good/canvas-2048x2048.png" "$C/limits/real-5000x5000.png"
echo "== now: one child per crop (the captured program), wall time and peak resident memory of that child"
for f in good/canvas-1536x1024.png good/canvas-1536x1024.jpg good/canvas-1536x1024.webp good/canvas-2048x2048.png limits/real-5000x5000.png limits/real-5000x5000.jpg limits/real-10000x2500.png limits/jpeg-declares-5000x5000.jpg limits/png-declares-10000x2500-crc-ok.png limits/webp-vp8l-declares-5000x5000-noise.webp bad/png-idat-zlib-bomb.png limits/webp-vp8x-canvas-8x8-inner-12000x9000.webp bad/brief-png-no-idat.png; do
  for size in '{"w":1200,"h":628}'; do
    out=$( { /usr/bin/time -l node -e "$(cat $E/child-program.js)" "$size" < "$C/$f" > /dev/null; } 2>&1 )
    real=$(echo "$out" | awk '/real/ {print $1}'); rss=$(echo "$out" | awk '/maximum resident set size/ {printf "%d", $1/1048576}')
    echo "  $(printf '%-52s' "$f") ${real}s  peak ${rss} MB"
  done
done
