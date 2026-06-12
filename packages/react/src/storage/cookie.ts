import {
  createListenerSet,
  parseAnonymousSession,
  type EmporixStorage,
  type EmporixStorageKey,
} from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_TOKEN_NAME = "emporix.customerToken";
const CART_NAME = "emporix.cartId";
const ANON_NAME = "emporix.anonymousSession";
const SITE_NAME = "emporix.siteCode";
const LANGUAGE_NAME = "emporix.language";
const ACTIVE_LE_NAME = "emporix.activeLegalEntityId";
const REFRESH_NAME = "emporix.refreshToken";

/**
 * Cookie-backed store. `Secure` defaults to on for https origins; override
 * with `secure: false` only for non-https dev setups. Consumer must still pick
 * an appropriate `sameSite` for CSRF safety.
 */
export function createCookieStorage(
  opts: { name?: string; secure?: boolean; sameSite?: "lax" | "strict" | "none" } = {},
): EmporixStorage {
  const tokenName = opts.name ?? DEFAULT_TOKEN_NAME;
  const sameSite = opts.sameSite ?? "lax";
  // Default: Secure on https origins. Tokens must not ride plain-http
  // cookies in production; localhost/http dev keeps working without opts.
  const secure =
    opts.secure ?? (typeof location !== "undefined" && location.protocol === "https:");
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
  const all = createListenerSet<EmporixStorageKey>();
  return {
    getCustomerToken: () => readCookie(tokenName),
    setCustomerToken: (t) => {
      writeCookie(tokenName, t);
      all.notify("customerToken");
    },
    getCartId: () => readCookie(CART_NAME),
    setCartId: (id) => {
      writeCookie(CART_NAME, id);
      all.notify("cartId");
    },
    getAnonymousSession: () => parseAnonymousSession(readCookie(ANON_NAME)),
    setAnonymousSession: (s) => {
      writeCookie(
        ANON_NAME,
        s === null
          ? null
          : JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
      );
      all.notify("anonymousSession");
    },
    getSiteCode: () => readCookie(SITE_NAME),
    setSiteCode: (code) => {
      writeCookie(SITE_NAME, code);
      all.notify("siteCode");
    },
    getLanguage: () => readCookie(LANGUAGE_NAME),
    setLanguage: (l) => {
      writeCookie(LANGUAGE_NAME, l);
      all.notify("language");
    },
    getActiveLegalEntityId: () => readCookie(ACTIVE_LE_NAME),
    setActiveLegalEntityId: (id) => {
      writeCookie(ACTIVE_LE_NAME, id);
      all.notify("activeLegalEntityId");
    },
    getRefreshToken: () => readCookie(REFRESH_NAME),
    setRefreshToken: (t) => {
      writeCookie(REFRESH_NAME, t);
      all.notify("refreshToken");
    },
    subscribeAll: (l) => all.add(l),
  };
}
