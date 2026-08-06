import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchProduct } from "@viu/emporix-sdk-react/ssr";
import { emporix, SITE_CODE, LANGUAGE } from "../../emporix";
import { ProductDetail } from "./product-detail";

/**
 * Server Component: prefetch with the SDK, hand the dehydrated cache to the client.
 *
 * **Both discriminators have to be passed, and `language` is the one that bit.** The
 * prefetch key must match `useProduct`'s key or hydration is a miss. This comment used to
 * say «language is unbound on both sides (null), so it is omitted here» — true on the
 * server, false in the browser: `EmporixProvider` fetches the active site and seeds
 * `language` from its `defaultLanguage`, which changes the key **after mount** and
 * orphans everything prefetched under `language: null`.
 *
 * Measured 2026-08-06. Before, the browser re-fetched the product it had just been handed:
 *
 *   GET /customerlogin/auth/anonymous/login
 *   GET /site/viu/sites/main
 *   GET /product/viu/products/0f1e2d3c-4b5a   ← the prefetch, thrown away
 *
 * The tell was visible without a network log: the server-rendered `<h1>` showed the
 * product **id** — no `Accept-Language`, so Emporix returns the whole locale map and the
 * `typeof name === "string"` check falls through — while the hydrated DOM showed the
 * German name, which only a request carrying a language gets. Two different reads.
 *
 * With `language` pinned in `app/site.ts` and passed here, that GET is gone and the name
 * renders identically in the HTML and the DOM.
 */

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params; // async since Next 15, mandatory since Next 16
  const qc = new QueryClient();
  await prefetchProduct(qc, emporix(), id, undefined, { siteCode: SITE_CODE, language: LANGUAGE });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProductDetail productId={id} />
    </HydrationBoundary>
  );
}
