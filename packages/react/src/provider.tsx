import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage/index";
import { createMemoryStorage } from "./storage/memory";

interface EmporixContextValue {
  client: EmporixClient;
  storage: EmporixStorage;
}

const EmporixContext = createContext<EmporixContextValue | null>(null);

/** Props for {@link EmporixProvider}. */
export interface EmporixProviderProps {
  client: EmporixClient;
  queryClient?: QueryClient;
  storage?: EmporixStorage;
  initialCustomerToken?: string;
  children: ReactNode;
}

/** Provides the SDK client, token storage and a react-query client to the tree. */
export function EmporixProvider({
  client,
  queryClient,
  storage,
  initialCustomerToken,
  children,
}: EmporixProviderProps): React.JSX.Element {
  const value = useMemo<EmporixContextValue>(() => {
    const s =
      storage ??
      createMemoryStorage(
        initialCustomerToken !== undefined ? { initial: initialCustomerToken } : {},
      );
    if (initialCustomerToken && storage && storage.getCustomerToken() === null) {
      storage.setCustomerToken(initialCustomerToken);
    }
    return { client, storage: s };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, storage, initialCustomerToken]);
  const qc = useMemo(() => queryClient ?? new QueryClient(), [queryClient]);

  // Idempotent one-time wiring: attaches a storage-backed adapter to the SDK's
  // token provider so anonymous sessions survive reloads. Runs once per
  // (client, storage) pair via useState's lazy initializer.
  useState(() => {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => value.storage.getAnonymousSession(),
      write: (s) => value.storage.setAnonymousSession(s),
    });
    return null;
  });

  return (
    <EmporixContext.Provider value={value}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </EmporixContext.Provider>
  );
}

/** Returns the SDK client and token storage. Throws outside an {@link EmporixProvider}. */
export function useEmporix(): EmporixContextValue {
  const ctx = useContext(EmporixContext);
  if (!ctx) throw new Error("useEmporix must be used within an EmporixProvider");
  return ctx;
}
