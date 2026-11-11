/** Small process-local read cache. Concurrent readers share an in-flight load; errors are never cached. */
export function coalescedReads<T>(load: (key: string) => Promise<T>, ttlMs = 1000, maxEntries = 512) {
  const entries = new Map<string, { expires: number; pending: boolean; value: Promise<T> }>();
  return (key: string): Promise<T> => {
    const now = Date.now();
    const cached = entries.get(key);
    if (cached && (cached.pending || cached.expires > now)) return cached.value;
    // Never evict an in-flight read: that would allow duplicate queries under load.
    for (const [k, e] of entries) if (!e.pending && e.expires <= now) entries.delete(k);
    if (entries.size >= maxEntries) {
      const oldest = [...entries].find(([, e]) => !e.pending);
      if (oldest) entries.delete(oldest[0]);
      else return Promise.reject(new Error('Read capacity reached'));
    }
    const entry: { expires: number; pending: boolean; value: Promise<T> } = { expires: now + ttlMs, pending: true, value: Promise.resolve(null as T) };
    entry.value = Promise.resolve().then(() => load(key)).then(value => {
      entry.pending = false;
      entry.expires = Date.now() + ttlMs;
      return value;
    }, error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return entry.value;
  };
}
