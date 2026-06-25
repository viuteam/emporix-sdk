import { useRef } from "react";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../../storage/index";

interface ProviderWiringArgs {
  client: EmporixClient;
  /** Resolved storage (prop or the memory fallback). Receives the anon-store adapter. */
  storage: EmporixStorage;
  initialCustomerToken?: string;
  /**
   * The original `storage` prop (undefined when the memory fallback is used).
   * The SSR token seed only runs against a caller-supplied storage.
   */
  externalStorage?: EmporixStorage;
}

/**
 * Idempotent wiring that must precede the children's first fetch effects:
 * (1) attach the storage-backed anonymous-session adapter to the SDK token
 * provider, (2) seed the SSR-provided customer token into external storage.
 * Ref-guarded so it re-runs when (client, storage) identity changes — a
 * useState lazy initializer runs once per component INSTANCE and silently
 * skips re-wiring on prop swaps; a useEffect runs AFTER children fetch.
 */
export function useProviderWiring({
  client,
  storage,
  initialCustomerToken,
  externalStorage,
}: ProviderWiringArgs): void {
  const wiredRef = useRef<{ client: EmporixClient; storage: EmporixStorage } | null>(null);
  if (wiredRef.current?.client !== client || wiredRef.current?.storage !== storage) {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => storage.getAnonymousSession(),
      write: (s) => storage.setAnonymousSession(s),
    });
    if (initialCustomerToken && externalStorage && externalStorage.getCustomerToken() === null) {
      externalStorage.setCustomerToken(initialCustomerToken);
    }
    wiredRef.current = { client, storage };
  }
}
