import {
  createListenerSet,
  parseAnonymousSession,
  type EmporixStorage,
  type EmporixStorageKey,
} from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_TOKEN_KEY = "emporix.customerToken";
const CART_KEY = "emporix.cartId";
const ANON_KEY = "emporix.anonymousSession";
const SITE_KEY = "emporix.siteCode";
const LANGUAGE_KEY = "emporix.language";
const ACTIVE_LE_KEY = "emporix.activeLegalEntityId";
const REFRESH_KEY = "emporix.refreshToken";

/** Browser `localStorage`-backed store. Falls back to memory on the server. */
export function createLocalStorageStorage(opts: { key?: string } = {}): EmporixStorage {
  const tokenKey = opts.key ?? DEFAULT_TOKEN_KEY;
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] localStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  const ls = (globalThis as unknown as { localStorage: Storage }).localStorage;
  const tokenListeners = new Set<(t: string | null) => void>();
  const all = createListenerSet<EmporixStorageKey>();
  return {
    getCustomerToken: () => ls.getItem(tokenKey),
    setCustomerToken: (t) => {
      if (t === null) ls.removeItem(tokenKey);
      else ls.setItem(tokenKey, t);
      for (const l of tokenListeners) l(t);
      all.notify("customerToken");
    },
    subscribe: (l) => {
      tokenListeners.add(l);
      return () => tokenListeners.delete(l);
    },
    getCartId: () => ls.getItem(CART_KEY),
    setCartId: (id) => {
      if (id === null) ls.removeItem(CART_KEY);
      else ls.setItem(CART_KEY, id);
      all.notify("cartId");
    },
    getAnonymousSession: () => parseAnonymousSession(ls.getItem(ANON_KEY)),
    setAnonymousSession: (s) => {
      if (s === null) ls.removeItem(ANON_KEY);
      else ls.setItem(ANON_KEY, JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }));
      all.notify("anonymousSession");
    },
    getSiteCode: () => ls.getItem(SITE_KEY),
    setSiteCode: (code) => {
      if (code === null) ls.removeItem(SITE_KEY);
      else ls.setItem(SITE_KEY, code);
      all.notify("siteCode");
    },
    getLanguage: () => ls.getItem(LANGUAGE_KEY),
    setLanguage: (l) => {
      if (l === null) ls.removeItem(LANGUAGE_KEY);
      else ls.setItem(LANGUAGE_KEY, l);
      all.notify("language");
    },
    getActiveLegalEntityId: () => ls.getItem(ACTIVE_LE_KEY),
    setActiveLegalEntityId: (id) => {
      if (id === null) ls.removeItem(ACTIVE_LE_KEY);
      else ls.setItem(ACTIVE_LE_KEY, id);
      all.notify("activeLegalEntityId");
    },
    getRefreshToken: () => ls.getItem(REFRESH_KEY),
    setRefreshToken: (t) => {
      if (t === null) ls.removeItem(REFRESH_KEY);
      else ls.setItem(REFRESH_KEY, t);
      all.notify("refreshToken");
    },
    subscribeAll: (l) => all.add(l),
  };
}
