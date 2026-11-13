#!/bin/bash
# QA fixtures: good logo files in many encodings, made with ImageMagick 7, cwebp/img2webp and jpegtran (not with the
# canvas library the code under test uses). Run from anywhere: bash .factory/safe-logo-decode/qa/gen-good.sh
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)/fx/good"; mkdir -p "$D"; cd "$D"
# The picture: teal field (#0F766E) most of it, a magenta block (#C026D3), a white bar and a near-black bar.
draw() { magick -size "$1" "xc:$2" -fill '#0F766E' -draw "rectangle %[fx:w*0.08],%[fx:h*0.1] %[fx:w*0.62],%[fx:h*0.9]" -fill '#C026D3' -draw "rectangle %[fx:w*0.7],%[fx:h*0.1] %[fx:w*0.92],%[fx:h*0.65]" -fill white -draw "rectangle %[fx:w*0.2],%[fx:h*0.45] %[fx:w*0.5],%[fx:h*0.55]" -fill '#111318' -draw "rectangle %[fx:w*0.7],%[fx:h*0.75] %[fx:w*0.92],%[fx:h*0.85]" "$3"; }
draw 256x128 none PNG32:png-rgba.png
draw 256x128 white PNG24:png-rgb.png
draw 256x128 none -define png:color-type=3 PNG8:png-palette.png 2>/dev/null || magick png-rgba.png PNG8:png-palette.png
magick png-rgba.png -depth 16 -define png:bit-depth=16 -define png:color-type=6 png-16bit.png
magick png-rgba.png -interlace PNG PNG32:png-interlaced.png
magick png-rgb.png -colorspace Gray -define png:color-type=0 png-gray.png
draw 48x48 none PNG32:png-48x48.png
draw 47x47 none PNG32:png-47x47.png
draw 400x48 none PNG32:png-400x48.png
draw 48x400 none PNG32:png-48x400.png
draw 47x400 none PNG32:png-47x400.png
draw 512x512 none PNG32:png-512.png
draw 180x180 white PNG24:apple-180.png
draw 1200x630 white PNG24:og-1200x630.png
magick png-rgb.png -quality 90 -sampling-factor 2x2 -interlace none jpg-baseline.jpg
magick png-rgb.png -quality 90 -interlace Plane jpg-progressive.jpg
magick png-rgb.png -colorspace CMYK -quality 90 jpg-cmyk.jpg
magick png-rgb.png -colorspace Gray -quality 90 jpg-gray.jpg
magick png-rgb.png -quality 90 -sampling-factor 1x1 jpg-444.jpg
jpegtran -arithmetic -outfile jpg-arithmetic.jpg jpg-baseline.jpg 2>/dev/null || true
magick -size 48x100 xc:white -fill '#0F766E' -draw 'rectangle 4,4 43,70' -fill '#C026D3' -draw 'rectangle 4,76 43,95' -quality 92 jpg-48x100-plain.jpg
magick -size 47x100 xc:white -fill '#0F766E' -draw 'rectangle 4,4 42,70' -quality 92 jpg-47x100-plain.jpg
cwebp -quiet -q 85 png-rgb.png -o webp-lossy.webp
cwebp -quiet -lossless png-rgb.png -o webp-lossless.webp
cwebp -quiet -lossless png-rgba.png -o webp-lossless-alpha.webp
cwebp -quiet -q 85 -alpha_q 90 png-rgba.png -o webp-lossy-alpha.webp
magick png-rgba.png -modulate 100,100,160 PNG32:frame2.png
img2webp -lossy -d 200 png-rgba.png frame2.png -o webp-animated.webp
rm -f frame2.png
magick png-rgb.png gif-still.gif
magick -delay 20 png-rgb.png \( png-rgb.png -negate \) -loop 0 gif-animated.gif
magick png-512.png -define icon:auto-resize=128,64,48 ico-multi.ico
magick png-rgb.png BMP3:bmp-24.bmp
# AVIF: this machine's ImageMagick and ffmpeg have no AVIF encoder (ImageMagick silently writes a PNG under the .avif name),
# so this one file is made with the canvas library's encoder. Run from the worktree root so the library resolves.
(cd "$D/../../../../.." && node -e "const { createCanvas } = require('@napi-rs/canvas'); const c = createCanvas(256,128); const g = c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,256,128); g.fillStyle='#0F766E'; g.fillRect(20,13,139,102); g.fillStyle='#C026D3'; g.fillRect(179,13,56,70); require('fs').writeFileSync(process.argv[1], c.toBuffer('image/avif'));" "$D/avif-still.avif")
magick png-rgb.png tiff-still.tiff
ls -la
