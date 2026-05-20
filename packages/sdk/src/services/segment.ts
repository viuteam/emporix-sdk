import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { requireCustomer } from "../core/require-customer";
import type { ProductService } from "./product";
import type { CategoryService } from "./category";
import type {
  SegmentResponse,
  ItemAssignmentResponse,
  CategoryTreeResponse,
} from "../generated/customer-segment";

/** Generated segment types (read shapes — storefront `segment_read_own`). */
export type Segment = SegmentResponse;
export type SegmentItem = ItemAssignmentResponse;
export type SegmentCategoryTree = CategoryTreeResponse;
export type SegmentCategoryTreeNode = CategoryTreeResponse[number];

/** Cross-service hydrate dependencies, injected from `EmporixClient`. */
export interface SegmentServiceDeps {
  products: ProductService;
  categories: CategoryService;
}

function setIfDefined<V>(
  q: Record<string, string | number | undefined>,
  key: string,
  value: V | undefined,
): void {
  if (value !== undefined && value !== "") {
    q[key] = value as unknown as string | number;
  }
}

/**
 * Customer-segment reads. Every method requires a customer/raw
 * `AuthContext` — the `segment_read_own` scope is on the customer token.
 * The standard product/category endpoints do **not** auto-filter by
 * segment; the storefront uses these reads to discover what to fetch.
 */
export class SegmentService {
  constructor(
    private readonly ctx: ClientContext,
    private readonly deps: SegmentServiceDeps,
  ) {}

  private base(): string {
    return `/customer-segment/${this.ctx.tenant}/segments`;
  }

  /** Lists segments the caller belongs to (with `segment_read_own`). */
  async list(
    query: { q?: string; pageNumber?: number; pageSize?: number } = {},
    auth?: AuthContext,
  ): Promise<Segment[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "q", query.q);
    setIfDefined(q, "pageNumber", query.pageNumber);
    setIfDefined(q, "pageSize", query.pageSize);
    return this.ctx.http.request<Segment[]>({
      method: "GET",
      path: this.base(),
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }

  /** Fetches a single segment by id. */
  async get(segmentId: string, auth?: AuthContext): Promise<Segment> {
    return this.ctx.http.request<Segment>({
      method: "GET",
      path: `${this.base()}/${segmentId}`,
      auth: requireCustomer(auth),
    });
  }

  /** Item assignments (PRODUCT + CATEGORY) across all the caller's active segments. */
  async listItems(
    query: {
      q?: string;
      siteCode?: string;
      legalEntityId?: string;
      onlyActive?: boolean;
    } = {},
    auth?: AuthContext,
  ): Promise<SegmentItem[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "q", query.q);
    setIfDefined(q, "siteCode", query.siteCode);
    setIfDefined(q, "legalEntityId", query.legalEntityId);
    if (query.onlyActive !== undefined) q.onlyActive = String(query.onlyActive);
    return this.ctx.http.request<SegmentItem[]>({
      method: "GET",
      path: `${this.base()}/items`,
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }

  /** Item assignments of one specific segment. */
  async listSegmentItems(
    segmentId: string,
    query: {
      q?: string;
      legalEntityId?: string;
      pageNumber?: number;
      pageSize?: number;
    } = {},
    auth?: AuthContext,
  ): Promise<SegmentItem[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "q", query.q);
    setIfDefined(q, "legalEntityId", query.legalEntityId);
    setIfDefined(q, "pageNumber", query.pageNumber);
    setIfDefined(q, "pageSize", query.pageSize);
    return this.ctx.http.request<SegmentItem[]>({
      method: "GET",
      path: `${this.base()}/${segmentId}/items`,
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }

  /** Category tree built only from the caller's active segments. */
  async getCategoryTree(
    query: { siteCode?: string; legalEntityId?: string } = {},
    auth?: AuthContext,
  ): Promise<SegmentCategoryTree> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "siteCode", query.siteCode);
    setIfDefined(q, "legalEntityId", query.legalEntityId);
    return this.ctx.http.request<SegmentCategoryTree>({
      method: "GET",
      path: `${this.base()}/items/category-trees`,
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }
}
