import type { TokenStorage } from "./index";

/** In-memory token store. Default, SSR-safe, no persistence. */
export function createMemoryStorage(opts: { initial?: string } = {}): TokenStorage {
  let token: string | null = opts.initial ?? null;
  const listeners = new Set<(t: string | null) => void>();
  return {
    getCustomerToken: () => token,
    setCustomerToken: (t) => {
      token = t;
      for (const l of listeners) l(token);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
