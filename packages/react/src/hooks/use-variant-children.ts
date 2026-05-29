import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { type Product } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";

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
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: emporixKey(
      "variant-children",
      [parentVariantId, { pageSize: options.pageSize }],
      { tenant: client.tenant, authKind: ctx.kind, siteCode },
    ),
    enabled: typeof parentVariantId === "string" && parentVariantId !== "",
    queryFn: () =>
      client.products.listVariantChildren(
        parentVariantId as string,
        options.pageSize !== undefined ? { pageSize: options.pageSize } : {},
        ctx,
      ),
    staleTime: VARIANT_CHILDREN_STALE_TIME,
  });
}
