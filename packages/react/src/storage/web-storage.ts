import {
  createListenerSet,
  parseAnonymousSession,
  type EmporixStorage,
  type EmporixStorageKey,
} from "./index";

const DEFAULT_TOKEN_KEY = "emporix.customerToken";
const CART_KEY = "emporix.cartId";
const ANON_KEY = "emporix.anonymousSession";
const SITE_KEY = "emporix.siteCode";
const LANGUAGE_KEY = "emporix.language";
const ACTIVE_LE_KEY = "emporix.activeLegalEntityId";
const REFRESH_KEY = "emporix.refreshToken";
const SAAS_KEY = "emporix.saasToken";

/**
 * Internal: build an {@link EmporixStorage} backed by any Web `Storage`
 * instance (`localStorage` or `sessionStorage`). Both share the identical
 * `getItem`/`setItem`/`removeItem` surface, so the 8-key wiring lives here once.
 * Callers own the availability check + memory fallback before delegating.
 */
export function fromWebStorage(
  storage: Storage,
  opts: { key?: string } = {},
): EmporixStorage {
  const tokenKey = opts.key ?? DEFAULT_TOKEN_KEY;
  const tokenListeners = new Set<(t: string | null) => void>();
  const all = createListenerSet<EmporixStorageKey>();
  return {
    getCustomerToken: () => storage.getItem(tokenKey),
    setCustomerToken: (t) => {
      if (t === null) storage.removeItem(tokenKey);
      else storage.setItem(tokenKey, t);
      for (const l of tokenListeners) l(t);
      all.notify("customerToken");
    },
    subscribe: (l) => {
      tokenListeners.add(l);
      return () => tokenListeners.delete(l);
    },
    getCartId: () => storage.getItem(CART_KEY),
    setCartId: (id) => {
      if (id === null) storage.removeItem(CART_KEY);
      else storage.setItem(CART_KEY, id);
      all.notify("cartId");
    },
    getAnonymousSession: () => parseAnonymousSession(storage.getItem(ANON_KEY)),
    setAnonymousSession: (s) => {
      if (s === null) storage.removeItem(ANON_KEY);
      else
        storage.setItem(
          ANON_KEY,
          JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
        );
      all.notify("anonymousSession");
    },
    getSiteCode: () => storage.getItem(SITE_KEY),
    setSiteCode: (code) => {
      if (code === null) storage.removeItem(SITE_KEY);
      else storage.setItem(SITE_KEY, code);
      all.notify("siteCode");
    },
    getLanguage: () => storage.getItem(LANGUAGE_KEY),
    setLanguage: (l) => {
      if (l === null) storage.removeItem(LANGUAGE_KEY);
      else storage.setItem(LANGUAGE_KEY, l);
      all.notify("language");
    },
    getActiveLegalEntityId: () => storage.getItem(ACTIVE_LE_KEY),
    setActiveLegalEntityId: (id) => {
      if (id === null) storage.removeItem(ACTIVE_LE_KEY);
      else storage.setItem(ACTIVE_LE_KEY, id);
      all.notify("activeLegalEntityId");
    },
    getRefreshToken: () => storage.getItem(REFRESH_KEY),
    setRefreshToken: (t) => {
      if (t === null) storage.removeItem(REFRESH_KEY);
      else storage.setItem(REFRESH_KEY, t);
      all.notify("refreshToken");
    },
    getSaasToken: () => storage.getItem(SAAS_KEY),
    setSaasToken: (t) => {
      if (t === null) storage.removeItem(SAAS_KEY);
      else storage.setItem(SAAS_KEY, t);
      all.notify("saasToken");
    },
    subscribeAll: (l) => all.add(l),
  };
}
