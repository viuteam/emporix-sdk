import {
  assertInInjectionContext,
  DestroyRef,
  inject,
  signal,
  type Injector,
  type Signal,
} from "@angular/core";
import {
  getCustomerSessionStore,
  type EmporixStorage,
  type EmporixStorageKey,
} from "@viu/emporix-sdk";

/**
 * Resolve a `DestroyRef` from an explicit injector or the ambient context.
 *
 * Same contract as TanStack's `injectQuery`: an explicit injector waives the
 * context requirement, otherwise the framework's own error is thrown. `debugFn`
 * is what puts the caller's name in that error, so it has to accept any
 * function shape — `() => void` rejects every real caller.
 */
function destroyRefFrom(
  injector: Injector | undefined,
  debugFn: (...args: never[]) => unknown,
): DestroyRef {
  if (injector !== undefined) return injector.get(DestroyRef);
  assertInInjectionContext(debugFn);
  return inject(DestroyRef);
}

/**
 * A signal over one persisted session key.
 *
 * This is what makes `enabled` gates and cache keys react to login, logout and a
 * site switch. `injectQuery` re-runs its options callback in a reactive context,
 * so reading this signal *inside* that callback re-derives the key and the gate;
 * reading it outside freezes both at creation time.
 *
 * React solves the same problem with `useSyncExternalStore`, and its comment
 * records the failure it fixed: raw `storage.getCustomerToken()` reads in hook
 * bodies "never re-rendered on login/logout — `enabled` gates stayed stale until
 * an unrelated re-render".
 *
 * A storage without `subscribeAll` is non-reactive, matching React's behaviour
 * for the same case.
 */
export function storageSignal<T>(
  storage: EmporixStorage,
  key: EmporixStorageKey,
  read: (s: EmporixStorage) => T,
  opts: { injector?: Injector } = {},
): Signal<T> {
  const value = signal<T>(read(storage));
  const stop = storage.subscribeAll?.((changed) => {
    if (changed === key) value.set(read(storage));
  });
  if (stop !== undefined) {
    destroyRefFrom(opts.injector, storageSignal).onDestroy(stop);
  }
  return value.asReadonly();
}

/**
 * The stored customer token, as a signal.
 *
 * Routed through the shared customer-session store rather than `subscribeAll`,
 * matching React: the store is the one place that also holds the in-memory
 * `refreshToken` and `saasToken`, and it mirrors external token writes from any
 * consumer. One store per storage instance, so a login anywhere is visible
 * everywhere.
 */
export function customerTokenSignal(
  storage: EmporixStorage,
  opts: { injector?: Injector } = {},
): Signal<string | null> {
  const store = getCustomerSessionStore(storage);
  const value = signal<string | null>(store.getSnapshot().token);
  // Resolve the DestroyRef BEFORE subscribing: `assertInInjectionContext`
  // throwing after the subscription would leak the listener it just added.
  const destroyRef = destroyRefFrom(opts.injector, customerTokenSignal);
  destroyRef.onDestroy(store.subscribe(() => value.set(store.getSnapshot().token)));
  return value.asReadonly();
}

/** The active guest-or-customer cart id, as a signal. */
export function cartIdSignal(
  storage: EmporixStorage,
  opts: { injector?: Injector } = {},
): Signal<string | null> {
  return storageSignal(storage, "cartId", (s) => s.getCartId(), opts);
}
