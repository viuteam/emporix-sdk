import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useEmporix } from "../../provider";
import { getCustomerSessionStore } from "./customer-session-store";

/**
 * Reactive render-time view of the stored customer token. Replaces raw
 * `storage.getCustomerToken()` reads in hook bodies, which (a) never
 * re-rendered on login/logout — `enabled` gates stayed stale until an
 * unrelated re-render — and (b) could tear under concurrent rendering.
 * Server snapshot reads the same store: a server-side memory storage seeded
 * with `initialCustomerToken` must render authenticated markup.
 */
export function useCustomerToken(): string | null {
  const { storage } = useEmporix();
  const store = useMemo(() => getCustomerSessionStore(storage), [storage]);
  const getToken = useCallback(() => store.getSnapshot().token, [store]);
  return useSyncExternalStore(store.subscribe, getToken, getToken);
}

/**
 * Reactive render-time view of the stored cart id. Subscribes to the
 * storage's key-level change feed; storages without `subscribeAll` are
 * non-reactive (unchanged from the previous behavior).
 */
export function useCartId(): string | null {
  const { storage } = useEmporix();
  const subscribe = useCallback(
    (onChange: () => void) =>
      storage.subscribeAll?.((key) => {
        if (key === "cartId") onChange();
      }) ?? (() => {}),
    [storage],
  );
  const getCartId = useCallback(() => storage.getCartId(), [storage]);
  return useSyncExternalStore(subscribe, getCartId, getCartId);
}
