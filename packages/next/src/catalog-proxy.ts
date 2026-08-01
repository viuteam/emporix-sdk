import { emporixTagsForUrl } from "./tags";
import { getEmporixClient } from "./client";
import { assertSameOrigin } from "./bff-auth";

const DEFAULT_HOST = "https://api.emporix.io";

/**
 * A catch-all Route Handler for **public catalog reads only**.
 *
 * Lets a storefront keep client-side catalog interaction — typeahead, infinite
 * scroll, filters — while holding no Emporix token in the browser. The browser
 * sends a placeholder; this route substitutes the server's real anonymous token.
 *
 * The allowlist is {@link emporixTagsForUrl}: a URL is proxyable exactly when it
 * yields cache tags, which is already the "public and cacheable" test. Cart,
 * order, customer and token endpoints yield `[]` and get a 403. There is
 * deliberately no second allowlist to keep in sync.
 *
 * Proxying catalog reads is a net win rather than a cost: the response is cached
 * by Next once for all visitors instead of fetched per browser.
 *
 * @example
 * ```ts
 * // app/api/emporix/[...path]/route.ts
 * export const GET = createEmporixCatalogRoute();
 * ```
 */
export function createEmporixCatalogRoute(
  opts: { tenant?: string; revalidate?: number } = {},
): (request: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response> {
  return async (request, ctx) => {
    try {
      assertSameOrigin(request);
    } catch {
      return new Response("forbidden", { status: 403 });
    }

    const tenant = opts.tenant ?? process.env.EMPORIX_TENANT;
    if (!tenant) {
      throw new Error(
        "createEmporixCatalogRoute: no tenant. Set EMPORIX_TENANT or pass { tenant }.",
      );
    }

    const { path } = await ctx.params;
    const host = process.env.EMPORIX_HOST ?? DEFAULT_HOST;
    const search = new URL(request.url).search;
    const upstream = `${host}/${path.join("/")}${search}`;

    if (emporixTagsForUrl(upstream, tenant).length === 0) {
      return new Response("forbidden", { status: 403 });
    }


    // The tagged client is correct here: this is public, cacheable catalog data
    // and its anonymous token carries no personalization.
    const client = getEmporixClient({
      tenant,
      ...(opts.revalidate !== undefined ? { revalidate: opts.revalidate } : {}),
    });
    const session = await client.tokenProvider.getAnonymousToken();

    // The placeholder Authorization from the browser is DISCARDED, never
    // forwarded — a fresh Headers object rather than a copy of the request's.
    const res = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  };
}
