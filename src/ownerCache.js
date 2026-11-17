/**
 * Remembers the owner's role IDs per guild so a busy channel does not
 * call the Discord REST API on every role mention.
 * Falsy results are not stored: a missing guild is retried next time.
 */
export function createOwnerCache({ ttlMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
  const entries = new Map();

  return {
    async get(key, fetcher) {
      const time = now();
      const hit = entries.get(key);
      if (hit && time - hit.at < ttlMs) return hit.value;
      const value = await fetcher();
      if (value) entries.set(key, { at: time, value });
      return value;
    },
    size() {
      return entries.size;
    },
  };
}
