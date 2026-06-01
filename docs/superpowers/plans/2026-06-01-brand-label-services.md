# Brand + Label Services Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **Brand** and **Label** services as two core SDK services, `client.brands` and `client.labels` (full CRUD each), in one branch/PR.

**Architecture:** Types generated via `@hey-api/openapi-ts`; `brand-types.ts`/`label-types.ts` alias the generated types. Two service classes default to the service token (overridable). **Tenant-less base paths** (`/brand/brands`, `/label/labels`). No React.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-brand-label-services-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `brand-service` + `label-service` URLs |
| `packages/sdk/specs/{brand-service,label-service}.yml` | fetched OpenAPI |
| `packages/sdk/src/generated/{brand-service,label-service}/` | generated types |
| `packages/sdk/src/services/{brand,label}-types.ts` | public type aliases |
| `packages/sdk/src/services/{brand,label}.ts` | `BrandService` / `LabelService` |
| `packages/sdk/src/{brand,label}.ts` | facade re-exports |
| `packages/sdk/src/core/logger.ts` | add `"brand"`, `"label"` to `ServiceName` |
| `packages/sdk/src/client.ts` | construct + expose `brands`, `labels` |
| `packages/sdk/src/index.ts` | re-export the facades |
| `packages/sdk/tests/services/{brand,label}-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/{brand,label}.test.ts` | MSW tests |
| `packages/sdk/tests/services/brand-label-wiring.test.ts` | wiring test (both) |
| `docs/brand.md`, `docs/label.md` | usage docs |
| `CLAUDE.md` | service-list update |
| `.changeset/brand-label-services.md` | release entry (sdk only) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/brand-label-services` off current `main`, commit the spec + plan docs first:
```bash
git checkout main && git pull
git checkout -b feat/brand-label-services
git add docs/superpowers/specs/2026-06-01-brand-label-services-design.md docs/superpowers/plans/2026-06-01-brand-label-services.md
git commit -m "docs(sdk): add brand and label services design spec and plan"
```

---

## Task 1: Generate Brand + Label types (codegen)

**Files:** modify `fetch-specs.ts`; create the two `specs/*.yml` + `src/generated/*` trees.

- [ ] **Step 1: Add the spec entries**

In `packages/sdk/scripts/fetch-specs.ts`, add (after the `reward-points` entry):

```ts
  "brand-service": `${BASE}/products-labels-and-brands/brand-service/api-reference/api.yml`,
  "label-service": `${BASE}/products-labels-and-brands/label-service/api-reference/api.yml`,
```

(Both URLs verified live → HTTP 200.)

- [ ] **Step 2: Fetch + generate**

```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: `fetched brand-service (...)`, `fetched label-service (...)`, and both `src/generated/` trees written.

- [ ] **Step 3: Verify the generated type names**

```bash
grep -nE "^export type " packages/sdk/src/generated/brand-service/types.gen.ts | grep -viE "Data =|Error|Responses|Response =|ClientOptions|Trait|Page"
grep -nE "^export type " packages/sdk/src/generated/label-service/types.gen.ts | grep -viE "Data =|Error|Responses|Response =|ClientOptions|Trait|Page"
```
Record (scratch note for Tasks 2/3):
- Brand: read shape (`BrandResponse`), list (`Brands`), create body (`Brand`), update body (`UpdateBrand`).
- Label: read shape (`Label`), list (`Labels`), create body (`LabelCreation`), update body (`LabelUpdate`).

Confirm the PATCH body type and the list shape (paged envelope vs plain array), and the create/update/delete response codes:
```bash
grep -nE "body\??:|200:|201:|204:|url: '" packages/sdk/src/generated/brand-service/types.gen.ts | head -40
grep -nE "body\??:|200:|201:|204:|url: '" packages/sdk/src/generated/label-service/types.gen.ts | head -40
```

- [ ] **Step 4: Keep the change focused**

`git status --short`. If unrelated `specs/*.yml`/`src/generated/*` drifted, restore them; re-run Step 2; stage only the brand/label paths.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/brand-service.yml packages/sdk/specs/label-service.yml packages/sdk/src/generated/brand-service packages/sdk/src/generated/label-service
git commit -m "feat(sdk): generate brand and label types"
```

---

## Task 2: BrandService (types + service)

**Files:** create `brand-types.ts`, `brand.ts`, `src/brand.ts`; tests `brand-types.test.ts`, `brand.test.ts`.

- [ ] **Step 1: Write the failing type test**

Create `packages/sdk/tests/services/brand-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Brand, BrandList, BrandInput, BrandUpdate } from "../../src/services/brand-types";

describe("brand types", () => {
  it("Brand and BrandList are usable", () => {
    expectTypeOf<Brand>().not.toBeNever();
    expectTypeOf<BrandList>().not.toBeNever();
  });
  it("BrandInput / BrandUpdate are usable as bodies", () => {
    expectTypeOf<BrandInput>().not.toBeNever();
    expectTypeOf<BrandUpdate>().not.toBeNever();
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm -F @viu/emporix-sdk exec tsc --noEmit 2>&1 | grep brand-types
```
Expected: `Cannot find module '../../src/services/brand-types'`.

- [ ] **Step 3: Write `brand-types.ts`** (swap names for the real generated ones)

```ts
import type {
  BrandResponse,
  Brands,
  Brand as GenBrandInput,
  UpdateBrand,
} from "../generated/brand-service";

/** A brand (read shape). */
export type Brand = BrandResponse;
/** List of brands (`GET /brand/brands`). */
export type BrandList = Brands;
/** Create body (`POST /brand/brands`). */
export type BrandInput = GenBrandInput;
/** Update / patch body (`PUT`/`PATCH /brand/brands/{id}`). */
export type BrandUpdate = UpdateBrand;
```

> If the list is a plain array (`Brands = Array<BrandResponse>`) keep it; if it
> is a paged envelope, `BrandList` reflects that. Alias only — structural only
> for genuinely inlined schemas.

- [ ] **Step 4: Write the failing service test**

Create `packages/sdk/tests/services/brand.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { BrandService } from "../../src/services/brand";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "brand" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new BrandService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/brand/brands";

describe("BrandService", () => {
  it("listBrands GETs the tenant-less path with a service token", async () => {
    let seenAuth: string | null = null;
    let pathname = "";
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "b1" }]);
      }),
    );
    await svc().listBrands();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(pathname).toBe("/brand/brands");
  });

  it("getBrand fetches one by id", async () => {
    server.use(http.get(`${BASE}/b1`, () => HttpResponse.json({ id: "b1" })));
    expect((await svc().getBrand("b1")) as { id?: string }).toEqual({ id: "b1" });
  });

  it("getBrand throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getBrand("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createBrand POSTs the body", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "b1" }, { status: 201 });
      }),
    );
    await svc().createBrand({ name: "Acme" } as never);
    expect(body).toEqual({ name: "Acme" });
  });

  it("updateBrand PUTs to the id", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/b1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "b1" });
      }),
    );
    await svc().updateBrand("b1", { name: "Acme2" } as never);
    expect(body).toEqual({ name: "Acme2" });
  });

  it("patchBrand PATCHes the id", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/b1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "b1" });
      }),
    );
    await svc().patchBrand("b1", { name: "Renamed" } as never);
    expect(body).toEqual({ name: "Renamed" });
  });

  it("deleteBrand DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/b1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteBrand("b1")).resolves.toBeUndefined();
  });

  it("encodeURIComponent-escapes the brand id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/brand/brands/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getBrand("a/b");
    expect(pathname).toBe("/brand/brands/a%2Fb");
  });
});
```

> If Task 1 found create/update/patch return 204 or a different body, adjust the
> mocks + return types. Drop `as never` if the aliased input types accept the literals.

- [ ] **Step 5: Run both tests to verify they fail**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/brand.test.ts
```
Expected: FAIL — cannot find module `../../src/services/brand`.

- [ ] **Step 6: Write `brand.ts` + facade**

Create `packages/sdk/src/services/brand.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Brand, BrandList, BrandInput, BrandUpdate } from "./brand-types";

export type { Brand, BrandList, BrandInput, BrandUpdate } from "./brand-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Brand Service (`/brand/brands`): CRUD over brands. Server-side;
 * defaults to the service token (reads also work with an anonymous token).
 * The path carries no `{tenant}` segment — the tenant comes from the token.
 */
export class BrandService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/brand/brands`;
  }

  /** List all brands. */
  async listBrands(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<BrandList> {
    return this.ctx.http.request<BrandList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one brand by id. */
  async getBrand(brandId: string, auth: AuthContext = SERVICE): Promise<Brand> {
    return this.ctx.http.request<Brand>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(brandId)}`,
      auth,
    });
  }

  /** Create a brand. */
  async createBrand(input: BrandInput, auth: AuthContext = SERVICE): Promise<Brand> {
    return this.ctx.http.request<Brand>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Replace a brand by id. */
  async updateBrand(brandId: string, input: BrandUpdate, auth: AuthContext = SERVICE): Promise<Brand> {
    return this.ctx.http.request<Brand>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(brandId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a brand by id. */
  async patchBrand(brandId: string, patch: BrandUpdate, auth: AuthContext = SERVICE): Promise<Brand> {
    return this.ctx.http.request<Brand>({
      method: "PATCH",
      path: `${this.base()}/${encodeURIComponent(brandId)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a brand by id. */
  async deleteBrand(brandId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(brandId)}`,
      auth,
    });
  }
}
```

Create `packages/sdk/src/brand.ts`:

```ts
export * from "./services/brand";
```

- [ ] **Step 7: Run tests + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/brand-types.test.ts tests/services/brand.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all PASS; typecheck exits 0.

- [ ] **Step 8: Commit (two commits)**

```bash
git add packages/sdk/src/services/brand-types.ts packages/sdk/tests/services/brand-types.test.ts
git commit -m "feat(sdk): add brand public types"
git add packages/sdk/src/services/brand.ts packages/sdk/src/brand.ts packages/sdk/tests/services/brand.test.ts
git commit -m "feat(sdk): add brand service"
```

---

## Task 3: LabelService (types + service)

**Files:** create `label-types.ts`, `label.ts`, `src/label.ts`; tests `label-types.test.ts`, `label.test.ts`.

- [ ] **Step 1: Write the failing type test**

Create `packages/sdk/tests/services/label-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Label, LabelList, LabelInput, LabelUpdate } from "../../src/services/label-types";

describe("label types", () => {
  it("Label and LabelList are usable", () => {
    expectTypeOf<Label>().not.toBeNever();
    expectTypeOf<LabelList>().not.toBeNever();
  });
  it("LabelInput / LabelUpdate are usable as bodies", () => {
    expectTypeOf<LabelInput>().not.toBeNever();
    expectTypeOf<LabelUpdate>().not.toBeNever();
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm -F @viu/emporix-sdk exec tsc --noEmit 2>&1 | grep label-types
```

- [ ] **Step 3: Write `label-types.ts`** (swap names for the real generated ones)

```ts
import type {
  Label as GenLabel,
  Labels,
  LabelCreation,
  LabelUpdate as GenLabelUpdate,
} from "../generated/label-service";

/** A label (read shape). */
export type Label = GenLabel;
/** List of labels (`GET /label/labels`). */
export type LabelList = Labels;
/** Create body (`POST /label/labels`). */
export type LabelInput = LabelCreation;
/** Update / patch body (`PUT`/`PATCH /label/labels/{id}`). */
export type LabelUpdate = GenLabelUpdate;
```

- [ ] **Step 4: Write the failing service test**

Create `packages/sdk/tests/services/label.test.ts` — identical structure to `brand.test.ts` with these substitutions: import `LabelService` from `../../src/services/label`; logger `{ service: "label" }`; `const BASE = "https://api.emporix.io/label/labels";`; methods `listLabels`/`getLabel`/`createLabel`/`updateLabel`/`patchLabel`/`deleteLabel`; assert `pathname` `/label/labels` and escape `/label/labels/a%2Fb`. Full file:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { LabelService } from "../../src/services/label";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "label" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new LabelService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/label/labels";

describe("LabelService", () => {
  it("listLabels GETs /label/labels with a service token", async () => {
    let seenAuth: string | null = null;
    let pathname = "";
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "l1" }]);
      }),
    );
    await svc().listLabels();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(pathname).toBe("/label/labels");
  });

  it("getLabel fetches one by id", async () => {
    server.use(http.get(`${BASE}/l1`, () => HttpResponse.json({ id: "l1" })));
    expect((await svc().getLabel("l1")) as { id?: string }).toEqual({ id: "l1" });
  });

  it("getLabel throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getLabel("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createLabel POSTs the body", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "l1" }, { status: 201 });
      }),
    );
    await svc().createLabel({ name: "Sale" } as never);
    expect(body).toEqual({ name: "Sale" });
  });

  it("updateLabel PUTs to the id", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/l1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "l1" });
      }),
    );
    await svc().updateLabel("l1", { name: "Sale2" } as never);
    expect(body).toEqual({ name: "Sale2" });
  });

  it("patchLabel PATCHes the id", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/l1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "l1" });
      }),
    );
    await svc().patchLabel("l1", { name: "Renamed" } as never);
    expect(body).toEqual({ name: "Renamed" });
  });

  it("deleteLabel DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/l1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteLabel("l1")).resolves.toBeUndefined();
  });

  it("encodeURIComponent-escapes the label id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/label/labels/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getLabel("a/b");
    expect(pathname).toBe("/label/labels/a%2Fb");
  });
});
```

- [ ] **Step 5: Run to verify it fails**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/label.test.ts
```
Expected: FAIL — cannot find module `../../src/services/label`.

- [ ] **Step 6: Write `label.ts` + facade**

Create `packages/sdk/src/services/label.ts` — identical to `brand.ts` with: import from `./label-types`; class `LabelService`; `base()` returns `/label/labels`; methods `listLabels`/`getLabel`/`createLabel`/`updateLabel`/`patchLabel`/`deleteLabel`; types `Label`/`LabelList`/`LabelInput`/`LabelUpdate`; doc comment "Emporix Label Service (`/label/labels`)". Create `packages/sdk/src/label.ts`:

```ts
export * from "./services/label";
```

- [ ] **Step 7: Run tests + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/label-types.test.ts tests/services/label.test.ts
pnpm -F @viu/emporix-sdk typecheck
```

- [ ] **Step 8: Commit (two commits)**

```bash
git add packages/sdk/src/services/label-types.ts packages/sdk/tests/services/label-types.test.ts
git commit -m "feat(sdk): add label public types"
git add packages/sdk/src/services/label.ts packages/sdk/src/label.ts packages/sdk/tests/services/label.test.ts
git commit -m "feat(sdk): add label service"
```

---

## Task 4: Wire both services onto EmporixClient

**Files:** modify `logger.ts`, `client.ts`, `index.ts`; test `brand-label-wiring.test.ts`.

- [ ] **Step 1: Write the failing wiring test**

Create `packages/sdk/tests/services/brand-label-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { BrandService } from "../../src/services/brand";
import { LabelService } from "../../src/services/label";

describe("EmporixClient brand/label wiring", () => {
  it("exposes the brand and label services", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.brands).toBeInstanceOf(BrandService);
    expect(sdk.labels).toBeInstanceOf(LabelService);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/brand-label-wiring.test.ts
```
Expected: FAIL — `sdk.brands` / `sdk.labels` undefined.

- [ ] **Step 3a: Extend `ServiceName`**

In `packages/sdk/src/core/logger.ts`, add after `| "reward-points"`:

```ts
  | "brand"
  | "label"
```

- [ ] **Step 3b: Import + expose in `client.ts`**

Imports after `RewardPointsService`:

```ts
import { BrandService } from "./services/brand";
import { LabelService } from "./services/label";
```

Fields after `rewardPoints`:

```ts
  readonly brands: BrandService;
  readonly labels: LabelService;
```

Construct after `this.rewardPoints = ...`:

```ts
    this.brands = new BrandService(mk("brand"));
    this.labels = new LabelService(mk("label"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add after `export * from "./reward-points";`:

```ts
export * from "./brand";
export * from "./label";
```

- [ ] **Step 4: Run the test, full suite, typecheck, build**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/brand-label-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk build
```
Expected: all PASS; typecheck exits 0; build succeeds (examples typecheck against the new dist).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/brand-label-wiring.test.ts
git commit -m "feat(sdk): expose brand and label services on the client"
```

---

## Task 5: Documentation

**Files:** create `docs/brand.md`, `docs/label.md`; modify `CLAUDE.md`.

- [ ] **Step 1: Write `docs/brand.md`**

````markdown
# Brand Service

Bindings for the Emporix **Brand Service** (`/brand/brands`): CRUD over brands.

> **Server-side.** Defaults to the service (clientCredentials) token. Brand
> **reads** require no scope (work with an anonymous token too); writes need
> `brand.brand_manage`, delete needs `brand.brand_delete`. The path carries no
> tenant segment — the tenant comes from the token.

```ts
const brands = await client.brands.listBrands();
const brand = await client.brands.getBrand("brand-id");
await client.brands.createBrand({ name: "Acme" });
await client.brands.updateBrand("brand-id", { name: "Acme Corp" });
await client.brands.patchBrand("brand-id", { name: "Renamed" });
await client.brands.deleteBrand("brand-id");
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.anonymous()` for storefront reads or
`auth.service("other-set")` for a different credential set.
````

- [ ] **Step 2: Write `docs/label.md`**

````markdown
# Label Service

Bindings for the Emporix **Label Service** (`/label/labels`): CRUD over product
labels (e.g. "Sale", "New").

> **Server-side.** Defaults to the service (clientCredentials) token
> (`label.label_read` / `label.label_manage`). The path carries no tenant
> segment — the tenant comes from the token.

```ts
const labels = await client.labels.listLabels();
const label = await client.labels.getLabel("label-id");
await client.labels.createLabel({ name: "Sale" });
await client.labels.updateLabel("label-id", { name: "Clearance" });
await client.labels.patchLabel("label-id", { name: "Renamed" });
await client.labels.deleteLabel("label-id");
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
````

- [ ] **Step 3: Update CLAUDE.md service list**

Append `Brand, Label` to the `packages/sdk` row's service list:

```
…, Coupon, RewardPoints, Brand, Label) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 4: Commit**

```bash
git add docs/brand.md docs/label.md CLAUDE.md
git commit -m "docs(sdk): document the brand and label services"
```

---

## Task 6: Changeset

**Files:** create `.changeset/brand-label-services.md`.

- [ ] **Step 1: Write the changeset (sdk only)**

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix Brand and Label Service bindings via `client.brands` and
`client.labels`: full CRUD (`listBrands`/`getBrand`/`createBrand`/`updateBrand`/
`patchBrand`/`deleteBrand` and the label equivalents). Server-side only — these
use the service (clientCredentials) token; brand reads also work anonymously.
```

- [ ] **Step 2: Verify**

```bash
pnpm changeset status
```
Expected: `@viu/emporix-sdk` bumped minor.

- [ ] **Step 3: Commit**

```bash
git add .changeset/brand-label-services.md
git commit -m "chore(release): add brand and label services changeset"
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

- **Spec coverage:** D1 full CRUD each → 6 methods per service in Tasks 2/3 + tests. D2 two services one branch → Tasks 2/3 + wiring Task 4. D3 no React → no React tasks. D4 service-token default → `const SERVICE` per method. D5 codegen + aliasing → Task 1 + 2/3 type modules. D6 tenant-less base paths → `base()` returns `/brand/brands` and `/label/labels`; tests assert `pathname` exactly and the `a%2Fb` escape. Docs/changeset → Tasks 5/6 (sdk only). No gaps.
- **Placeholder scan:** No TBD/TODO. Every code step has full code (label service body references brand's structure with explicit substitutions listed). Upstream-dependent uncertainties (generated names, PATCH body, list-envelope, response codes) are concrete `grep`/note verifications with fallbacks.
- **Type consistency:** Public names `Brand`/`BrandList`/`BrandInput`/`BrandUpdate` and `Label`/`LabelList`/`LabelInput`/`LabelUpdate` are identical across Tasks 2/3 (defs), the services (imports + re-exports), and the tests. Method names match across services, the wiring test, and the docs. Loggers `"brand"`/`"label"` match `mk("brand")`/`mk("label")` and the `ServiceName` additions. Commit scopes are `sdk`/`release` with lowercase verbs (commitlint-safe).
```
