// Test-only: an in-memory stand-in for next/headers cookies(), one Map per simulated browser. No app code imports this.
//   const H = vi.hoisted(() => ({ jar: new Map<string, string>() }));
//   vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));
export function cookieStore(m: Map<string, string>) {
  return {
    get: (name: string) => (m.has(name) ? { name, value: m.get(name)! } : undefined),
    getAll: () => [...m].map(([name, value]) => ({ name, value })),
    has: (name: string) => m.has(name),
    set: (name: string, value: string) => { m.set(name, value); },
    delete: (name: string) => { m.delete(name); },
  };
}
export const headersMock = (current: () => Map<string, string>) => ({
  cookies: async () => cookieStore(current()),
  headers: async () => new Headers(),
});
