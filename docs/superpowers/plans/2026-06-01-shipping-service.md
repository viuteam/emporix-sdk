# Shipping Service Binding (Phase 1 — Config) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **Shipping Service** config cluster as a core SDK service, `client.shipping` (sites, zones, methods, cost/quote, groups, customer-group relations — 26 ops). Delivery scheduling is Phase 2 (later).

**Architecture:** Types generated via `@hey-api/openapi-ts` and aliased in `shipping-types.ts` (read = write body for zone/method/group/cgrelation; creates → `ResourceCreated`; updates/patches/deletes → void). One service class; site-scoped methods take `site` first. Service-token default. No React.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-shipping-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `shipping` spec URL |
| `packages/sdk/specs/shipping.yml` | fetched OpenAPI |
| `packages/sdk/src/generated/shipping/` | generated types |
| `packages/sdk/src/services/shipping-types.ts` | public type aliases |
| `packages/sdk/src/services/shipping.ts` | `ShippingService` |
| `packages/sdk/src/shipping.ts` | facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"shipping"` to `ServiceName` |
| `packages/sdk/src/client.ts` | construct + expose `shipping` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/shipping-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/shipping.test.ts` | MSW tests |
| `packages/sdk/tests/services/shipping-wiring.test.ts` | wiring test |
| `docs/shipping.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/shipping-service.md` | release entry (sdk only) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/shipping-service` off current `main`, commit spec + plan first:
```bash
git checkout main && git pull
git checkout -b feat/shipping-service
git add docs/superpowers/specs/2026-06-01-shipping-service-design.md docs/superpowers/plans/2026-06-01-shipping-service.md
git commit -m "docs(sdk): add shipping service design spec and plan"
```

---

## Task 1: Generate Shipping types (codegen)

- [ ] **Step 1: Add the spec entry** — in `fetch-specs.ts`, after `currency-service`:

```ts
  shipping: `${BASE}/delivery-and-shipping/shipping/api-reference/api.yml`,
```

- [ ] **Step 2: Fetch + generate**

```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```

- [ ] **Step 3: Verify the generated names** — record for Task 2:

```bash
grep -nE "^export type (Site|Sites|Zone|Zones|Method|Methods|Group|GroupList|CGRelation|CGRelationList|FindSiteRequest|QuotePayload|QuoteResponse|QuoteSlot|MinimumFee|ResourceCreatedResponse) " packages/sdk/src/generated/shipping/types.gen.ts
```
Confirm list shapes (array vs paged) and the create/update/patch/delete response codes per op:

```bash
grep -nE "body\??: [A-Za-z]|200:|201:|204:|url: '" packages/sdk/src/generated/shipping/types.gen.ts | grep -iE "zones|methods|quote|groups|cgrelations|findSite|201:|204:" | head -60
```

- [ ] **Step 4: Keep the change focused** — restore unrelated drift; stage only `shipping` paths.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/shipping.yml packages/sdk/src/generated/shipping
git commit -m "feat(sdk): generate shipping types"
```

---

## Task 2: Public types module

**Files:** create `shipping-types.ts`; test `shipping-types.test.ts`.

- [ ] **Step 1: Failing type test** — `packages/sdk/tests/services/shipping-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Site, SiteList, FindSiteInput, Zone, ZoneList, ShippingMethod, ShippingMethodList,
  ShippingGroup, ShippingGroupList, CgRelation, CgRelationList,
  QuoteInput, QuoteResult, QuoteSlotInput, MinimumFee, ResourceCreated,
} from "../../src/services/shipping-types";

describe("shipping types", () => {
  it("all Phase-1 types are usable", () => {
    for (const _ of []) void _;
    expectTypeOf<Site>().not.toBeNever();
    expectTypeOf<SiteList>().not.toBeNever();
    expectTypeOf<FindSiteInput>().not.toBeNever();
    expectTypeOf<Zone>().not.toBeNever();
    expectTypeOf<ZoneList>().not.toBeNever();
    expectTypeOf<ShippingMethod>().not.toBeNever();
    expectTypeOf<ShippingMethodList>().not.toBeNever();
    expectTypeOf<ShippingGroup>().not.toBeNever();
    expectTypeOf<ShippingGroupList>().not.toBeNever();
    expectTypeOf<CgRelation>().not.toBeNever();
    expectTypeOf<CgRelationList>().not.toBeNever();
    expectTypeOf<QuoteInput>().not.toBeNever();
    expectTypeOf<QuoteResult>().not.toBeNever();
    expectTypeOf<QuoteSlotInput>().not.toBeNever();
    expectTypeOf<MinimumFee>().not.toBeNever();
    expectTypeOf<ResourceCreated>().not.toBeNever();
  });
});
```

- [ ] **Step 2: Verify it fails** — `... | grep shipping-types`.

- [ ] **Step 3: Write `shipping-types.ts`** (swap names for the real generated ones):

```ts
/**
 * Public types for the Shipping Service (Phase 1 — config). Stable names aliased
 * over the generated `shipping` types. Zone/Method/Group/CGRelation use the same
 * schema for read and write bodies; creates return `ResourceCreated`.
 */
import type {
  Site as GenSite,
  Sites,
  FindSiteRequest,
  Zone as GenZone,
  Zones,
  Method as GenMethod,
  Methods,
  Group as GenGroup,
  GroupList,
  CGRelation as GenCGRelation,
  CGRelationList,
  QuotePayload,
  QuoteResponse,
  QuoteSlot,
  MinimumFee as GenMinimumFee,
  ResourceCreatedResponse,
} from "../generated/shipping";

/** A shipping-related site. */
export type Site = GenSite;
/** `findSites` response. */
export type SiteList = Sites;
/** `findSites` request body. */
export type FindSiteInput = FindSiteRequest;

/** A shipping zone (read + write body). */
export type Zone = GenZone;
/** List of shipping zones. */
export type ZoneList = Zones;

/** A shipping method (read + write body). */
export type ShippingMethod = GenMethod;
/** List of shipping methods. */
export type ShippingMethodList = Methods;

/** A shipping group (read + write body). */
export type ShippingGroup = GenGroup;
/** List of shipping groups. */
export type ShippingGroupList = GroupList;

/** A customer-group relation (read + write body). */
export type CgRelation = GenCGRelation;
/** List of customer-group relations. */
export type CgRelationList = CGRelationList;

/** Body for `quote` / `quoteMinimum`. */
export type QuoteInput = QuotePayload;
/** `quote` result. */
export type QuoteResult = QuoteResponse;
/** Body for `quoteSlot`. */
export type QuoteSlotInput = QuoteSlot;
/** `quoteMinimum` / `quoteSlot` result. */
export type MinimumFee = GenMinimumFee;

/** Shared create response (`{ id?/link }`). */
export type ResourceCreated = ResourceCreatedResponse;
```

> If a list schema is inlined as an array, set the alias to `T[]`. If a generated
> name differs, swap it; structural only for genuinely inlined schemas.

- [ ] **Step 4: Run test + typecheck** — `vitest run tests/services/shipping-types.test.ts` + `typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/shipping-types.ts packages/sdk/tests/services/shipping-types.test.ts
git commit -m "feat(sdk): add shipping public types"
```

---

## Task 3: ShippingService — core (sites, zones, methods, quote)

**Files:** create `shipping.ts`, `src/shipping.ts`; test `shipping.test.ts` (core cases).

- [ ] **Step 1: Failing service test** — `packages/sdk/tests/services/shipping.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ShippingService } from "../../src/services/shipping";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "shipping" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ShippingService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/shipping/acme";

describe("ShippingService — sites & zones", () => {
  it("findSites POSTs /findSite with a service token", async () => {
    let seenAuth: string | null = null;
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/findSite`, async ({ request }) => {
        seenAuth = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json([{ code: "main" }]);
      }),
    );
    await svc().findSites({ postalCode: "10115" } as never);
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(body).toEqual({ postalCode: "10115" });
  });

  it("listZones / getZone use the site-scoped path", async () => {
    let pathname = "";
    server.use(
      http.get(`${BASE}/main/zones`, () => HttpResponse.json([{ id: "z1" }])),
      http.get(`${BASE}/main/zones/z1`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "z1" });
      }),
    );
    await svc().listZones("main");
    await svc().getZone("main", "z1");
    expect(pathname).toBe("/shipping/acme/main/zones/z1");
  });

  it("createZone POSTs and returns the resource location", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/main/zones`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "z1" }, { status: 201 });
      }),
    );
    const res = await svc().createZone("main", { name: "DE" } as never);
    expect(body).toEqual({ name: "DE" });
    expect((res as { id?: string }).id).toBe("z1");
  });

  it("updateZone / patchZone / deleteZone resolve to void", async () => {
    server.use(
      http.put(`${BASE}/main/zones/z1`, () => new HttpResponse(null, { status: 204 })),
      http.patch(`${BASE}/main/zones/z1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/main/zones/z1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().updateZone("main", "z1", { name: "DE" } as never)).resolves.toBeUndefined();
    await expect(svc().patchZone("main", "z1", { name: "DE2" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteZone("main", "z1")).resolves.toBeUndefined();
  });

  it("getZone throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/main/zones/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getZone("main", "NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });
});

describe("ShippingService — methods & quote", () => {
  it("methods CRUD use the nested path", async () => {
    let createdBody: unknown = null;
    let pathname = "";
    server.use(
      http.get(`${BASE}/main/zones/z1/methods`, () => HttpResponse.json([{ id: "m1" }])),
      http.get(`${BASE}/main/zones/z1/methods/m1`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "m1" });
      }),
      http.post(`${BASE}/main/zones/z1/methods`, async ({ request }) => {
        createdBody = await request.json();
        return HttpResponse.json({ id: "m1" }, { status: 201 });
      }),
      http.put(`${BASE}/main/zones/z1/methods/m1`, () => new HttpResponse(null, { status: 204 })),
      http.patch(`${BASE}/main/zones/z1/methods/m1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/main/zones/z1/methods/m1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listMethods("main", "z1");
    await svc().getMethod("main", "z1", "m1");
    expect(pathname).toBe("/shipping/acme/main/zones/z1/methods/m1");
    await svc().createMethod("main", "z1", { name: "Standard" } as never);
    expect(createdBody).toEqual({ name: "Standard" });
    await expect(svc().updateMethod("main", "z1", "m1", { name: "Std" } as never)).resolves.toBeUndefined();
    await expect(svc().patchMethod("main", "z1", "m1", { name: "Std2" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteMethod("main", "z1", "m1")).resolves.toBeUndefined();
  });

  it("quote / quoteMinimum / quoteSlot POST to their paths", async () => {
    server.use(
      http.post(`${BASE}/main/quote`, () => HttpResponse.json({ methods: [] })),
      http.post(`${BASE}/main/quote/minimum`, () => HttpResponse.json({ amount: 5 })),
      http.post(`${BASE}/main/quote/slot`, () => HttpResponse.json({ amount: 7 })),
    );
    await expect(svc().quote("main", { cartId: "c1" } as never)).resolves.toBeDefined();
    await expect(svc().quoteMinimum("main", { cartId: "c1" } as never)).resolves.toBeDefined();
    await expect(svc().quoteSlot("main", { cartId: "c1" } as never)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Verify it fails** — `vitest run tests/services/shipping.test.ts` → module not found.

- [ ] **Step 3: Write `shipping.ts` + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Site, SiteList, FindSiteInput,
  Zone, ZoneList,
  ShippingMethod, ShippingMethodList,
  ShippingGroup, ShippingGroupList,
  CgRelation, CgRelationList,
  QuoteInput, QuoteResult, QuoteSlotInput, MinimumFee,
  ResourceCreated,
} from "./shipping-types";

export type {
  Site, SiteList, FindSiteInput,
  Zone, ZoneList,
  ShippingMethod, ShippingMethodList,
  ShippingGroup, ShippingGroupList,
  CgRelation, CgRelationList,
  QuoteInput, QuoteResult, QuoteSlotInput, MinimumFee,
  ResourceCreated,
} from "./shipping-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Shipping Service (`/shipping/{tenant}/…`), Phase 1 — config: sites,
 * zones, methods, cost/quote, groups, customer-group relations. Server-side;
 * defaults to the service token. Most methods are site-scoped and take `site`
 * first; `findSites` is tenant-level.
 */
export class ShippingService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/shipping/${this.ctx.tenant}`;
  }

  private siteBase(site: string): string {
    return `${this.base()}/${encodeURIComponent(site)}`;
  }

  // --- Sites ---

  /** Find shipping-related sites by postal code (`POST /findSite`). */
  async findSites(input: FindSiteInput, auth: AuthContext = SERVICE): Promise<SiteList> {
    return this.ctx.http.request<SiteList>({
      method: "POST",
      path: `${this.base()}/findSite`,
      auth,
      body: input,
    });
  }

  // --- Zones ---

  /** List shipping zones for a site. */
  async listZones(site: string, query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<ZoneList> {
    return this.ctx.http.request<ZoneList>({
      method: "GET",
      path: `${this.siteBase(site)}/zones`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one shipping zone. */
  async getZone(site: string, zoneId: string, auth: AuthContext = SERVICE): Promise<Zone> {
    return this.ctx.http.request<Zone>({
      method: "GET",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}`,
      auth,
    });
  }

  /** Create a shipping zone. */
  async createZone(site: string, zone: Zone, auth: AuthContext = SERVICE): Promise<ResourceCreated> {
    return this.ctx.http.request<ResourceCreated>({
      method: "POST",
      path: `${this.siteBase(site)}/zones`,
      auth,
      body: zone,
    });
  }

  /** Replace a shipping zone. */
  async updateZone(site: string, zoneId: string, zone: Zone, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}`,
      auth,
      body: zone,
    });
  }

  /** Partially update a shipping zone. */
  async patchZone(site: string, zoneId: string, patch: Zone, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a shipping zone. */
  async deleteZone(site: string, zoneId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}`,
      auth,
    });
  }

  // --- Methods (per zone) ---

  /** List shipping methods of a zone. */
  async listMethods(site: string, zoneId: string, query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<ShippingMethodList> {
    return this.ctx.http.request<ShippingMethodList>({
      method: "GET",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one shipping method. */
  async getMethod(site: string, zoneId: string, methodId: string, auth: AuthContext = SERVICE): Promise<ShippingMethod> {
    return this.ctx.http.request<ShippingMethod>({
      method: "GET",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods/${encodeURIComponent(methodId)}`,
      auth,
    });
  }

  /** Create a shipping method in a zone. */
  async createMethod(site: string, zoneId: string, method: ShippingMethod, auth: AuthContext = SERVICE): Promise<ResourceCreated> {
    return this.ctx.http.request<ResourceCreated>({
      method: "POST",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods`,
      auth,
      body: method,
    });
  }

  /** Replace a shipping method. */
  async updateMethod(site: string, zoneId: string, methodId: string, method: ShippingMethod, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods/${encodeURIComponent(methodId)}`,
      auth,
      body: method,
    });
  }

  /** Partially update a shipping method. */
  async patchMethod(site: string, zoneId: string, methodId: string, patch: ShippingMethod, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods/${encodeURIComponent(methodId)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a shipping method. */
  async deleteMethod(site: string, zoneId: string, methodId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods/${encodeURIComponent(methodId)}`,
      auth,
    });
  }

  // --- Cost / quote ---

  /** Calculate the final shipping cost (`POST /quote`). */
  async quote(site: string, input: QuoteInput, auth: AuthContext = SERVICE): Promise<QuoteResult> {
    return this.ctx.http.request<QuoteResult>({
      method: "POST",
      path: `${this.siteBase(site)}/quote`,
      auth,
      body: input,
    });
  }

  /** Calculate the minimum shipping cost (`POST /quote/minimum`). */
  async quoteMinimum(site: string, input: QuoteInput, auth: AuthContext = SERVICE): Promise<MinimumFee> {
    return this.ctx.http.request<MinimumFee>({
      method: "POST",
      path: `${this.siteBase(site)}/quote/minimum`,
      auth,
      body: input,
    });
  }

  /** Calculate the shipping cost for a given slot (`POST /quote/slot`). */
  async quoteSlot(site: string, input: QuoteSlotInput, auth: AuthContext = SERVICE): Promise<MinimumFee> {
    return this.ctx.http.request<MinimumFee>({
      method: "POST",
      path: `${this.siteBase(site)}/quote/slot`,
      auth,
      body: input,
    });
  }
}
```

Facade `packages/sdk/src/shipping.ts`:

```ts
export * from "./services/shipping";
```

> `Site`, `ShippingGroup`/`ShippingGroupList`, `CgRelation`/`CgRelationList` are
> imported here so the re-export surfaces them; they are used by Task 4's methods.
> If the type re-export complains about unused imports before Task 4, keep them —
> they are consumed by the `export type` block (a re-export, not a value use).

- [ ] **Step 4: Run test + typecheck** — `vitest run tests/services/shipping.test.ts` + `typecheck`. Drop `as never` if the aliased inputs accept the literals.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/shipping.ts packages/sdk/src/shipping.ts packages/sdk/tests/services/shipping.test.ts
git commit -m "feat(sdk): add shipping service (sites, zones, methods, quote)"
```

---

## Task 4: ShippingService — groups & customer-group relations

**Files:** modify `shipping.ts`; extend `shipping.test.ts`.

- [ ] **Step 1: Add failing tests** — append to `shipping.test.ts`:

```ts
describe("ShippingService — groups & cg-relations", () => {
  it("groups CRUD", async () => {
    let createdBody: unknown = null;
    server.use(
      http.get(`${BASE}/main/groups`, () => HttpResponse.json([{ id: "g1" }])),
      http.get(`${BASE}/main/groups/g1`, () => HttpResponse.json({ id: "g1" })),
      http.post(`${BASE}/main/groups`, async ({ request }) => {
        createdBody = await request.json();
        return HttpResponse.json({ id: "g1" }, { status: 201 });
      }),
      http.put(`${BASE}/main/groups/g1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/main/groups/g1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listGroups("main");
    expect((await svc().getGroup("main", "g1")) as { id?: string }).toEqual({ id: "g1" });
    await svc().createGroup("main", { name: "Bulky" } as never);
    expect(createdBody).toEqual({ name: "Bulky" });
    await expect(svc().updateGroup("main", "g1", { name: "Bulky2" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteGroup("main", "g1")).resolves.toBeUndefined();
  });

  it("customer-group relations CRUD", async () => {
    let createdBody: unknown = null;
    let pathname = "";
    server.use(
      http.get(`${BASE}/main/cgrelations`, () => HttpResponse.json([{ customerId: "C1" }])),
      http.get(`${BASE}/main/cgrelations/C1`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ customerId: "C1" });
      }),
      http.post(`${BASE}/main/cgrelations`, async ({ request }) => {
        createdBody = await request.json();
        return HttpResponse.json({ customerId: "C1" }, { status: 201 });
      }),
      http.put(`${BASE}/main/cgrelations/C1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/main/cgrelations/C1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listCgRelations("main");
    await svc().getCgRelations("main", "C1");
    expect(pathname).toBe("/shipping/acme/main/cgrelations/C1");
    await svc().createCgRelation("main", { customerId: "C1" } as never);
    expect(createdBody).toEqual({ customerId: "C1" });
    await expect(svc().updateCgRelations("main", "C1", { groups: [] } as never)).resolves.toBeUndefined();
    await expect(svc().deleteCgRelation("main", "C1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Verify the new tests fail** — `vitest run tests/services/shipping.test.ts` (the group/cg methods are missing).

- [ ] **Step 3: Add the methods** — insert into the `ShippingService` class (before the closing brace):

```ts
  // --- Groups ---

  /** List shipping groups for a site. */
  async listGroups(site: string, query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<ShippingGroupList> {
    return this.ctx.http.request<ShippingGroupList>({
      method: "GET",
      path: `${this.siteBase(site)}/groups`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one shipping group. */
  async getGroup(site: string, groupId: string, auth: AuthContext = SERVICE): Promise<ShippingGroup> {
    return this.ctx.http.request<ShippingGroup>({
      method: "GET",
      path: `${this.siteBase(site)}/groups/${encodeURIComponent(groupId)}`,
      auth,
    });
  }

  /** Create a shipping group. */
  async createGroup(site: string, group: ShippingGroup, auth: AuthContext = SERVICE): Promise<ResourceCreated> {
    return this.ctx.http.request<ResourceCreated>({
      method: "POST",
      path: `${this.siteBase(site)}/groups`,
      auth,
      body: group,
    });
  }

  /** Replace a shipping group. */
  async updateGroup(site: string, groupId: string, group: ShippingGroup, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.siteBase(site)}/groups/${encodeURIComponent(groupId)}`,
      auth,
      body: group,
    });
  }

  /** Delete a shipping group. */
  async deleteGroup(site: string, groupId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.siteBase(site)}/groups/${encodeURIComponent(groupId)}`,
      auth,
    });
  }

  // --- Customer-group relations ---

  /** List customer-group relations for a site. */
  async listCgRelations(site: string, query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<CgRelationList> {
    return this.ctx.http.request<CgRelationList>({
      method: "GET",
      path: `${this.siteBase(site)}/cgrelations`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a customer's customer-group relations. */
  async getCgRelations(site: string, customerId: string, auth: AuthContext = SERVICE): Promise<CgRelation> {
    return this.ctx.http.request<CgRelation>({
      method: "GET",
      path: `${this.siteBase(site)}/cgrelations/${encodeURIComponent(customerId)}`,
      auth,
    });
  }

  /** Create a customer-group relation. */
  async createCgRelation(site: string, relation: CgRelation, auth: AuthContext = SERVICE): Promise<ResourceCreated> {
    return this.ctx.http.request<ResourceCreated>({
      method: "POST",
      path: `${this.siteBase(site)}/cgrelations`,
      auth,
      body: relation,
    });
  }

  /** Update a customer's customer-group relations. */
  async updateCgRelations(site: string, customerId: string, relation: CgRelation, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.siteBase(site)}/cgrelations/${encodeURIComponent(customerId)}`,
      auth,
      body: relation,
    });
  }

  /** Delete a customer's customer-group relation. */
  async deleteCgRelation(site: string, customerId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.siteBase(site)}/cgrelations/${encodeURIComponent(customerId)}`,
      auth,
    });
  }
```

- [ ] **Step 4: Run the full shipping test + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/shipping.ts packages/sdk/tests/services/shipping.test.ts
git commit -m "feat(sdk): add shipping groups and customer-group relations"
```

---

## Task 5: Wire onto EmporixClient

**Files:** modify `logger.ts`, `client.ts`, `index.ts`; test `shipping-wiring.test.ts`.

- [ ] **Step 1: Failing wiring test:**

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { ShippingService } from "../../src/services/shipping";

describe("EmporixClient shipping wiring", () => {
  it("exposes the shipping service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.shipping).toBeInstanceOf(ShippingService);
  });
});
```

- [ ] **Step 2: Verify it fails.**

- [ ] **Step 3a: `ServiceName`** — add `| "shipping"` after `| "currency"`.
- [ ] **Step 3b: `client.ts`** — import `ShippingService` after `CurrencyService`; field `readonly shipping: ShippingService;` after `currencies`; construct `this.shipping = new ShippingService(mk("shipping"));`.
- [ ] **Step 3c: barrel** — `export * from "./shipping";` after `export * from "./currency";`.

- [ ] **Step 4: Run wiring test, full suite, typecheck, build:**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/shipping-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk build
```

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/shipping-wiring.test.ts
git commit -m "feat(sdk): expose shipping service on the client"
```

---

## Task 6: Documentation

- [ ] **Step 1: `docs/shipping.md`**

````markdown
# Shipping Service

Bindings for the Emporix **Shipping Service** (`/shipping/{tenant}/…`). **Phase 1**
covers shipping config: sites, zones, methods, cost/quote, groups, and
customer-group relations.

> **Server-side.** Defaults to the service token (`shipping.shipping_read` /
> `shipping.shipping_manage`). Most methods are **site-scoped** and take `site`
> as the first argument; `findSites` is tenant-level. Creates return a resource
> location; updates/patches/deletes resolve to `void`.

```ts
// sites
const sites = await client.shipping.findSites({ postalCode: "10115" });

// zones + methods (site-scoped)
const zones = await client.shipping.listZones("main");
const { id: zoneId } = await client.shipping.createZone("main", { name: { en: "Germany" }, /* … */ });
const methods = await client.shipping.listMethods("main", zoneId);
await client.shipping.createMethod("main", zoneId, { name: { en: "Standard" }, /* … */ });

// cost
const quote = await client.shipping.quote("main", { cartId: "cart-1" /* … */ });
const minimum = await client.shipping.quoteMinimum("main", { cartId: "cart-1" });

// groups + customer-group relations
await client.shipping.listGroups("main");
await client.shipping.listCgRelations("main");
```

> **Phase 2 (not yet bound):** delivery windows, delivery times + slots, and
> delivery cycles.
````

- [ ] **Step 2: CLAUDE.md** — append `Shipping` to the service list:

```
…, Country, Currency, Shipping) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/shipping.md CLAUDE.md
git commit -m "docs(sdk): document the shipping service"
```

---

## Task 7: Changeset

- [ ] **Step 1: `.changeset/shipping-service.md`**

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix Shipping Service bindings (Phase 1 — config) via `client.shipping`:
sites (`findSites`), zones and methods (full CRUD), cost/quote (`quote`,
`quoteMinimum`, `quoteSlot`), shipping groups, and customer-group relations.
Server-side only — these use the service (clientCredentials) token. Delivery
scheduling (windows, times, slots, cycles) is not yet bound.
```

- [ ] **Step 2: Verify** — `pnpm changeset status` (adds `@viu/emporix-sdk`).

- [ ] **Step 3: Commit**

```bash
git add .changeset/shipping-service.md
git commit -m "chore(release): add shipping service changeset"
```

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 Phase-1 scope (26 ops: sites/zones/methods/quote/groups/cgrelations) → Tasks 3+4 + tests; scheduling excluded (Phase 2). D2 one service → Task 5. D3 no React → no React tasks. D4 service-token default → `const SERVICE` per method. D5 codegen + aliasing (read=write body, creates→`ResourceCreated`, updates/patches/deletes→void) → Tasks 1/2/3/4. D6 `site` param → `siteBase(site)` helper; `findSites` uses `base()`; tests assert `/shipping/acme/main/zones/z1` and `/shipping/acme/findSite`. Docs/changeset → Tasks 6/7 (sdk only). No gaps.
- **Placeholder scan:** No TBD/TODO. All 26 methods have full code (Task 3: 16, Task 4: 10). Upstream-dependent uncertainties (generated names, list-envelope, update/patch response codes) are concrete `grep`/note verifications with fallbacks.
- **Type consistency:** Public names (`Site`/`SiteList`/`FindSiteInput`/`Zone`/`ZoneList`/`ShippingMethod`/`ShippingMethodList`/`ShippingGroup`/`ShippingGroupList`/`CgRelation`/`CgRelationList`/`QuoteInput`/`QuoteResult`/`QuoteSlotInput`/`MinimumFee`/`ResourceCreated`) are identical across Task 2 (defs), Task 3 (imports + re-exports), Tasks 3/4 method signatures, and the tests. Method names match across the service, the wiring test, and the docs. Base path `/shipping/${tenant}` + `siteBase` match the spec and tests. Logger `"shipping"` matches `mk("shipping")` and the `ServiceName` addition. Commit scopes are `sdk`/`release` with lowercase verbs (commitlint-safe).
```
