'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn } from '@/components/ui';

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
type TurnstileWindow = Window & { turnstile?: TurnstileApi };
let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  const win = window as TurnstileWindow;
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.defer = true;
    const fail = () => { clearTimeout(timer); script.remove(); scriptPromise = undefined; reject(new Error('human_check_unavailable')); };
    const timer = window.setTimeout(fail, 15000);
    script.onload = () => { clearTimeout(timer); if (win.turnstile) resolve(win.turnstile); else fail(); };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Only the server can enable the development stub. Production still validates every token itself. */
export function Turnstile({ siteKey, devStubs = false, resetKey = 0, onToken }: { siteKey: string; devStubs?: boolean; resetKey?: number; onToken: (token: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken); callback.current = onToken;
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    callback.current(''); setError(''); setReady(false);
    if (devStubs) { callback.current('development-only-human-check'); setReady(true); return; }
    if (!siteKey) return;
    let disposed = false, widget: string | undefined, api: TurnstileApi | undefined;
    loadTurnstile().then(loaded => {
      if (disposed || !root.current) return;
      api = loaded;
      const failed = () => { if (!disposed) { callback.current(''); setError('The security check couldn’t finish. Try it again.'); } };
      try {
        widget = api.render(root.current, {
          sitekey: siteKey, action: 'turnstile-spin-v2', theme: 'auto', size: 'flexible',
          callback: (token: string) => { if (!disposed) { callback.current(token); setError(''); } },
          'expired-callback': () => { if (!disposed) { callback.current(''); setError('The security check expired. Try it again.'); } },
          'error-callback': failed, 'timeout-callback': failed,
        });
        setReady(true);
      } catch { failed(); }
    }).catch(() => { if (!disposed) setError('The security check couldn’t load. Check your connection and try again.'); });
    return () => { disposed = true; if (widget && api) { try { api.remove(widget); } catch { /* A completed navigation can already have removed the iframe. */ } } };
  }, [siteKey, devStubs, resetKey, retry]);
  if (devStubs) return null;
  if (!siteKey) return <p className="small" role="status">The security check is temporarily unavailable. Try again later, or use Google from sign in.</p>;
  return <div className="col" style={{ gap: 8, width: '100%', minWidth: 0 }}>
    <div ref={root} data-action="turnstile-spin-v2" aria-label="Security check" style={{ minHeight: 65, width: '100%' }} />
    {!ready && !error && <p className="xs sub" role="status">Loading security check…</p>}
    {error && <><p className="small" role="alert" style={{ color: 'var(--bad)' }}>{error}</p><Btn size="sm" onClick={() => setRetry(n => n + 1)}>Retry security check</Btn></>}
  </div>;
}
