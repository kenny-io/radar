// The idle stop with the real thirty seconds: a caller reads once, then stays alive doing nothing for 34 s, then reads
// again. When did the first reader go, and does the second read get a new one?
import { spawn } from 'node:child_process';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const child = spawn(path.join(process.cwd(), 'node_modules/.bin/tsx'), [path.join(here, 'life-child.mjs'), 'wait-idle-again', '34000'], { stdio: ['ignore', 'pipe', 'inherit'] });
let first = 0, readAt = 0, goneAfter = null, out = ''; const rows = [];
child.stdout.on('data', d => { out += d; let nl; while ((nl = out.indexOf('\n')) >= 0) { const row = JSON.parse(out.slice(0, nl)); out = out.slice(nl + 1); rows.push(row); if (row.reader && !first) { first = row.reader; readAt = row.t; } } });
const poll = setInterval(() => { if (first && goneAfter === null && !alive(first)) goneAfter = Date.now() - readAt; }, 20);
child.on('exit', code => { clearInterval(poll); const again = rows.find(r => r.again); console.log(JSON.stringify({ firstReader: first, firstReaderGoneMsAfterItsLastRead: goneAfter, callerSawItAliveAt34s: rows.find(r => r.waited)?.readerAlive, secondRead: again ? `${again.again} pages` : 'none', secondReader: again?.reader, newReader: again ? again.reader !== first : null, callerExit: code })); });
