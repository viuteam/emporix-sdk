import {
  parseAnonymousSession,
  type EmporixStorage,
  type EmporixStorageKey,
} from "./index";
import { STORAGE_KEYS } from "./keys";

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
  const tokenName = opts.tokenName ?? STORAGE_KEYS.customerToken;
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

    getCartId: () => io.get(STORAGE_KEYS.cartId),
    setCartId: (id) => write(STORAGE_KEYS.cartId, id, "cartId"),

    getAnonymousSession: () => parseAnonymousSession(io.get(STORAGE_KEYS.anonymousSession)),
    setAnonymousSession: (s) =>
      write(
        STORAGE_KEYS.anonymousSession,
        s === null
          ? null
          : JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
        "anonymousSession",
      ),

    getSiteCode: () => io.get(STORAGE_KEYS.siteCode),
    setSiteCode: (code) => write(STORAGE_KEYS.siteCode, code, "siteCode"),

    getLanguage: () => io.get(STORAGE_KEYS.language),
    setLanguage: (l) => write(STORAGE_KEYS.language, l, "language"),

    getActiveLegalEntityId: () => io.get(STORAGE_KEYS.activeLegalEntityId),
    setActiveLegalEntityId: (id) =>
      write(STORAGE_KEYS.activeLegalEntityId, id, "activeLegalEntityId"),

    getRefreshToken: () => io.get(STORAGE_KEYS.refreshToken),
    setRefreshToken: (t) => write(STORAGE_KEYS.refreshToken, t, "refreshToken"),

    getSaasToken: () => io.get(STORAGE_KEYS.saasToken),
    setSaasToken: (t) => write(STORAGE_KEYS.saasToken, t, "saasToken"),
  };
}
