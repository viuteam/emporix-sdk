import type { TokenStorage } from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_KEY = "emporix.customerToken";

/** Browser `localStorage`-backed store. Falls back to memory on the server. */
export function createLocalStorageStorage(opts: { key?: string } = {}): TokenStorage {
  const key = opts.key ?? DEFAULT_KEY;
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] localStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  const ls = (globalThis as unknown as { localStorage: Storage }).localStorage;
  const listeners = new Set<(t: string | null) => void>();
  return {
    getCustomerToken: () => ls.getItem(key),
    setCustomerToken: (t) => {
      if (t === null) ls.removeItem(key);
      else ls.setItem(key, t);
      for (const l of listeners) l(t);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
