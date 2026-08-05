import { emporixTagsForUrl } from "./tags";
import { getEmporixClient } from "./client";
import { assertSameOrigin } from "./session-auth";

const DEFAULT_HOST = "https://api.emporix.io";

/**
 * A catch-all Route Handler for **public reads only**.
 *
 * Lets a storefront keep client-side interaction — typeahead, infinite scroll,
 * filters — while holding no Emporix token in the browser. The browser sends a
 * placeholder; this route substitutes the server's real anonymous token.
 *
 * The allowlist is {@link emporixTagsForUrl}: a URL is proxyable exactly when it
 * yields cache tags, which is already the "public and cacheable" test. That
 * currently admits `product`, `category`, `price`, `availability` and `site`.
 * Cart, order, customer and token endpoints yield `[]` and get a 403. There is
 * deliberately no second allowlist to keep in sync — widen the tag mapper and
 * this widens with it, which is the intended coupling.
 *
 * Not named `catalog`: the allowlist covers prices and site config too, and
 * Emporix has a real Catalog service (`client.catalogs`) this has nothing to do
 * with.
 *
 * Proxying these reads is a net win rather than a cost: the answer is tagged and
 * revalidated exactly like a Server Component's catalog read, so Next holds it
 * once for all visitors and the same webhook invalidates both. The response also
 * carries `Cache-Control`, so a CDN in front never has to ask twice.
 *
 * @example
 * ```ts
 * // app/api/emporix/[...path]/route.ts
 * export const GET = createEmporixPublicRoute();
 * ```
 */
export function createEmporixPublicRoute(
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
        "createEmporixPublicRoute: no tenant. Set EMPORIX_TENANT or pass { tenant }.",
      );
    }

    const { path } = await ctx.params;
    const host = process.env.EMPORIX_HOST ?? DEFAULT_HOST;
    const search = new URL(request.url).search;
    const upstream = `${host}/${path.join("/")}${search}`;

    const tags = emporixTagsForUrl(upstream, tenant);
    if (tags.length === 0) {
      return new Response("forbidden", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const revalidate = opts.revalidate ?? 3600;
    // The tagged client is correct here: this is public, cacheable data
    // and its anonymous token carries no personalization.
    const client = getEmporixClient({
      tenant,
      ...(opts.revalidate !== undefined ? { revalidate: opts.revalidate } : {}),
    });
    const session = await client.tokenProvider.getAnonymousToken();

    // The placeholder Authorization from the browser is DISCARDED, never
    // forwarded — a fresh Headers object rather than a copy of the request's.
    //
    // `next.tags` and `next.revalidate` are the whole point of this line. Without
    // them this was an uncached passthrough: one billed Emporix call per
    // debounced keystroke in a typeahead, for an answer every visitor shares.
    // The same webhook that invalidates a Server Component's catalog read
    // invalidates this, because the tags are the same ones.
    const res = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
      next: { tags, revalidate },
    } as RequestInit & { next: { tags: string[]; revalidate: number } });

    // A CDN may hold a 2xx — it is public and shared. It must NOT hold an error:
    // a 502 pinned for an hour outlives the outage that caused it.
    const cacheable = res.status >= 200 && res.status < 300;
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": cacheable
          ? `public, s-maxage=${revalidate}, stale-while-revalidate=60`
          : "no-store",
      },
    });
  };
}
