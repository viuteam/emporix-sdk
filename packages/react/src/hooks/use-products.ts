import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { type PaginatedItems, type Product } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";

const PRODUCTS_STALE_TIME = 60_000; // 1 minute — catalog listings + prices.

/** Fetches one product. Default auth: customer if logged in, else anonymous. */
export function useProduct(productId: string, options: QueryOpts = {}): UseQueryResult<Product> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "product", productId, { tenant: client.tenant, authKind: ctx.kind, siteCode }],
    queryFn: () => client.products.get(productId, undefined, ctx),
    staleTime: PRODUCTS_STALE_TIME,
  });
}

/** Fetches one page of products. */
export function useProducts(
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "products", params, { tenant: client.tenant, authKind: ctx.kind, siteCode }],
    queryFn: () => client.products.list(params, ctx),
    staleTime: PRODUCTS_STALE_TIME,
  });
}

/** Infinite product list — terminates on `hasNextPage=false`. */
export function useProductsInfinite(
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Product>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useInfiniteQuery({
    queryKey: ["emporix", "products-infinite", params, { tenant: client.tenant, authKind: ctx.kind, siteCode }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.products.list(
        params.pageSize !== undefined
          ? { pageNumber: pageParam as number, pageSize: params.pageSize }
          : { pageNumber: pageParam as number },
        ctx,
      ),
    getNextPageParam: (last: PaginatedItems<Product>) =>
      last.hasNextPage ? last.pageNumber + 1 : undefined,
    staleTime: PRODUCTS_STALE_TIME,
  });
}

/** Fetches one product by its `code` (URL slug). Disabled when code is empty. */
export function useProductByCode(
  code: string | undefined,
  options: QueryOpts = {},
): UseQueryResult<Product> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "product-by-code", code, { tenant: client.tenant, authKind: ctx.kind, siteCode }],
    enabled: typeof code === "string" && code !== "",
    queryFn: () => client.products.getByCode(code as string, ctx),
    staleTime: PRODUCTS_STALE_TIME,
  });
}

/** Full-text product search. Disabled when query is empty/whitespace. */
export function useProductSearch(
  query: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: [
      "emporix",
      "product-search",
      query,
      params,
      { tenant: client.tenant, authKind: ctx.kind, siteCode },
    ],
    enabled: typeof query === "string" && query.trim() !== "",
    queryFn: () => client.products.search(query as string, params, ctx),
    staleTime: PRODUCTS_STALE_TIME,
  });
}
