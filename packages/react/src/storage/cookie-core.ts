import {
  parseAnonymousSession,
  type EmporixStorage,
  type EmporixStorageKey,
} from "./index";

/**
 * The eight persisted session keys, as cookie names. Single source of truth —
 * both the browser backend (`./cookie`) and the server backend (`./server`)
 * read and write through these.
 */
export const COOKIE_NAMES = {
  customerToken: "emporix.customerToken",
  cartId: "emporix.cartId",
  anonymousSession: "emporix.anonymousSession",
  siteCode: "emporix.siteCode",
  language: "emporix.language",
  activeLegalEntityId: "emporix.activeLegalEntityId",
  refreshToken: "emporix.refreshToken",
  saasToken: "emporix.saasToken",
} as const;

/** Backend-agnostic cookie accessor. `set` absent means the storage is read-only. */
export interface CookieIo {
  get(name: string): string | null;
  /** `null` deletes the cookie. */
  set?(name: string, value: string | null): void;
}

/**
 * Builds an {@link EmporixStorage} over a cookie accessor. Contains the whole
 * name-to-accessor mapping so no backend repeats it.
 *
 * `opts.notify` is a callback rather than a flag so this module stays free of
 * listener-set lifetime: the browser backend owns a `createListenerSet`, passes
 * its `notify` here, and attaches `subscribeAll` to the result itself. This
 * function never sets `subscribeAll` — the server backend therefore has none,
 * which is correct: a server render has no lifetime to observe.
 */
export function createCookieBackedStorage(
  io: CookieIo,
  opts: { tokenName?: string; notify?: (key: EmporixStorageKey) => void } = {},
): EmporixStorage {
  const tokenName = opts.tokenName ?? COOKIE_NAMES.customerToken;
  const notify = opts.notify;

  // Read-only mode: warn once per key so a genuine bug surfaces, but a render
  // loop cannot flood the log.
  const warned = new Set<EmporixStorageKey>();
  const write = (name: string, value: string | null, key: EmporixStorageKey): void => {
    if (io.set === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[emporix] storage is read-only; ignoring write to "${key}". ` +
            "Provide a `set` accessor to enable writes (e.g. from a Server Action).",
        );
      }
      return;
    }
    io.set(name, value);
    notify?.(key);
  };

  return {
    getCustomerToken: () => io.get(tokenName),
    setCustomerToken: (t) => write(tokenName, t, "customerToken"),

    getCartId: () => io.get(COOKIE_NAMES.cartId),
    setCartId: (id) => write(COOKIE_NAMES.cartId, id, "cartId"),

    getAnonymousSession: () => parseAnonymousSession(io.get(COOKIE_NAMES.anonymousSession)),
    setAnonymousSession: (s) =>
      write(
        COOKIE_NAMES.anonymousSession,
        s === null
          ? null
          : JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
        "anonymousSession",
      ),

    getSiteCode: () => io.get(COOKIE_NAMES.siteCode),
    setSiteCode: (code) => write(COOKIE_NAMES.siteCode, code, "siteCode"),

    getLanguage: () => io.get(COOKIE_NAMES.language),
    setLanguage: (l) => write(COOKIE_NAMES.language, l, "language"),

    getActiveLegalEntityId: () => io.get(COOKIE_NAMES.activeLegalEntityId),
    setActiveLegalEntityId: (id) =>
      write(COOKIE_NAMES.activeLegalEntityId, id, "activeLegalEntityId"),

    getRefreshToken: () => io.get(COOKIE_NAMES.refreshToken),
    setRefreshToken: (t) => write(COOKIE_NAMES.refreshToken, t, "refreshToken"),

    getSaasToken: () => io.get(COOKIE_NAMES.saasToken),
    setSaasToken: (t) => write(COOKIE_NAMES.saasToken, t, "saasToken"),
  };
}
