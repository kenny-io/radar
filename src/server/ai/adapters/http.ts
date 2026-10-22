export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number }): Promise<any> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), init.timeoutMs || 120000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) { const e: any = new Error(`HTTP ${r.status}: ${txt.slice(0, 400)}`); e.status = r.status; e.permanent = r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408; throw e; }
    return txt ? JSON.parse(txt) : {};
  } finally { clearTimeout(t); }
}
/** Iterate server-sent events from a fetch Response. */
export async function* sseEvents(res: Response, onChunk?: () => void): AsyncGenerator<{ event: string | null; data: string }> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    onChunk?.(); // any bytes (including SSE comments) count as activity for idle timeouts
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      let event: string | null = null; const data: string[] = [];
      for (const line of chunk.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trimStart()); }
      if (data.length) yield { event, data: data.join('\n') };
    }
  }
}
