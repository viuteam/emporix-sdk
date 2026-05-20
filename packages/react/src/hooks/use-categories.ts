import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { type PaginatedItems, type Category, type CategoryNode } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

/** Fetches one category. */
export function useCategory(
  categoryId: string,
  options: QueryOpts = {},
): UseQueryResult<Category> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "category", categoryId, { tenant: client.tenant, authKind: kind }],
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
  return useQuery({
    queryKey: ["emporix", "categories", params, { tenant: client.tenant, authKind: kind }],
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
  return useInfiniteQuery({
    queryKey: ["emporix", "categories-infinite", params, { tenant: client.tenant, authKind: kind }],
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
  return useQuery({
    queryKey: [
      "emporix",
      "category-tree",
      rootId ?? null,
      { tenant: client.tenant, authKind: kind },
    ],
    queryFn: () => client.categories.tree(rootId, ctx),
  });
}
