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
        // Client component: storefront-only, no backend secret in the browser.
        credentials: {
          storefront: {
            clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "",
            // Bound at anonymous-login so prices.matchByContext can resolve.
            context: { currency: "EUR", siteCode: "main", targetLocation: "DE" },
          },
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
