// Prints the JSON lines of reads.mjs as a table.   node summ.mjs <file.jsonl>...
import fs from 'node:fs';
for (const f of process.argv.slice(2)) for (const l of fs.readFileSync(f, 'utf8').trim().split('\n')) {
  let r; try { r = JSON.parse(l); } catch { console.log('RAW', l.slice(0, 200)); continue; }
  if (r.done || r.skipped || r.unhandledRejection || r.uncaughtException) { console.log(l); continue; }
  console.log([(r.kind || '').padEnd(7), r.name.slice(0, 66).padEnd(66), String(r.mb ?? r.documentMb).padStart(5), String(r.ms).padStart(5), r.outcome.replace('The document could not be read: ', '').replace('PageUnreadable', 'PU').slice(0, 30).padEnd(30), 'late', String(r.lateMs).padStart(6), 'ans', String(r.answerMb).padStart(7), 'rdr', String(r.readerRssMb).padStart(4), 'clr', String(r.callerRssMb).padStart(4)].join(' '));
}
