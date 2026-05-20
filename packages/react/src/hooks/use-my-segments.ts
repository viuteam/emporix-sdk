import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type Segment,
  type SegmentItem,
  type SegmentCategoryTree,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

function customerCtx(token: string | null): AuthContext {
  if (!token) throw new Error("requires a customer token in storage");
  return auth.customer(token);
}

/** Segments the logged-in customer belongs to (`segment_read_own`). */
export function useMySegments(
  query: { q?: string; pageNumber?: number; pageSize?: number } = {},
): UseQueryResult<Segment[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: ["emporix", "segment", "list", { tenant: client.tenant, query }],
    enabled: token !== null,
    queryFn: () => client.segments.list(query, customerCtx(token)),
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
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: ["emporix", "segment", "items", { tenant: client.tenant, query }],
    enabled: token !== null,
    queryFn: () => client.segments.listItems(query, customerCtx(token)),
  });
}

/** Category tree filtered to the caller's segments. */
export function useMySegmentCategoryTree(
  query: { siteCode?: string; legalEntityId?: string } = {},
): UseQueryResult<SegmentCategoryTree> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: ["emporix", "segment", "categoryTree", { tenant: client.tenant, query }],
    enabled: token !== null,
    queryFn: () => client.segments.getCategoryTree(query, customerCtx(token)),
  });
}
