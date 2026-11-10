import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { useEmporix } from "../../provider";
import { getCustomerSessionStore } from "./customer-session-store";
import { HostTokenContext } from "./use-provider-wiring";

/**
 * Reactive render-time view of the stored customer token. Replaces raw
 * `storage.getCustomerToken()` reads in hook bodies, which (a) never
 * re-rendered on login/logout — `enabled` gates stayed stale until an
 * unrelated re-render — and (b) could tear under concurrent rendering.
 * Server snapshot reads the same store: a server-side memory storage seeded
 * with `initialCustomerToken` must render authenticated markup.
 *
 * Under `customerSession: "external"` and `"proxy"` the provider's value wins
 * over the stored copy — see {@link HostTokenContext}. `null` from it is an
 * answer too ("no customer"), so only `undefined` falls back to storage.
 */
export function useCustomerToken(): string | null {
  const { storage } = useEmporix();
  const hostToken = useContext(HostTokenContext);
  const store = useMemo(() => getCustomerSessionStore(storage), [storage]);
  const getToken = useCallback(() => store.getSnapshot().token, [store]);
  const stored = useSyncExternalStore(store.subscribe, getToken, getToken);
  return hostToken !== undefined ? hostToken : stored;
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
