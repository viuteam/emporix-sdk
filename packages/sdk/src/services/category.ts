import type { ClientContext, PaginatedItems } from "../core/context";
import { iterateAll } from "../core/context";
import type { AuthContext } from "../core/auth";
import { resolveQuery, type QueryFor } from "../core/query";
import type { Product } from "./product";
import type {
  Category as GeneratedCategory,
  CategoryTree,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  CategoryPartialUpdateRequest,
  CategoryIdResponse,
  CategoryTreeSearchRequest,
  CategoryAssignment as GeneratedCategoryAssignment,
  AssignmentRequest,
  BulkAssignmentRequest,
  BulkAssignmentUpsertRequest,
  BulkAssignmentResponse,
  AssignmentIdResponse,
} from "../generated/category";

const ANON: AuthContext = { kind: "anonymous" };
const SERVICE: AuthContext = { kind: "service" };

/** A category as returned by the Category service (all generated fields). */
export type Category = GeneratedCategory;

/** The category tree as returned by the Category service. */
export type CategoryNode = CategoryTree;

/** Body for creating a category (`POST /categories`). */
export type CategoryCreateInput = CategoryCreateRequest;

/** Body for a full category replace (`PUT /categories/{id}`). */
export type CategoryUpdateInput = CategoryUpdateRequest;

/** Body for a partial category update (`PATCH /categories/{id}`). */
export type CategoryPatchInput = CategoryPartialUpdateRequest;

/** Id envelope returned when a category is created. */
export type CategoryCreated = CategoryIdResponse;

/** Body for searching category trees (`POST /category-trees/search`). */
export type CategoryTreeSearchInput = CategoryTreeSearchRequest;

/** A category assignment (a resource reference bound to a category). */
export type CategoryAssignment = GeneratedCategoryAssignment;

/** Body for assigning a single resource to a category. */
export type CategoryAssignmentInput = AssignmentRequest;

/** Body for bulk-assigning resources to a category. */
export type CategoryAssignmentBulkInput = BulkAssignmentRequest;

/** Body for bulk-upserting assignment references (`ref.id` only). */
export type CategoryAssignmentRefBulkInput = BulkAssignmentUpsertRequest;

/** Multi-status result of a bulk assignment operation. */
export type CategoryAssignmentBulkResult = BulkAssignmentResponse;

/** Id envelope returned when an assignment is created. */
export type CategoryAssignmentCreated = AssignmentIdResponse;

/** Category reads. Default auth: anonymous. */
export class CategoryService {
  static readonly channel = "category" as const;
  constructor(private readonly ctx: ClientContext) {}

  /** Fetches one category by id. */
  async get(categoryId: string, auth: AuthContext = ANON): Promise<Category> {
    return this.ctx.http.request<Category>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}`,
      auth,
    });
  }

  /** One page of categories. */
  async list(
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Category>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Category[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /**
   * Searches categories by a `q` filter — a raw Emporix DSL string or a built
   * filter (e.g. `@viu/emporix-mixins`' `mixinQuery(...)`). Category does not
   * support `compoundLogicalQuery`, so `or()` filters are rejected.
   */
  async search(
    query: QueryFor<"CATEGORY">,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Category>> {
    const q = resolveQuery(query, { compoundLogicalQuery: false });
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Category[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories`,
      query: { q, pageNumber, pageSize },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Async-iterates every category across pages. */
  listAll(params: { pageSize?: number } = {}, auth: AuthContext = ANON): AsyncIterable<Category> {
    const pageSize = params.pageSize ?? 50;
    return iterateAll<Category>((pageNumber) => this.list({ pageNumber, pageSize }, auth));
  }

  /**
   * The catalogue's **root categories** — the published category trees
   * (`GET /category-trees`). Use these for top-level storefront navigation;
   * drill into a node's children with {@link subcategories}.
   */
  async tree(auth: AuthContext = ANON): Promise<Category[]> {
    return this.ctx.http.request<Category[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/category-trees`,
      auth,
    });
  }

  /**
   * Rebuild a category tree from its root (`POST /category-trees/{rootCategoryId}/rebuild`).
   * Admin write — defaults to the service token. Returns the rebuilt tree.
   */
  async rebuildTree(rootCategoryId: string, auth: AuthContext = SERVICE): Promise<CategoryNode> {
    return this.ctx.http.request<CategoryNode>({
      method: "POST",
      path: `/category/${this.ctx.tenant}/category-trees/${encodeURIComponent(rootCategoryId)}/rebuild`,
      auth,
    });
  }

  /**
   * Direct child categories of a category (for hierarchy drill-down). Mirrors
   * {@link productsIn}: reads the category's **assignments** and keeps the
   * `CATEGORY` references, resolving them to full categories. Returns an empty
   * array when the category has no child categories.
   */
  async subcategories(
    categoryId: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Category[]> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const assignments = await this.ctx.http.request<Array<{ ref?: { id?: string; type?: string } }>>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments`,
      query: { pageNumber, pageSize },
      auth,
    });
    const categoryIds = assignments
      .map((a) => (a.ref?.type?.toUpperCase() === "CATEGORY" ? a.ref.id : undefined))
      .filter((id): id is string => Boolean(id));
    if (categoryIds.length === 0) return [];
    return this.searchByIds(categoryIds, {}, auth);
  }

  /**
   * One page of products in a category. The category service exposes products
   * as **assignments** (`/categories/{id}/assignments`) — references, not full
   * products — so this fetches a page of assignments, keeps the `PRODUCT`
   * references, and resolves them to full products via `/products/search`.
   * `hasNextPage` reflects the assignments page (the source of truth for
   * pagination).
   */
  async productsIn(
    categoryId: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const assignments = await this.ctx.http.request<Array<{ ref?: { id?: string; type?: string } }>>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments`,
      query: { pageNumber, pageSize },
      auth,
    });
    const hasNextPage = assignments.length === pageSize;
    const productIds = assignments
      .map((a) => (a.ref?.type?.toUpperCase() === "PRODUCT" ? a.ref.id : undefined))
      .filter((id): id is string => Boolean(id));
    if (productIds.length === 0) {
      return { items: [], pageNumber, pageSize, hasNextPage };
    }
    const items = await this.ctx.http.request<Product[]>({
      method: "POST",
      path: `/product/${this.ctx.tenant}/products/search`,
      query: { pageSize: productIds.length },
      auth,
      body: { q: `id:(${productIds.join(",")})` },
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
    });
    return { items, pageNumber, pageSize, hasNextPage };
  }

  /**
   * Bulk fetch by id. POSTs `/categories/search` with `q="id:(id1,id2,…)"`,
   * chunking when the list is larger than `options.chunkSize` (default
   * 100). An empty list short-circuits with no HTTP call. **Order is not
   * guaranteed** across chunks — re-index by `id` if order matters.
   */
  async searchByIds(
    ids: string[],
    options: { chunkSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Category[]> {
    if (ids.length === 0) return [];
    const chunkSize = options.chunkSize ?? 100;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.ctx.http.request<Category[]>({
          method: "POST",
          path: `/category/${this.ctx.tenant}/categories/search`,
          query: { pageSize: chunk.length },
          auth,
          body: { q: `id:(${chunk.join(",")})` },
        }),
      ),
    );
    return pages.flat();
  }

  /** Lists a category's ancestor categories (breadcrumb-up). Default auth: anonymous. */
  async parents(categoryId: string, auth: AuthContext = ANON): Promise<Category[]> {
    return this.ctx.http.request<Category[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}/parents`,
      auth,
    });
  }

  /**
   * Lists a category's direct child categories via the dedicated
   * `…/subcategories` endpoint. (The older `subcategories()` reads `/assignments`
   * and is kept for backward compatibility.) Default auth: anonymous.
   */
  async childCategories(categoryId: string, auth: AuthContext = ANON): Promise<Category[]> {
    return this.ctx.http.request<Category[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}/subcategories`,
      auth,
    });
  }

  /** Retrieves one category tree by its root category id. Default auth: anonymous. */
  async getTree(categoryId: string, auth: AuthContext = ANON): Promise<CategoryNode> {
    return this.ctx.http.request<CategoryNode>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/category-trees/${encodeURIComponent(categoryId)}`,
      auth,
    });
  }

  // --- Admin write CRUD. Default auth: service. ---

  /**
   * Creates a category (`POST /categories`). Default auth: service.
   * `options.publish` sets the `publish` query flag (needs the
   * `category.category_publish` scope).
   */
  async create(
    input: CategoryCreateInput,
    options: { publish?: boolean } = {},
    auth: AuthContext = SERVICE,
  ): Promise<CategoryCreated> {
    return this.ctx.http.request<CategoryCreated>({
      method: "POST",
      path: `/category/${this.ctx.tenant}/categories`,
      ...(options.publish === undefined ? {} : { query: { publish: String(options.publish) } }),
      body: input,
      auth,
    });
  }

  /**
   * Full-replaces a category (`PUT /categories/{categoryId}`). This is an
   * upsert: with a caller-supplied id it may create (201, returns the id) or
   * update an existing one (204, returns nothing). Default auth: service.
   */
  async update(
    categoryId: string,
    input: CategoryUpdateInput,
    options: { publish?: boolean } = {},
    auth: AuthContext = SERVICE,
  ): Promise<CategoryCreated | void> {
    return this.ctx.http.request<CategoryCreated | void>({
      method: "PUT",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}`,
      ...(options.publish === undefined ? {} : { query: { publish: String(options.publish) } }),
      body: input,
      auth,
    });
  }

  /**
   * Partially updates a category (`PATCH /categories/{categoryId}`). Default
   * auth: service. `options.publish` sets the `publish` query flag.
   */
  async patch(
    categoryId: string,
    input: CategoryPatchInput,
    options: { publish?: boolean } = {},
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}`,
      ...(options.publish === undefined ? {} : { query: { publish: String(options.publish) } }),
      body: input,
      auth,
    });
  }

  /** Deletes a category (`DELETE /categories/{categoryId}`). Default auth: service. */
  async delete(categoryId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}`,
      auth,
    });
  }

  /**
   * Searches categories via `POST /categories/search`. Same query capability
   * as {@link search} (`compoundLogicalQuery: false` — Category rejects `or()`
   * filters); the POST body avoids URL-length limits for large `q` filters.
   * `params.showRoots` / `params.showUnpublished` are POST-only flags. Default
   * auth: anonymous.
   */
  async searchByQuery(
    query: QueryFor<"CATEGORY">,
    params: { pageNumber?: number; pageSize?: number; sort?: string; showRoots?: boolean; showUnpublished?: boolean } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Category>> {
    const q = resolveQuery(query, { compoundLogicalQuery: false });
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Category[]>({
      method: "POST",
      path: `/category/${this.ctx.tenant}/categories/search`,
      query: {
        pageNumber,
        pageSize,
        ...(params.sort === undefined ? {} : { sort: params.sort }),
        ...(params.showRoots === undefined ? {} : { showRoots: String(params.showRoots) }),
        ...(params.showUnpublished === undefined ? {} : { showUnpublished: String(params.showUnpublished) }),
      },
      body: { q },
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /**
   * Searches category trees via `POST /category-trees/search` — returns the
   * trees that include at least one of the given `categoryIds`. Default auth:
   * anonymous.
   */
  async searchTrees(
    input: CategoryTreeSearchInput,
    options: { showUnpublished?: boolean } = {},
    auth: AuthContext = ANON,
  ): Promise<CategoryNode[]> {
    return this.ctx.http.request<CategoryNode[]>({
      method: "POST",
      path: `/category/${this.ctx.tenant}/category-trees/search`,
      ...(options.showUnpublished === undefined ? {} : { query: { showUnpublished: String(options.showUnpublished) } }),
      body: input,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
      auth,
    });
  }

  /**
   * Category ↔ resource assignments. Writes default to service auth. The
   * assignment `ref.type` is `'PRODUCT'` (per the API); category hierarchy is
   * managed via `parentId` on the category, not via assignments.
   */
  readonly assignments = {
    /** One page of a category's assignments. Default auth: anonymous. */
    list: async (
      categoryId: string,
      params: { pageNumber?: number; pageSize?: number; sort?: string; expandSupercategoriesIds?: boolean; showUnpublished?: boolean } = {},
      auth: AuthContext = ANON,
    ): Promise<CategoryAssignment[]> =>
      this.ctx.http.request<CategoryAssignment[]>({
        method: "GET",
        path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments`,
        query: {
          ...(params.pageNumber === undefined ? {} : { pageNumber: params.pageNumber }),
          ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
          ...(params.sort === undefined ? {} : { sort: params.sort }),
          ...(params.expandSupercategoriesIds === undefined ? {} : { expandSupercategoriesIds: String(params.expandSupercategoriesIds) }),
          ...(params.showUnpublished === undefined ? {} : { showUnpublished: String(params.showUnpublished) }),
        },
        auth,
      }),

    /** Assigns a single resource to a category (`POST …/assignments`). Default auth: service. */
    create: async (categoryId: string, input: CategoryAssignmentInput, auth: AuthContext = SERVICE): Promise<CategoryAssignmentCreated> =>
      this.ctx.http.request<CategoryAssignmentCreated>({
        method: "POST",
        path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments`,
        body: input,
        auth,
      }),

    /** Bulk-assigns resources to a category (`POST …/assignments/bulk`). Default auth: service. */
    bulkCreate: async (categoryId: string, input: CategoryAssignmentBulkInput, auth: AuthContext = SERVICE): Promise<CategoryAssignmentBulkResult> =>
      this.ctx.http.request<CategoryAssignmentBulkResult>({
        method: "POST",
        path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments/bulk`,
        body: input,
        auth,
      }),

    /** Removes one assignment by id (`DELETE …/assignments/{assignmentId}`). Default auth: service. */
    remove: async (categoryId: string, assignmentId: string, auth: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments/${assignmentId}`,
        auth,
      });
    },

    /** Removes all of a category's assignments (`DELETE …/assignments`). Default auth: service. */
    removeAll: async (categoryId: string, options: { assignmentType?: "PRODUCT" } = {}, auth: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments`,
        ...(options.assignmentType === undefined ? {} : { query: { assignmentType: options.assignmentType } }),
        auth,
      });
    },

    /** Upserts an assignment by reference id — no body (`PUT …/assignments/references/{referenceId}`). Default auth: service. */
    upsertByReference: async (categoryId: string, referenceId: string, auth: AuthContext = SERVICE): Promise<CategoryAssignmentCreated> =>
      this.ctx.http.request<CategoryAssignmentCreated>({
        method: "PUT",
        path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments/references/${referenceId}`,
        auth,
      }),

    /** Removes an assignment by reference id (`DELETE …/assignments/references/{referenceId}`). Default auth: service. */
    removeByReference: async (categoryId: string, referenceId: string, auth: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments/references/${referenceId}`,
        auth,
      });
    },

    /** Bulk-upserts assignment references (`PUT …/assignments/references/bulk`). Default auth: service. */
    bulkUpsertByReference: async (categoryId: string, input: CategoryAssignmentRefBulkInput, auth: AuthContext = SERVICE): Promise<CategoryAssignmentBulkResult> =>
      this.ctx.http.request<CategoryAssignmentBulkResult>({
        method: "PUT",
        path: `/category/${this.ctx.tenant}/categories/${categoryId}/assignments/references/bulk`,
        body: input,
        auth,
      }),

    /**
     * Lists every category assigned to the given reference id — tenant-wide
     * (`GET /assignments/references/{referenceId}`). Default auth: anonymous.
     */
    listCategoriesByReference: async (
      referenceId: string,
      params: { pageNumber?: number; pageSize?: number; sort?: string; showUnpublished?: boolean; expandSupercategoriesIds?: boolean } = {},
      auth: AuthContext = ANON,
    ): Promise<Category[]> =>
      this.ctx.http.request<Category[]>({
        method: "GET",
        path: `/category/${this.ctx.tenant}/assignments/references/${referenceId}`,
        query: {
          ...(params.pageNumber === undefined ? {} : { pageNumber: params.pageNumber }),
          ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
          ...(params.sort === undefined ? {} : { sort: params.sort }),
          ...(params.showUnpublished === undefined ? {} : { showUnpublished: String(params.showUnpublished) }),
          ...(params.expandSupercategoriesIds === undefined ? {} : { expandSupercategoriesIds: String(params.expandSupercategoriesIds) }),
        },
        auth,
      }),

    /** Removes all assignments to a given reference id — tenant-wide (`DELETE /assignments/references/{referenceId}`). Default auth: service. */
    removeAllByReference: async (referenceId: string, auth: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/category/${this.ctx.tenant}/assignments/references/${referenceId}`,
        auth,
      });
    },
  };
}
