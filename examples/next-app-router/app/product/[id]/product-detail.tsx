"use client";

import { useProduct } from "@viu/emporix-sdk-react";

/** Client component: reads the product from the hydrated React-Query cache —
 * a cache HIT when the RSC prefetched with matching siteCode/language. */
export function ProductDetail({ productId }: { productId: string }): React.JSX.Element {
  const { data, isLoading, error } = useProduct(productId);
  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Failed to load product.</p>;
  return (
    <article>
      <h1>{typeof data?.name === "string" ? data.name : productId}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </article>
  );
}
