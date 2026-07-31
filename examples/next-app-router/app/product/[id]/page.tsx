import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchProduct } from "@viu/emporix-sdk-react/ssr";
import { emporix, SITE_CODE } from "../../emporix";
import { ProductDetail } from "./product-detail";

// Server Component: prefetch with the SDK, hand the dehydrated cache to the
// client. The prefetch key must match useProduct's key for hydration to be a
// cache hit — so the same siteCode the client's EmporixProvider binds is passed
// here, and app/emporix.ts is the single place both read it from. language is
// unbound on both sides (null), so it is omitted here.

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params; // async since Next 15, mandatory since Next 16
  const qc = new QueryClient();
  await prefetchProduct(qc, emporix(), id, undefined, { siteCode: SITE_CODE });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProductDetail productId={id} />
    </HydrationBoundary>
  );
}
