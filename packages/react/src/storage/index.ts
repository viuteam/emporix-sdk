/**
 * The session-persistence contract and its two framework-free implementations
 * now live in `@viu/emporix-sdk` (`core/session-storage.ts`) — none of it was a
 * React concern, and `@viu/emporix-sdk-next` needed exactly this to stop
 * depending on the React bindings. Re-exported here unchanged: these names have
 * always been part of this package's public surface.
 *
 * What is left in this file is what genuinely belongs to a browser: the listener
 * set the Web Storage and cookie backends use for `subscribeAll`, and the
 * backends themselves.
 */
export type {
  EmporixStorage,
  EmporixStorageKey,
  PersistedAnonymousSession,
  TokenStorage,
} from "@viu/emporix-sdk";
export { parseAnonymousSession } from "@viu/emporix-sdk";

/**
 * Internal: create a swallow-on-throw listener set used by all three storage
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

export { createMemoryStorage } from "./memory";
export { createLocalStorage, createLocalStorageStorage } from "./local-storage";
export { createSessionStorage } from "./session-storage";
export { createCookieStorage } from "./cookie";
