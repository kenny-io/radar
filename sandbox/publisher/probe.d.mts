// Types for probe.mjs, so Radar's TypeScript tests can import the runner script.
export declare const PROXY_BASE_PATH: string;
export declare const PROXY_HEALTH_ROUTE: string;
export declare const PROXY_URL_VARIABLE: string;
export declare const CANARY_HOSTS: readonly string[];
export interface ProbeTiming { healthWindowMs: number; healthAttemptMs: number; healthPauseMs: number; canaryMs: number }
export declare const PROBE_TIMING: Readonly<ProbeTiming>;
export declare function resolveHealthUrl(value: unknown): { health: string; hostname: string } | null;
export declare function connectThroughProxy(proxy: URL, host: string, timeoutMs: number): Promise<number | null>;
export declare function runProbe(options?: {
  environment?: Record<string, string | undefined>;
  fetchImpl?: (url: string, init: RequestInit) => Promise<{ status: number; body?: { cancel(): Promise<void> } | null }>;
  connectImpl?: (proxy: URL, host: string, timeoutMs: number) => Promise<number | null>;
  timing?: ProbeTiming;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ ok: boolean; line: string }>;
