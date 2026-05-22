import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import {
  type PaginatedItems,
  type Category,
  type CategoryNode,
  type Product,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";

/** Fetches one category. */
export function useCategory(
  categoryId: string,
  options: QueryOpts = {},
): UseQueryResult<Category> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "category", categoryId, { tenant: client.tenant, authKind: kind, siteCode }],
    queryFn: () => client.categories.get(categoryId, ctx),
  });
}

/** Fetches one page of categories. */
export function useCategories(
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Category>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "categories", params, { tenant: client.tenant, authKind: kind, siteCode }],
    queryFn: () => client.categories.list(params, ctx),
  });
}

/** Infinite category list — terminates on `hasNextPage=false`. */
export function useCategoriesInfinite(
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Category>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useInfiniteQuery({
    queryKey: ["emporix", "categories-infinite", params, { tenant: client.tenant, authKind: kind, siteCode }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.categories.list(
        params.pageSize !== undefined
          ? { pageNumber: pageParam as number, pageSize: params.pageSize }
          : { pageNumber: pageParam as number },
        ctx,
      ),
    getNextPageParam: (last: PaginatedItems<Category>) =>
      last.hasNextPage ? last.pageNumber + 1 : undefined,
  });
}

/** Fetches the category tree. */
export function useCategoryTree(
  rootId?: string,
  options: QueryOpts = {},
): UseQueryResult<CategoryNode> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: [
      "emporix",
      "category-tree",
      rootId ?? null,
      { tenant: client.tenant, authKind: kind, siteCode },
    ],
    queryFn: () => client.categories.tree(rootId, ctx),
  });
}

/** One page of products in a category. Disabled when categoryId is empty. */
export function useProductsInCategory(
  categoryId: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: [
      "emporix",
      "products-in-category",
      categoryId,
      params,
      { tenant: client.tenant, authKind: kind, siteCode },
    ],
    enabled: typeof categoryId === "string" && categoryId !== "",
    queryFn: () => client.categories.productsIn(categoryId as string, params, ctx),
  });
}

/** Infinite-scroll product list for a category. Terminates on `hasNextPage=false`. */
export function useProductsInCategoryInfinite(
  categoryId: string | undefined,
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Product>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useInfiniteQuery({
    queryKey: [
      "emporix",
      "products-in-category-infinite",
      categoryId,
      params,
      { tenant: client.tenant, authKind: kind, siteCode },
    ],
    enabled: typeof categoryId === "string" && categoryId !== "",
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.categories.productsIn(
        categoryId as string,
        params.pageSize !== undefined
          ? { pageNumber: pageParam as number, pageSize: params.pageSize }
          : { pageNumber: pageParam as number },
        ctx,
      ),
    getNextPageParam: (last: PaginatedItems<Product>) =>
      last.hasNextPage ? last.pageNumber + 1 : undefined,
  });
}
