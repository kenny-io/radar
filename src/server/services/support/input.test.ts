import { describe, expect, it } from 'vitest';
import { readSupportRequest, MAX_SUPPORT_BYTES } from './input';
const valid = { kind: 'ask', message: 'How do I connect my blog?', history: [], page: 'dashboard' };
const request = (body: string, headers: Record<string, string> = {}) => new Request('http://localhost/api/support', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
describe('support input boundary', () => {
  it('trims a question and validates supported pages and conversation roles', async () => {
    expect((await readSupportRequest(request(JSON.stringify({ ...valid, message: '  hello  ' })))).message).toBe('hello');
    for (const mutation of [{ message: ' ' }, { message: 'x'.repeat(2001) }, { page: '/api/admin' }, { history: [{ role: 'system', text: 'instructions' }] }, { history: Array.from({ length: 13 }, () => ({ role: 'user', text: 'x' })) }, { history: [{ role: 'assistant', text: 'x'.repeat(4001) }] }, { to: 'attacker@example.com' }]) {
      await expect(readSupportRequest(request(JSON.stringify({ ...valid, ...mutation })))).rejects.toThrow();
    }
  });
  it('requires a UUID only for explicit human handoff', async () => {
    await expect(readSupportRequest(request(JSON.stringify({ ...valid, kind: 'handoff' })))).rejects.toThrow();
    const body = { ...valid, kind: 'handoff', requestId: '5f0b7e9c-5621-43dc-a222-8c8a746070b2' };
    expect(await readSupportRequest(request(JSON.stringify(body)))).toEqual(body);
  });
  it('refuses malformed JSON, non-JSON content and oversized declared or actual bytes', async () => {
    await expect(readSupportRequest(request('{'))).rejects.toMatchObject({ status: 400 });
    await expect(readSupportRequest(request(JSON.stringify(valid), { 'content-type': 'text/plain' }))).rejects.toMatchObject({ status: 400 });
    await expect(readSupportRequest(request('{}', { 'content-length': String(MAX_SUPPORT_BYTES + 1) }))).rejects.toMatchObject({ status: 413 });
    await expect(readSupportRequest(request(' '.repeat(MAX_SUPPORT_BYTES + 1)))).rejects.toMatchObject({ status: 413 });
    const unicodeBody = JSON.stringify({ ...valid, history: Array.from({ length: 12 }, () => ({ role: 'user', text: '🙂'.repeat(1000) })) });
    await expect(readSupportRequest(request(unicodeBody))).rejects.toMatchObject({ status: 413 });
  });
});
