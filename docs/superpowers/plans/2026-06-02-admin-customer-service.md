# Admin: Customer Service (Batch 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the tenant-managed Customer Service as `client.customerAdmin` (15 ops). `client-management` is skipped (already covered by companies/contacts/locations).

**Architecture:** Types generated via `@hey-api/openapi-ts`, aliased with an `AdminCustomer*` prefix (avoids barrel collisions with the storefront `client.customers`). One service class, service-token default, no React.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-02-admin-customer-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `customer-service` URL |
| `packages/sdk/specs/customer-service.yml` | fetched OpenAPI |
| `packages/sdk/src/generated/customer-service/` | generated types |
| `packages/sdk/src/services/customer-admin-types.ts` | public type aliases |
| `packages/sdk/src/services/customer-admin.ts` | `CustomerAdminService` |
| `packages/sdk/src/customer-admin.ts` | facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"customer-admin"` |
| `packages/sdk/src/client.ts` | construct + expose `customerAdmin` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/customer-admin{,-types,-wiring}.test.ts` | tests |
| `docs/customer-admin.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/admin-customer-service.md` | release entry (sdk only) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/admin-customer-service` off current `main`, commit spec + plan first:
```bash
git checkout main && git pull
git checkout -b feat/admin-customer-service
git add docs/superpowers/specs/2026-06-02-admin-customer-service-design.md docs/superpowers/plans/2026-06-02-admin-customer-service.md
git commit -m "docs(sdk): add admin customer-service design spec and plan"
```

---

## Task 1: Generate types (codegen)

- [ ] **Step 1:** in `fetch-specs.ts`, after `pick-pack`:
```ts
  "customer-service": `${BASE}/companies-and-customers/customer-service/api-reference/api.yml`,
```
- [ ] **Step 2:** `pnpm -F @viu/emporix-sdk fetch:specs` then `generate`.
- [ ] **Step 3: Verify generated names** — record for Task 2:
```bash
grep -nE "^export type (CustomerForSellerDto|CustomerSignupBySellerDto|CustomerUpdateBySellerDto|CustomerPatchBySellerDto|ResourceLocation|Address|Address_2|AddressUpdateDto) =" packages/sdk/src/generated/customer-service/types.gen.ts
grep -nE "body\??: [A-Za-z]|200: |201:|204:|url: '/customer/\{tenant\}/customers" packages/sdk/src/generated/customer-service/types.gen.ts | head -40
```
Pin: patch/tag response codes, the search body type, the `tags` query param name/format, and the add-address body (`Address_2`).
- [ ] **Step 4:** keep focused (restore unrelated drift; stage only `customer-service`).
- [ ] **Step 5: Commit**
```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/customer-service.yml packages/sdk/src/generated/customer-service
git commit -m "feat(sdk): generate customer-service (admin) types"
```

---

## Task 2: CustomerAdminService (types + service)

- [ ] **Step 1: `customer-admin-types.ts`** (swap names for the real generated ones):

```ts
import type {
  CustomerForSellerDto,
  CustomerSignupBySellerDto,
  CustomerUpdateBySellerDto,
  CustomerPatchBySellerDto,
  ResourceLocation,
  Address as GenAddress,
  Address_2,
  AddressUpdateDto,
} from "../generated/customer-service";

/** A customer profile (seller/admin read shape). */
export type AdminCustomer = CustomerForSellerDto;
/** List of customers. */
export type AdminCustomerList = AdminCustomer[];
/** Create body (`POST /customers`). */
export type AdminCustomerInput = CustomerSignupBySellerDto;
/** Upsert body (`PUT /customers/{num}`). */
export type AdminCustomerUpdate = CustomerUpdateBySellerDto;
/** Partial-update body (`PATCH /customers/{num}`). */
export type AdminCustomerPatch = CustomerPatchBySellerDto;
/** Create/upsert response — a resource location. */
export type AdminCustomerCreated = ResourceLocation;
/** Search body (`POST /customers/search`). */
export type AdminCustomerSearchQuery = Record<string, unknown>;

/** A customer address (read). */
export type AdminCustomerAddress = GenAddress;
/** List of customer addresses. */
export type AdminCustomerAddressList = AdminCustomerAddress[];
/** Add-address body (`POST …/addresses`). */
export type AdminCustomerAddressInput = Address_2;
/** Upsert/patch address body (`PUT`/`PATCH …/addresses/{id}`). */
export type AdminCustomerAddressUpdate = AddressUpdateDto;
```

> If the spec names the search body, alias `AdminCustomerSearchQuery` to it. If
> the add-address body is not `Address_2` (hey-api dedup name), use the real name.

Type test `customer-admin-types.test.ts`: assert all `not.toBeNever()` (lists `toBeArray()`).

- [ ] **Step 2: Failing service test** — `customer-admin.test.ts` (`BASE = "https://api.emporix.io/customer/acme/customers"`):

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CustomerAdminService } from "../../src/services/customer-admin";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-admin" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CustomerAdminService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/customer/acme/customers";

describe("CustomerAdminService", () => {
  it("listCustomers GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ customerNumber: "C1" }]);
      }),
    );
    await svc().listCustomers();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("search / get / create / upsert / patch / delete", async () => {
    let searchBody: unknown = null;
    let createBody: unknown = null;
    server.use(
      http.post(`${BASE}/search`, async ({ request }) => {
        searchBody = await request.json();
        return HttpResponse.json([{ customerNumber: "C1" }]);
      }),
      http.get(`${BASE}/C1`, () => HttpResponse.json({ customerNumber: "C1" })),
      http.post(BASE, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ id: "C1" }, { status: 201 });
      }),
      http.put(`${BASE}/C1`, () => HttpResponse.json({ id: "C1" }, { status: 200 })),
      http.patch(`${BASE}/C1`, () => new HttpResponse(null, { status: 200 })),
      http.delete(`${BASE}/C1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().searchCustomers({ email: "a@b.c" });
    expect(searchBody).toEqual({ email: "a@b.c" });
    expect((await svc().getCustomer("C1")) as { customerNumber?: string }).toEqual({ customerNumber: "C1" });
    expect(((await svc().createCustomer({ email: "a@b.c" } as never)) as { id?: string }).id).toBe("C1");
    expect(createBody).toEqual({ email: "a@b.c" });
    await expect(svc().upsertCustomer("C1", { email: "a@b.c" } as never)).resolves.toBeDefined();
    await expect(svc().patchCustomer("C1", { firstName: "A" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteCustomer("C1")).resolves.toBeUndefined();
  });

  it("getCustomer throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getCustomer("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("addresses: list / get / add / upsert / patch / delete", async () => {
    let addBody: unknown = null;
    server.use(
      http.get(`${BASE}/C1/addresses`, () => HttpResponse.json([{ id: "a1" }])),
      http.get(`${BASE}/C1/addresses/a1`, () => HttpResponse.json({ id: "a1" })),
      http.post(`${BASE}/C1/addresses`, async ({ request }) => {
        addBody = await request.json();
        return HttpResponse.json({ id: "a1" }, { status: 201 });
      }),
      http.put(`${BASE}/C1/addresses/a1`, () => HttpResponse.json({ id: "a1" }, { status: 200 })),
      http.patch(`${BASE}/C1/addresses/a1`, () => new HttpResponse(null, { status: 200 })),
      http.delete(`${BASE}/C1/addresses/a1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listAddresses("C1");
    expect((await svc().getAddress("C1", "a1")) as { id?: string }).toEqual({ id: "a1" });
    await svc().addAddress("C1", { street: "Main" } as never);
    expect(addBody).toEqual({ street: "Main" });
    await expect(svc().upsertAddress("C1", "a1", { street: "Main" } as never)).resolves.toBeDefined();
    await expect(svc().patchAddress("C1", "a1", { street: "2nd" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteAddress("C1", "a1")).resolves.toBeUndefined();
  });

  it("address tags via the ?tags= query param", async () => {
    let addSearch = "";
    let delSearch = "";
    server.use(
      http.post(`${BASE}/C1/addresses/a1/tags`, ({ request }) => {
        addSearch = new URL(request.url).search;
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${BASE}/C1/addresses/a1/tags`, ({ request }) => {
        delSearch = new URL(request.url).search;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().addAddressTags("C1", "a1", ["home", "default"]);
    await svc().removeAddressTags("C1", "a1", ["home"]);
    expect(addSearch).toContain("tags=home");
    expect(delSearch).toContain("tags=home");
  });

  it("encodeURIComponent-escapes the customer number", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/customer/acme/customers/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getCustomer("a/b");
    expect(pathname).toBe("/customer/acme/customers/a%2Fb");
  });
});
```

> Adjust patch (200 no body → void) and tags (query param) per codegen findings.

- [ ] **Step 3: Write `customer-admin.ts` + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  AdminCustomer, AdminCustomerList, AdminCustomerInput, AdminCustomerUpdate,
  AdminCustomerPatch, AdminCustomerCreated, AdminCustomerSearchQuery,
  AdminCustomerAddress, AdminCustomerAddressList, AdminCustomerAddressInput, AdminCustomerAddressUpdate,
} from "./customer-admin-types";

export type {
  AdminCustomer, AdminCustomerList, AdminCustomerInput, AdminCustomerUpdate,
  AdminCustomerPatch, AdminCustomerCreated, AdminCustomerSearchQuery,
  AdminCustomerAddress, AdminCustomerAddressList, AdminCustomerAddressInput, AdminCustomerAddressUpdate,
} from "./customer-admin-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Customer Service — tenant/seller-managed customer profiles and
 * addresses (`/customer/{tenant}/customers`). Server-side; defaults to the
 * service token. Distinct from the storefront `client.customers`.
 */
export class CustomerAdminService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/customer/${this.ctx.tenant}/customers`;
  }

  private customerPath(customerNumber: string): string {
    return `${this.base()}/${encodeURIComponent(customerNumber)}`;
  }

  private addressPath(customerNumber: string, addressId: string): string {
    return `${this.customerPath(customerNumber)}/addresses/${encodeURIComponent(addressId)}`;
  }

  // --- Customers ---

  /** List customers. */
  async listCustomers(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<AdminCustomerList> {
    return this.ctx.http.request<AdminCustomerList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Search customers (`POST /customers/search`). */
  async searchCustomers(query: AdminCustomerSearchQuery, auth: AuthContext = SERVICE): Promise<AdminCustomerList> {
    return this.ctx.http.request<AdminCustomerList>({ method: "POST", path: `${this.base()}/search`, auth, body: query });
  }

  /** Retrieve a customer profile by number. */
  async getCustomer(customerNumber: string, auth: AuthContext = SERVICE): Promise<AdminCustomer> {
    return this.ctx.http.request<AdminCustomer>({ method: "GET", path: this.customerPath(customerNumber), auth });
  }

  /** Create a customer. */
  async createCustomer(input: AdminCustomerInput, auth: AuthContext = SERVICE): Promise<AdminCustomerCreated> {
    return this.ctx.http.request<AdminCustomerCreated>({ method: "POST", path: this.base(), auth, body: input });
  }

  /** Upsert a customer profile by number (`PUT`). */
  async upsertCustomer(customerNumber: string, input: AdminCustomerUpdate, auth: AuthContext = SERVICE): Promise<AdminCustomerCreated> {
    return this.ctx.http.request<AdminCustomerCreated>({ method: "PUT", path: this.customerPath(customerNumber), auth, body: input });
  }

  /** Partially update a customer profile (`PATCH`). */
  async patchCustomer(customerNumber: string, patch: AdminCustomerPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "PATCH", path: this.customerPath(customerNumber), auth, body: patch });
  }

  /** Delete a customer profile. */
  async deleteCustomer(customerNumber: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "DELETE", path: this.customerPath(customerNumber), auth });
  }

  // --- Addresses ---

  /** List a customer's addresses. */
  async listAddresses(customerNumber: string, auth: AuthContext = SERVICE): Promise<AdminCustomerAddressList> {
    return this.ctx.http.request<AdminCustomerAddressList>({
      method: "GET",
      path: `${this.customerPath(customerNumber)}/addresses`,
      auth,
    });
  }

  /** Retrieve one address. */
  async getAddress(customerNumber: string, addressId: string, auth: AuthContext = SERVICE): Promise<AdminCustomerAddress> {
    return this.ctx.http.request<AdminCustomerAddress>({ method: "GET", path: this.addressPath(customerNumber, addressId), auth });
  }

  /** Add an address. */
  async addAddress(customerNumber: string, input: AdminCustomerAddressInput, auth: AuthContext = SERVICE): Promise<AdminCustomerCreated> {
    return this.ctx.http.request<AdminCustomerCreated>({
      method: "POST",
      path: `${this.customerPath(customerNumber)}/addresses`,
      auth,
      body: input,
    });
  }

  /** Upsert an address by id (`PUT`). */
  async upsertAddress(customerNumber: string, addressId: string, input: AdminCustomerAddressUpdate, auth: AuthContext = SERVICE): Promise<AdminCustomerCreated> {
    return this.ctx.http.request<AdminCustomerCreated>({ method: "PUT", path: this.addressPath(customerNumber, addressId), auth, body: input });
  }

  /** Partially update an address by id (`PATCH`). */
  async patchAddress(customerNumber: string, addressId: string, patch: AdminCustomerAddressUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "PATCH", path: this.addressPath(customerNumber, addressId), auth, body: patch });
  }

  /** Delete an address by id. */
  async deleteAddress(customerNumber: string, addressId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "DELETE", path: this.addressPath(customerNumber, addressId), auth });
  }

  /** Add tags to an address (`?tags=` query). */
  async addAddressTags(customerNumber: string, addressId: string, tags: string[], auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.addressPath(customerNumber, addressId)}/tags`,
      auth,
      query: { tags: tags.join(",") },
    });
  }

  /** Remove tags from an address (`?tags=` query). */
  async removeAddressTags(customerNumber: string, addressId: string, tags: string[], auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.addressPath(customerNumber, addressId)}/tags`,
      auth,
      query: { tags: tags.join(",") },
    });
  }
}
```

Facade `src/customer-admin.ts`: `export * from "./services/customer-admin";`

- [ ] **Step 4: Run tests + typecheck.** Drop `as never` where the aliased inputs accept the literals.

- [ ] **Step 5: Commit (two commits: types, service).**

```bash
git commit -m "feat(sdk): add customer-admin public types"
git commit -m "feat(sdk): add customer-admin service"
```

---

## Task 3: Wire onto EmporixClient

- [ ] **Step 1: Failing wiring test** — `customer-admin-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { CustomerAdminService } from "../../src/services/customer-admin";

describe("EmporixClient customer-admin wiring", () => {
  it("exposes the customer-admin service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.customerAdmin).toBeInstanceOf(CustomerAdminService);
  });
});
```

- [ ] **Step 2: Verify it fails.**
- [ ] **Step 3a: `ServiceName`** — add `| "customer-admin"` after `| "pick-pack"`.
- [ ] **Step 3b: `client.ts`** — import `CustomerAdminService` after `PickPackService`; field `readonly customerAdmin: CustomerAdminService;` after `pickPack`; construct `this.customerAdmin = new CustomerAdminService(mk("customer-admin"));`.
- [ ] **Step 3c: barrel** — `export * from "./customer-admin";` after `export * from "./pick-pack";`.
- [ ] **Step 4: Run wiring test, full suite, typecheck, build.**
- [ ] **Step 5: Commit** — `feat(sdk): expose customer-admin service on the client`.

---

## Task 4: Documentation

- [ ] **Step 1:** Create `docs/customer-admin.md` (server-side note; clarify it is the seller/admin customer management, distinct from the storefront `client.customers`).
- [ ] **Step 2: CLAUDE.md** — append `CustomerAdmin` to the service list.
- [ ] **Step 3: Commit** — `docs(sdk): document the customer-admin service`.

---

## Task 5: Changeset

- [ ] **Step 1: `.changeset/admin-customer-service.md`**

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix tenant-managed Customer Service bindings via `client.customerAdmin`:
admin/seller CRUD over customer profiles (`listCustomers`, `searchCustomers`,
`getCustomer`, `createCustomer`, `upsertCustomer`, `patchCustomer`,
`deleteCustomer`) and their addresses (`listAddresses`, `getAddress`,
`addAddress`, `upsertAddress`, `patchAddress`, `deleteAddress`, `addAddressTags`,
`removeAddressTags`). Server-side only — distinct from the storefront
`client.customers`.
```

- [ ] **Step 2: Verify** — `pnpm changeset status` (adds `@viu/emporix-sdk`).
- [ ] **Step 3: Commit** — `chore(release): add customer-admin service changeset`.

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
```

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 full surface (15 ops) → Task 2 methods + tests. D2 new service `client.customerAdmin`, client-management skipped → Task 3. D3 no React / service-token → `const SERVICE`. D4 codegen + `AdminCustomer*`-prefixed aliasing (avoids barrel collisions with storefront `Customer`/`Address`); create/upsert → `ResourceLocation`; patch → void; delete → void; tags via `?tags=` query. Docs/changeset → Tasks 4/5 (sdk only). No gaps.
- **Placeholder scan:** No TBD/TODO in code steps. Upstream uncertainties (patch/tag response codes, search body, `Address_2` name, tags param) are concrete codegen-verify notes with fallbacks.
- **Type consistency:** Public names all `AdminCustomer*`-prefixed → no collision with existing `Customer`/`Address` barrel exports; identical across the types module, the service imports + re-exports, and the tests. Base path `/customer/${tenant}/customers` matches the spec + tests. Logger `"customer-admin"` matches `mk("customer-admin")` + the `ServiceName` addition. `customerPath`/`addressPath` helpers centralize prefixes. Commit scopes `sdk`/`release`, lowercase verbs (commitlint-safe).
```
