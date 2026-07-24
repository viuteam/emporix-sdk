import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import { requireCustomer } from "../core/require-customer";
import type { ProductService } from "./product";
import type { CategoryService } from "./category";
import type {
  SegmentResponse,
  ItemAssignmentResponse,
  CategoryTreeResponse,
  SegmentCreation,
  SegmentUpdate,
  SegmentsSearch,
  SegmentUpdateBulk,
  Match,
  CustomerAssignmentUpsert,
  CustomerAssignmentUpsertBulk,
  CustomerAssignmentResponse,
  ItemAssignmentUpsert,
  ItemAssignmentUpsertBulk,
  BulkResponse,
  BulkAssignmentResponse,
} from "../generated/customer-segment";

/** Generated segment types (read shapes — storefront `segment_read_own`). */
export type Segment = SegmentResponse;
export type SegmentItem = ItemAssignmentResponse;
export type SegmentCategoryTree = CategoryTreeResponse;
export type SegmentCategoryTreeNode = CategoryTreeResponse[number];

/** Create body for a segment (generated). */
export type SegmentInput = SegmentCreation;
/** Full-replace (PUT) body for a segment (generated). */
export type SegmentUpdateInput = SegmentUpdate;
/** Partial (PATCH) body for a segment. */
export type SegmentPatchInput = Partial<SegmentUpdate>;
/** Search body for segments (generated). */
export type SegmentSearchQuery = SegmentsSearch;
/** Body for a segment match check (generated). */
export type SegmentMatchInput = Match;
/** One entry of a segment bulk request (generated). */
export type SegmentBulkItem = SegmentUpdateBulk;
/** Per-entry result of a segment bulk operation (generated). */
export type SegmentBulkResult = BulkResponse;
/** Customer→segment assignment body (generated). */
export type SegmentCustomerInput = CustomerAssignmentUpsert;
/** One entry of a customer-assignment bulk request (generated). */
export type SegmentCustomerBulkInput = CustomerAssignmentUpsertBulk;
/** A customer→segment assignment (read). */
export type SegmentCustomer = CustomerAssignmentResponse;
/** Item→segment assignment body (generated). */
export type SegmentItemInput = ItemAssignmentUpsert;
/** One entry of an item-assignment bulk request (generated). */
export type SegmentItemBulkInput = ItemAssignmentUpsertBulk;
/** Per-entry result of an assignment bulk operation (generated). */
export type SegmentAssignmentBulkResult = BulkAssignmentResponse;

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

/** Admin default: segment-manage operations use a service token. */
const SERVICE: AuthContext = { kind: "service" };

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

  // --- Admin CRUD (segment_manage). Default auth: service. ---

  /** Creates a segment. Default auth: service. */
  async create(input: SegmentInput, authCtx: AuthContext = SERVICE): Promise<Segment> {
    return this.ctx.http.request<Segment>({ method: "POST", path: this.base(), auth: authCtx, body: input });
  }

  /** Searches segments (POST body). Default auth: service. */
  async search(query: SegmentSearchQuery, authCtx: AuthContext = SERVICE): Promise<Segment[]> {
    return this.ctx.http.request<Segment[]>({
      method: "POST",
      path: `${this.base()}/search`,
      auth: authCtx,
      body: query,
    });
  }

  /** Full-replaces a segment (PUT). Default auth: service. */
  async update(segmentId: string, input: SegmentUpdateInput, authCtx: AuthContext = SERVICE): Promise<Segment> {
    return this.ctx.http.request<Segment>({
      method: "PUT",
      path: `${this.base()}/${segmentId}`,
      auth: authCtx,
      body: input,
    });
  }

  /** Partially updates a segment (PATCH). Default auth: service. */
  async patch(segmentId: string, input: SegmentPatchInput, authCtx: AuthContext = SERVICE): Promise<Segment> {
    return this.ctx.http.request<Segment>({
      method: "PATCH",
      path: `${this.base()}/${segmentId}`,
      auth: authCtx,
      body: input,
    });
  }

  /** Deletes a segment. Default auth: service. */
  async delete(segmentId: string, authCtx: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${segmentId}`,
      auth: authCtx,
    });
  }

  /** Checks which segments the given items/customers match. Default auth: service. */
  async match(input: SegmentMatchInput, authCtx: AuthContext = SERVICE): Promise<Segment[]> {
    return this.ctx.http.request<Segment[]>({
      method: "POST",
      path: `${this.base()}/match`,
      auth: authCtx,
      body: input,
    });
  }

  /** Creates multiple segments. Default auth: service. */
  async bulkCreate(inputs: SegmentBulkItem[], authCtx: AuthContext = SERVICE): Promise<SegmentBulkResult[]> {
    return this.ctx.http.request<SegmentBulkResult[]>({
      method: "POST",
      path: `${this.base()}/bulk`,
      auth: authCtx,
      body: inputs,
    });
  }

  /** Upserts multiple segments (PUT). Default auth: service. */
  async bulkUpdate(inputs: SegmentBulkItem[], authCtx: AuthContext = SERVICE): Promise<SegmentBulkResult[]> {
    return this.ctx.http.request<SegmentBulkResult[]>({
      method: "PUT",
      path: `${this.base()}/bulk`,
      auth: authCtx,
      body: inputs,
    });
  }

  /** Deletes multiple segments (DELETE with a body of ids). Default auth: service. */
  async bulkDelete(body: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentBulkResult[]> {
    return this.ctx.http.request<SegmentBulkResult[]>({
      method: "DELETE",
      path: `${this.base()}/bulk`,
      auth: authCtx,
      body,
    });
  }

  /** Customer→segment assignments (`segment_manage`). Default auth: service. */
  readonly customers = {
    list: async (segmentId: string, query?: Record<string, string | number>, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer[]> =>
      this.ctx.http.request<SegmentCustomer[]>({
        method: "GET",
        path: `${this.base()}/${segmentId}/customers`,
        auth: authCtx,
        ...(query ? { query } : {}),
      }),
    search: async (segmentId: string, query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer[]> =>
      this.ctx.http.request<SegmentCustomer[]>({
        method: "POST",
        path: `${this.base()}/${segmentId}/customers/search`,
        auth: authCtx,
        body: query,
      }),
    get: async (segmentId: string, customerId: string, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer> =>
      this.ctx.http.request<SegmentCustomer>({
        method: "GET",
        path: `${this.base()}/${segmentId}/customers/${customerId}`,
        auth: authCtx,
      }),
    assign: async (segmentId: string, customerId: string, input: SegmentCustomerInput, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer> =>
      this.ctx.http.request<SegmentCustomer>({
        method: "PUT",
        path: `${this.base()}/${segmentId}/customers/${customerId}`,
        auth: authCtx,
        body: input,
      }),
    remove: async (segmentId: string, customerId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.base()}/${segmentId}/customers/${customerId}`,
        auth: authCtx,
      });
    },
    getForEntity: async (segmentId: string, customerId: string, legalEntityId: string, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer> =>
      this.ctx.http.request<SegmentCustomer>({
        method: "GET",
        path: `${this.base()}/${segmentId}/customers/${customerId}/${legalEntityId}`,
        auth: authCtx,
      }),
    assignForEntity: async (segmentId: string, customerId: string, legalEntityId: string, input: SegmentCustomerInput, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer> =>
      this.ctx.http.request<SegmentCustomer>({
        method: "PUT",
        path: `${this.base()}/${segmentId}/customers/${customerId}/${legalEntityId}`,
        auth: authCtx,
        body: input,
      }),
    removeForEntity: async (segmentId: string, customerId: string, legalEntityId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.base()}/${segmentId}/customers/${customerId}/${legalEntityId}`,
        auth: authCtx,
      });
    },
    bulkAssign: async (segmentId: string, inputs: SegmentCustomerBulkInput[], authCtx: AuthContext = SERVICE): Promise<SegmentAssignmentBulkResult[]> =>
      this.ctx.http.request<SegmentAssignmentBulkResult[]>({
        method: "PUT",
        path: `${this.base()}/${segmentId}/customers/bulk`,
        auth: authCtx,
        body: inputs,
      }),
    bulkRemove: async (segmentId: string, body: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentAssignmentBulkResult[]> =>
      this.ctx.http.request<SegmentAssignmentBulkResult[]>({
        method: "DELETE",
        path: `${this.base()}/${segmentId}/customers/bulk`,
        auth: authCtx,
        body,
      }),
  };

  /** Item→segment assignments (`type` = PRODUCT | CATEGORY). Default auth: service. */
  readonly items = {
    search: async (segmentId: string, query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentItem[]> =>
      this.ctx.http.request<SegmentItem[]>({
        method: "POST",
        path: `${this.base()}/${segmentId}/items/search`,
        auth: authCtx,
        body: query,
      }),
    get: async (segmentId: string, type: string, itemId: string, authCtx: AuthContext = SERVICE): Promise<SegmentItem> =>
      this.ctx.http.request<SegmentItem>({
        method: "GET",
        path: `${this.base()}/${segmentId}/items/${type}/${itemId}`,
        auth: authCtx,
      }),
    assign: async (segmentId: string, type: string, itemId: string, input: SegmentItemInput, authCtx: AuthContext = SERVICE): Promise<SegmentItem> =>
      this.ctx.http.request<SegmentItem>({
        method: "PUT",
        path: `${this.base()}/${segmentId}/items/${type}/${itemId}`,
        auth: authCtx,
        body: input,
      }),
    remove: async (segmentId: string, type: string, itemId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.base()}/${segmentId}/items/${type}/${itemId}`,
        auth: authCtx,
      });
    },
    bulkAssign: async (segmentId: string, type: string, inputs: SegmentItemBulkInput[], authCtx: AuthContext = SERVICE): Promise<SegmentAssignmentBulkResult[]> =>
      this.ctx.http.request<SegmentAssignmentBulkResult[]>({
        method: "PUT",
        path: `${this.base()}/${segmentId}/items/${type}/bulk`,
        auth: authCtx,
        body: inputs,
      }),
    bulkRemove: async (segmentId: string, type: string, body: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentAssignmentBulkResult[]> =>
      this.ctx.http.request<SegmentAssignmentBulkResult[]>({
        method: "DELETE",
        path: `${this.base()}/${segmentId}/items/${type}/bulk`,
        auth: authCtx,
        body,
      }),
  };
}
