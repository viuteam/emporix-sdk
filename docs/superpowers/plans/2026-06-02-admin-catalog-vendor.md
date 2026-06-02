# Admin: Catalog + Vendor Services (Batch 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind Catalog Management (`client.catalogs`) and Vendor Service (`client.vendors`) in one branch (~18 ops).

**Architecture:** Types generated via `@hey-api/openapi-ts` and aliased per service. Two service classes, service-token default, no React. Standard tenant base paths.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-02-admin-catalog-vendor-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `catalog`, `vendor-service` URLs |
| `packages/sdk/specs/{catalog,vendor-service}.yml` | fetched OpenAPI |
| `packages/sdk/src/generated/{catalog,vendor-service}/` | generated types |
| `packages/sdk/src/services/{catalog,vendor}-types.ts` | public type aliases |
| `packages/sdk/src/services/{catalog,vendor}.ts` | service classes |
| `packages/sdk/src/{catalog,vendor}.ts` | facade re-exports |
| `packages/sdk/src/core/logger.ts` | add `"catalog"`, `"vendor"` |
| `packages/sdk/src/client.ts` | construct + expose `catalogs`, `vendors` |
| `packages/sdk/src/index.ts` | re-export the facades |
| `packages/sdk/tests/services/*` | type + MSW + wiring tests |
| `docs/{catalog,vendor}.md` | usage docs |
| `CLAUDE.md` | service-list update |
| `.changeset/admin-catalog-vendor.md` | release entry (sdk only) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/admin-catalog-vendor` off current `main`, commit spec + plan first:
```bash
git checkout main && git pull
git checkout -b feat/admin-catalog-vendor
git add docs/superpowers/specs/2026-06-02-admin-catalog-vendor-design.md docs/superpowers/plans/2026-06-02-admin-catalog-vendor.md
git commit -m "docs(sdk): add admin catalog+vendor design spec and plan"
```

---

## Task 1: Generate types (codegen)

- [ ] **Step 1: Add the spec entries** — in `fetch-specs.ts`, after `unit-handling-service`:

```ts
  catalog: `${BASE}/catalogs-and-categories/catalog/api-reference/api.yml`,
  "vendor-service": `${BASE}/companies-and-customers/vendor-service/api-reference/api.yml`,
```

- [ ] **Step 2: Fetch + generate.**

- [ ] **Step 3: Verify generated names** — record for Tasks 2-3:

```bash
for d in catalog vendor-service; do
  echo "== $d =="; grep -nE "^export type " packages/sdk/src/generated/$d/types.gen.ts | grep -viE "Data =|Error|Responses|Response =|ClientOptions|Trait"
done
```
Catalog: `Catalog`/`CreateCatalog`/`UpdateCatalog`/`UpdateCatalogProperties`/`CreateCatalogResponse`. Vendor: `Vendor`/`VendorCreate`/`VendorUpdate`/`Location`/`LocationCreate`/`LocationUpdate`/`ResourceId` + the vendor search body. Confirm list shapes (array vs envelope), PUT-upsert/patch response codes, and the search-body type.

- [ ] **Step 4: Keep focused** — restore unrelated drift; stage only the two new trees.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/catalog.yml packages/sdk/specs/vendor-service.yml packages/sdk/src/generated/catalog packages/sdk/src/generated/vendor-service
git commit -m "feat(sdk): generate catalog and vendor types"
```

---

## Task 2: CatalogService

- [ ] **Step 1: `catalog-types.ts`** (swap names for the real generated ones):

```ts
import type {
  Catalog as GenCatalog,
  CreateCatalog,
  UpdateCatalog,
  UpdateCatalogProperties,
  CreateCatalogResponse,
} from "../generated/catalog";

/** A catalog (read shape). */
export type Catalog = GenCatalog;
/** List of catalogs. */
export type CatalogList = Catalog[];
/** Create body (`POST /catalogs`). */
export type CatalogInput = CreateCatalog;
/** Upsert body (`PUT /catalogs/{id}`). */
export type CatalogUpdate = UpdateCatalog;
/** Partial-update body (`PATCH /catalogs/{id}`). */
export type CatalogPatch = UpdateCatalogProperties;
/** Create/upsert response. */
export type CatalogCreated = CreateCatalogResponse;
```

Type test `catalog-types.test.ts`: assert all `not.toBeNever()`.

- [ ] **Step 2: `catalog.ts` service + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Catalog, CatalogList, CatalogInput, CatalogUpdate, CatalogPatch, CatalogCreated } from "./catalog-types";

export type { Catalog, CatalogList, CatalogInput, CatalogUpdate, CatalogPatch, CatalogCreated } from "./catalog-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Catalog Management (`/catalog/{tenant}/catalogs`): CRUD over catalogs.
 * Server-side; defaults to the service token. `updateCatalog` is an upsert (PUT).
 */
export class CatalogService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/catalog/${this.ctx.tenant}/catalogs`;
  }

  /** List catalogs (filtered/sorted). */
  async listCatalogs(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<CatalogList> {
    return this.ctx.http.request<CatalogList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a catalog by id. */
  async getCatalog(catalogId: string, auth: AuthContext = SERVICE): Promise<Catalog> {
    return this.ctx.http.request<Catalog>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(catalogId)}`,
      auth,
    });
  }

  /** Retrieve all catalogs that contain a category. */
  async getCatalogsForCategory(categoryId: string, auth: AuthContext = SERVICE): Promise<CatalogList> {
    return this.ctx.http.request<CatalogList>({
      method: "GET",
      path: `${this.base()}/categories/${encodeURIComponent(categoryId)}`,
      auth,
    });
  }

  /** Create a catalog. */
  async createCatalog(input: CatalogInput, auth: AuthContext = SERVICE): Promise<CatalogCreated> {
    return this.ctx.http.request<CatalogCreated>({ method: "POST", path: this.base(), auth, body: input });
  }

  /** Upsert a catalog by id (`PUT`). */
  async updateCatalog(catalogId: string, input: CatalogUpdate, auth: AuthContext = SERVICE): Promise<CatalogCreated> {
    return this.ctx.http.request<CatalogCreated>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(catalogId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a catalog by id (`PATCH`). */
  async patchCatalog(catalogId: string, patch: CatalogPatch, auth: AuthContext = SERVICE): Promise<Catalog> {
    return this.ctx.http.request<Catalog>({
      method: "PATCH",
      path: `${this.base()}/${encodeURIComponent(catalogId)}`,
      auth,
      body: patch,
    });
  }

  /** Remove a catalog by id. */
  async deleteCatalog(catalogId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(catalogId)}`,
      auth,
    });
  }
}
```

Facade `src/catalog.ts`: `export * from "./services/catalog";`

MSW test `catalog.test.ts` (`BASE = "https://api.emporix.io/catalog/acme/catalogs"`): list / get / getCatalogsForCategory (assert path `/catalog/acme/catalogs/categories/c1`) / create (→ CatalogCreated) / update (PUT → CatalogCreated) / patch (body asserted) / delete (204) / `Bearer svc-tok` / `encodeURIComponent` / 404.

> If `patchCatalog` returns a generic `Object` rather than the catalog, type it
> `unknown`; if PUT-upsert returns void, adjust. Pin at codegen.

- [ ] **Step 3: Run catalog tests + typecheck; commit (types, service).**

---

## Task 3: VendorService

- [ ] **Step 1: `vendor-types.ts`** (swap names for the real generated ones):

```ts
import type {
  Vendor as GenVendor,
  VendorCreate,
  VendorUpdate as GenVendorUpdate,
  Location as GenLocation,
  LocationCreate,
  LocationUpdate,
  ResourceId,
} from "../generated/vendor-service";

/** A vendor (read shape). */
export type Vendor = GenVendor;
/** List of vendors. */
export type VendorList = Vendor[];
/** Create body (`POST /vendors`). */
export type VendorInput = VendorCreate;
/** Upsert body (`PUT /vendors/{id}`). */
export type VendorUpdate = GenVendorUpdate;
/** Create response — a resource id. */
export type VendorCreated = ResourceId;
/** Search body (`POST /vendors/search`). */
export type VendorSearchQuery = Record<string, unknown>;

/** A vendor location (read shape). */
export type VendorLocation = GenLocation;
/** List of vendor locations. */
export type VendorLocationList = VendorLocation[];
/** Create body (`POST /locations`). */
export type VendorLocationInput = LocationCreate;
/** Upsert body (`PUT /locations/{id}`). */
export type VendorLocationUpdate = LocationUpdate;
```

> If the spec names the search body, alias `VendorSearchQuery` to it. If lists
> are paged envelopes, set `VendorList`/`VendorLocationList` accordingly.

Type test `vendor-types.test.ts`: assert the named types `not.toBeNever()`.

- [ ] **Step 2: `vendor.ts` service + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Vendor, VendorList, VendorInput, VendorUpdate, VendorCreated, VendorSearchQuery,
  VendorLocation, VendorLocationList, VendorLocationInput, VendorLocationUpdate,
} from "./vendor-types";

export type {
  Vendor, VendorList, VendorInput, VendorUpdate, VendorCreated, VendorSearchQuery,
  VendorLocation, VendorLocationList, VendorLocationInput, VendorLocationUpdate,
} from "./vendor-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Vendor Service (`/vendor/{tenant}/…`): vendors and their locations.
 * Server-side; defaults to the service token. PUT methods are upserts.
 */
export class VendorService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/vendor/${this.ctx.tenant}`;
  }

  // --- Vendors ---

  /** List all vendors. */
  async listVendors(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<VendorList> {
    return this.ctx.http.request<VendorList>({
      method: "GET",
      path: `${this.base()}/vendors`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a vendor by id. */
  async getVendor(vendorId: string, auth: AuthContext = SERVICE): Promise<Vendor> {
    return this.ctx.http.request<Vendor>({
      method: "GET",
      path: `${this.base()}/vendors/${encodeURIComponent(vendorId)}`,
      auth,
    });
  }

  /** Search vendors (`POST /vendors/search`). */
  async searchVendors(query: VendorSearchQuery, auth: AuthContext = SERVICE): Promise<VendorList> {
    return this.ctx.http.request<VendorList>({
      method: "POST",
      path: `${this.base()}/vendors/search`,
      auth,
      body: query,
    });
  }

  /** Create a vendor. */
  async createVendor(input: VendorInput, auth: AuthContext = SERVICE): Promise<VendorCreated> {
    return this.ctx.http.request<VendorCreated>({ method: "POST", path: `${this.base()}/vendors`, auth, body: input });
  }

  /** Upsert a vendor by id (`PUT`). */
  async updateVendor(vendorId: string, input: VendorUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/vendors/${encodeURIComponent(vendorId)}`,
      auth,
      body: input,
    });
  }

  /** Delete a vendor by id. */
  async deleteVendor(vendorId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/vendors/${encodeURIComponent(vendorId)}`,
      auth,
    });
  }

  // --- Vendor locations ---

  /** List all vendor locations. */
  async listVendorLocations(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<VendorLocationList> {
    return this.ctx.http.request<VendorLocationList>({
      method: "GET",
      path: `${this.base()}/locations`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a vendor location by id. */
  async getVendorLocation(locationId: string, auth: AuthContext = SERVICE): Promise<VendorLocation> {
    return this.ctx.http.request<VendorLocation>({
      method: "GET",
      path: `${this.base()}/locations/${encodeURIComponent(locationId)}`,
      auth,
    });
  }

  /** Create a vendor location. */
  async createVendorLocation(input: VendorLocationInput, auth: AuthContext = SERVICE): Promise<VendorCreated> {
    return this.ctx.http.request<VendorCreated>({ method: "POST", path: `${this.base()}/locations`, auth, body: input });
  }

  /** Upsert a vendor location by id (`PUT`). */
  async updateVendorLocation(locationId: string, input: VendorLocationUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/locations/${encodeURIComponent(locationId)}`,
      auth,
      body: input,
    });
  }

  /** Delete a vendor location by id. */
  async deleteVendorLocation(locationId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/locations/${encodeURIComponent(locationId)}`,
      auth,
    });
  }
}
```

Facade `src/vendor.ts`: `export * from "./services/vendor";`

MSW test `vendor.test.ts` (`BASE = "https://api.emporix.io/vendor/acme"`): vendors list/get/create (→ resourceId 201)/update (PUT 204)/delete (204)/search (POST `/vendors/search`, body asserted); locations list/get/create/update/delete; `Bearer svc-tok`; `encodeURIComponent`; 404.

> If PUT-upsert (vendor/location) returns a body (e.g. `resourceId`), change the
> return type + mock. Pin at codegen.

- [ ] **Step 3: Run vendor tests + typecheck; commit (types, service).**

---

## Task 4: Wire both onto EmporixClient

- [ ] **Step 1: Failing wiring test** — `catalog-vendor-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { CatalogService } from "../../src/services/catalog";
import { VendorService } from "../../src/services/vendor";

describe("EmporixClient catalog/vendor wiring", () => {
  it("exposes catalogs and vendors", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.catalogs).toBeInstanceOf(CatalogService);
    expect(sdk.vendors).toBeInstanceOf(VendorService);
  });
});
```

- [ ] **Step 2: Verify it fails.**

- [ ] **Step 3a: `ServiceName`** — add `| "catalog" | "vendor"` after `| "unit-handling"`.
- [ ] **Step 3b: `client.ts`** — import the two services after `UnitHandlingService`; fields `readonly catalogs: CatalogService; readonly vendors: VendorService;` after `units`; construct `this.catalogs = new CatalogService(mk("catalog")); this.vendors = new VendorService(mk("vendor"));`.
- [ ] **Step 3c: barrel** — after `export * from "./unit-handling";`:
```ts
export * from "./catalog";
export * from "./vendor";
```

- [ ] **Step 4: Run wiring test, full suite, typecheck, build.**

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/catalog-vendor-wiring.test.ts
git commit -m "feat(sdk): expose catalog and vendor services on the client"
```

---

## Task 5: Documentation

- [ ] **Step 1:** Create `docs/catalog.md` and `docs/vendor.md` (server-side note + method snippets; vendor doc notes the `*VendorLocation*` methods are vendor pickup/warehouse locations, distinct from `client.locations`).
- [ ] **Step 2: CLAUDE.md** — append `Catalog, Vendor` to the service list.
- [ ] **Step 3: Commit** — `docs(sdk): document the catalog and vendor services`.

---

## Task 6: Changeset

- [ ] **Step 1: `.changeset/admin-catalog-vendor.md`**

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix Catalog Management (`client.catalogs`) and Vendor Service
(`client.vendors`) bindings: catalog CRUD (incl. catalogs-for-category) and
vendor + vendor-location CRUD with vendor search. Server-side only — these use
the service (clientCredentials) token.
```

- [ ] **Step 2: Verify** — `pnpm changeset status` (adds `@viu/emporix-sdk`).
- [ ] **Step 3: Commit** — `chore(release): add catalog and vendor services changeset`.

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
```

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 full surface (catalog 7, vendor 11) → Tasks 2-3 + tests. D2 two services one branch → Task 4. D3 no React / service-token → `const SERVICE`. D4 codegen + aliasing; catalog create/upsert → `CatalogCreated`, patch body `UpdateCatalogProperties`; vendor/location create → `resourceId`; PUT upserts; search POST. Docs/changeset → Tasks 5/6 (sdk only). No gaps.
- **Placeholder scan:** No TBD/TODO in code steps. Upstream-dependent uncertainties (list envelopes, PUT-upsert/patch response codes, search body type) are concrete codegen-verify notes with fallbacks.
- **Type consistency:** Public names per service identical across the types module, the service imports + re-exports, and the tests. Base paths `/catalog/${tenant}/catalogs`, `/vendor/${tenant}` match the spec + tests. Loggers `"catalog"`/`"vendor"` match `mk(...)` + the `ServiceName` additions. Vendor location methods named `*VendorLocation*` to disambiguate from `client.locations`. Commit scopes `sdk`/`release`, lowercase verbs (commitlint-safe).
```
