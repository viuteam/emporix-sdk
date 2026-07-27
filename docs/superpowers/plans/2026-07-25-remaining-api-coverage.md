# Remaining API Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last 8 gaps of the admin-CRUD series — 3 in customer-management (B2B), 3 in fee, 2 in configuration — so the SDK wraps every non-deprecated operation of every vendored spec except the two endpoints declined earlier.

**Architecture:** Flat methods appended to five existing classes. Each service keeps its own conventions: the B2B services take a **required** `auth` argument; the backend services default to their existing module-level `SERVICE` const. No new classes, no wiring changes.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- HTTP: `this.ctx.http.request<T>({ method, path, query?, body?, auth })`.
- **Auth differs per service — do not unify:**
  - `companies.ts` / `contacts.ts`: `auth: AuthContext` **required**, last positional arg, no default.
  - `fee.ts` / `tenant-config.ts` / `client-config.ts`: `auth: AuthContext = SERVICE` (the const already exists in each file).
- Follow each file's existing path style: `companies`/`contacts` interpolate ids **without** `encodeURIComponent` (matching their siblings); `tenant-config`/`client-config` **do** escape keys. Keep it consistent within each file.
- Commitlint scope allowlist (verified in `commitlint.config.js`): `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. So **`customer` is valid** (Task 1), while `fee`, `configuration` and `contacts` are **not** — Tasks 2–4 use scope **`sdk`**. Subject's first word must be a lowercase verb.
- Do NOT modify existing methods, and do NOT touch the customer services (`customer.ts`, `customer-admin.ts`) — they are already complete.

## File Structure

- **Modify** `packages/sdk/src/services/companies.ts` — add `LegalEntitySearchInput`, extend the generated-type import, add `search` + `parentHierarchy` (class ends line 80).
- **Modify** `packages/sdk/src/services/contacts.ts` — add `get` (class ends line 71).
- **Modify** `packages/sdk/src/services/fee-types.ts` — add 2 search-body aliases.
- **Modify** `packages/sdk/src/services/fee.ts` — extend the import/re-export blocks (lines 3-21), add 3 methods (class ends line 221).
- **Modify** `packages/sdk/src/services/tenant-config.ts` — add `listGlobal` (class ends line 75).
- **Modify** `packages/sdk/src/services/client-config.ts` — add `listClients` (class ends line 90).
- **Create** 3 test files + 1 changeset.
- **No** `index.ts` change — all five services are exported through `export *` barrels.

---

### Task 1: customer-management (B2B) — search, parent hierarchy, contact get

**Files:**
- Modify: `packages/sdk/src/services/companies.ts`, `packages/sdk/src/services/contacts.ts`
- Test: `packages/sdk/tests/services/customer-mgmt-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `CompaniesService(ctx)` / `ContactsService(ctx)`, their private `base()` helpers, `LegalEntity`, `ContactAssignment`.
- Produces:
  - `type LegalEntitySearchInput = { q?: string }` (exported from `companies.ts`)
  - `CompaniesService.search(query: LegalEntitySearchInput, auth: AuthContext): Promise<LegalEntity[]>`
  - `CompaniesService.parentHierarchy(legalEntityId: string, auth: AuthContext): Promise<LegalEntity[]>`
  - `ContactsService.get(contactAssignmentId: string, auth: AuthContext): Promise<ContactAssignment>`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/customer-mgmt-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CompaniesService } from "../../src/services/companies";
import { ContactsService } from "../../src/services/contacts";

function ctxWith(request: ReturnType<typeof vi.fn>) {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const companies = (req: ReturnType<typeof vi.fn>): CompaniesService => new CompaniesService(ctxWith(req));
const contacts = (req: ReturnType<typeof vi.fn>): ContactsService => new ContactsService(ctxWith(req));
const LE = "/customer-management/acme/legal-entities";
const CA = "/customer-management/acme/contact-assignments";
const CUST = { kind: "customer", token: "T" } as const;

describe("CompaniesService search + hierarchy", () => {
  it("search POSTs /legal-entities/search with the q body", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "le1" }]);
    const res = await companies(s).search({ q: "name:Acme" }, CUST);
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${LE}/search`, body: { q: "name:Acme" }, auth: CUST }),
    );
    expect(res).toEqual([{ id: "le1" }]);
  });

  it("parentHierarchy GETs the hierarchy path", async () => {
    const h = vi.fn().mockResolvedValue([{ id: "parent" }]);
    await companies(h).parentHierarchy("le1", CUST);
    expect(h).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${LE}/le1/parent-hierarchy`, auth: CUST }),
    );
  });
});

describe("ContactsService.get", () => {
  it("GETs one contact assignment by id", async () => {
    const g = vi.fn().mockResolvedValue({ id: "ca1" });
    const res = await contacts(g).get("ca1", CUST);
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${CA}/ca1`, auth: CUST }),
    );
    expect(res).toEqual({ id: "ca1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- customer-mgmt-admin`
Expected: FAIL — `search` / `parentHierarchy` / `get` are not functions.

- [ ] **Step 3: Add the search input type to `companies.ts`**

In `packages/sdk/src/services/companies.ts`, after the import block (which ends line 7), add:

```ts
/** Body for `companies.search` — an Emporix `q`-syntax filter. */
export type LegalEntitySearchInput = { q?: string };
```

- [ ] **Step 4: Add the two `CompaniesService` methods**

Append inside the `CompaniesService` class, after `delete` and before the class's closing `}` (line 80):

```ts
  /**
   * Searches legal entities via `POST /legal-entities/search` with an Emporix
   * `q`-syntax filter body. Requires the same read scope as {@link listMine}.
   */
  async search(query: LegalEntitySearchInput, auth: AuthContext): Promise<LegalEntity[]> {
    return this.ctx.http.request<LegalEntity[]>({
      method: "POST",
      path: `${this.base()}/search`,
      auth,
      body: query,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
    });
  }

  /**
   * Retrieves a legal entity's chain of parent entities
   * (`GET /legal-entities/{id}/parent-hierarchy`).
   */
  async parentHierarchy(legalEntityId: string, auth: AuthContext): Promise<LegalEntity[]> {
    return this.ctx.http.request<LegalEntity[]>({
      method: "GET",
      path: `${this.base()}/${legalEntityId}/parent-hierarchy`,
      auth,
    });
  }
```

- [ ] **Step 5: Add `ContactsService.get`**

Append inside the `ContactsService` class in `packages/sdk/src/services/contacts.ts`, after `unassign` and before the class's closing `}` (line 71):

```ts
  /** Fetches a single contact assignment by id. */
  async get(contactAssignmentId: string, auth: AuthContext): Promise<ContactAssignment> {
    return this.ctx.http.request<ContactAssignment>({
      method: "GET",
      path: `${this.base()}/${contactAssignmentId}`,
      auth,
    });
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- customer-mgmt-admin`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/services/companies.ts packages/sdk/src/services/contacts.ts packages/sdk/tests/services/customer-mgmt-admin.test.ts
git commit -m "feat(customer): add legal-entity search, parent hierarchy and contact-assignment get"
```

---

### Task 2: fee — single product-fee delete and the two product searches

**Files:**
- Modify: `packages/sdk/src/services/fee-types.ts`, `packages/sdk/src/services/fee.ts`
- Test: `packages/sdk/tests/services/fee-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `FeeService(ctx)`, `productFeesBase()`, `itemFeesBase()`, `SERVICE`, `ItemFee`.
- Produces:
  - `interface ItemFeeSearchByProductId { productId: string; siteCodes: string[]; pageNumber?: number; pageSize?: number }`
  - `interface ItemFeeSearchByProductIds { productIds: string; siteCode: string; pageNumber?: number; pageSize?: number }`
  - `deleteProductFee(productId: string, feeId: string, auth?: AuthContext): Promise<void>`
  - `searchItemFeesByProductId(search: ItemFeeSearchByProductId, auth?: AuthContext): Promise<ItemFee[]>`
  - `searchItemFeesByProductIds(search: ItemFeeSearchByProductIds, auth?: AuthContext): Promise<ItemFee[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/fee-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { FeeService } from "../../src/services/fee";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof FeeService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): FeeService => new FeeService(ctxWith(req));
const PF = "/fee/acme/productFees";
const IF = "/fee/acme/itemFees";

describe("FeeService product-fee delete", () => {
  it("deleteProductFee removes a single fee from a product", async () => {
    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).deleteProductFee("p1", "f1");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${PF}/p1/fees/f1`, auth: { kind: "service" } }),
    );
  });

  it("stays distinct from deleteProductFees (which clears all)", async () => {
    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).deleteProductFees("p1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${PF}/p1/fees` }));
  });
});

describe("FeeService product searches", () => {
  it("searchItemFeesByProductId POSTs siteCodes (plural) for one productId", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "if1" }]);
    const res = await svc(s).searchItemFeesByProductId({ productId: "p1", siteCodes: ["main", "ch"] });
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${IF}/searchByProductId`,
        body: { productId: "p1", siteCodes: ["main", "ch"] },
        auth: { kind: "service" },
      }),
    );
    expect(res).toEqual([{ id: "if1" }]);
  });

  it("searchItemFeesByProductIds POSTs productIds as a single string with one siteCode", async () => {
    const s = vi.fn().mockResolvedValue([]);
    await svc(s).searchItemFeesByProductIds({ productIds: "p1,p2", siteCode: "main" });
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${IF}/searchByProductIds`,
        body: { productIds: "p1,p2", siteCode: "main" },
        auth: { kind: "service" },
      }),
    );
  });

  it("honors an explicit auth override", async () => {
    const s = vi.fn().mockResolvedValue([]);
    await svc(s).searchItemFeesByProductId({ productId: "p1", siteCodes: [] }, { kind: "raw", token: "X" });
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- fee-admin`
Expected: FAIL — `deleteProductFee` / `searchItemFeesByProductId` are not functions.

- [ ] **Step 3: Add the two search-body types**

In `packages/sdk/src/services/fee-types.ts`, append after the existing `ItemFeeSearch` interface:

```ts
/**
 * Body of `POST /itemFees/searchByProductId` — one product, several sites.
 *
 * **Note:** this and {@link ItemFeeSearchByProductIds} are asymmetric in the
 * upstream spec (singular here takes `siteCodes: string[]`, plural takes a
 * single `siteCode` and a comma-joined `productIds` **string**). The SDK mirrors
 * the schema verbatim rather than normalizing it.
 */
export interface ItemFeeSearchByProductId {
  productId: string;
  siteCodes: string[];
  pageNumber?: number;
  pageSize?: number;
}

/**
 * Body of `POST /itemFees/searchByProductIds` — several products, one site.
 * `productIds` is a **single string** (comma-separated), not an array — see the
 * note on {@link ItemFeeSearchByProductId}.
 */
export interface ItemFeeSearchByProductIds {
  productIds: string;
  siteCode: string;
  pageNumber?: number;
  pageSize?: number;
}
```

- [ ] **Step 4: Extend the fee service's import and re-export blocks**

In `packages/sdk/src/services/fee.ts`, add both names to the `./fee-types` **import** (lines 3-11) and to the **re-export** block (lines 13-21), so each block reads:

```ts
import type {
  Fee,
  ItemFee,
  FeeDraft,
  ItemFeeDraft,
  ItemFeeSearch,
  ItemFeeSearchByProductId,
  ItemFeeSearchByProductIds,
  ListFeesQuery,
  SetItemFeesOptions,
} from "./fee-types";

export type {
  Fee,
  ItemFee,
  FeeDraft,
  ItemFeeDraft,
  ItemFeeSearch,
  ItemFeeSearchByProductId,
  ItemFeeSearchByProductIds,
  ListFeesQuery,
  SetItemFeesOptions,
} from "./fee-types";
```

- [ ] **Step 5: Add the three methods**

Append inside the `FeeService` class, after `deleteProductFees` and before the class's closing `}` (line 221):

```ts
  /**
   * Removes **one** fee from a product
   * (`DELETE /productFees/{productId}/fees/{feeId}`). Use
   * {@link deleteProductFees} to clear every fee of a product.
   */
  async deleteProductFee(
    productId: string,
    feeId: string,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.productFeesBase()}/${productId}/fees/${feeId}`,
      auth,
    });
  }

  /**
   * Finds item fees for one product across several sites
   * (`POST /itemFees/searchByProductId`).
   */
  async searchItemFeesByProductId(
    search: ItemFeeSearchByProductId,
    auth: AuthContext = SERVICE,
  ): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "POST",
      path: `${this.itemFeesBase()}/searchByProductId`,
      auth,
      body: search,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
    });
  }

  /**
   * Finds item fees for several products on one site
   * (`POST /itemFees/searchByProductIds`). Note the upstream asymmetry:
   * `productIds` is a comma-separated **string** and `siteCode` is singular.
   */
  async searchItemFeesByProductIds(
    search: ItemFeeSearchByProductIds,
    auth: AuthContext = SERVICE,
  ): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "POST",
      path: `${this.itemFeesBase()}/searchByProductIds`,
      auth,
      body: search,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
    });
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- fee-admin`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/services/fee-types.ts packages/sdk/src/services/fee.ts packages/sdk/tests/services/fee-admin.test.ts
git commit -m "feat(sdk): add single product-fee delete and product-based item-fee searches"
```

---

### Task 3: configuration — global configurations and client list

**Files:**
- Modify: `packages/sdk/src/services/tenant-config.ts`, `packages/sdk/src/services/client-config.ts`
- Test: `packages/sdk/tests/services/configuration-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `TenantConfigService(ctx)` / `ClientConfigService(ctx)`, their `SERVICE` consts, `Configuration`.
- Produces:
  - `TenantConfigService.listGlobal<T = unknown>(auth?: AuthContext): Promise<Configuration<T>[]>`
  - `ClientConfigService.listClients(auth?: AuthContext): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/configuration-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { TenantConfigService } from "../../src/services/tenant-config";
import { ClientConfigService } from "../../src/services/client-config";

function ctxWith(request: ReturnType<typeof vi.fn>) {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const tenantCfg = (req: ReturnType<typeof vi.fn>): TenantConfigService => new TenantConfigService(ctxWith(req));
const clientCfg = (req: ReturnType<typeof vi.fn>): ClientConfigService => new ClientConfigService(ctxWith(req));

describe("configuration reads", () => {
  it("listGlobal GETs /global-configurations with the SERVICE default", async () => {
    const g = vi.fn().mockResolvedValue([{ key: "k", value: 1 }]);
    const res = await tenantCfg(g).listGlobal();
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/configuration/acme/global-configurations",
        auth: { kind: "service" },
      }),
    );
    expect(res).toEqual([{ key: "k", value: 1 }]);
  });

  it("listClients GETs /clients with the SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue(["storefront", "backoffice"]);
    const res = await clientCfg(c).listClients();
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/configuration/acme/clients",
        auth: { kind: "service" },
      }),
    );
    expect(res).toEqual(["storefront", "backoffice"]);
  });

  it("both honor an explicit auth override", async () => {
    const g = vi.fn().mockResolvedValue([]);
    await tenantCfg(g).listGlobal({ kind: "raw", token: "X" });
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));

    const c = vi.fn().mockResolvedValue([]);
    await clientCfg(c).listClients({ kind: "raw", token: "X" });
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- configuration-admin`
Expected: FAIL — `listGlobal` / `listClients` are not functions.

- [ ] **Step 3: Add `listGlobal` to `tenant-config.ts`**

Append inside the `TenantConfigService` class, after `delete` and before the class's closing `}` (line 75):

```ts
  /**
   * List the platform-wide global configurations
   * (`GET /global-configurations`) — a separate resource from the tenant's own
   * `/configurations`.
   */
  async listGlobal<T = unknown>(auth: AuthContext = SERVICE): Promise<Configuration<T>[]> {
    return this.ctx.http.request<Configuration<T>[]>({
      method: "GET",
      path: `/configuration/${this.ctx.tenant}/global-configurations`,
      auth,
    });
  }
```

- [ ] **Step 4: Add `listClients` to `client-config.ts`**

Append inside the `ClientConfigService` class, after `delete` and before the class's closing `}` (line 90):

```ts
  /**
   * List the client ids that have configurations (`GET /clients`). Note this
   * targets `/configuration/{tenant}/clients` directly — the private
   * {@link base} helper appends `/configurations` for a specific client.
   */
  async listClients(auth: AuthContext = SERVICE): Promise<string[]> {
    return this.ctx.http.request<string[]>({
      method: "GET",
      path: `/configuration/${this.ctx.tenant}/clients`,
      auth,
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- configuration-admin`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/tenant-config.ts packages/sdk/src/services/client-config.ts packages/sdk/tests/services/configuration-admin.test.ts
git commit -m "feat(sdk): add global configuration and client list reads"
```

---

### Task 4: Changeset + full verification

**Files:**
- Create: `.changeset/remaining-api-coverage.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/remaining-api-coverage.md`:

```md
---
"@viu/emporix-sdk": minor
---

Close the last API-coverage gaps. `client.companies` gains `search` (POST
`/legal-entities/search`) and `parentHierarchy`; `client.contacts` gains `get`.
`client.fees` gains `deleteProductFee` (removing a single fee from a product,
next to the existing `deleteProductFees` which clears all) plus
`searchItemFeesByProductId` and `searchItemFeesByProductIds` — note these two
search bodies are asymmetric upstream (`siteCodes: string[]` vs a single
`siteCode`, and `productIds` as a comma-separated string), which the SDK mirrors
verbatim. `client.tenantConfig` gains `listGlobal` and `client.clientConfig`
gains `listClients`. Every service keeps its existing auth convention.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the three new test files).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/remaining-api-coverage.md
git commit -m "chore(sdk): add changeset for remaining api coverage"
```

---

## Self-Review

**Spec coverage** — every operation maps to a task:

| Spec operation | Task |
|---|---|
| `companies.search` (POST /legal-entities/search) | 1 |
| `companies.parentHierarchy` (GET …/{id}/parent-hierarchy) | 1 |
| `contacts.get` (GET /contact-assignments/{id}) | 1 |
| `deleteProductFee` (DELETE /productFees/{productId}/fees/{feeId}) | 2 |
| `searchItemFeesByProductId` (POST /itemFees/searchByProductId) | 2 |
| `searchItemFeesByProductIds` (POST /itemFees/searchByProductIds) | 2 |
| `listGlobal` (GET /global-configurations) | 3 |
| `listClients` (GET /clients) | 3 |
| 3 new types (`LegalEntitySearchInput`, 2 fee search bodies) | 1, 2 |
| Changeset (minor) | 4 |

8 operations = the full verified gap. The customer services are untouched
(already complete); `GET /validateauthtoken` stays declined. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** method names match between tests and implementations
(`search`, `parentHierarchy`, `get`, `deleteProductFee`,
`searchItemFeesByProductId`, `searchItemFeesByProductIds`, `listGlobal`,
`listClients`). The fee types are declared in `fee-types.ts` and added to both
the import and re-export blocks of `fee.ts` in the same step, so the service
compiles at each commit. `LegalEntitySearchInput` is declared in `companies.ts`
itself (that file declares no separate types module). ✓

**Auth-convention check:** Task 1's methods take `auth` as a required positional
argument with no default (matching `listMine`/`get`/`create` in the same files);
Tasks 2 and 3 use `auth: AuthContext = SERVICE` (matching their files' existing
methods). The tests assert both shapes — Task 1 passes an explicit customer
context, Tasks 2/3 assert the `{ kind: "service" }` default plus an override. ✓

**No barrel/index churn:** all five services reach `index.ts` through `export *`
barrels (`src/companies.ts`, `src/contacts.ts`, `src/fee.ts`,
`src/tenant-config.ts`, `src/client-config.ts`), so the new methods and types are
exported automatically. ✓

**Commit scopes:** verified against `commitlint.config.js` — `customer` (Task 1)
and `sdk` (Tasks 2-4) are both in the allowlist. `fee`, `configuration` and
`contacts` are **not**, which is why Tasks 2 and 3 use `sdk` rather than a
service-named scope. ✓
