import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

export interface FailureContext {
  source: 'action' | 'http' | 'job' | 'cron' | 'ai' | 'image' | 'visibility' | 'publishing' | 'social' | 'brief' | 'autopilot' | 'system';
  operation: string;
  businessId?: string | null; userId?: string | null; ref?: string | null;
  provider?: string; model?: string; attempt?: number; maxAttempts?: number;
  retrying?: boolean; degraded?: boolean; incidentKey?: string;
  jobId?: string; requestId?: string; status?: number; code?: string;
}
export interface FailureEvent {
  id: string; timestamp: string; environment: string; service: string;
  context: FailureContext; rootOperation: string; error: { name: string; message: string; status?: number; code?: string; cause?: string };
  hint: string;
}
interface Held { open: boolean; alerts: Array<() => Promise<void>> }
interface Scope { context: FailureContext; rootOperation: string; seen: WeakSet<object>; id: string; held?: Held }
const scope = new AsyncLocalStorage<Scope>();
let deliveryModule: Promise<typeof import('./delivery')> | undefined;
const defined = (context: Partial<FailureContext>) => Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
const fields = ['source', 'operation', 'businessId', 'userId', 'ref', 'provider', 'model', 'attempt', 'maxAttempts', 'retrying', 'degraded', 'incidentKey', 'jobId', 'requestId', 'status', 'code'] as const;

/** Deliberately excludes payloads, prompts, generated content, headers and request URLs. */
function safeContext(context: FailureContext): FailureContext {
  const out: Record<string, unknown> = {};
  for (const key of fields) {
    const value = context[key];
    if (typeof value === 'string') out[key] = sanitizeDiagnostic(value).slice(0, 200);
    else if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || value === null) out[key] = value;
  }
  return out as unknown as FailureContext;
}

export function sanitizeDiagnostic(value: unknown): string {
  let text = typeof value === 'string' ? value : 'Unknown error';
  for (const [key, secret] of Object.entries(process.env)) {
    if (secret && secret.length >= 5 && /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|AUTHORIZATION/i.test(key)) for (const representation of [secret, encodeURIComponent(secret)]) text = text.split(representation).join('[redacted]');
  }
  text = text.replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s<>"']+/gi, raw => {
    try { const u = new URL(raw); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname.replace(/(\/api\/invites\/)[^/]+/i, '$1[token]').replace(/(\/api\/files\/).*/i, '$1[key]')}${u.search || u.hash || u.username || u.password ? '[redacted]' : ''}`; } catch { return '[redacted URL]'; }
  });
  return text
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [redacted]')
    .replace(/\b(?:set-cookie|cookie)\s*[:=][^\n]+/gi, 'Cookie: [redacted]')
    .replace(/\b(?:sk|rk|re|whsec)[-_][a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .replace(/(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|session(?:[_-]?token)?|password|secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/(["']?(?:prompt|messages|input|output|content|b64_json|document)["']?\s*[:=]\s*)[^\n]+/gi, '$1[omitted]')
    .replace(/Structured output failed validation:[\s\S]*/i, 'Structured output failed validation')
    .replace(/data:[^\s,]+;base64,[a-zA-Z0-9+/=]+/g, '[omitted data]')
    .slice(0, 1600);
}
export function failureAlertsEnabled(): boolean {
  if (process.env.RADAR_DEV_STUBS === '1' && process.env.NODE_ENV !== 'production') return false;
  const flag = process.env.RADAR_FAILURE_ALERTS?.trim().toLowerCase();
  if (flag === 'off' || flag === '0') return false;
  return flag === 'on' || flag === '1' || process.env.NODE_ENV === 'production';
}
export function shouldReportFailure(error: unknown): boolean {
  const e = error as any;
  if (e?.name === 'ZodError') return false;
  // Expected user/access denials aren't service incidents. Provider errors call reportFailure directly.
  return !(typeof e?.userMessage === 'string' && e.status >= 400 && e.status < 500);
}
export function withFailureContext<T>(context: FailureContext, run: () => Promise<T>): Promise<T> {
  const parent = scope.getStore();
  return scope.run({ context: { ...parent?.context, ...defined(context) } as FailureContext, rootOperation: context.source === 'action' || context.source === 'job' ? context.operation : parent?.rootOperation || context.operation, seen: parent?.seen || new WeakSet(), id: parent?.id || randomUUID(), held: parent?.held }, run);
}
/** Hold the current scope's alerts until the caller knows how the work ended. A job attempt that will be retried is
 *  not an operator incident, whatever failed inside it: `settle(false)` drops its alerts (each is already logged) and
 *  `settle(true)` emails them. Reports made after settling are emailed at once. Outside a scope nothing is held. */
export function holdAlerts(): (send: boolean) => Promise<void> {
  const current = scope.getStore();
  if (!current) return async () => {};
  const held: Held = { open: true, alerts: [] }; current.held = held;
  return async send => {
    held.open = false;
    for (const alert of held.alerts.splice(0)) if (send) await alert().catch(e => { try { console.error('[radar.alert.delivery_failed]', sanitizeDiagnostic(e?.message)); } catch { /* never replaces the job's outcome */ } });
  };
}
function statusOf(error: any): number | undefined {
  const value = Number(error?.status || error?.http || error?.statusCode || String(error?.message || '').match(/(?:HTTP\s*|image\s+|Resend\s+)([45]\d\d)/i)?.[1]);
  return value >= 400 && value <= 599 ? value : undefined;
}
function hint(status: number | undefined, message: string): string {
  if (status === 402 || /credit|billing|insufficient_quota|spend.*limit|payment required/i.test(message)) return 'Check the provider account balance, billing and spending limits; replenish credits or use a healthy configured fallback.';
  if (status === 401 || status === 403) return 'Check the provider credentials and permissions; rotate or reconnect the affected integration if needed.';
  if (status === 429) return 'Check provider quota and rate limits; reduce concurrency or request more capacity.';
  if (status && status >= 500 || /timeout|timed out|fetch failed|ECONN|ENOTFOUND|overload|unavailable/i.test(message)) return 'Check the provider status and Radar service/network logs. Existing action retry/failover behavior is preserved.';
  return 'Inspect the correlated operation and service logs. Check integration configuration and retry the failed action when safe.';
}

const eCause = (error: unknown): object | undefined => { const cause = (error as any)?.cause; return cause && typeof cause === 'object' ? cause : undefined; };

/** Immediate, best-effort reporting. It never changes the caller's outcome or recursively reports delivery errors.
 *  Every report is logged; an operator alert goes out only for a failure nothing will retry (`retrying` is not true). */
export async function reportFailure(error: unknown, context: FailureContext): Promise<void> {
  try {
    const current = scope.getStore();
    const object = error && typeof error === 'object' ? error as object : null;
    let cause = eCause(error);
    if (object && current?.seen.has(object)) return;
    for (let depth = 0; cause && depth < 6; depth++, cause = eCause(cause)) if (current?.seen.has(cause)) { if (object) current.seen.add(object); return; }
    // A failure that will be retried or handed to a fallback is logged for diagnosis and never emailed: the system is
    // working as designed. It stays out of `seen` so the report that ends the action still alerts.
    const interim = context.retrying === true;
    if (object && !interim) current?.seen.add(object);
    const e = error as any;
    const merged = safeContext({ ...current?.context, ...defined(context) } as FailureContext);
    const message = e?.name === 'SyntaxError' ? 'Invalid JSON response' : sanitizeDiagnostic(typeof e?.message === 'string' ? e.message : typeof error === 'string' ? error : 'Unknown error');
    const status = context.status || statusOf(e);
    const event: FailureEvent = {
      id: randomUUID(), timestamp: new Date().toISOString(),
      environment: sanitizeDiagnostic(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development'),
      service: sanitizeDiagnostic(process.env.RAILWAY_SERVICE_NAME || (process.argv.some(v => v.includes('worker')) ? 'worker' : 'web')),
      context: merged, rootOperation: sanitizeDiagnostic(current?.rootOperation || context.operation),
      error: { name: sanitizeDiagnostic(e?.name || 'Error'), message, ...(status ? { status } : {}), ...(e?.code || context.code ? { code: sanitizeDiagnostic(String(e?.code || context.code)).slice(0, 120) } : {}), ...(e?.cause ? { cause: e.cause?.name === 'SyntaxError' ? 'Invalid JSON response' : sanitizeDiagnostic(e.cause?.message || String(e.cause)) } : {}) },
      hint: hint(status, message),
    };
    try { console.error('[radar.failure]', JSON.stringify(event)); } catch { /* Logging failure must not block email. */ }
    if (interim || !failureAlertsEnabled()) return;
    // Group explicitly keyed provider incidents for five minutes, never unrelated action failures.
    const identity = merged.incidentKey ? `${event.environment}:${event.service}:${merged.incidentKey}:${Math.floor(Date.now() / 300_000)}` : event.id;
    const key = `radar-failure/${createHash('sha256').update(identity).digest('hex')}`;
    const deliver = async () => { const { persistAndDeliverAlert } = await (deliveryModule ??= import('./delivery')); await persistAndDeliverAlert(event, key); };
    if (current?.held?.open) { current.held.alerts.push(deliver); return; }
    await deliver();
  } catch (deliveryError) {
    try { console.error('[radar.alert.delivery_failed]', sanitizeDiagnostic((deliveryError as any)?.message)); } catch { /* Reporting must never replace the original failure. */ }
  }
}
