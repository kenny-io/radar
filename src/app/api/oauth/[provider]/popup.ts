/** Tiny page that hands the result back to the window that opened the popup, then closes. */
export function popupResult(provider: string, payload: { ok: boolean; result?: any; error?: string }) {
  const msg = JSON.stringify({ type: 'radar-oauth', provider, ...payload }).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><title>Radar</title><body style="font-family:system-ui;padding:24px;color:#444">${payload.ok ? 'Connected. You can close this window.' : 'Access wasn’t granted. You can close this window.'}<script>try{window.opener&&window.opener.postMessage(${msg},location.origin)}catch(e){};setTimeout(function(){window.close()},150)</script></body>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
