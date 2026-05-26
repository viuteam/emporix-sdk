/** Pluggable persistence for SDK session state. SSR-safe by default (memory). */
export interface EmporixStorage {
  // Customer token (unchanged).
  getCustomerToken(): string | null;
  setCustomerToken(token: string | null): void;
  subscribe?(listener: (token: string | null) => void): () => void;

  // Active guest / customer cart id.
  getCartId(): string | null;
  setCartId(id: string | null): void;

  // Anonymous session — used by DefaultTokenProvider (via EmporixProvider
  // wiring) to preserve sessionId across page reloads.
  getAnonymousSession(): PersistedAnonymousSession | null;
  setAnonymousSession(session: PersistedAnonymousSession | null): void;

  // Active site code (MS-2). `null` = no site bound yet.
  getSiteCode(): string | null;
  setSiteCode(code: string | null): void;

  // Active legal entity id (B2B). `null` = B2C mode.
  getActiveLegalEntityId(): string | null;
  setActiveLegalEntityId(id: string | null): void;

  /**
   * Subscribe to any storage write. The listener receives the key that
   * changed. Returns an unsubscribe function. Optional — backends may no-op.
   * Used by the telemetry layer to emit `storage.write` events.
   */
  subscribeAll?(
    listener: (key: EmporixStorageKey) => void,
  ): () => void;
}

/** Minimal subset of `AnonymousSession` that needs to outlive a page load. */
export interface PersistedAnonymousSession {
  refreshToken: string;
  sessionId: string;
}

/** Backward-compat alias. New code should prefer `EmporixStorage`. */
export type TokenStorage = EmporixStorage;

/** Keys that participate in {@link EmporixStorage.subscribeAll}. */
export type EmporixStorageKey =
  | "customerToken"
  | "cartId"
  | "siteCode"
  | "anonymousSession"
  | "activeLegalEntityId";

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

/**
 * Internal: parses a raw `anonymousSession` JSON payload (from localStorage
 * or a cookie) into a {@link PersistedAnonymousSession}. Returns `null` for
 * any malformed or missing input.
 */
export function parseAnonymousSession(raw: string | null): PersistedAnonymousSession | null {
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
}

export { createMemoryStorage } from "./memory";
export { createLocalStorageStorage } from "./local-storage";
export { createCookieStorage } from "./cookie";
