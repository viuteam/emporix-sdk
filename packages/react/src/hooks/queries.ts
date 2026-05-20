import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type Product,
  type Category,
  type CategoryNode,
  type Cart,
  type PaginatedItems,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

interface QueryOpts {
  auth?: AuthContext;
}

function useReadAuth(override?: AuthContext): { ctx: AuthContext; kind: string } {
  const { storage } = useEmporix();
  if (override) return { ctx: override, kind: override.kind };
  const token = storage.getCustomerToken();
  return token
    ? { ctx: auth.customer(token), kind: "customer" }
    : { ctx: auth.anonymous(), kind: "anonymous" };
}

/** Fetches one product. Default auth: customer if logged in, else anonymous. */
export function useProduct(productId: string, options: QueryOpts = {}): UseQueryResult<Product> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "product", productId, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.products.get(productId, undefined, ctx),
  });
}

/** Fetches one page of products. */
export function useProducts(
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "products", params, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.products.list(params, ctx),
  });
}

/** Infinite product list — terminates on `hasNextPage=false`. */
export function useProductsInfinite(
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Product>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useInfiniteQuery({
    queryKey: ["emporix", "products-infinite", params, { tenant: client.tenant, authKind: kind }],
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
  });
}

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

/** Fetches a cart by id. Disabled when `cartId` is undefined. */
export function useCart(cartId?: string, options: QueryOpts = {}): UseQueryResult<Cart> {
  const { client, storage } = useEmporix();
  const override = options.auth;
  const token = storage.getCustomerToken();
  const ctx: AuthContext = override ?? (token ? auth.customer(token) : auth.anonymous());
  return useQuery({
    queryKey: ["emporix", "cart", cartId ?? null, { tenant: client.tenant, authKind: ctx.kind }],
    enabled: cartId !== undefined,
    queryFn: () => client.carts.get(cartId as string, ctx),
  });
}
