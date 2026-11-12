// QA-2, D3: is `sanitizeDiagnostic` byte-identical for every caller that does not ask for a longer limit?
// Run in two checkouts and compare the output:
//   QA_FAKE_API_KEY=qa-env-secret-value-0123456789 node --import tsx <path to this file>      (cwd = the checkout)
// Prints one digest over the whole corpus and one line per case (length and digest; never the text).
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { sanitizeDiagnostic } = await import(pathToFileURL(path.resolve('src/server/observability/failures.ts')).href);
const secret = process.env.QA_FAKE_API_KEY || '';
const words = n => Array.from({ length: n }, (_u, i) => `w${i}`).join(' ');
const corpus = [
  undefined, null, 42, {}, '', 'x', 'short message',
  words(300).slice(0, 1599), words(300).slice(0, 1600), words(300).slice(0, 1601), words(2000), 'x'.repeat(5000),
  `fetch https://user:pw@example.test:8443/api/invites/abc123?token=zzz#frag failed`, `see ${'postgres' + '://u:p@db.internal:5432/app'} and http://plain.test/path` /* placeholder, assembled */,
  `Authorization: Bearer abc.def.ghi and Basic dXNlcjpwYXNz`, `set-cookie: session=abc; Path=/\nnext line`, `key ${'sk-' + 'ant-api03-ABCDEFGHIJKLMNOP'} and re_12345678abcd and whsec_abcdefgh1234` /* a placeholder, assembled so that no key-shaped literal sits in this file */,
  `{"api_key":"abc","password": "pw", "secret":'s', access_token=tok}`, `prompt: write me a poem\nmessages = [1,2,3]\ncontent: body`, `Structured output failed validation: {"a":1}\nmore`,
  `image data:image/png;base64,${'QUJD'.repeat(50)} end`, `env secret ${secret} and encoded ${encodeURIComponent(secret + '/+ ')}`,
  words(400) + ` late secret ${secret} and Bearer late.token.value and https://late.example.test/x?y=1`,
  `${'a'.repeat(1590)} https://cut.example.test/across/the/limit?q=1`, `${'b'.repeat(1595)} Bearer abcdefghijklmnop`, '\u0000\u0007control\u001fchars\u007f', 'ünïcödé — “quotes” 🙂 '.repeat(120),
];
const rows = corpus.map(value => { const out = sanitizeDiagnostic(value); return `${String(out.length).padStart(5)} ${createHash('sha256').update(out).digest('hex').slice(0, 16)}`; });
console.log(createHash('sha256').update(rows.join('\n')).digest('hex'));
console.log(rows.join('\n'));
