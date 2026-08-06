"use client";

import { useState, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createMemoryStorage } from "@viu/emporix-sdk-react";
import { CURRENCY, LANGUAGE, SITE_CODE, TARGET_LOCATION } from "./site";

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
            // Bound at anonymous-login so prices.matchByContext can resolve — and from
            // `./site`, not spelled out here. It used to say `EUR`/`DE` while the server
            // said `CHF`, which is why `/guest-checkout` answered «no price resolved for
            // the product»: `useMatchPrices` sends only `items` and lets this context
            // decide the currency and the country.
            context: {
              currency: CURRENCY,
              siteCode: SITE_CODE,
              targetLocation: TARGET_LOCATION,
            },
          },
        },
      }),
  );
  const [queryClient] = useState(() => new QueryClient());
  const [storage] = useState(() =>
    createMemoryStorage(initialCustomerToken ? { initial: initialCustomerToken } : {}),
  );
  return (
    // `initialSiteCode` and `initialLanguage` are what make an SSR prefetch a cache hit,
    // and the second one is load-bearing: without it the provider fetches the active site
    // and seeds the language from its `defaultLanguage`, which changes every query key
    // after mount and orphans the dehydrated cache. Both come from `./site`, the same
    // module the prefetch on the server reads.
    <EmporixProvider
      client={client}
      queryClient={queryClient}
      storage={storage}
      initialSiteCode={SITE_CODE}
      initialLanguage={LANGUAGE}
    >
      {children}
    </EmporixProvider>
  );
}
