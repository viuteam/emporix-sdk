import type { EmporixStorage, PersistedAnonymousSession } from "./index";

/** In-memory token store. Default, SSR-safe, no persistence. */
export function createMemoryStorage(opts: { initial?: string } = {}): EmporixStorage {
  let token: string | null = opts.initial ?? null;
  let cartId: string | null = null;
  let anon: PersistedAnonymousSession | null = null;
  let siteCode: string | null = null;
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
    getCartId: () => cartId,
    setCartId: (id) => {
      cartId = id;
    },
    getAnonymousSession: () => anon,
    setAnonymousSession: (s) => {
      anon = s;
    },
    getSiteCode: () => siteCode,
    setSiteCode: (code) => {
      siteCode = code;
    },
  };
}
