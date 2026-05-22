import type { EmporixStorage, PersistedAnonymousSession } from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_TOKEN_KEY = "emporix.customerToken";
const CART_KEY = "emporix.cartId";
const ANON_KEY = "emporix.anonymousSession";
const SITE_KEY = "emporix.siteCode";

type AllKey = "customerToken" | "cartId" | "siteCode" | "anonymousSession";

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
    getCustomerToken: () => ls.getItem(tokenKey),
    setCustomerToken: (t) => {
      if (t === null) ls.removeItem(tokenKey);
      else ls.setItem(tokenKey, t);
      for (const l of listeners) l(t);
      notifyAll("customerToken");
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCartId: () => ls.getItem(CART_KEY),
    setCartId: (id) => {
      if (id === null) ls.removeItem(CART_KEY);
      else ls.setItem(CART_KEY, id);
      notifyAll("cartId");
    },
    getAnonymousSession: (): PersistedAnonymousSession | null => {
      const raw = ls.getItem(ANON_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedAnonymousSession>;
        if (typeof parsed.refreshToken === "string" && typeof parsed.sessionId === "string") {
          return { refreshToken: parsed.refreshToken, sessionId: parsed.sessionId };
        }
        return null;
      } catch {
        return null;
      }
    },
    setAnonymousSession: (s) => {
      if (s === null) ls.removeItem(ANON_KEY);
      else ls.setItem(ANON_KEY, JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }));
      notifyAll("anonymousSession");
    },
    getSiteCode: () => ls.getItem(SITE_KEY),
    setSiteCode: (code) => {
      if (code === null) ls.removeItem(SITE_KEY);
      else ls.setItem(SITE_KEY, code);
      notifyAll("siteCode");
    },
    subscribeAll: (l) => {
      allListeners.add(l);
      return () => allListeners.delete(l);
    },
  };
}
