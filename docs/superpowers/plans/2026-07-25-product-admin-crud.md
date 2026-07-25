# Product Admin CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 12 missing product-write operations to `ProductService` — product CRUD (`create`/`update`/`replace`/`delete`), bulk create/update, the dynamic-variant recalculation group, and a `templates` sub-resource — completing coverage of `packages/sdk/specs/product.yml`.

**Architecture:** Extend the existing `ProductService` class in place with flat methods plus a `readonly templates = {…}` sub-resource of arrow functions. Writes default to a new `SERVICE` auth const (overridable); new reads default to the existing `ANON`. Public types alias generated types 1:1. No client wiring, no constructor change.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types under `src/generated/product`.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- HTTP: `this.ctx.http.request<T>({ method, path, query?, body?, auth })`. Paths are written inline: `` `/product/${this.ctx.tenant}/products…` `` (this service has no `base()` helper).
- **Boolean query flags MUST be `String(...)`-serialized** — the `query` type is `Record<string, string | number | undefined>` and rejects booleans. Build query objects with conditional spreads: `...(o.doIndex === undefined ? {} : { doIndex: String(o.doIndex) })`.
- Auth: `const ANON: AuthContext = { kind: "anonymous" }` already exists at line 12. Add `const SERVICE: AuthContext = { kind: "service" }` beside it. Every write ends with `auth: AuthContext = SERVICE`; every new read ends with `auth: AuthContext = ANON`.
- Commitlint: scope `product` is allowed; subject's first word must be a lowercase verb.
- Do NOT modify existing methods (`get`, `getByCode`, `list`, `listAll`, `search`, `searchByName`, `searchByIds`, `searchByCodes`, `listVariantChildren`, `listVariantChildrenAll`) and do NOT widen the public `Product` read union.

## File Structure

- **Modify** `packages/sdk/src/services/product.ts` — extend the generated-type import (lines 5-10), add the `SERVICE` const, add 15 public type aliases, add 9 flat methods + the `templates` sub-resource at the end of the class (the class's final `}` is at line 220).
- **Modify** `packages/sdk/src/index.ts:54` — extend the `./services/product` type export.
- **Create** `packages/sdk/tests/services/product-admin.test.ts` — `vi.fn()`-mocked path/method/auth/query assertions.
- **Create** `.changeset/product-admin-crud.md` — minor changeset.

---

### Task 1: Types + product write CRUD

**Files:**
- Modify: `packages/sdk/src/services/product.ts` (import block lines 5-10; `SERVICE` const after line 12; aliases after line 18; methods appended before the class's closing `}` on line 220)
- Modify: `packages/sdk/src/index.ts:54`
- Test: `packages/sdk/tests/services/product-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `ProductService(ctx)`, `ANON`, `AuthContext`.
- Produces (all 15 aliases, so Tasks 2/3 and the index edit happen once):
  - `type ProductCreateInput`, `ProductUpdateInput`, `ProductPatchInput`, `ProductCreated`, `ProductBulkCreateInput`, `ProductBulkUpdateInput`, `ProductBulkResult`, `ProductRecalculationInput`, `ProductRecalculationResult`, `ProductRecalculationJob`, `ProductRecalculationJobStatus`, `ProductTemplate`, `ProductTemplateCreateInput`, `ProductTemplateUpdateInput`, `ProductTemplateCreated`
  - `create(input: ProductCreateInput, options?: ProductWriteOptions, auth?: AuthContext): Promise<ProductCreated>`
  - `update(productId: string, input: ProductPatchInput, options?: ProductWriteOptions, auth?: AuthContext): Promise<void>`
  - `replace(productId: string, input: ProductUpdateInput, options?: ProductWriteOptions & { partial?: boolean }, auth?: AuthContext): Promise<ProductCreated | void>`
  - `delete(productId: string, options?: { force?: boolean; doIndex?: boolean }, auth?: AuthContext): Promise<void>`
  - `interface ProductWriteOptions { skipVariantGeneration?: boolean; doIndex?: boolean; skipRelatedItemsValidation?: boolean }`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/product-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ProductService } from "../../src/services/product";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof ProductService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): ProductService => new ProductService(ctxWith(req));
const B = "/product/acme/products";
const T = "/product/acme/product-templates";

describe("ProductService write CRUD", () => {
  it("create/update/replace/delete hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(c).create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: B, auth: { kind: "service" } }));

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).update("p1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH", path: `${B}/p1`, auth: { kind: "service" } }));

    const r = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(r).replace("p1", {} as never);
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/p1`, auth: { kind: "service" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("p1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/p1`, auth: { kind: "service" } }));
  });

  it("stringifies the boolean write flags into the query", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(c).create({} as never, { doIndex: true, skipVariantGeneration: false });
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ query: { doIndex: "true", skipVariantGeneration: "false" } }),
    );

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).replace("p1", {} as never, { partial: true });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ query: { partial: "true" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("p1", { force: true });
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ query: { force: "true" } }));
  });

  it("omits the query entirely when no flags are given", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(c).create({} as never);
    expect(c.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });

  it("honors an explicit auth override", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await svc(c).create({} as never, {}, { kind: "raw", token: "X" });
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});
```

(`T` is used by Task 3's block appended to the same file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- product-admin`
Expected: FAIL — `create` / `update` / `replace` / `delete` are not functions.

- [ ] **Step 3: Extend the generated-type import**

In `packages/sdk/src/services/product.ts`, replace the import block (lines 5-10):

```ts
import type {
  BasicProductWithId,
  BundleProductWithId,
  ParentVariantProductWithId,
  ProductMedia,
} from "../generated/product";
```

with:

```ts
import type {
  BasicProductWithId,
  BundleProductWithId,
  ParentVariantProductWithId,
  ProductMedia,
  ProductCreateBody,
  ProductUpdateBody,
  ProductPartialUpdateBody,
  ProductBulkCreateBody,
  ProductBulkUpdateBody,
  BulkResponse,
  ResourceLocation,
  DynamicVariantRecalculationRequest,
  DynamicVariantRecalculationResponse,
  DynamicVariantRecalculationJobResponse,
  DynamicVariantRecalculationJobStatus,
  ProductTemplateResponse,
  ProductTemplateCreation,
  ProductTemplateUpdate,
} from "../generated/product";
```

- [ ] **Step 4: Add the SERVICE const**

In `product.ts`, replace line 12:

```ts
const ANON: AuthContext = { kind: "anonymous" };
```

with:

```ts
const ANON: AuthContext = { kind: "anonymous" };
const SERVICE: AuthContext = { kind: "service" };
```

- [ ] **Step 5: Add the type aliases and the write-options interface**

In `product.ts`, immediately after the `Media` alias (line 18):

```ts
/** Body for creating a product (`POST /products`) — any of the 5 product shapes. */
export type ProductCreateInput = ProductCreateBody;

/** Body for a full product replace (`PUT /products/{id}`). */
export type ProductUpdateInput = ProductUpdateBody;

/** Body for a partial product update (`PATCH /products/{id}`). */
export type ProductPatchInput = ProductPartialUpdateBody;

/** Id/location envelope returned when a product is created. */
export type ProductCreated = ResourceLocation;

/** Body for bulk-creating products (`POST /products/bulk`). */
export type ProductBulkCreateInput = ProductBulkCreateBody;

/** Body for bulk-updating products (`PUT /products/bulk`). */
export type ProductBulkUpdateInput = ProductBulkUpdateBody;

/** Per-entry result of a bulk product operation (207 Multi-Status). */
export type ProductBulkResult = BulkResponse;

/** Body for triggering a dynamic-variant recalculation. */
export type ProductRecalculationInput = DynamicVariantRecalculationRequest;

/** Result of triggering a recalculation — created jobs plus skipped product ids. */
export type ProductRecalculationResult = DynamicVariantRecalculationResponse;

/** A dynamic-variant recalculation job. */
export type ProductRecalculationJob = DynamicVariantRecalculationJobResponse;

/** Status of a recalculation job. */
export type ProductRecalculationJobStatus = DynamicVariantRecalculationJobStatus;

/** A product template as returned by the Product service. */
export type ProductTemplate = ProductTemplateResponse;

/** Body for creating a product template. */
export type ProductTemplateCreateInput = ProductTemplateCreation;

/** Body for updating a product template (`PUT`, full replace). */
export type ProductTemplateUpdateInput = ProductTemplateUpdate;

/** Id envelope returned when a product template is created. */
export type ProductTemplateCreated = { id?: string };

/** Query flags shared by the product write endpoints. */
export interface ProductWriteOptions {
  skipVariantGeneration?: boolean;
  doIndex?: boolean;
  skipRelatedItemsValidation?: boolean;
}
```

- [ ] **Step 6: Add the write-CRUD methods**

In `product.ts`, append these methods inside the `ProductService` class — after `listVariantChildren` (which ends with `}` on line 219) and before the class's closing `}` on line 220:

```ts
  // --- Admin writes. Default auth: service. ---

  /**
   * Creates a product (`POST /products`). Default auth: service. Accepts any of
   * the five product shapes (basic, bundle, parent-variant, variant,
   * dynamic-variant).
   */
  async create(
    input: ProductCreateInput,
    options: ProductWriteOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ProductCreated> {
    const query = {
      ...(options.skipVariantGeneration === undefined ? {} : { skipVariantGeneration: String(options.skipVariantGeneration) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
      ...(options.skipRelatedItemsValidation === undefined ? {} : { skipRelatedItemsValidation: String(options.skipRelatedItemsValidation) }),
    };
    return this.ctx.http.request<ProductCreated>({
      method: "POST",
      path: `/product/${this.ctx.tenant}/products`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: input,
      auth,
    });
  }

  /**
   * Partially updates a product (`PATCH /products/{productId}`). Default auth:
   * service. Use {@link replace} for a full replace (PUT).
   */
  async update(
    productId: string,
    input: ProductPatchInput,
    options: ProductWriteOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    const query = {
      ...(options.skipVariantGeneration === undefined ? {} : { skipVariantGeneration: String(options.skipVariantGeneration) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
      ...(options.skipRelatedItemsValidation === undefined ? {} : { skipRelatedItemsValidation: String(options.skipRelatedItemsValidation) }),
    };
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `/product/${this.ctx.tenant}/products/${productId}`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: input,
      auth,
    });
  }

  /**
   * Full-replaces a product (`PUT /products/{productId}`). Returns the created
   * resource on 201 (upsert) and nothing on 204. `options.partial` sends
   * `?partial=true` for a merge-style replace. Default auth: service.
   */
  async replace(
    productId: string,
    input: ProductUpdateInput,
    options: ProductWriteOptions & { partial?: boolean } = {},
    auth: AuthContext = SERVICE,
  ): Promise<ProductCreated | void> {
    const query = {
      ...(options.partial === undefined ? {} : { partial: String(options.partial) }),
      ...(options.skipVariantGeneration === undefined ? {} : { skipVariantGeneration: String(options.skipVariantGeneration) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
      ...(options.skipRelatedItemsValidation === undefined ? {} : { skipRelatedItemsValidation: String(options.skipRelatedItemsValidation) }),
    };
    return this.ctx.http.request<ProductCreated | void>({
      method: "PUT",
      path: `/product/${this.ctx.tenant}/products/${productId}`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: input,
      auth,
    });
  }

  /**
   * Deletes a product (`DELETE /products/{productId}`). `options.force` deletes
   * even when the product is referenced. Default auth: service.
   */
  async delete(
    productId: string,
    options: { force?: boolean; doIndex?: boolean } = {},
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    const query = {
      ...(options.force === undefined ? {} : { force: String(options.force) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
    };
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/product/${this.ctx.tenant}/products/${productId}`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      auth,
    });
  }
```

- [ ] **Step 7: Export the new types**

In `packages/sdk/src/index.ts`, replace line 54:

```ts
export type { Product, Media } from "./services/product";
```

with:

```ts
export type {
  Product,
  Media,
  ProductCreateInput,
  ProductUpdateInput,
  ProductPatchInput,
  ProductCreated,
  ProductBulkCreateInput,
  ProductBulkUpdateInput,
  ProductBulkResult,
  ProductRecalculationInput,
  ProductRecalculationResult,
  ProductRecalculationJob,
  ProductRecalculationJobStatus,
  ProductTemplate,
  ProductTemplateCreateInput,
  ProductTemplateUpdateInput,
  ProductTemplateCreated,
  ProductWriteOptions,
} from "./services/product";
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- product-admin`
Expected: PASS (4 tests).

- [ ] **Step 9: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/src/index.ts packages/sdk/tests/services/product-admin.test.ts
git commit -m "feat(product): add product write crud"
```

---

### Task 2: Bulk + dynamic-variant recalculation

**Files:**
- Modify: `packages/sdk/src/services/product.ts` (five methods appended after `delete`)
- Test: `packages/sdk/tests/services/product-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: the aliases and `ProductWriteOptions` from Task 1, `SERVICE`, `ANON`.
- Produces:
  - `bulkCreate(input: ProductBulkCreateInput, options?: ProductWriteOptions, auth?: AuthContext): Promise<ProductBulkResult[]>`
  - `bulkUpdate(input: ProductBulkUpdateInput, options?: ProductWriteOptions, auth?: AuthContext): Promise<ProductBulkResult[]>`
  - `recalculate(input: ProductRecalculationInput, auth?: AuthContext): Promise<ProductRecalculationResult>`
  - `listRecalculationJobs(params?: { status?: ProductRecalculationJobStatus }, auth?: AuthContext): Promise<ProductRecalculationJob[]>`
  - `getRecalculationJob(jobId: string, auth?: AuthContext): Promise<ProductRecalculationJob>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/product-admin.test.ts`:

```ts
describe("ProductService bulk + recalculation", () => {
  it("bulkCreate POSTs and bulkUpdate PUTs /products/bulk", async () => {
    const bc = vi.fn().mockResolvedValue([{ status: 201 }]);
    await svc(bc).bulkCreate([] as never);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/bulk`, body: [], auth: { kind: "service" } }));

    const bu = vi.fn().mockResolvedValue([{ status: 200 }]);
    await svc(bu).bulkUpdate([] as never);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/bulk`, body: [], auth: { kind: "service" } }));
  });

  it("recalculate POSTs /products/recalculate with the productIds body", async () => {
    const r = vi.fn().mockResolvedValue({ jobs: [], skippedProductIds: [] });
    const res = await svc(r).recalculate({ productIds: ["p1"] });
    expect(r).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${B}/recalculate`, body: { productIds: ["p1"] }, auth: { kind: "service" } }),
    );
    expect(res).toEqual({ jobs: [], skippedProductIds: [] });
  });

  it("job reads GET the jobs paths with ANON default and forward a status filter", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "j1" }]);
    await svc(l).listRecalculationJobs({ status: "PENDING" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${B}/recalculate/jobs`, query: { status: "PENDING" }, auth: { kind: "anonymous" } }),
    );

    const g = vi.fn().mockResolvedValue({ id: "j1" });
    await svc(g).getRecalculationJob("j1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/recalculate/jobs/j1`, auth: { kind: "anonymous" } }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- product-admin`
Expected: FAIL — `bulkCreate` / `recalculate` / … are not functions.

- [ ] **Step 3: Add the bulk + recalculation methods**

In `product.ts`, append inside the `ProductService` class after `delete` (from Task 1) and before the class's closing `}`:

```ts
  /**
   * Bulk-creates products (`POST /products/bulk`). Responds 207 Multi-Status:
   * partial failures do **not** throw — inspect each entry. Default auth: service.
   */
  async bulkCreate(
    input: ProductBulkCreateInput,
    options: ProductWriteOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ProductBulkResult[]> {
    const query = {
      ...(options.skipVariantGeneration === undefined ? {} : { skipVariantGeneration: String(options.skipVariantGeneration) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
      ...(options.skipRelatedItemsValidation === undefined ? {} : { skipRelatedItemsValidation: String(options.skipRelatedItemsValidation) }),
    };
    return this.ctx.http.request<ProductBulkResult[]>({
      method: "POST",
      path: `/product/${this.ctx.tenant}/products/bulk`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: input,
      auth,
    });
  }

  /**
   * Bulk-updates products (`PUT /products/bulk`). Responds 207 Multi-Status:
   * partial failures do **not** throw — inspect each entry. Default auth: service.
   */
  async bulkUpdate(
    input: ProductBulkUpdateInput,
    options: ProductWriteOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ProductBulkResult[]> {
    const query = {
      ...(options.skipVariantGeneration === undefined ? {} : { skipVariantGeneration: String(options.skipVariantGeneration) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
      ...(options.skipRelatedItemsValidation === undefined ? {} : { skipRelatedItemsValidation: String(options.skipRelatedItemsValidation) }),
    };
    return this.ctx.http.request<ProductBulkResult[]>({
      method: "PUT",
      path: `/product/${this.ctx.tenant}/products/bulk`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: input,
      auth,
    });
  }

  /**
   * Triggers a dynamic-variant recalculation for the given product ids
   * (`POST /products/recalculate`, 202). The result carries the created or
   * already-referenced `jobs` plus `skippedProductIds` — products whose root
   * already has a PENDING/PROCESSING job. Default auth: service.
   */
  async recalculate(
    input: ProductRecalculationInput,
    auth: AuthContext = SERVICE,
  ): Promise<ProductRecalculationResult> {
    return this.ctx.http.request<ProductRecalculationResult>({
      method: "POST",
      path: `/product/${this.ctx.tenant}/products/recalculate`,
      body: input,
      auth,
    });
  }

  /** Lists dynamic-variant recalculation jobs, optionally filtered by status. Default auth: anonymous. */
  async listRecalculationJobs(
    params: { status?: ProductRecalculationJobStatus } = {},
    auth: AuthContext = ANON,
  ): Promise<ProductRecalculationJob[]> {
    return this.ctx.http.request<ProductRecalculationJob[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products/recalculate/jobs`,
      ...(params.status === undefined ? {} : { query: { status: params.status } }),
      auth,
    });
  }

  /** Fetches one dynamic-variant recalculation job by id. Default auth: anonymous. */
  async getRecalculationJob(jobId: string, auth: AuthContext = ANON): Promise<ProductRecalculationJob> {
    return this.ctx.http.request<ProductRecalculationJob>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products/recalculate/jobs/${jobId}`,
      auth,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- product-admin`
Expected: PASS (7 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product-admin.test.ts
git commit -m "feat(product): add product bulk writes and variant recalculation"
```

---

### Task 3: `templates` sub-resource

**Files:**
- Modify: `packages/sdk/src/services/product.ts` (`readonly templates = {…}` appended after `getRecalculationJob`)
- Test: `packages/sdk/tests/services/product-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `ProductTemplate`, `ProductTemplateCreateInput`, `ProductTemplateUpdateInput`, `ProductTemplateCreated`, `SERVICE`, `ANON`, `this.ctx`.
- Produces: `readonly templates` with `list`, `get`, `create`, `update`, `delete` (exact signatures in Step 3).

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/product-admin.test.ts`:

```ts
describe("ProductService.templates", () => {
  it("reads default to ANON and hit the template paths", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "t1" }]);
    await svc(l).templates.list({ pageSize: 10, q: "name:Shirt" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: T,
        auth: { kind: "anonymous" },
        query: expect.objectContaining({ pageSize: 10, q: "name:Shirt" }),
      }),
    );

    const g = vi.fn().mockResolvedValue({ id: "t1" });
    await svc(g).templates.get("t1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${T}/t1`, auth: { kind: "anonymous" } }));
  });

  it("writes default to SERVICE and hit the template paths", async () => {
    const c = vi.fn().mockResolvedValue({ id: "t1" });
    const res = await svc(c).templates.create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: T, body: {}, auth: { kind: "service" } }));
    expect(res).toEqual({ id: "t1" });

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).templates.update("t1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${T}/t1`, body: {}, auth: { kind: "service" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).templates.delete("t1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${T}/t1`, auth: { kind: "service" } }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- product-admin`
Expected: FAIL — `templates` is undefined.

- [ ] **Step 3: Add the `templates` sub-resource**

In `product.ts`, append this member inside the `ProductService` class after `getRecalculationJob` (from Task 2) and before the class's closing `}`:

```ts
  /**
   * Product templates (`/product-templates`). Reads default to anonymous,
   * writes to service auth.
   */
  readonly templates = {
    /** One page of product templates. Default auth: anonymous. */
    list: async (
      params: { pageNumber?: number; pageSize?: number; sort?: string; q?: string } = {},
      auth: AuthContext = ANON,
    ): Promise<ProductTemplate[]> =>
      this.ctx.http.request<ProductTemplate[]>({
        method: "GET",
        path: `/product/${this.ctx.tenant}/product-templates`,
        query: {
          ...(params.pageNumber === undefined ? {} : { pageNumber: params.pageNumber }),
          ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
          ...(params.sort === undefined ? {} : { sort: params.sort }),
          ...(params.q === undefined ? {} : { q: params.q }),
        },
        auth,
      }),

    /** Fetches one product template by id. Default auth: anonymous. */
    get: async (templateId: string, auth: AuthContext = ANON): Promise<ProductTemplate> =>
      this.ctx.http.request<ProductTemplate>({
        method: "GET",
        path: `/product/${this.ctx.tenant}/product-templates/${templateId}`,
        auth,
      }),

    /** Creates a product template. Default auth: service. */
    create: async (
      input: ProductTemplateCreateInput,
      auth: AuthContext = SERVICE,
    ): Promise<ProductTemplateCreated> =>
      this.ctx.http.request<ProductTemplateCreated>({
        method: "POST",
        path: `/product/${this.ctx.tenant}/product-templates`,
        body: input,
        auth,
      }),

    /** Full-replaces a product template (`PUT`). Default auth: service. */
    update: async (
      templateId: string,
      input: ProductTemplateUpdateInput,
      auth: AuthContext = SERVICE,
    ): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "PUT",
        path: `/product/${this.ctx.tenant}/product-templates/${templateId}`,
        body: input,
        auth,
      });
    },

    /** Deletes a product template. Default auth: service. */
    delete: async (templateId: string, auth: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/product/${this.ctx.tenant}/product-templates/${templateId}`,
        auth,
      });
    },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- product-admin`
Expected: PASS (9 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product-admin.test.ts
git commit -m "feat(product): add product template crud"
```

---

### Task 4: Changeset + full verification

**Files:**
- Create: `.changeset/product-admin-crud.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/product-admin-crud.md`:

```md
---
"@viu/emporix-sdk": minor
---

Add product admin writes to `client.products`: `create`, `update` (PATCH),
`replace` (PUT, with an optional `partial` flag), `delete` (with `force`),
`bulkCreate`/`bulkUpdate` (207 Multi-Status — inspect each entry), the
dynamic-variant recalculation group (`recalculate`, `listRecalculationJobs`,
`getRecalculationJob`), and a `products.templates` sub-resource
(`list`/`get`/`create`/`update`/`delete`). Writes default to service auth and
expose the endpoints' query flags (`skipVariantGeneration`, `doIndex`,
`skipRelatedItemsValidation`); the existing catalog reads are unchanged.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the new `product-admin` tests).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/product-admin-crud.md
git commit -m "chore(product): add changeset for product admin crud"
```

---

## Self-Review

**Spec coverage** — every spec operation maps to a task:

| Spec operation | Task |
|---|---|
| `create` (POST /products) | 1 |
| `update` (PATCH /products/{id}) | 1 |
| `replace` (PUT /products/{id}) | 1 |
| `delete` (DELETE /products/{id}) | 1 |
| `bulkCreate` (POST /products/bulk) | 2 |
| `bulkUpdate` (PUT /products/bulk) | 2 |
| `recalculate` (POST /products/recalculate) | 2 |
| `listRecalculationJobs` (GET …/recalculate/jobs) | 2 |
| `getRecalculationJob` (GET …/recalculate/jobs/{jobId}) | 2 |
| `templates.list` (GET /product-templates) | 3 |
| `templates.get` (GET /product-templates/{id}) | 3 |
| `templates.create` (POST /product-templates) | 3 |
| `templates.update` (PUT /product-templates/{id}) | 3 |
| `templates.delete` (DELETE /product-templates/{id}) | 3 |
| 15 type aliases + `ProductWriteOptions` + index exports | 1 |
| Changeset (minor) | 4 |

(14 method entries cover the 12 missing spec operations — `templates.list`/`get` and the two job reads map 1:1; nothing double-counted.)

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** method names match between tests and implementations (`create`/`update`/`replace`/`delete`/`bulkCreate`/`bulkUpdate`/`recalculate`/`listRecalculationJobs`/`getRecalculationJob`/`templates.{list,get,create,update,delete}`). All aliases and `ProductWriteOptions` are declared and index-exported in Task 1 before Tasks 2/3 consume them. Generated import names verified against `src/generated/product/types.gen.ts` (`ProductCreateBody`, `ProductUpdateBody`, `ProductPartialUpdateBody`, `ProductBulkCreateBody`, `ProductBulkUpdateBody`, `BulkResponse`, `ResourceLocation`, `DynamicVariantRecalculationRequest`/`Response`/`JobResponse`/`JobStatus`, `ProductTemplateResponse`, `ProductTemplateCreation`, `ProductTemplateUpdate`). ✓

**Boolean-flag handling:** every boolean query flag is `String(...)`-wrapped (the `query` type rejects booleans — this exact issue was caught by typecheck in the category PR #166). The `query` key is omitted entirely when no flags are set, which the "omits the query entirely" test asserts. `listRecalculationJobs`'s `status` is a string union, so it needs no conversion. ✓
