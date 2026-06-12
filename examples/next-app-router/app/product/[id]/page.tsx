import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { prefetchProduct } from "@viu/emporix-sdk-react/ssr";
import { ProductDetail } from "./product-detail";

// Server Component: prefetch with the SDK, hand the dehydrated cache to the
// client. The prefetch key must match useProduct's key for hydration to be a
// cache hit — so we pass the SAME siteCode the client's EmporixProvider binds
// (see app/providers.tsx: storefront.context.siteCode = "main"). language is
// unbound on both sides (null), so it is omitted here.
const SITE_CODE = "main";

const sdk = new EmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
  credentials: {
    storefront: {
      clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "",
      context: { siteCode: SITE_CODE },
    },
  },
  logger: false,
});

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params; // Next 15: params is async
  const qc = new QueryClient();
  await prefetchProduct(qc, sdk, id, undefined, { siteCode: SITE_CODE });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProductDetail productId={id} />
    </HydrationBoundary>
  );
}
