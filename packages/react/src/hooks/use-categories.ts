import {
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import {
  type PaginatedItems,
  type Category,
  type Product,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";
import { useEmporixInfinite } from "./internal/use-emporix-infinite";
import { useEmporixQuery } from "./internal/use-emporix-query";

const CATEGORIES_STALE_TIME = 5 * 60_000; // 5 minutes — catalog structure.

/** Fetches one category. */
export function useCategory(
  categoryId: string,
  options: QueryOpts = {},
): UseQueryResult<Category> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "category", args: [categoryId],
    ...(options.auth ? { authOverride: options.auth } : {}),
    queryFn: (ctx) => client.categories.get(categoryId, ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}

/** Direct child categories of a category (hierarchy drill-down). Disabled when id is empty. */
export function useSubcategories(
  categoryId: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<Category[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "subcategories", args: [categoryId ?? null, params],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: typeof categoryId === "string" && categoryId !== "",
    queryFn: (ctx) => client.categories.subcategories(categoryId as string, params, ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}

/** Fetches one page of categories. */
export function useCategories(
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Category>> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "categories", args: [params],
    ...(options.auth ? { authOverride: options.auth } : {}),
    queryFn: (ctx) => client.categories.list(params, ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}

/** Infinite category list — terminates on `hasNextPage=false`. */
export function useCategoriesInfinite(
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Category>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode, language } = useReadSite();
  return useEmporixInfinite<Category>({
    queryKey: emporixKey("categories-infinite", [params], { tenant: client.tenant, authKind: ctx.kind, siteCode, language }),
    fetchPage: (pageNumber) =>
      client.categories.list(
        params.pageSize !== undefined ? { pageNumber, pageSize: params.pageSize } : { pageNumber },
        ctx,
      ),
    staleTime: CATEGORIES_STALE_TIME,
  });
}

/** The catalogue's root categories (published category trees) for top-level nav. */
export function useCategoryTree(options: QueryOpts = {}): UseQueryResult<Category[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "category-tree", args: [],
    ...(options.auth ? { authOverride: options.auth } : {}),
    queryFn: (ctx) => client.categories.tree(ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}

/** One page of products in a category. Disabled when categoryId is empty. */
export function useProductsInCategory(
  categoryId: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "products-in-category", args: [categoryId, params],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: typeof categoryId === "string" && categoryId !== "",
    queryFn: (ctx) => client.categories.productsIn(categoryId as string, params, ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}

/** Infinite-scroll product list for a category. Terminates on `hasNextPage=false`. */
export function useProductsInCategoryInfinite(
  categoryId: string | undefined,
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Product>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode, language } = useReadSite();
  return useEmporixInfinite<Product>({
    queryKey: emporixKey("products-in-category-infinite", [categoryId, params], { tenant: client.tenant, authKind: ctx.kind, siteCode, language }),
    enabled: typeof categoryId === "string" && categoryId !== "",
    fetchPage: (pageNumber) =>
      client.categories.productsIn(
        categoryId as string,
        params.pageSize !== undefined ? { pageNumber, pageSize: params.pageSize } : { pageNumber },
        ctx,
      ),
    staleTime: CATEGORIES_STALE_TIME,
  });
}
