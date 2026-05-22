import {
  createListenerSet,
  type EmporixStorage,
  type EmporixStorageKey,
  type PersistedAnonymousSession,
} from "./index";

/** In-memory token store. Default, SSR-safe, no persistence. */
export function createMemoryStorage(opts: { initial?: string } = {}): EmporixStorage {
  let token: string | null = opts.initial ?? null;
  let cartId: string | null = null;
  let anon: PersistedAnonymousSession | null = null;
  let siteCode: string | null = null;
  const tokenListeners = new Set<(t: string | null) => void>();
  const all = createListenerSet<EmporixStorageKey>();
  return {
    getCustomerToken: () => token,
    setCustomerToken: (t) => {
      token = t;
      for (const l of tokenListeners) l(token);
      all.notify("customerToken");
    },
    subscribe: (l) => {
      tokenListeners.add(l);
      return () => tokenListeners.delete(l);
    },
    getCartId: () => cartId,
    setCartId: (id) => {
      cartId = id;
      all.notify("cartId");
    },
    getAnonymousSession: () => anon,
    setAnonymousSession: (s) => {
      anon = s;
      all.notify("anonymousSession");
    },
    getSiteCode: () => siteCode,
    setSiteCode: (code) => {
      siteCode = code;
      all.notify("siteCode");
    },
    subscribeAll: (l) => all.add(l),
  };
}
