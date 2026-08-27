/**
 * The session-persistence contract and its two framework-free implementations
 * now live in `@viu/emporix-sdk` (`core/session-storage.ts`) — none of it was a
 * React concern, and `@viu/emporix-sdk-next` needed exactly this to stop
 * depending on the React bindings. Re-exported here unchanged: these names have
 * always been part of this package's public surface.
 *
 * The browser backends followed them there once `@viu/emporix-sdk-angular`
 * needed the same ones — `localStorage` is not a React API either. This file is
 * now purely a barrel: it defines nothing, so there is nothing here that can
 * drift from what another binding writes.
 */
export type {
  EmporixStorage,
  EmporixStorageKey,
  PersistedAnonymousSession,
  TokenStorage,
} from "@viu/emporix-sdk";
export { parseAnonymousSession, createListenerSet } from "@viu/emporix-sdk";

export { createMemoryStorage } from "./memory";
export { createLocalStorage, createLocalStorageStorage } from "./local-storage";
export { createSessionStorage } from "./session-storage";
export { createCookieStorage } from "./cookie";
