import {
  createListenerSet,
  parseAnonymousSession,
  type EmporixStorage,
  type EmporixStorageKey,
} from "./index";
import { STORAGE_KEYS } from "./keys";

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
  const tokenKey = opts.key ?? STORAGE_KEYS.customerToken;
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
    getCartId: () => storage.getItem(STORAGE_KEYS.cartId),
    setCartId: (id) => {
      if (id === null) storage.removeItem(STORAGE_KEYS.cartId);
      else storage.setItem(STORAGE_KEYS.cartId, id);
      all.notify("cartId");
    },
    getAnonymousSession: () => parseAnonymousSession(storage.getItem(STORAGE_KEYS.anonymousSession)),
    setAnonymousSession: (s) => {
      if (s === null) storage.removeItem(STORAGE_KEYS.anonymousSession);
      else
        storage.setItem(
          STORAGE_KEYS.anonymousSession,
          JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
        );
      all.notify("anonymousSession");
    },
    getSiteCode: () => storage.getItem(STORAGE_KEYS.siteCode),
    setSiteCode: (code) => {
      if (code === null) storage.removeItem(STORAGE_KEYS.siteCode);
      else storage.setItem(STORAGE_KEYS.siteCode, code);
      all.notify("siteCode");
    },
    getLanguage: () => storage.getItem(STORAGE_KEYS.language),
    setLanguage: (l) => {
      if (l === null) storage.removeItem(STORAGE_KEYS.language);
      else storage.setItem(STORAGE_KEYS.language, l);
      all.notify("language");
    },
    getActiveLegalEntityId: () => storage.getItem(STORAGE_KEYS.activeLegalEntityId),
    setActiveLegalEntityId: (id) => {
      if (id === null) storage.removeItem(STORAGE_KEYS.activeLegalEntityId);
      else storage.setItem(STORAGE_KEYS.activeLegalEntityId, id);
      all.notify("activeLegalEntityId");
    },
    getRefreshToken: () => storage.getItem(STORAGE_KEYS.refreshToken),
    setRefreshToken: (t) => {
      if (t === null) storage.removeItem(STORAGE_KEYS.refreshToken);
      else storage.setItem(STORAGE_KEYS.refreshToken, t);
      all.notify("refreshToken");
    },
    getSaasToken: () => storage.getItem(STORAGE_KEYS.saasToken),
    setSaasToken: (t) => {
      if (t === null) storage.removeItem(STORAGE_KEYS.saasToken);
      else storage.setItem(STORAGE_KEYS.saasToken, t);
      all.notify("saasToken");
    },
    subscribeAll: (l) => all.add(l),
  };
}
