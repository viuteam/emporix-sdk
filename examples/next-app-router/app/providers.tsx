"use client";

import { useState, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createMemoryStorage } from "@viu/emporix-sdk-react";

export function Providers({
  initialCustomerToken,
  children,
}: {
  initialCustomerToken?: string;
  children: ReactNode;
}): React.JSX.Element {
  const [client] = useState(
    () =>
      new EmporixClient({
        tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
        credentials: {
          backend: { clientId: "unused-on-client", secret: "unused-on-client" },
          storefront: { clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
        },
      }),
  );
  const [queryClient] = useState(() => new QueryClient());
  const [storage] = useState(() =>
    createMemoryStorage(initialCustomerToken ? { initial: initialCustomerToken } : {}),
  );
  return (
    <EmporixProvider client={client} queryClient={queryClient} storage={storage}>
      {children}
    </EmporixProvider>
  );
}
