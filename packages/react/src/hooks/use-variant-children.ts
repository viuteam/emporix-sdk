import { type UseQueryResult } from "@tanstack/react-query";
import { type Product } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { type QueryOpts } from "./internal/use-read-auth";
import { useEmporixQuery } from "./internal/use-emporix-query";

const VARIANT_CHILDREN_STALE_TIME = 60_000; // 1 minute — catalog data.

export type UseVariantChildrenOptions = QueryOpts & { pageSize?: number };

/**
 * Resolves the VARIANT children of a PARENT_VARIANT product via
 * `products.listVariantChildren`. The cache key contains `parentVariantId`.
 * Disabled until `parentVariantId` is a non-empty string.
 */
export function useVariantChildren(
  parentVariantId: string | undefined,
  options: UseVariantChildrenOptions = {},
): UseQueryResult<Product[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "variant-children",
    args: [parentVariantId, { pageSize: options.pageSize }],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: typeof parentVariantId === "string" && parentVariantId !== "",
    queryFn: (ctx) =>
      client.products.listVariantChildren(
        parentVariantId as string,
        options.pageSize !== undefined ? { pageSize: options.pageSize } : {},
        ctx,
      ),
    staleTime: VARIANT_CHILDREN_STALE_TIME,
  });
}
