// Dedicated loop in the existing worker process: recovery mail never waits for AI/analysis job slots or cron hooks.
import { dispatchLifecycleBatch, type DispatchOptions } from './dispatch';
export interface LifecycleLoopOptions {
  dispatch?: (options: DispatchOptions) => Promise<{ processed: number; blocked?: string }>;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
export function startLifecycleDispatcher(options: LifecycleLoopOptions = {}) {
  const controller = new AbortController();
  const dispatch = options.dispatch || dispatchLifecycleBatch, idle = options.pause || pause;
  const done = (async () => {
    while (!controller.signal.aborted) {
      let blocked = false;
      try {
        const result = await dispatch({ limit: 10, signal: controller.signal, shouldStop: () => controller.signal.aborted });
        blocked = !!result.blocked;
      } catch { blocked = true; console.error('[lifecycle] dispatcher iteration failed; durable queue retained'); }
      if (!controller.signal.aborted) await idle(blocked ? 30_000 : 1000, controller.signal);
    }
  })();
  return { stop: async () => { controller.abort(); await done; } };
}
