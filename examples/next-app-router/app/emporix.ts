import { getEmporixClient, type GetEmporixClientOptions } from "@viu/emporix-sdk-next";
import type { EmporixClient } from "@viu/emporix-sdk";
import { CURRENCY, LANGUAGE, SITE_CODE, TARGET_LOCATION } from "./site";

/**
 * Maps this app's `NEXT_PUBLIC_*` environment names onto the package factory.
 *
 * The `NEXT_PUBLIC_` prefix is required because `app/providers.tsx` is a Client
 * Component and reads the same values in the browser; the package's own defaults
 * (`EMPORIX_TENANT`, `EMPORIX_STOREFRONT_CLIENT_ID`) are server-only names, so
 * they are passed explicitly here instead.
 *
 * The request context comes from `./site`, which the browser client reads too. It used to
 * be spelled out here under the comment «bound on every server-side client so prefetch
 * keys match what the provider binds» — the two were spelled out separately and
 * disagreed about currency, country and language. One module now, so they cannot.
 */
export function emporix(opts: GetEmporixClientOptions = {}): EmporixClient {
  return getEmporixClient({
    tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
    clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "",
    context: {
      siteCode: SITE_CODE,
      currency: CURRENCY,
      targetLocation: TARGET_LOCATION,
      language: LANGUAGE,
    },
    ...opts,
  });
}

// Re-exported so a page that builds a prefetch key imports the client and the
// discriminators from one place.
export { LANGUAGE, SITE_CODE } from "./site";
