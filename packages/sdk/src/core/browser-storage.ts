/**
 * The browser session-storage backends: memory, localStorage, sessionStorage,
 * document.cookie.
 *
 * The contract and the framework-free backends live in `./session-storage`;
 * these are the ones that need browser globals. They were in
 * `@viu/emporix-sdk-react` until `@viu/emporix-sdk-angular` needed them too —
 * `localStorage` is not a React API, and duplicating a storage backend per
 * binding means two of them writing subtly different values under the same key.
 *
 * Every export is a named factory and the package sets `sideEffects: false`, so
 * a Node consumer that imports none of them bundles none of them. That is
 * asserted by `scripts/check-treeshake.mjs`.
 */
import {
  createCookieBackedStorage,
  parseAnonymousSession,
  type EmporixStorage,
  type PersistedAnonymousSession,
} from "./session-storage";
import { STORAGE_KEYS, type EmporixStorageKey } from "./session-keys";

/**
 * The three methods these backends use from a Web `Storage`.
 *
 * Declared locally on purpose. This package compiles with `lib: ["ES2022"]` and
 * no `"DOM"` — that is the invariant which keeps the SDK runnable on Node, edge
 * runtimes and workers, and adding DOM to the lib to satisfy this one file would
 * switch that compile-time guard off for all ~60 services. So every browser
 * global below is reached through a narrowed `globalThis` instead of an ambient
 * declaration, which is also the pattern the localStorage and sessionStorage
 * availability checks already used before this code moved here.
 */
export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Narrowed view of the browser globals these backends touch. */
interface BrowserGlobals {
  localStorage?: WebStorageLike;
  sessionStorage?: WebStorageLike;
  document?: { cookie: string };
  location?: { protocol: string };
}

const browser = globalThis as unknown as BrowserGlobals;

/**
 * Internal: create a swallow-on-throw listener set used by all the storage
 * backends for `subscribeAll`. Centralizes the try/catch wrapper so a buggy
 * telemetry handler never breaks a storage write.
 */
export function createListenerSet<T>(): {
  add(l: (value: T) => void): () => void;
  notify(value: T): void;
} {
  const listeners = new Set<(v: T) => void>();
  return {
    add(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    notify(value) {
      for (const l of listeners) {
        try {
          l(value);
        } catch {
          // Swallow handler errors; telemetry must never break writes.
        }
      }
    },
  };
}

/** In-memory token store. Default, SSR-safe, no persistence. */
export function createMemoryStorage(opts: { initial?: string } = {}): EmporixStorage {
  let token: string | null = opts.initial ?? null;
  let cartId: string | null = null;
  let anon: PersistedAnonymousSession | null = null;
  let siteCode: string | null = null;
  let language: string | null = null;
  let activeLegalEntityId: string | null = null;
  let refreshToken: string | null = null;
  let saasToken: string | null = null;
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
    getLanguage: () => language,
    setLanguage: (l) => {
      language = l;
      all.notify("language");
    },
    getActiveLegalEntityId: () => activeLegalEntityId,
    setActiveLegalEntityId: (id) => {
      activeLegalEntityId = id;
      all.notify("activeLegalEntityId");
    },
    getRefreshToken: () => refreshToken,
    setRefreshToken: (t) => {
      refreshToken = t;
      all.notify("refreshToken");
    },
    getSaasToken: () => saasToken,
    setSaasToken: (t) => {
      saasToken = t;
      all.notify("saasToken");
    },
    subscribeAll: (l) => all.add(l),
  };
}

/**
 * Internal: build an {@link EmporixStorage} backed by any Web `Storage`
 * instance (`localStorage` or `sessionStorage`). Both share the identical
 * `getItem`/`setItem`/`removeItem` surface, so the 8-key wiring lives here once.
 * Callers own the availability check + memory fallback before delegating.
 */
export function fromWebStorage(
  storage: WebStorageLike,
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
    getAnonymousSession: () =>
      parseAnonymousSession(storage.getItem(STORAGE_KEYS.anonymousSession)),
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

/**
 * Browser `localStorage`-backed store: persistent and shared across tabs.
 * Falls back to memory on the server (or when localStorage is unavailable).
 */
export function createLocalStorage(opts: { key?: string } = {}): EmporixStorage {
  const store = browser.localStorage;
  if (store === undefined) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] localStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  return fromWebStorage(store, opts);
}

/** @deprecated Use {@link createLocalStorage}. Kept for backward compatibility. */
export const createLocalStorageStorage = createLocalStorage;

/**
 * Browser `sessionStorage`-backed store: per-tab persistence that survives a
 * reload but is cleared when the tab closes and is not shared across tabs.
 * Falls back to memory on the server (or when sessionStorage is unavailable).
 */
export function createSessionStorage(opts: { key?: string } = {}): EmporixStorage {
  const store = browser.sessionStorage;
  if (store === undefined) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] sessionStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  return fromWebStorage(store, opts);
}

/**
 * Cookie-backed store. `Secure` defaults to on for https origins; override
 * with `secure: false` only for non-https dev setups. Consumer must still pick
 * an appropriate `sameSite` for CSRF safety.
 */
export function createCookieStorage(
  opts: { name?: string; secure?: boolean; sameSite?: "lax" | "strict" | "none" } = {},
): EmporixStorage {
  const sameSite = opts.sameSite ?? "lax";
  // Default: Secure on https origins. Tokens must not ride plain-http
  // cookies in production; localhost/http dev keeps working without opts.
  const secure = opts.secure ?? browser.location?.protocol === "https:";
  const doc = browser.document;
  if (doc === undefined) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] document unavailable; cookie storage falling back to in-memory");
    return createMemoryStorage();
  }
  const attrs = `path=/; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
  const all = createListenerSet<EmporixStorageKey>();
  const storage = createCookieBackedStorage(
    {
      get: (name) => {
        for (const part of doc.cookie.split("; ")) {
          const [k, ...v] = part.split("=");
          if (k === name) return decodeURIComponent(v.join("=")) || null;
        }
        return null;
      },
      set: (name, value) => {
        doc.cookie =
          value === null
            ? `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attrs}`
            : `${name}=${encodeURIComponent(value)}; ${attrs}`;
      },
    },
    {
      ...(opts.name !== undefined ? { tokenName: opts.name } : {}),
      notify: (key) => all.notify(key),
    },
  );
  return { ...storage, subscribeAll: (l) => all.add(l) };
}
