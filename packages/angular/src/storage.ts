/**
 * Storage backends, re-exported from `@viu/emporix-sdk` so an Angular consumer
 * has one import site for the whole binding.
 *
 * The definitions live in the SDK because they are shared with the React
 * bindings — the same eight keys are cookie names on a server, Web Storage keys
 * in a browser and record fields in a session store, so a copy per binding would
 * mean a session written by one and unreadable by the other.
 */
export {
  createMemoryStorage,
  createLocalStorage,
  createLocalStorageStorage,
  createSessionStorage,
  createCookieStorage,
  createCookieBackedStorage,
  createServerStorage,
  parseAnonymousSession,
  serverAuth,
  STORAGE_KEYS,
} from "@viu/emporix-sdk";
export type {
  CookieIo,
  EmporixStorage,
  EmporixStorageKey,
  PersistedAnonymousSession,
  ServerCookieJar,
  TokenStorage,
} from "@viu/emporix-sdk";
