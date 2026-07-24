# Category Admin CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing write-CRUD, POST-body search, and assignment management to `CategoryService` (`client.categories`), completing coverage of `packages/sdk/specs/category.yml` (minus one deprecated endpoint).

**Architecture:** Extend the existing `CategoryService` class in place — no new class, no client wiring, no constructor change. Core writes are direct methods; assignments become a `readonly assignments = {…}` sub-resource of arrow functions (matching `segment.ts`). Writes default to `SERVICE` auth (overridable); new reads default to `ANON`. Public types alias the generated types 1:1.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types under `src/generated/category`.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- Auth: `const SERVICE: AuthContext = { kind: "service" }` and `const ANON: AuthContext = { kind: "anonymous" }` already exist at the top of `category.ts`. Every write method signature ends with `auth: AuthContext = SERVICE`; every new read ends with `auth: AuthContext = ANON`.
- HTTP: always `this.ctx.http.request<T>({ method, path, query?, body?, idempotent?, auth })`. Base path is inline: `` `/category/${this.ctx.tenant}/...` ``.
- Assignment `ref.type` stays `'PRODUCT'` per the generated schema — do not widen to `CATEGORY`.
- Commitlint: scope must be `category`; subject's first word is a lowercase verb (e.g. `feat(category): add ...`).
- Do NOT modify existing methods (`get`/`list`/`search`/`listAll`/`tree`/`getTree`/`parents`/`childCategories`/`subcategories`/`productsIn`/`searchByIds`/`rebuildTree`).
- The deprecated `GET /categories/categoryTree` is out of scope.

## File Structure

- **Modify** `packages/sdk/src/services/category.ts` — extend the import from `../generated/category`, add public type aliases, add core-CRUD methods, add `searchByQuery`/`searchTrees`, add the `assignments` sub-resource.
- **Modify** `packages/sdk/src/index.ts:56` — add the new public type exports to the existing `./services/category` type-export.
- **Create** `packages/sdk/tests/services/category-admin.test.ts` — `vi.fn()`-mocked path/method/auth assertions (harness mirrors `tests/services/segment-admin.test.ts`).
- **Create** `.changeset/category-admin-crud.md` — minor changeset.

---

### Task 1: Core write CRUD (create/update/patch/delete)

**Files:**
- Modify: `packages/sdk/src/services/category.ts` (import block line 6; type aliases after line 15; methods appended at end of class)
- Modify: `packages/sdk/src/index.ts:56`
- Test: `packages/sdk/tests/services/category-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `CategoryService(ctx)` constructor, `SERVICE`/`ANON` consts, `AuthContext`.
- Produces:
  - `type CategoryCreateInput`, `CategoryUpdateInput`, `CategoryPatchInput`, `CategoryCreated`
  - `create(input: CategoryCreateInput, options?: { publish?: boolean }, auth?: AuthContext): Promise<CategoryCreated>`
  - `update(categoryId: string, input: CategoryUpdateInput, options?: { publish?: boolean }, auth?: AuthContext): Promise<CategoryCreated | void>`
  - `patch(categoryId: string, input: CategoryPatchInput, options?: { publish?: boolean }, auth?: AuthContext): Promise<void>`
  - `delete(categoryId: string, auth?: AuthContext): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/category-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CategoryService } from "../../src/services/category";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof CategoryService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): CategoryService => new CategoryService(ctxWith(req));
const B = "/category/acme/categories";

describe("CategoryService admin core CRUD", () => {
  it("create/update/patch/delete hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(c).create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: B, auth: { kind: "service" } }));

    const u = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(u).update("c1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/c1`, auth: { kind: "service" } }));

    const p = vi.fn().mockResolvedValue(undefined);
    await svc(p).patch("c1", {} as never);
    expect(p).toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH", path: `${B}/c1`, auth: { kind: "service" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("c1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1`, auth: { kind: "service" } }));
  });

  it("maps the publish option to the query flag", async () => {
    const c = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(c).create({} as never, { publish: true });
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ query: { publish: true } }));
  });

  it("honors an explicit auth override", async () => {
    const r = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(r).create({} as never, {}, { kind: "raw", token: "T" });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "T" } }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- category-admin`
Expected: FAIL — `create` / `update` / `patch` / `delete` are not functions (methods don't exist yet).

- [ ] **Step 3: Extend the generated-type import**

In `packages/sdk/src/services/category.ts`, replace line 6:

```ts
import type { Category as GeneratedCategory, CategoryTree } from "../generated/category";
```

with:

```ts
import type {
  Category as GeneratedCategory,
  CategoryTree,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  CategoryPartialUpdateRequest,
  CategoryIdResponse,
} from "../generated/category";
```

- [ ] **Step 4: Add the core type aliases**

In `category.ts`, immediately after the `CategoryNode` alias (after line 15):

```ts
/** Body for creating a category (`POST /categories`). */
export type CategoryCreateInput = CategoryCreateRequest;

/** Body for a full category replace (`PUT /categories/{id}`). */
export type CategoryUpdateInput = CategoryUpdateRequest;

/** Body for a partial category update (`PATCH /categories/{id}`). */
export type CategoryPatchInput = CategoryPartialUpdateRequest;

/** Id envelope returned when a category is created. */
export type CategoryCreated = CategoryIdResponse;
```

- [ ] **Step 5: Add the core-CRUD methods**

In `category.ts`, append these methods inside the `CategoryService` class, after the last existing method (`getTree`) and before the class's closing brace:

```ts
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
      ...(options.publish === undefined ? {} : { query: { publish: options.publish } }),
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
      ...(options.publish === undefined ? {} : { query: { publish: options.publish } }),
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
      ...(options.publish === undefined ? {} : { query: { publish: options.publish } }),
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
```

- [ ] **Step 6: Export the new types**

In `packages/sdk/src/index.ts`, replace line 56:

```ts
export type { Category, CategoryNode } from "./services/category";
```

with:

```ts
export type {
  Category,
  CategoryNode,
  CategoryCreateInput,
  CategoryUpdateInput,
  CategoryPatchInput,
  CategoryCreated,
} from "./services/category";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- category-admin`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/src/index.ts packages/sdk/tests/services/category-admin.test.ts
git commit -m "feat(category): add category write crud"
```

---

### Task 2: POST-body search (searchByQuery + searchTrees)

**Files:**
- Modify: `packages/sdk/src/services/category.ts` (import block; one type alias; two methods)
- Modify: `packages/sdk/src/index.ts` (the `./services/category` type-export block)
- Test: `packages/sdk/tests/services/category-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `resolveQuery`, `QueryFor` (already imported), `PaginatedItems`, `Category`, `CategoryNode`.
- Produces:
  - `type CategoryTreeSearchInput`
  - `searchByQuery(query: QueryFor<"CATEGORY">, params?: { pageNumber?: number; pageSize?: number; sort?: string; showRoots?: boolean; showUnpublished?: boolean }, auth?: AuthContext): Promise<PaginatedItems<Category>>`
  - `searchTrees(input: CategoryTreeSearchInput, options?: { showUnpublished?: boolean }, auth?: AuthContext): Promise<CategoryNode[]>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/category-admin.test.ts`:

```ts
describe("CategoryService search reads", () => {
  it("searchByQuery POSTs /categories/search with a resolved q body and ANON default", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "c1" }]);
    const res = await svc(s).searchByQuery("name:Shoes");
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${B}/search`,
        body: { q: "name:Shoes" },
        auth: { kind: "anonymous" },
      }),
    );
    expect(res.items).toEqual([{ id: "c1" }]);
    expect(res.hasNextPage).toBe(false);
  });

  it("searchByQuery forwards optional query flags", async () => {
    const s = vi.fn().mockResolvedValue([]);
    await svc(s).searchByQuery("*", { showRoots: true, sort: "position:ASC" });
    expect(s.mock.calls[0][0].query).toMatchObject({ showRoots: true, sort: "position:ASC" });
  });

  it("searchTrees POSTs /category-trees/search", async () => {
    const t = vi.fn().mockResolvedValue([{ id: "root" }]);
    await svc(t).searchTrees({ categoryIds: ["c1"] });
    expect(t).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/category/acme/category-trees/search",
        body: { categoryIds: ["c1"] },
        auth: { kind: "anonymous" },
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- category-admin`
Expected: FAIL — `searchByQuery` / `searchTrees` are not functions.

- [ ] **Step 3: Extend the generated-type import**

In `category.ts`, add `CategoryTreeSearchRequest` to the `../generated/category` import (the block edited in Task 1):

```ts
import type {
  Category as GeneratedCategory,
  CategoryTree,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  CategoryPartialUpdateRequest,
  CategoryIdResponse,
  CategoryTreeSearchRequest,
} from "../generated/category";
```

- [ ] **Step 4: Add the type alias**

In `category.ts`, after the `CategoryCreated` alias:

```ts
/** Body for searching category trees (`POST /category-trees/search`). */
export type CategoryTreeSearchInput = CategoryTreeSearchRequest;
```

- [ ] **Step 5: Add the search methods**

Append to the `CategoryService` class (after `delete`, before the `assignments` sub-resource that Task 3 adds):

```ts
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
        ...(params.showRoots === undefined ? {} : { showRoots: params.showRoots }),
        ...(params.showUnpublished === undefined ? {} : { showUnpublished: params.showUnpublished }),
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
      ...(options.showUnpublished === undefined ? {} : { query: { showUnpublished: options.showUnpublished } }),
      body: input,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
      auth,
    });
  }
```

- [ ] **Step 6: Export the new type**

In `packages/sdk/src/index.ts`, add `CategoryTreeSearchInput` to the `./services/category` type-export block:

```ts
export type {
  Category,
  CategoryNode,
  CategoryCreateInput,
  CategoryUpdateInput,
  CategoryPatchInput,
  CategoryCreated,
  CategoryTreeSearchInput,
} from "./services/category";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- category-admin`
Expected: PASS (6 tests total).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/src/index.ts packages/sdk/tests/services/category-admin.test.ts
git commit -m "feat(category): add post-body category and tree search"
```

---

### Task 3: Assignments sub-resource

**Files:**
- Modify: `packages/sdk/src/services/category.ts` (import block; six type aliases; `readonly assignments = {…}` member)
- Modify: `packages/sdk/src/index.ts` (the `./services/category` type-export block)
- Test: `packages/sdk/tests/services/category-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `AuthContext`, `SERVICE`, `ANON`, `Category`, `this.ctx`.
- Produces:
  - `type CategoryAssignment`, `CategoryAssignmentInput`, `CategoryAssignmentBulkInput`, `CategoryAssignmentRefBulkInput`, `CategoryAssignmentBulkResult`, `CategoryAssignmentCreated`
  - `readonly assignments` with: `list`, `create`, `bulkCreate`, `remove`, `removeAll`, `upsertByReference`, `removeByReference`, `bulkUpsertByReference`, `listCategoriesByReference`, `removeAllByReference` (exact signatures in Step 5).

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/category-admin.test.ts`:

```ts
describe("CategoryService.assignments", () => {
  it("category-bound assignment ops hit the right method+path", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "a1" }]);
    await svc(l).assignments.list("c1");
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/c1/assignments`, auth: { kind: "anonymous" } }));

    const cr = vi.fn().mockResolvedValue({ id: "a1" });
    await svc(cr).assignments.create("c1", { ref: { id: "p1", type: "PRODUCT" } });
    expect(cr).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/c1/assignments`, auth: { kind: "service" } }));

    const bc = vi.fn().mockResolvedValue([{ status: "201" }]);
    await svc(bc).assignments.bulkCreate("c1", [{ ref: { id: "p1", type: "PRODUCT" } }]);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/c1/assignments/bulk`, auth: { kind: "service" } }));

    const rm = vi.fn().mockResolvedValue(undefined);
    await svc(rm).assignments.remove("c1", "a1");
    expect(rm).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1/assignments/a1`, auth: { kind: "service" } }));

    const ra = vi.fn().mockResolvedValue(undefined);
    await svc(ra).assignments.removeAll("c1", { assignmentType: "PRODUCT" });
    expect(ra).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1/assignments`, query: { assignmentType: "PRODUCT" } }));
  });

  it("reference-based assignment ops hit /assignments/references/...", async () => {
    const up = vi.fn().mockResolvedValue({ id: "a1" });
    await svc(up).assignments.upsertByReference("c1", "p1");
    expect(up).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/c1/assignments/references/p1`, auth: { kind: "service" } }));
    expect(up.mock.calls[0][0]).not.toHaveProperty("body");

    const rr = vi.fn().mockResolvedValue(undefined);
    await svc(rr).assignments.removeByReference("c1", "p1");
    expect(rr).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1/assignments/references/p1` }));

    const bu = vi.fn().mockResolvedValue([{ status: "200" }]);
    await svc(bu).assignments.bulkUpsertByReference("c1", [{ ref: { id: "p1" } }]);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/c1/assignments/references/bulk`, auth: { kind: "service" } }));
  });

  it("tenant-level reference ops target /assignments/references/{id}", async () => {
    const lc = vi.fn().mockResolvedValue([{ id: "c1" }]);
    await svc(lc).assignments.listCategoriesByReference("p1");
    expect(lc).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/category/acme/assignments/references/p1", auth: { kind: "anonymous" } }));

    const rl = vi.fn().mockResolvedValue(undefined);
    await svc(rl).assignments.removeAllByReference("p1");
    expect(rl).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/category/acme/assignments/references/p1", auth: { kind: "service" } }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- category-admin`
Expected: FAIL — `assignments` is undefined.

- [ ] **Step 3: Extend the generated-type import**

In `category.ts`, add the assignment types to the `../generated/category` import block:

```ts
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
```

- [ ] **Step 4: Add the assignment type aliases**

In `category.ts`, after the `CategoryTreeSearchInput` alias:

```ts
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
```

- [ ] **Step 5: Add the `assignments` sub-resource**

Append this member inside the `CategoryService` class (after `searchTrees`, before the class's closing brace):

```ts
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
          ...(params.expandSupercategoriesIds === undefined ? {} : { expandSupercategoriesIds: params.expandSupercategoriesIds }),
          ...(params.showUnpublished === undefined ? {} : { showUnpublished: params.showUnpublished }),
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
          ...(params.showUnpublished === undefined ? {} : { showUnpublished: params.showUnpublished }),
          ...(params.expandSupercategoriesIds === undefined ? {} : { expandSupercategoriesIds: params.expandSupercategoriesIds }),
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
```

- [ ] **Step 6: Export the new types**

In `packages/sdk/src/index.ts`, add the six assignment types to the `./services/category` type-export block:

```ts
export type {
  Category,
  CategoryNode,
  CategoryCreateInput,
  CategoryUpdateInput,
  CategoryPatchInput,
  CategoryCreated,
  CategoryTreeSearchInput,
  CategoryAssignment,
  CategoryAssignmentInput,
  CategoryAssignmentBulkInput,
  CategoryAssignmentRefBulkInput,
  CategoryAssignmentBulkResult,
  CategoryAssignmentCreated,
} from "./services/category";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- category-admin`
Expected: PASS (9 tests total).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/src/index.ts packages/sdk/tests/services/category-admin.test.ts
git commit -m "feat(category): add category assignment management"
```

---

### Task 4: Changeset + full verification

**Files:**
- Create: `.changeset/category-admin-crud.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/category-admin-crud.md`:

```md
---
"@viu/emporix-sdk": minor
---

Add category admin CRUD to `client.categories`: core writes
(`create`/`update`/`patch`/`delete`), POST-body search (`searchByQuery`,
`searchTrees`), and a `categories.assignments` sub-resource — `list`,
`create`, `bulkCreate`, `remove`, `removeAll`, reference-based
`upsertByReference`/`removeByReference`/`bulkUpsertByReference`, and
tenant-wide `listCategoriesByReference`/`removeAllByReference`. Writes default
to service auth (overridable). The existing storefront reads are unchanged.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the new `category-admin` tests).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/category-admin-crud.md
git commit -m "chore(category): add changeset for category admin crud"
```

---

## Self-Review

**Spec coverage** — every spec operation maps to a task:

| Spec operation | Task |
|---|---|
| `create` (POST /categories) | 1 |
| `update` (PUT /categories/{id}) | 1 |
| `patch` (PATCH /categories/{id}) | 1 |
| `delete` (DELETE /categories/{id}) | 1 |
| `searchByQuery` (POST /categories/search) | 2 |
| `searchTrees` (POST /category-trees/search) | 2 |
| `assignments.list` (GET …/assignments) | 3 |
| `assignments.create` (POST …/assignments) | 3 |
| `assignments.bulkCreate` (POST …/assignments/bulk) | 3 |
| `assignments.remove` (DELETE …/assignments/{assignmentId}) | 3 |
| `assignments.removeAll` (DELETE …/assignments) | 3 |
| `assignments.upsertByReference` (PUT …/references/{referenceId}) | 3 |
| `assignments.removeByReference` (DELETE …/references/{referenceId}) | 3 |
| `assignments.bulkUpsertByReference` (PUT …/references/bulk) | 3 |
| `assignments.listCategoriesByReference` (GET /assignments/references/{referenceId}) | 3 |
| `assignments.removeAllByReference` (DELETE /assignments/references/{referenceId}) | 3 |
| All 11 public type aliases | 1–3 |
| Changeset (minor) | 4 |

Deprecated `GET /categories/categoryTree` — intentionally excluded (spec "Out of scope"). ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** method names and the `assignments.*` keys used in the Task 3 tests match Step 5 exactly (`list`, `create`, `bulkCreate`, `remove`, `removeAll`, `upsertByReference`, `removeByReference`, `bulkUpsertByReference`, `listCategoriesByReference`, `removeAllByReference`). The index.ts export block grows monotonically across Tasks 1→2→3 (each shows its full final state). Generated import names verified against `src/generated/category/types.gen.ts` (`CategoryCreateRequest`, `CategoryUpdateRequest`, `CategoryPartialUpdateRequest`, `CategoryIdResponse`, `CategoryTreeSearchRequest`, `CategoryAssignment`, `AssignmentRequest`, `BulkAssignmentRequest`, `BulkAssignmentUpsertRequest`, `BulkAssignmentResponse`, `AssignmentIdResponse`). ✓
