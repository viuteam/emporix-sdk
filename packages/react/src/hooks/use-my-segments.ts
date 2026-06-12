import {
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEmporixInfinite } from "./internal/use-emporix-infinite";
import {
  auth,
  type AuthContext,
  type Segment,
  type SegmentItem,
  type SegmentCategoryTree,
  type Product,
  type Category,
  type PaginatedItems,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadSite } from "./internal/use-read-site";
import { useCustomerToken } from "./internal/use-storage-snapshot";

const SEGMENTS_STALE_TIME = 5 * 60_000; // 5 minutes — segment membership is admin-driven.

function customerCtx(token: string | null): AuthContext {
  if (!token) throw new Error("requires a customer token in storage");
  return auth.customer(token);
}

/** Segments the logged-in customer belongs to (`segment_read_own`). */
export function useMySegments(
  query: { q?: string; pageNumber?: number; pageSize?: number } = {},
): UseQueryResult<Segment[]> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "segment", "list", { tenant: client.tenant, query, siteCode, language }],
    enabled: token !== null,
    queryFn: () => client.segments.list(query, customerCtx(token)),
    staleTime: SEGMENTS_STALE_TIME,
  });
}

/** Item assignments (PRODUCT + CATEGORY) across the caller's active segments. */
export function useMySegmentItems(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
  } = {},
): UseQueryResult<SegmentItem[]> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "segment", "items", { tenant: client.tenant, query, siteCode, language }],
    enabled: token !== null,
    queryFn: () => client.segments.listItems(query, customerCtx(token)),
    staleTime: SEGMENTS_STALE_TIME,
  });
}

/** Category tree filtered to the caller's segments. */
export function useMySegmentCategoryTree(
  query: { siteCode?: string; legalEntityId?: string } = {},
): UseQueryResult<SegmentCategoryTree> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "segment", "categoryTree", { tenant: client.tenant, query, siteCode, language }],
    enabled: token !== null,
    queryFn: () => client.segments.getCategoryTree(query, customerCtx(token)),
    staleTime: SEGMENTS_STALE_TIME,
  });
}

/** Hydrated PRODUCT page for the caller's segments (single-page). */
export function useMySegmentProducts(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageNumber?: number;
    pageSize?: number;
  } = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "segment", "myProducts", { tenant: client.tenant, query, siteCode, language }],
    enabled: token !== null,
    queryFn: () => client.segments.listMyProducts(query, customerCtx(token)),
    staleTime: SEGMENTS_STALE_TIME,
  });
}

/**
 * Hydrated PRODUCT pages — infinite scroll. `data.pages` is an array of
 * pages; call `fetchNextPage()` to load the next one. Terminates when
 * the source segment-items page is not full.
 */
export function useMySegmentProductsInfinite(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageSize?: number;
  } = {},
) {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();
  return useEmporixInfinite<Product>({
    queryKey: [
      "emporix",
      "segment",
      "myProductsInfinite",
      { tenant: client.tenant, query, siteCode, language },
    ],
    enabled: token !== null,
    fetchPage: (pageNumber) =>
      client.segments.listMyProducts(
        { ...query, pageNumber, pageSize: query.pageSize ?? 20 },
        customerCtx(token),
      ),
    staleTime: SEGMENTS_STALE_TIME,
  });
}

/** Hydrated CATEGORY page for the caller's segments (single-page). */
export function useMySegmentCategories(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageNumber?: number;
    pageSize?: number;
  } = {},
): UseQueryResult<PaginatedItems<Category>> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "segment", "myCategories", { tenant: client.tenant, query, siteCode, language }],
    enabled: token !== null,
    queryFn: () => client.segments.listMyCategories(query, customerCtx(token)),
    staleTime: SEGMENTS_STALE_TIME,
  });
}

/**
 * Hydrated CATEGORY pages — infinite scroll. Same semantics as
 * {@link useMySegmentProductsInfinite}.
 */
export function useMySegmentCategoriesInfinite(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageSize?: number;
  } = {},
) {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();
  return useEmporixInfinite<Category>({
    queryKey: [
      "emporix",
      "segment",
      "myCategoriesInfinite",
      { tenant: client.tenant, query, siteCode, language },
    ],
    enabled: token !== null,
    fetchPage: (pageNumber) =>
      client.segments.listMyCategories(
        { ...query, pageNumber, pageSize: query.pageSize ?? 20 },
        customerCtx(token),
      ),
    staleTime: SEGMENTS_STALE_TIME,
  });
}
