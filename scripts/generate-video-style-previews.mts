/** Offline, fixed public fixture. No private input, providers, narration or credentials are used. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { VIDEO_STYLE_IDS } from '../src/lib/videoStyles';
import { videoFrame, carouselFrame } from '../src/server/services/social/media/draw';
import type { Scene, Timeline } from '../src/server/services/social/media/model';

const scene: Scene = {
  id: 'sample', title: 'An item, a check, a result', mainIdea: 'A simple illustrative review: check an item, save its result, then look back at the original.',
  narration: 'An item arrives. Review checks it. The result is saved. Look back at the item.',
  nodes: [{ id: 'item', kind: 'input', label: 'New item' }, { id: 'review', kind: 'process', label: 'Check the item' }, { id: 'result', kind: 'storage', label: 'Saved result', state: 'Illustrative example' }],
  edges: [{ from: 'item', to: 'review', kind: 'flow', label: 'check' }, { from: 'review', to: 'result', kind: 'transform', label: 'save' }], revisit: ['item'],
  cues: [{ kind: 'node', target: 'item', phrase: 'An item arrives.', occurrence: 1 }, { kind: 'node', target: 'review', phrase: 'Review checks it.', occurrence: 1 }, { kind: 'edge', target: 'item->review', phrase: 'Review checks it.', occurrence: 1 }, { kind: 'node', target: 'result', phrase: 'The result is saved.', occurrence: 1 }, { kind: 'edge', target: 'review->result', phrase: 'The result is saved.', occurrence: 1 }, { kind: 'revisit', target: 'item', phrase: 'Look back at the item.', occurrence: 1 }],
};
const timeline: Timeline = { duration: 7.5, scenes: [{ scene, start: .5, end: 6.7, cues: [{ kind: 'node', target: 'item', start: .5, end: 1.6 }, { kind: 'node', target: 'review', start: 1.8, end: 3 }, { kind: 'edge', target: 'item->review', start: 2.1, end: 3.1 }, { kind: 'node', target: 'result', start: 3.3, end: 4.8 }, { kind: 'edge', target: 'review->result', start: 3.6, end: 4.8 }, { kind: 'revisit', target: 'item', start: 5.2, end: 6.7 }] }], captions: [{ start: .5, end: 1.7, text: 'An item arrives.' }, { start: 1.8, end: 3.1, text: 'Review checks it.' }, { start: 3.3, end: 4.9, text: 'The result is saved.' }, { start: 5.2, end: 6.7, text: 'Look back at the item.' }] };
const output = path.join(process.cwd(), 'public/social/video-styles');
await fs.mkdir(output, { recursive: true });
for (const style of VIDEO_STYLE_IDS) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-style-public-'));
  let encoder: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await fs.writeFile(path.join(output, `${style}.jpg`), carouselFrame(scene, 0, 1, style).toBuffer('image/jpeg', 88));
    const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '24', '-vcodec', 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '2', path.join(temp, 'sample.mp4')], { shell: false, stdio: ['pipe', 'ignore', 'pipe'] });
    encoder = ffmpeg; timer = setTimeout(() => ffmpeg.kill('SIGKILL'), 60000);
    ffmpeg.stdin.on('error', () => {});
    let error = ''; ffmpeg.stderr.on('data', b => { error = (error + b).slice(-4000); });
    const exited = new Promise<void>((resolve, reject) => { ffmpeg.on('error', reject); ffmpeg.on('exit', code => code === 0 ? resolve() : reject(new Error(`Preview encode failed: ${error}`))); });
    for (let frame = 0; frame < 180; frame++) await new Promise<void>((resolve, reject) => ffmpeg.stdin.write(videoFrame(timeline, frame / 24, undefined, style).toBuffer('image/jpeg', 88), error => error ? reject(error) : resolve()));
    ffmpeg.stdin.end(); await exited;
    await fs.copyFile(path.join(temp, 'sample.mp4'), path.join(output, `${style}.mp4`));
    console.log(`Rendered public silent preview: ${style}`);
  } finally { if (timer) clearTimeout(timer); if (encoder && encoder.exitCode === null) encoder.kill('SIGKILL'); await fs.rm(temp, { recursive: true, force: true }); }
}
