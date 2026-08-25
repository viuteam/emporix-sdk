import { computed, type Injector, type Signal } from "@angular/core";
import type { CreateQueryResult } from "@tanstack/angular-query-experimental";
import type { Site } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { injectEmporixSite } from "../site";

/** 10 minutes — sites change admin-side only. */
const SITES_STALE = 10 * 60_000;

export interface SiteOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: SiteOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * Every site the tenant offers.
 *
 * `site: "none"` — this read is what *tells you* about sites, so keying it by the
 * active one would be circular and would refetch the same list per site.
 */
export function injectSites(opts: SiteOpts = {}): CreateQueryResult<Site[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Site[], readonly []>(
    () => ({
      resource: "sites",
      args: [] as const,
      site: "none",
      mode: "read-auth",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.sites.list(ctx),
      staleTime: SITES_STALE,
    }),
    pass(opts),
  );
}

/**
 * The active site's full DTO, or `undefined` while nothing is resolved.
 *
 * Derived from {@link injectSites} and the site context rather than fetched
 * separately: the list is already cached for ten minutes, and a second per-site
 * read would bill for something the client already holds.
 *
 * A signal, not a query result — there is no request of its own to report on. Use
 * `injectSites().isPending()` if you need the loading state.
 */
export function injectActiveSite(opts: SiteOpts = {}): Signal<Site | undefined> {
  const context = injectEmporixSite();
  const sites = injectSites(opts);
  return computed(() => {
    const code = context.siteCode();
    if (code === null) return undefined;
    return sites.data()?.find((s) => s.code === code);
  });
}
