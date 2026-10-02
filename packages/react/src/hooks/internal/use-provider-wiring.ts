import { createContext, useEffect, useLayoutEffect, useRef } from "react";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../../storage/index";

// React 18 warns about useLayoutEffect in a server render. A server render never
// commits, so the plain effect it falls back to there never runs either.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The host's `initialCustomerToken` under `customerSession: "external"`, straight
 * from the prop; `undefined` otherwise. Render-time token readers prefer it to
 * the stored copy, which a changed token reaches only after the render (see
 * below). Reading storage, the render that rotates the token would run on the
 * outgoing one, and so would every request it starts — on a tenant switch that
 * is every query, since the tenant is part of every key.
 */
export const HostTokenContext = createContext<string | undefined>(undefined);

interface ProviderWiringArgs {
  client: EmporixClient;
  /** Resolved storage (the `storage` prop or the provider's memory fallback). */
  storage: EmporixStorage;
  initialCustomerToken?: string;
  /** See `EmporixProviderProps.customerSession`. Always resolved by the provider. */
  customerSession: "owned" | "external";
}

/**
 * Idempotent wiring that must precede the children's first fetch effects:
 * (1) attach the storage-backed anonymous-session adapter to the SDK token
 * provider, (2) seed — and in external mode re-seed — the customer token.
 *
 * Done during render with ref guards, not in an effect. A `useState` lazy
 * initializer runs once per component INSTANCE and silently skips re-wiring on
 * prop swaps; a `useEffect` runs AFTER the children fetch. The first seed into a
 * storage is therefore a render-phase side effect, deliberately: it must be
 * visible to the children on their first render, and it is idempotent.
 *
 * Only the first, though. Nothing in the tree subscribes to a storage before the
 * provider commits with it — every subscription is an effect — so that write
 * notifies no one. After the commit the token readers, the company bootstrap and
 * the telemetry source listen, and the same write during render would update
 * them while this provider renders, which React rejects. A later change (an
 * external-mode rotation, an owned-mode seed into a slot a logout emptied) is
 * therefore written in a layout effect: after the render, before paint, with the
 * readers re-rendering synchronously. External-mode readers do not even wait for
 * it — see {@link HostTokenContext}.
 */
export function useProviderWiring({
  client,
  storage,
  initialCustomerToken,
  customerSession,
}: ProviderWiringArgs): void {
  const wiredRef = useRef<{ client: EmporixClient; storage: EmporixStorage } | null>(null);
  if (wiredRef.current?.client !== client || wiredRef.current?.storage !== storage) {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => storage.getAnonymousSession(),
      write: (s) => storage.setAnonymousSession(s),
    });
    wiredRef.current = { client, storage };
  }

  const seededRef = useRef<{ storage: EmporixStorage; token: string } | null>(null);
  const committedRef = useRef<EmporixStorage | null>(null);
  const seed = (): void => {
    if (
      initialCustomerToken === undefined ||
      (seededRef.current?.storage === storage && seededRef.current?.token === initialCustomerToken)
    ) {
      return;
    }
    const stored = storage.getCustomerToken();
    // "owned": seed only into an empty slot — a live session must never be
    // clobbered by a stale SSR-provided token.
    // "external": the host owns the token, so a changed prop wins.
    const shouldWrite =
      customerSession === "external" ? stored !== initialCustomerToken : stored === null;
    if (shouldWrite) storage.setCustomerToken(initialCustomerToken);
    seededRef.current = { storage, token: initialCustomerToken };
  };

  if (committedRef.current !== storage) seed();
  useIsomorphicLayoutEffect(() => {
    committedRef.current = storage;
    seed();
  });
}
