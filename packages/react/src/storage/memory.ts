import type { EmporixStorage, PersistedAnonymousSession } from "./index";

type AllKey = "customerToken" | "cartId" | "siteCode" | "anonymousSession";

/** In-memory token store. Default, SSR-safe, no persistence. */
export function createMemoryStorage(opts: { initial?: string } = {}): EmporixStorage {
  let token: string | null = opts.initial ?? null;
  let cartId: string | null = null;
  let anon: PersistedAnonymousSession | null = null;
  let siteCode: string | null = null;
  const listeners = new Set<(t: string | null) => void>();
  const allListeners = new Set<(k: AllKey) => void>();
  const notifyAll = (k: AllKey): void => {
    for (const l of allListeners) {
      try {
        l(k);
      } catch {
        // Swallow handler errors; telemetry must never break writes.
      }
    }
  };
  return {
    getCustomerToken: () => token,
    setCustomerToken: (t) => {
      token = t;
      for (const l of listeners) l(token);
      notifyAll("customerToken");
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCartId: () => cartId,
    setCartId: (id) => {
      cartId = id;
      notifyAll("cartId");
    },
    getAnonymousSession: () => anon,
    setAnonymousSession: (s) => {
      anon = s;
      notifyAll("anonymousSession");
    },
    getSiteCode: () => siteCode,
    setSiteCode: (code) => {
      siteCode = code;
      notifyAll("siteCode");
    },
    subscribeAll: (l) => {
      allListeners.add(l);
      return () => allListeners.delete(l);
    },
  };
}
