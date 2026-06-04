import type { EmporixStorage } from "../../storage";

/**
 * The three session tokens the customer session tracks. `token` is mirrored
 * from persistent storage; `refreshToken` and `saasToken` are in-memory only
 * (deliberately never persisted).
 */
export interface CustomerSessionState {
  token: string | null;
  refreshToken: string | null;
  saasToken: string | null;
}

export interface CustomerSessionStore {
  getSnapshot: () => CustomerSessionState;
  setState: (
    next: CustomerSessionState | ((prev: CustomerSessionState) => CustomerSessionState),
  ) => void;
  subscribe: (listener: () => void) => () => void;
}

// One store per storage instance. The storage object is the stable per-app
// identity (a WeakMap lets it be GC'd with the app; each test gets a fresh
// storage → a fresh isolated store).
const stores = new WeakMap<EmporixStorage, CustomerSessionStore>();

/**
 * Shared in-memory store for the customer session, keyed by the storage
 * instance. Every `useCustomerSession()` consumer reads/writes the same store,
 * so a login in one component (e.g. the auth form) is visible to another
 * (e.g. the checkout page) — without this, the in-memory `saasToken` lived in
 * a single component's `useState` and customer checkout would 401 elsewhere.
 */
export function getCustomerSessionStore(storage: EmporixStorage): CustomerSessionStore {
  const existing = stores.get(storage);
  if (existing) return existing;

  let state: CustomerSessionState = {
    token: storage.getCustomerToken(),
    refreshToken: null,
    saasToken: null,
  };
  const listeners = new Set<() => void>();
  const store: CustomerSessionStore = {
    getSnapshot: () => state,
    setState: (next) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: CustomerSessionState) => CustomerSessionState)(state)
          : next;
      if (resolved === state) return;
      state = resolved;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  stores.set(storage, store);
  return store;
}
