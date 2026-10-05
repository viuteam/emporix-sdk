import { EmporixClient } from "@viu/emporix-sdk";
import type { CategoryNode, Site } from "@viu/emporix-sdk";

export interface TenantChoices {
  sites: Site[];
  categories: CategoryNode[];
}

/**
 * Signs in anonymously with a throwaway client and reads what the setup offers:
 * the tenant's active sites and the roots of its category tree. A wrong tenant
 * or client id fails here, before the shop renders.
 */
export async function loadTenantChoices(input: {
  tenant: string;
  storefrontClientId: string;
  host?: string | undefined;
}): Promise<TenantChoices> {
  const client = new EmporixClient({
    tenant: input.tenant,
    ...(input.host ? { host: input.host } : {}),
    credentials: { storefront: { clientId: input.storefrontClientId } },
    logger: { level: "warn" },
  });
  const [sites, categories] = await Promise.all([client.sites.list(), client.categories.tree()]);
  return { sites: sites.filter((s) => s.active), categories };
}

/**
 * The price context a site implies: its currency and its home country. The same
 * derivation `SiteContextProvider` makes on a site switch
 * (`packages/react/src/site-context.tsx`).
 */
export function siteContext(site: Site): { siteCode: string; currency: string; targetLocation: string } {
  return { siteCode: site.code, currency: site.currency, targetLocation: site.homeBase.address.country };
}
