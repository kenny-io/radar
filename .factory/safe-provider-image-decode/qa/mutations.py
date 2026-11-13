#!/usr/bin/env python3
"""Would the engineer's tests notice if the protection were removed?

Each deliberate breakage is applied to a SCRATCH copy of the revision under test (never to the worktree), the
engineer's test file is run there unedited, and the copy is restored.

  mkdir <scratch>/mut && git archive 0d2739c1 | tar -x -C <scratch>/mut && ln -s "$PWD/node_modules" <scratch>/mut/node_modules
  python3 .factory/safe-provider-image-decode/qa/mutations.py <scratch>/mut <out.json> [name ...]

A breakage that makes the decoder run inside the test process can end that process (that is the defect): vitest then
reports an error or exits without a summary, which counts as noticed.
"""
import json, re, subprocess, sys, pathlib, time

root = pathlib.Path(sys.argv[1]); out_file = sys.argv[2]; only = sys.argv[3:]
target = root / 'src/server/services/images.ts'
pristine = target.read_text()
assert 'decodeInChild(raw, CROP' in pristine, 'not the revision under test'

OLD_BODY = """  const { loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(raw);
  const c = createCanvas(w, h); const ctx = c.getContext('2d');
  const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c.toBuffer('image/png');
"""
IN_PROCESS = "(async () => { const { loadImage } = await import('@napi-rs/canvas'); const img = await loadImage(raw); const c = createCanvas(w, h); const ctx = c.getContext('2d'); const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s; ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh); return { data: c.toBuffer('image/png') }; })()"

def sub(old, new, count=1):
    def f(s):
        assert old in s, 'pattern not found: ' + old[:60]
        return s.replace(old, new, count)
    return f

def whole_body(s):
    a = s.index('export async function coverCrop('); a = s.index('\n', a) + 1; b = s.index('\n}\n', a) + 1
    return s[:a] + OLD_BODY + s[b:]

MUTATIONS = {
    'M01 decode in this process again (the base body of coverCrop)': whole_body,
    'M02 no completeness check (a cut-short file reaches the child)': sub("  if (!probe.complete) throw refusedPicture('the file is cut short');\n", ''),
    'M03 no animated check': sub("  if (probe.animated) throw refusedPicture('it is animated');\n", ''),
    'M04 no pixel-limit check': sub("  if (overPixelLimits(probe)) throw refusedPicture('it is larger than the decoder is given');\n", ''),
    'M05 no zero-size check': sub("  if (!(probe.width > 0 && probe.height > 0)) throw refusedPicture('it has no size');\n", ''),
    'M06 the child answer is not checked': sub("  if (!made || made.type !== 'image/png' || !made.complete || made.width !== w || made.height !== h) throw refusedPicture('the decoder did not answer with the crop');\n", ''),
    'M07 the answer is checked for type only, not size or completeness': sub("if (!made || made.type !== 'image/png' || !made.complete || made.width !== w || made.height !== h)", "if (!made || made.type !== 'image/png')"),
    'M08 decoder unavailable: fall back to decoding in this process': sub(".catch(error => { throw error instanceof ImageRefused ? refusedPicture(`the decoder could not read it (${error.reason})`) : error; });", ".catch(error => { if (error instanceof ImageRefused) throw refusedPicture(`the decoder could not read it (${error.reason})`); return " + IN_PROCESS + "; });"),
    'M09 child refused the picture: try once more in this process': sub(".catch(error => { throw error instanceof ImageRefused ? refusedPicture(`the decoder could not read it (${error.reason})`) : error; });", ".catch(error => { if (!(error instanceof ImageRefused)) throw error; return " + IN_PROCESS + "; });"),
    'M10 refusals are RadarErrors': sub("const refusedPicture = (why: string) => new Error(`The image model's picture was refused: ${why}`);", "const refusedPicture = (why: string) => new RadarError(`The image model's picture was refused: ${why}`, 502, 'image_failed');"),
    'M11 the crop is drawn from the top left, not centred': sub("ctx.drawImage(img, (o.w - dw) / 2, (o.h - dh) / 2, dw, dh);", "ctx.drawImage(img, 0, 0, dw, dh);"),
    'M12 the crop is scaled to fit inside, not to fill': sub("const s = Math.max(o.w / img.width, o.h / img.height);", "const s = Math.min(o.w / img.width, o.h / img.height);"),
    'M13 an unknown type is refused by accident (a TypeError from the next line) instead of by the check': sub("  if (!probe) throw refusedPicture('it is not a PNG, JPEG or WebP');\n  if (!probe.complete) throw refusedPicture('the file is cut short');\n  if (probe.animated) throw refusedPicture('it is animated');\n  if (!(probe.width > 0 && probe.height > 0)) throw refusedPicture('it has no size');\n", "  if (probe) {\n  if (!probe.complete) throw refusedPicture('the file is cut short');\n  if (probe.animated) throw refusedPicture('it is animated');\n  if (!(probe.width > 0 && probe.height > 0)) throw refusedPicture('it has no size');\n  }\n"),
    'M19 bytes of an unknown type are not refused: SVG, GIF, AVIF and HTML go to the child': sub("  if (!probe) throw refusedPicture('it is not a PNG, JPEG or WebP');\n  if (!probe.complete) throw refusedPicture('the file is cut short');\n  if (probe.animated) throw refusedPicture('it is animated');\n  if (!(probe.width > 0 && probe.height > 0)) throw refusedPicture('it has no size');\n  // Before any decode: the decoder allocates the whole bitmap on load, so a small file declaring a huge size is stopped here.\n  if (overPixelLimits(probe)) throw refusedPicture('it is larger than the decoder is given');\n", "  if (probe) {\n  if (!probe.complete) throw refusedPicture('the file is cut short');\n  if (probe.animated) throw refusedPicture('it is animated');\n  if (!(probe.width > 0 && probe.height > 0)) throw refusedPicture('it has no size');\n  if (overPixelLimits(probe)) throw refusedPicture('it is larger than the decoder is given');\n  }\n"),
    'M14 the refusal message quotes the file': sub("  if (!probe) throw refusedPicture('it is not a PNG, JPEG or WebP');", "  if (!probe) throw refusedPicture('it is not a PNG, JPEG or WebP: ' + raw.toString('latin1', 0, 400));"),
    'M15 decoder unavailable is reported as a refused picture': sub(".catch(error => { throw error instanceof ImageRefused ? refusedPicture(`the decoder could not read it (${error.reason})`) : error; });", ".catch(() => { throw refusedPicture('the decoder could not read it'); });"),
    'M16 the time limit is 10 minutes and the output limit 2 GB': sub("const CROP_LIMITS = { timeoutMs: 20_000, maxOutput: 32 * 1024 * 1024 };", "const CROP_LIMITS = { timeoutMs: 600_000, maxOutput: 2 * 1024 * 1024 * 1024 };"),
    'M17 the provider picture is put in the child arguments': sub("await decodeInChild(raw, CROP, { w, h }, CROP_LIMITS)", "await decodeInChild(raw, CROP, { w, h, head: raw.toString('base64', 0, 64) }, CROP_LIMITS)"),
    'M18 the pixel limit applies to the long side only': sub("  if (overPixelLimits(probe)) throw refusedPicture('it is larger than the decoder is given');\n", "  if (probe.width > 10_000 || probe.height > 10_000) throw refusedPicture('it is larger than the decoder is given');\n"),
}

results = []
for name, mutate in MUTATIONS.items():
    if only and not any(name.startswith(o) for o in only): continue
    target.write_text(mutate(pristine))
    t = time.time()
    try:
        p = subprocess.run(['npx', 'vitest', 'run', 'src/server/services/images.safeDecode.test.ts'], cwd=root, capture_output=True, text=True, timeout=900)
        text = re.sub(r'\x1b\[[0-9;]*m', '', p.stdout + p.stderr); code = p.returncode
    except subprocess.TimeoutExpired as e:
        text = (e.stdout or b'').decode() if isinstance(e.stdout, bytes) else (e.stdout or ''); code = 'timeout'
    finally:
        target.write_text(pristine)
    tests = re.search(r'^\s*Tests\s+(.*)$', text, re.M); failed = re.findall(r'^\s*[×✗]\s+(.*)$', text, re.M)
    errors = re.findall(r'(Unhandled Error|Worker exited unexpectedly|SIGSEGV|Segmentation fault|ERR_IPC_CHANNEL_CLOSED|Channel closed|terminated|Error: .*exited)', text)
    noticed = code != 0
    results.append({'mutation': name, 'noticed': noticed, 'exit': code, 'summary': tests.group(1).strip() if tests else None, 'failedTests': len(failed), 'firstFailed': [f[:150] for f in failed[:4]], 'processErrors': sorted(set(errors))[:4], 'seconds': round(time.time() - t)})
    print(('NOTICED ' if noticed else 'SURVIVED') + ' | ' + name + ' | exit ' + str(code) + ' | ' + (tests.group(1).strip() if tests else 'no summary line') + (' | ' + ', '.join(sorted(set(errors))[:3]) if errors else ''), flush=True)
assert target.read_text() == pristine
json.dump(results, open(out_file, 'w'), indent=1)
