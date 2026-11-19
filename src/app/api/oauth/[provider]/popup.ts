import { oauthFlow, oauthReturnKey, publicOAuthResult, type OAuthResult } from '@/lib/oauthReturn';

/** Return public grant references only; the same-origin fallback survives an OAuth provider severing window.opener. */
export function popupResult(provider: string, payload: OAuthResult, flow?: string) {
  const nonce = oauthFlow(flow);
  const msg = JSON.stringify({ type: 'radar-oauth', provider, ...publicOAuthResult(payload), ...(nonce ? { flow: nonce } : {}) }).replace(/</g, '\\u003c');
  const key = JSON.stringify(nonce ? oauthReturnKey(nonce) : null);
  const html = `<!doctype html><meta charset="utf-8"><title>Radar</title><body style="font-family:system-ui;padding:24px;color:#444">${payload.ok ? 'Sign-in received. Return to Radar to finish connecting.' : 'Sign-in could not be completed. Return to Radar and try again.'}<script>(function(){var message=Object.assign(${msg},{at:Date.now()}),key=${key};try{if(window.opener)window.opener.postMessage(message,location.origin)}catch(e){}if(key){try{var channel=new BroadcastChannel(key);channel.postMessage(message);setTimeout(function(){channel.close()},200)}catch(e){}try{localStorage.setItem(key,JSON.stringify(message));localStorage.removeItem(key)}catch(e){}}setTimeout(function(){window.close()},300)})()</script></body>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
