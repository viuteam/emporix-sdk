import { getEmporixClient, type GetEmporixClientOptions } from "@viu/emporix-sdk-next";
import type { EmporixClient } from "@viu/emporix-sdk";

/** Bound on every server-side client so prefetch keys match what the provider binds. */
export const SITE_CODE = "main";

/**
 * Maps this app's `NEXT_PUBLIC_*` environment names onto the package factory.
 *
 * The `NEXT_PUBLIC_` prefix is required because `app/providers.tsx` is a Client
 * Component and reads the same values in the browser; the package's own defaults
 * (`EMPORIX_TENANT`, `EMPORIX_STOREFRONT_CLIENT_ID`) are server-only names, so
 * they are passed explicitly here instead.
 */
export function emporix(opts: GetEmporixClientOptions = {}): EmporixClient {
  return getEmporixClient({
    tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
    clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "",
    context: { siteCode: SITE_CODE, currency: "CHF" },
    ...opts,
  });
}
