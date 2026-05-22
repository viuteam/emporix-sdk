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
}

/** Minimal subset of `AnonymousSession` that needs to outlive a page load. */
export interface PersistedAnonymousSession {
  refreshToken: string;
  sessionId: string;
}

/** Backward-compat alias. New code should prefer `EmporixStorage`. */
export type TokenStorage = EmporixStorage;

export { createMemoryStorage } from "./memory";
export { createLocalStorageStorage } from "./local-storage";
export { createCookieStorage } from "./cookie";
