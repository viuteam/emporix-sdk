import type { EmporixStorage, PersistedAnonymousSession } from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_TOKEN_NAME = "emporix.customerToken";
const CART_NAME = "emporix.cartId";
const ANON_NAME = "emporix.anonymousSession";
const SITE_NAME = "emporix.siteCode";

type AllKey = "customerToken" | "cartId" | "siteCode" | "anonymousSession";

/** Cookie-backed store. Consumer must set SameSite/Secure for CSRF safety. */
export function createCookieStorage(
  opts: { name?: string; secure?: boolean; sameSite?: "lax" | "strict" | "none" } = {},
): EmporixStorage {
  const tokenName = opts.name ?? DEFAULT_TOKEN_NAME;
  const sameSite = opts.sameSite ?? "lax";
  const secure = opts.secure ?? false;
  if (typeof document === "undefined") {
    // eslint-disable-next-line no-console
    console.warn("[emporix] document unavailable; cookie storage falling back to in-memory");
    return createMemoryStorage();
  }
  const attrs = `path=/; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
  const readCookie = (name: string): string | null => {
    for (const part of document.cookie.split("; ")) {
      const [k, ...v] = part.split("=");
      if (k === name) return decodeURIComponent(v.join("=")) || null;
    }
    return null;
  };
  const writeCookie = (name: string, value: string | null): void => {
    document.cookie =
      value === null
        ? `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attrs}`
        : `${name}=${encodeURIComponent(value)}; ${attrs}`;
  };
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
    getCustomerToken: () => readCookie(tokenName),
    setCustomerToken: (t) => {
      writeCookie(tokenName, t);
      notifyAll("customerToken");
    },
    getCartId: () => readCookie(CART_NAME),
    setCartId: (id) => {
      writeCookie(CART_NAME, id);
      notifyAll("cartId");
    },
    getAnonymousSession: (): PersistedAnonymousSession | null => {
      const raw = readCookie(ANON_NAME);
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
      writeCookie(
        ANON_NAME,
        s === null
          ? null
          : JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
      );
      notifyAll("anonymousSession");
    },
    getSiteCode: () => readCookie(SITE_NAME),
    setSiteCode: (code) => {
      writeCookie(SITE_NAME, code);
      notifyAll("siteCode");
    },
    subscribeAll: (l) => {
      allListeners.add(l);
      return () => allListeners.delete(l);
    },
  };
}
