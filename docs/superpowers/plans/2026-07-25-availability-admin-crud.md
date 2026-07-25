# Availability Admin CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 7 missing non-deprecated availability operations to `AvailabilityService` — the per-site listing, per-product create/update/delete, and the three bulk operations — while leaving the 5 deprecated location-management endpoints unwrapped.

**Architecture:** Flat methods on the existing class. Writes default to a new `SERVICE` const (overridable); the new read defaults to the existing `ANON`. New public types are aliases in `availability-types.ts`, re-exported from `services/availability.ts`; the root barrel uses `export *`, so `index.ts` needs no edit.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types under `src/generated/availability`.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- HTTP: `this.ctx.http.request<T>({ method, path, query?, body?, headers?, auth })`. Paths inline: `` `/availability/${this.ctx.tenant}/…` `` (no `base()` helper in this service).
- Path segments carrying ids are `encodeURIComponent`-escaped, matching the existing `get`.
- Auth: `const ANON: AuthContext = { kind: "anonymous" }` already exists at line 19. Add `const SERVICE: AuthContext = { kind: "service" }` beside it. Writes end with `auth: AuthContext = SERVICE`; the new read ends with `auth: AuthContext = ANON`.
- **The bulk vendor header is `vendor-id`**, NOT the generated schema's `venodr-id` (upstream typo; maintainer's decision). Send it only when `options.vendorId` is given.
- `DELETE /availability/bulk` carries a **body** — do not drop it.
- Commitlint: scope `availability` is allowed; subject's first word must be a lowercase verb.
- Do NOT wrap the deprecated location endpoints, and do NOT modify `get` / `getMany`.

## File Structure

- **Modify** `packages/sdk/src/services/availability-types.ts` — add 5 type aliases beside the existing `Availability`.
- **Modify** `packages/sdk/src/services/availability.ts` — re-export the new types, add the `SERVICE` const, import `PaginatedItems`, add 7 methods.
- **Create** `packages/sdk/tests/services/availability-admin.test.ts` — `vi.fn()`-mocked assertions.
- **Create** `.changeset/availability-admin-crud.md` — minor changeset.
- **No** `index.ts` change (`src/availability.ts` is `export * from "./services/availability"`).

---

### Task 1: Types + site read + per-product writes

**Files:**
- Modify: `packages/sdk/src/services/availability-types.ts`
- Modify: `packages/sdk/src/services/availability.ts` (imports lines 1-6; `SERVICE` const after line 19; methods appended before the class's closing `}` on line 90)
- Test: `packages/sdk/tests/services/availability-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `AvailabilityService(ctx)`, `ANON`, `Availability`.
- Produces (all 5 aliases, so Task 2 needs no type work):
  - `type AvailabilityInput`, `AvailabilityCreated`, `AvailabilityBulkInput`, `AvailabilityBulkDeleteInput`, `AvailabilityBulkResult`
  - `listForSite(siteCode: string, params?: { pageNumber?: number; pageSize?: number; q?: string; sort?: string }, auth?: AuthContext): Promise<PaginatedItems<Availability>>`
  - `create(productId: string, siteCode: string, input: AvailabilityInput, auth?: AuthContext): Promise<AvailabilityCreated>`
  - `update(productId: string, siteCode: string, input: AvailabilityInput, auth?: AuthContext): Promise<AvailabilityCreated | void>`
  - `delete(productId: string, siteCode: string, auth?: AuthContext): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/availability-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AvailabilityService } from "../../src/services/availability";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof AvailabilityService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): AvailabilityService => new AvailabilityService(ctxWith(req));
const A = "/availability/acme/availability";

describe("AvailabilityService.listForSite", () => {
  it("GETs the site path with ANON default and wraps into PaginatedItems", async () => {
    const l = vi.fn().mockResolvedValue([{ productId: "p1", available: true }]);
    const res = await svc(l).listForSite("main", { pageSize: 10, q: "available:true", sort: "productId" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: `${A}/site/main`,
        auth: { kind: "anonymous" },
        query: expect.objectContaining({ pageNumber: 1, pageSize: 10, q: "available:true", sort: "productId" }),
      }),
    );
    expect(res).toEqual({
      items: [{ productId: "p1", available: true }],
      pageNumber: 1,
      pageSize: 10,
      hasNextPage: false,
    });
  });
});

describe("AvailabilityService per-product writes", () => {
  it("create/update/delete hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "main:p1" });
    await svc(c).create("p1", "main", {} as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${A}/p1/main`, body: {}, auth: { kind: "service" } }),
    );

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).update("p1", "main", {} as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${A}/p1/main`, body: {}, auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("p1", "main");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${A}/p1/main`, auth: { kind: "service" } }),
    );
  });

  it("escapes path segments and honors an explicit auth override", async () => {
    const c = vi.fn().mockResolvedValue({ id: "x" });
    await svc(c).create("p/1", "main", {} as never, { kind: "raw", token: "X" });
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${A}/p%2F1/main`, auth: { kind: "raw", token: "X" } }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- availability-admin`
Expected: FAIL — `listForSite` / `create` / `update` / `delete` are not functions.

- [ ] **Step 3: Add the type aliases**

In `packages/sdk/src/services/availability-types.ts`, replace the import line and append the new aliases so the file reads:

```ts
import type {
  AvailabilityWithBundle,
  AvailabilityDto,
  AvailabilityBulkDto,
  AvailabilityDeleteBulkDto,
  IdResponse,
  BulkResponse,
} from "../generated/availability";

/** A product's availability record (bundle-aware). */
export type Availability = AvailabilityWithBundle;

/** Body for creating or updating a single product's availability. */
export type AvailabilityInput = AvailabilityDto;

/** Id envelope returned when an availability record is created. */
export type AvailabilityCreated = IdResponse;

/** One entry of a bulk create/update request. */
export type AvailabilityBulkInput = AvailabilityBulkDto;

/** One entry of a bulk delete request. */
export type AvailabilityBulkDeleteInput = AvailabilityDeleteBulkDto;

/** Per-entry result of a bulk availability operation (207 Multi-Status). */
export type AvailabilityBulkResult = BulkResponse;
```

(Keep the existing file-header doc comment at the top.)

- [ ] **Step 4: Update the service imports, re-exports and add the SERVICE const**

In `packages/sdk/src/services/availability.ts`, replace lines 1-6:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError } from "../core/errors";
import type { Availability } from "./availability-types";

export type { Availability } from "./availability-types";
```

with:

```ts
import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError } from "../core/errors";
import type {
  Availability,
  AvailabilityInput,
  AvailabilityCreated,
  AvailabilityBulkInput,
  AvailabilityBulkDeleteInput,
  AvailabilityBulkResult,
} from "./availability-types";

export type {
  Availability,
  AvailabilityInput,
  AvailabilityCreated,
  AvailabilityBulkInput,
  AvailabilityBulkDeleteInput,
  AvailabilityBulkResult,
} from "./availability-types";
```

Then replace the `ANON` line (line 19 in the original file):

```ts
const ANON: AuthContext = { kind: "anonymous" };
```

with:

```ts
const ANON: AuthContext = { kind: "anonymous" };
const SERVICE: AuthContext = { kind: "service" };
```

- [ ] **Step 5: Add the site read and the per-product writes**

Append these methods inside the `AvailabilityService` class — after `getMany` and before the class's closing `}`:

```ts
  /**
   * Lists every availability record for a site (`GET /availability/site/{site}`),
   * wrapped into `PaginatedItems`. Default auth: anonymous.
   */
  async listForSite(
    siteCode: string,
    params: { pageNumber?: number; pageSize?: number; q?: string; sort?: string } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Availability>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Availability[]>({
      method: "GET",
      path: `/availability/${this.ctx.tenant}/availability/site/${encodeURIComponent(siteCode)}`,
      query: {
        pageNumber,
        pageSize,
        ...(params.q === undefined ? {} : { q: params.q }),
        ...(params.sort === undefined ? {} : { sort: params.sort }),
      },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  // --- Admin writes. Default auth: service. ---

  /**
   * Creates an availability record for a product on a site
   * (`POST /availability/{productId}/{site}`). Responds 409 when the record
   * already exists — use {@link update} to upsert. Default auth: service.
   */
  async create(
    productId: string,
    siteCode: string,
    input: AvailabilityInput,
    auth: AuthContext = SERVICE,
  ): Promise<AvailabilityCreated> {
    return this.ctx.http.request<AvailabilityCreated>({
      method: "POST",
      path: `/availability/${this.ctx.tenant}/availability/${encodeURIComponent(
        productId,
      )}/${encodeURIComponent(siteCode)}`,
      body: input,
      auth,
    });
  }

  /**
   * Upserts a product's availability on a site
   * (`PUT /availability/{productId}/{site}`). Returns the created record's id
   * on 201 and nothing on 204. This endpoint has no PATCH counterpart.
   * Default auth: service.
   */
  async update(
    productId: string,
    siteCode: string,
    input: AvailabilityInput,
    auth: AuthContext = SERVICE,
  ): Promise<AvailabilityCreated | void> {
    return this.ctx.http.request<AvailabilityCreated | void>({
      method: "PUT",
      path: `/availability/${this.ctx.tenant}/availability/${encodeURIComponent(
        productId,
      )}/${encodeURIComponent(siteCode)}`,
      body: input,
      auth,
    });
  }

  /**
   * Deletes a product's availability on a site
   * (`DELETE /availability/{productId}/{site}`). Default auth: service.
   */
  async delete(productId: string, siteCode: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/availability/${this.ctx.tenant}/availability/${encodeURIComponent(
        productId,
      )}/${encodeURIComponent(siteCode)}`,
      auth,
    });
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- availability-admin`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/services/availability-types.ts packages/sdk/src/services/availability.ts packages/sdk/tests/services/availability-admin.test.ts
git commit -m "feat(availability): add site listing and per-product availability writes"
```

---

### Task 2: Bulk operations

**Files:**
- Modify: `packages/sdk/src/services/availability.ts` (three methods appended after `delete`)
- Test: `packages/sdk/tests/services/availability-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: the aliases from Task 1, `SERVICE`.
- Produces:
  - `bulkCreate(input: AvailabilityBulkInput[], options?: { vendorId?: string }, auth?: AuthContext): Promise<AvailabilityBulkResult[]>`
  - `bulkUpdate(input: AvailabilityBulkInput[], options?: { vendorId?: string }, auth?: AuthContext): Promise<AvailabilityBulkResult[]>`
  - `bulkDelete(input: AvailabilityBulkDeleteInput[], options?: { vendorId?: string }, auth?: AuthContext): Promise<AvailabilityBulkResult[]>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/availability-admin.test.ts`:

```ts
describe("AvailabilityService bulk", () => {
  it("bulkCreate/bulkUpdate/bulkDelete hit /availability/bulk with a body", async () => {
    const c = vi.fn().mockResolvedValue([{ code: 201 }]);
    await svc(c).bulkCreate([{ productId: "p1" }] as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${A}/bulk`,
        body: [{ productId: "p1" }],
        auth: { kind: "service" },
      }),
    );

    const u = vi.fn().mockResolvedValue([{ code: 200 }]);
    await svc(u).bulkUpdate([{ productId: "p1" }] as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${A}/bulk`, body: [{ productId: "p1" }] }),
    );

    const d = vi.fn().mockResolvedValue([{ code: 204 }]);
    await svc(d).bulkDelete([{ productId: "p1", site: "main" }] as never);
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: `${A}/bulk`,
        body: [{ productId: "p1", site: "main" }],
        auth: { kind: "service" },
      }),
    );
  });

  it("sends the vendor-id header only when vendorId is given", async () => {
    const withVendor = vi.fn().mockResolvedValue([]);
    await svc(withVendor).bulkCreate([] as never, { vendorId: "v1" });
    expect(withVendor).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { "vendor-id": "v1" } }),
    );

    const without = vi.fn().mockResolvedValue([]);
    await svc(without).bulkCreate([] as never);
    expect(without.mock.calls[0]?.[0]).not.toHaveProperty("headers");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- availability-admin`
Expected: FAIL — `bulkCreate` / `bulkUpdate` / `bulkDelete` are not functions.

- [ ] **Step 3: Add the bulk methods**

Append inside the `AvailabilityService` class after `delete` (from Task 1) and before the class's closing `}`:

```ts
  /**
   * Bulk-creates availability records (`POST /availability/bulk`). Responds 207
   * Multi-Status: partial failures do **not** throw — inspect each entry.
   *
   * `options.vendorId` limits the operation to a vendor's products. It is sent
   * as the `vendor-id` header. **Note:** the OpenAPI schema spells this header
   * `venodr-id`, which is an evident upstream typo (the body field is
   * `vendorId`); the SDK sends the corrected name. Unverified against the live
   * API — if the service really expects the misspelling, the filter silently
   * has no effect.
   *
   * Default auth: service.
   */
  async bulkCreate(
    input: AvailabilityBulkInput[],
    options: { vendorId?: string } = {},
    auth: AuthContext = SERVICE,
  ): Promise<AvailabilityBulkResult[]> {
    return this.ctx.http.request<AvailabilityBulkResult[]>({
      method: "POST",
      path: `/availability/${this.ctx.tenant}/availability/bulk`,
      ...(options.vendorId === undefined ? {} : { headers: { "vendor-id": options.vendorId } }),
      body: input,
      auth,
    });
  }

  /**
   * Bulk-updates availability records (`PUT /availability/bulk`). Responds 207
   * Multi-Status: partial failures do **not** throw — inspect each entry. See
   * {@link bulkCreate} for the `vendorId` header caveat. Default auth: service.
   */
  async bulkUpdate(
    input: AvailabilityBulkInput[],
    options: { vendorId?: string } = {},
    auth: AuthContext = SERVICE,
  ): Promise<AvailabilityBulkResult[]> {
    return this.ctx.http.request<AvailabilityBulkResult[]>({
      method: "PUT",
      path: `/availability/${this.ctx.tenant}/availability/bulk`,
      ...(options.vendorId === undefined ? {} : { headers: { "vendor-id": options.vendorId } }),
      body: input,
      auth,
    });
  }

  /**
   * Bulk-deletes availability records (`DELETE /availability/bulk`). Unusually
   * for a DELETE, this endpoint takes a body listing the records to remove.
   * Responds 207 Multi-Status: partial failures do **not** throw — inspect each
   * entry. See {@link bulkCreate} for the `vendorId` header caveat. Default
   * auth: service.
   */
  async bulkDelete(
    input: AvailabilityBulkDeleteInput[],
    options: { vendorId?: string } = {},
    auth: AuthContext = SERVICE,
  ): Promise<AvailabilityBulkResult[]> {
    return this.ctx.http.request<AvailabilityBulkResult[]>({
      method: "DELETE",
      path: `/availability/${this.ctx.tenant}/availability/bulk`,
      ...(options.vendorId === undefined ? {} : { headers: { "vendor-id": options.vendorId } }),
      body: input,
      auth,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- availability-admin`
Expected: PASS (5 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/availability.ts packages/sdk/tests/services/availability-admin.test.ts
git commit -m "feat(availability): add bulk availability writes"
```

---

### Task 3: Changeset + full verification

**Files:**
- Create: `.changeset/availability-admin-crud.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/availability-admin-crud.md`:

```md
---
"@viu/emporix-sdk": minor
---

Add availability admin operations to `client.availability`: `listForSite`
(paginated per-site listing), per-product `create`/`update`/`delete`, and
`bulkCreate`/`bulkUpdate`/`bulkDelete` (207 Multi-Status — inspect each entry;
the bulk delete carries a body). Writes default to service auth. The bulk
methods accept `{ vendorId }`, sent as the `vendor-id` header — note the OpenAPI
schema spells it `venodr-id`, an apparent upstream typo, and the corrected name
is not yet verified against the live API. The deprecated location-management
endpoints remain unwrapped, and the existing reads are unchanged.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the new `availability-admin` tests).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/availability-admin-crud.md
git commit -m "chore(availability): add changeset for availability admin crud"
```

---

## Self-Review

**Spec coverage** — every in-scope operation maps to a task:

| Spec operation | Task |
|---|---|
| `listForSite` (GET /availability/site/{site}) | 1 |
| `create` (POST /availability/{productId}/{site}) | 1 |
| `update` (PUT /availability/{productId}/{site}) | 1 |
| `delete` (DELETE /availability/{productId}/{site}) | 1 |
| `bulkCreate` (POST /availability/bulk) | 2 |
| `bulkUpdate` (PUT /availability/bulk) | 2 |
| `bulkDelete` (DELETE /availability/bulk) | 2 |
| 5 type aliases | 1 |
| Changeset (minor) | 3 |

Excluded per spec: the 5 deprecated location-management endpoints. Already
wrapped: `get`, `getMany`. 7 + 5 + 2 = 14 = the service's full operation count. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** method names match between tests and implementations
(`listForSite`, `create`, `update`, `delete`, `bulkCreate`, `bulkUpdate`,
`bulkDelete`). All 5 aliases are declared and re-exported in Task 1 before Task 2
consumes them. Generated import names verified against
`src/generated/availability/types.gen.ts` (`AvailabilityDto`,
`AvailabilityBulkDto`, `AvailabilityDeleteBulkDto`, `IdResponse`,
`BulkResponse`, `AvailabilityWithBundle`). No `index.ts` edit is needed because
`src/availability.ts` re-exports with `export *`. ✓

**Header/body handling:** the `vendor-id` header is spread only when
`options.vendorId` is set — asserted both ways (`headers` present / absent).
`bulkDelete` sends a body despite being a DELETE, which its test asserts
explicitly. `listForSite` always sends `pageNumber`/`pageSize` (defaulted) and
adds `q`/`sort` only when given. No boolean query flags exist here, so no
`String(...)` conversion is needed. ✓

**Deliberate spec deviation:** the header name `vendor-id` differs from the
generated `venodr-id` on the maintainer's instruction. It is documented in the
design doc, the method docstrings, the changeset, and here — and it remains
unverified against the live API. ✓
