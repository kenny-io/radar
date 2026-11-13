
const o = JSON.parse(process.argv[1]);
const chunks = [];
let answered = false;
const answer = (envelope, data) => {
  if (answered) return; answered = true;
  const json = Buffer.from(JSON.stringify(envelope)); const length = Buffer.alloc(4); length.writeUInt32BE(json.length);
  process.stdout.write(Buffer.concat(data ? [length, json, data] : [length, json]), () => process.exit(0));
};
const reply = (head, data) => answer({ head }, data);
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  let createCanvas, loadImage, img;
  try { ({ createCanvas, loadImage } = require('@napi-rs/canvas')); } catch (e) { return answer({ fault: 'unavailable' }); }
  try { img = await loadImage(Buffer.concat(chunks)); } catch (e) { return answer({ fault: 'not_loaded' }); }
  try {

    const c = createCanvas(o.w, o.h); const ctx = c.getContext('2d');
    const s = Math.max(o.w / img.width, o.h / img.height); const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (o.w - dw) / 2, (o.h - dh) / 2, dw, dh);
    reply({}, c.toBuffer('image/png'));

  } catch (e) { answer({ fault: 'work_failed' }); }
});
