import type { ClientContext, PaginatedItems } from "../core/context";
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
  static readonly channel = "segment" as const;
  static readonly deps = ["products", "categories"] as const;
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
      pageNumber?: number;
      pageSize?: number;
    } = {},
    auth?: AuthContext,
  ): Promise<SegmentItem[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "q", query.q);
    setIfDefined(q, "siteCode", query.siteCode);
    setIfDefined(q, "legalEntityId", query.legalEntityId);
    setIfDefined(q, "pageNumber", query.pageNumber);
    setIfDefined(q, "pageSize", query.pageSize);
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

  private async pickItemIds(
    kind: "PRODUCT" | "CATEGORY",
    query: Parameters<SegmentService["listItems"]>[0],
    auth: AuthContext | undefined,
  ): Promise<string[]> {
    const rows = await this.listItems(query, auth);
    const ids: string[] = [];
    for (const r of rows) {
      const id = r.item?.id;
      if (r.type === kind && typeof id === "string") ids.push(id);
    }
    return ids;
  }

  /** Product ids assigned to the caller's active segments. */
  async listMyProductIds(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<string[]> {
    return this.pickItemIds("PRODUCT", query ?? {}, auth);
  }

  /** Category ids assigned to the caller's active segments. */
  async listMyCategoryIds(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<string[]> {
    return this.pickItemIds("CATEGORY", query ?? {}, auth);
  }

  /**
   * Hydrates `listMyProductIds` via `ProductService.get` in parallel.
   * Resolves in the same order as the id list. Any single failure rejects
   * the whole batch (`Promise.all`); use the id-list method + your own
   * tolerance strategy if partial success matters.
   */
  async listMyProducts(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<PaginatedItems<Awaited<ReturnType<ProductService["get"]>>>> {
    const pageNumber = query?.pageNumber ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const sourceItems = await this.listItems(
      { ...(query ?? {}), pageNumber, pageSize },
      auth,
    );
    const ids: string[] = [];
    for (const r of sourceItems) {
      if (r.type === "PRODUCT" && typeof r.item?.id === "string") ids.push(r.item.id);
    }
    const items = await this.deps.products.searchByIds(ids, undefined, auth);
    return { items, pageNumber, pageSize, hasNextPage: sourceItems.length === pageSize };
  }

  /**
   * Hydrates a page of the caller's segment CATEGORY assignments into
   * real categories via one bulk `categories.searchByIds` call. Same
   * `hasNextPage` semantic as `listMyProducts`.
   */
  async listMyCategories(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<PaginatedItems<Awaited<ReturnType<CategoryService["get"]>>>> {
    const pageNumber = query?.pageNumber ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const sourceItems = await this.listItems(
      { ...(query ?? {}), pageNumber, pageSize },
      auth,
    );
    const ids: string[] = [];
    for (const r of sourceItems) {
      if (r.type === "CATEGORY" && typeof r.item?.id === "string") ids.push(r.item.id);
    }
    const items = await this.deps.categories.searchByIds(ids, undefined, auth);
    return { items, pageNumber, pageSize, hasNextPage: sourceItems.length === pageSize };
  }
}
