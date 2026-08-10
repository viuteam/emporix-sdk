import { useRef } from "react";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../../storage/index";

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
 * prop swaps; a `useEffect` runs AFTER the children fetch. The storage write is
 * therefore a render-phase side effect, deliberately: it must be visible to the
 * children on their first render, and it is idempotent.
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
  if (
    initialCustomerToken !== undefined &&
    (seededRef.current?.storage !== storage || seededRef.current?.token !== initialCustomerToken)
  ) {
    const stored = storage.getCustomerToken();
    // "owned": seed only into an empty slot — a live session must never be
    // clobbered by a stale SSR-provided token.
    // "external": the host owns the token, so a changed prop wins.
    const shouldWrite =
      customerSession === "external" ? stored !== initialCustomerToken : stored === null;
    if (shouldWrite) storage.setCustomerToken(initialCustomerToken);
    seededRef.current = { storage, token: initialCustomerToken };
  }
}
