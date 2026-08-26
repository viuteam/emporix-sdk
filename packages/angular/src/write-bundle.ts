import { inject, signal, type Signal } from "@angular/core";
import { injectQueryClient } from "@tanstack/angular-query-experimental";
import { auth, type AuthContext, type EmporixStorage } from "@viu/emporix-sdk";
import { EMPORIX_STORAGE } from "./tokens";

/**
 * Resolve the auth context for a write from whatever token is stored right now.
 *
 * Read at call time, not at construction: a bundle injected while the shopper was
 * a guest must send the customer token once they sign in, and a bundle held by a
 * long-lived component outlives the session it was created in.
 */
export const ctxFor = (storage: EmporixStorage): AuthContext => {
  const token = storage.getCustomerToken();
  return token !== null ? auth.customer(token) : auth.anonymous();
};

export interface WriteBundle {
  /** True while any write from this bundle is in flight. */
  isPending: Signal<boolean>;
  /** The last write's failure, cleared when the next one starts. */
  error: Signal<Error | null>;
  /** Runs `work`, then invalidates the bundle's keys. Rethrows after recording. */
  write: <T>(work: (ctx: AuthContext) => Promise<T>) => Promise<T>;
}

/**
 * The shared write path behind every mutation injectable.
 *
 * One place owns the three things a component needs from a write — is it in
 * flight, did it fail, and is the cache now stale — so the bundles cannot drift
 * on any of them.
 *
 * Invalidation runs only on success. A failed write left the server state alone,
 * and re-fetching to establish that costs a billed call for an answer we already
 * have. The error is recorded on `error()` *and* rethrown: a component that only
 * renders state reads the signal, one that needs to branch after the call awaits
 * it, and swallowing the rejection would break the second.
 */
export function writeBundle(keys: readonly (readonly string[])[]): WriteBundle {
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const qc = injectQueryClient();
  const isPending = signal(false);
  const error = signal<Error | null>(null);

  return {
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),
    write: async <T>(work: (ctx: AuthContext) => Promise<T>): Promise<T> => {
      error.set(null);
      isPending.set(true);
      try {
        const result = await work(ctxFor(storage));
        for (const key of keys) await qc.invalidateQueries({ queryKey: [...key] });
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        error.set(err);
        throw err;
      } finally {
        isPending.set(false);
      }
    },
  };
}
