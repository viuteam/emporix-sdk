# B2B Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add B2B-foundation capabilities to `@viu/emporix-sdk` and `@viu/emporix-sdk-react` — new `companies`/`contacts`/`locations`/`customerGroups` services, an active-company React context, company-aware query keys, and a `vite-spa` company switcher — without breaking the existing B2C flow.

**Architecture:** SDK gets four new facades that wrap Emporix Customer Management + IAM endpoints; an `InsufficientScopeError` surfaces 403-with-scope-hint. React provider gains a `CompanyContextProvider` (inside the existing `SiteContextProvider`) that bootstraps `myCompanies`, supports hybrid auto-pick / explicit-pick, performs eager token-refresh on switch, drops the local cart id, and invalidates B2B-scoped queries. New storage key `emporix.activeLegalEntityId` persists the selection.

**Tech Stack:** TypeScript, tsc, ESLint, Vitest + MSW for unit tests, React 18, `@tanstack/react-query` 5, pnpm workspace, changesets.

---

## Spec reference

This plan implements `docs/superpowers/specs/2026-05-24-b2b-foundation-design.md`.

## Spec-vs-plan scope deltas

- **Customer-Group membership mutations** (`useAddCustomerGroupMember` / `useRemoveCustomerGroupMember`) are **deferred** to a tiny follow-up plan. The IAM `/groups/{id}/members` exact endpoint shape is not in the docs we have; rather than guess (a placeholder), `customerGroups.listForCompany` ships read-only here and member-management follows once the IAM API reference is confirmed. The spec's long-term shape is unchanged.
- Everything else in the spec ships in this plan.

## File structure

### SDK — created

```
packages/sdk/src/generated/customer-management/
  types.gen.ts                   — hand-rolled mirror of OpenAPI 0.0.1 schemas
  index.ts                       — re-exports types.gen.ts
packages/sdk/src/generated/iam/
  types.gen.ts                   — hand-rolled minimal IAM group schemas (read-only)
  index.ts                       — re-exports types.gen.ts
packages/sdk/src/services/companies.ts          — LegalEntity service
packages/sdk/src/services/contacts.ts           — ContactAssignment service
packages/sdk/src/services/locations.ts          — Location service
packages/sdk/src/services/customer-groups.ts    — IAM group reads
packages/sdk/src/companies.ts                   — facade re-exports
packages/sdk/src/contacts.ts                    — facade re-exports
packages/sdk/src/locations.ts                   — facade re-exports
packages/sdk/src/customer-groups.ts             — facade re-exports
packages/sdk/tests/services/companies.test.ts
packages/sdk/tests/services/contacts.test.ts
packages/sdk/tests/services/locations.test.ts
packages/sdk/tests/services/customer-groups.test.ts
```

### SDK — modified

```
packages/sdk/src/core/errors.ts                 — add EmporixInsufficientScopeError
packages/sdk/src/core/http.ts                   — map 403-with-scope-hint to new error
packages/sdk/src/core/logger.ts                 — extend ServiceName with 'customer-management' and 'iam'
packages/sdk/src/client.ts                      — instantiate four new services
packages/sdk/src/index.ts                       — export new types + error
packages/sdk/tests/errors.test.ts               — InsufficientScopeError mapping cases
packages/sdk/tests/services/customer.test.ts    — refresh with legalEntityId assertion (extend if missing)
packages/sdk/tests/services/cart.test.ts        — getCurrent with different legalEntityId assertion
packages/sdk/tests/services/facade-coverage.test.ts — add new services to coverage check
```

### React — created

```
packages/react/src/company-context.tsx          — CompanyContextProvider + useActiveCompany
packages/react/src/hooks/use-my-companies.ts
packages/react/src/hooks/use-company.ts
packages/react/src/hooks/use-company-contacts.ts
packages/react/src/hooks/use-company-locations.ts
packages/react/src/hooks/use-company-groups.ts
packages/react/src/hooks/use-company-mutations.ts   — single file holds 9 mutation hooks (companies+contacts+locations CRUD)
packages/react/src/hooks/use-company-switcher.ts
packages/react/tests/use-active-company-bootstrap.test.tsx
packages/react/tests/use-active-company-switch.test.tsx
packages/react/tests/use-my-companies.test.tsx
packages/react/tests/use-company-contacts.test.tsx
packages/react/tests/use-company-locations.test.tsx
packages/react/tests/use-company-mutations.test.tsx
packages/react/tests/provider-b2b.test.tsx
```

### React — modified

```
packages/react/src/storage/index.ts             — add 'emporix.activeLegalEntityId' to EmporixStorageKey
packages/react/src/storage/local-storage.ts     — add helpers getActiveLegalEntityId / setActiveLegalEntityId / clearActiveLegalEntityId
packages/react/src/storage/cookie.ts            — same trio
packages/react/src/storage/memory.ts            — same trio
packages/react/src/provider.tsx                 — wrap children in CompanyContextProvider; accept initialActiveLegalEntityId
packages/react/src/ssr.ts                       — expose initialActiveLegalEntityId
packages/react/src/telemetry.ts                 — add 'company:switched' event variant
packages/react/src/hooks/use-cart.ts            — include legalEntityId in queryKey + getCurrent
packages/react/src/hooks/use-checkout.ts        — pass legalEntityId from active company
packages/react/src/hooks/use-customer-addresses.ts — include legalEntityId in queryKey
packages/react/src/hooks/internal/bootstrap-cart.ts — getCurrent with legalEntityId
packages/react/src/hooks/index.ts               — export new hooks
packages/react/src/index.ts                     — export useActiveCompany + types
```

### Examples — created/modified

```
examples/vite-spa/src/components/CompanySwitcher.tsx — new
examples/vite-spa/src/components/CompanyBadge.tsx    — new
examples/vite-spa/src/App.tsx                        — mount switcher + badge in header
```

### Docs — created/modified

```
docs/b2b.md                                     — new
docs/auth.md                                    — append "refresh + legalEntityId" section
docs/checkout.md                                — append "active legal-entity scope" note
```

### Changesets — created

```
.changeset/b2b-foundation-sdk.md
.changeset/b2b-foundation-react.md
```

---

## Conventions you'll need

- Commit subject format: `<type>(<scope>): <lowercase-verb> …`. Scopes used here: `sdk`, `react`, `docs`, `examples`. Subject's first word after the scope MUST be a lowercase verb (`add`, `wire`, `surface`, etc.) — sentence-case is rejected by commitlint.
- Branch is `feat/b2b-foundation` (already created; spec commit `bc2f981` already lives on it).
- All commits end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Always run `pnpm -r typecheck && pnpm -r lint && pnpm -r test` before committing in case of cross-file fallout. The husky pre-commit hook runs typecheck + lint automatically; running tests separately is your responsibility.
- Test customer token used in fixtures is `"cust"` (matches existing `use-my-segments.test.tsx`). Tenant is `"acme"`.

---

## Task 1: New error type — `EmporixInsufficientScopeError`

**Files:**
- Modify: `packages/sdk/src/core/errors.ts`
- Modify: `packages/sdk/src/core/http.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/tests/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { errorFromResponse, EmporixInsufficientScopeError, EmporixForbiddenError } from "../src/core/errors";

describe("EmporixInsufficientScopeError", () => {
  it("is a subclass of EmporixForbiddenError so existing catches still work", () => {
    const e = new EmporixInsufficientScopeError("nope", 403, { details: ["missing scope: customermanagement.legalentity_manage"] }, "customermanagement.legalentity_manage");
    expect(e).toBeInstanceOf(EmporixForbiddenError);
    expect(e.status).toBe(403);
    expect(e.requiredScope).toBe("customermanagement.legalentity_manage");
  });

  it("errorFromResponse maps 403 with a scope hint in `details` to InsufficientScopeError", () => {
    const e = errorFromResponse(403, "GET /x → 403", { details: ["missing scope: customermanagement.legalentity_manage"] });
    expect(e).toBeInstanceOf(EmporixInsufficientScopeError);
    expect((e as EmporixInsufficientScopeError).requiredScope).toBe("customermanagement.legalentity_manage");
  });

  it("errorFromResponse keeps plain ForbiddenError when 403 has no scope hint", () => {
    const e = errorFromResponse(403, "GET /x → 403", { details: ["something else"] });
    expect(e).toBeInstanceOf(EmporixForbiddenError);
    expect(e).not.toBeInstanceOf(EmporixInsufficientScopeError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm -F @viu/emporix-sdk vitest run tests/errors.test.ts
```
Expected: FAIL with `EmporixInsufficientScopeError is not exported`.

- [ ] **Step 3: Implement the class**

In `packages/sdk/src/core/errors.ts`, add after the existing `EmporixForbiddenError` class:

```ts
const SCOPE_HINT_RE = /missing scope[: ]+([a-z0-9._-]+)/i;

export class EmporixInsufficientScopeError extends EmporixForbiddenError {
  readonly requiredScope: string | undefined;
  constructor(message: string, status: number, body: unknown, requiredScope?: string) {
    super(message, status, body);
    this.requiredScope = requiredScope;
  }
}

function extractRequiredScope(body: unknown): string | undefined {
  if (body && typeof body === "object" && "details" in body) {
    const details = (body as { details?: unknown }).details;
    if (Array.isArray(details)) {
      for (const d of details) {
        if (typeof d === "string") {
          const m = d.match(SCOPE_HINT_RE);
          if (m) return m[1];
        }
      }
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Wire `errorFromResponse`**

Replace the 403 branch in `packages/sdk/src/core/errors.ts`:

```ts
  if (status === 403) {
    const scope = extractRequiredScope(body);
    if (scope) return new EmporixInsufficientScopeError(message, status, body, scope);
    return new EmporixForbiddenError(message, status, body);
  }
```

- [ ] **Step 5: Export from package root**

In `packages/sdk/src/index.ts`, ensure both names appear in the existing `export { … } from "./core/errors"` re-export.

- [ ] **Step 6: Run the tests, expect pass**

```
pnpm -F @viu/emporix-sdk vitest run tests/errors.test.ts
```
Expected: PASS, three new tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/core/errors.ts packages/sdk/src/index.ts packages/sdk/tests/errors.test.ts
git commit -m "feat(sdk): add EmporixInsufficientScopeError for 403 with missing-scope hint

Subclasses EmporixForbiddenError so existing catch sites keep
working. errorFromResponse upgrades to the subclass when the body
contains a 'missing scope: <name>' detail string.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Vendor hand-rolled types for Customer Management + IAM

These are hand-rolled (not OpenAPI-generated) but live under `generated/` so the folder layout stays consistent. A header comment marks them as pending codegen wiring.

**Files:**
- Create: `packages/sdk/src/generated/customer-management/types.gen.ts`
- Create: `packages/sdk/src/generated/customer-management/index.ts`
- Create: `packages/sdk/src/generated/iam/types.gen.ts`
- Create: `packages/sdk/src/generated/iam/index.ts`

- [ ] **Step 1: Create customer-management types**

`packages/sdk/src/generated/customer-management/types.gen.ts`:

```ts
/**
 * Hand-written mirror of the Customer Management Service OpenAPI 0.0.1
 * schemas. The shapes below are taken directly from the documented API
 * (Legal Entities, Contact Assignments, Locations endpoints).
 *
 * **Not generated.** When the OpenAPI input file lands in the repo, this
 * file is replaced by codegen output. Keep the exported names stable so the
 * façade re-exports don't churn.
 */

export type LegalEntityType = "COMPANY" | "SUBSIDIARY";

export interface AccountLimit {
  currency?: string;
  value?: number;
}

export interface LegalInfo {
  legalName?: string;
  registrationDate?: string;
  taxRegistrationNumber?: string;
  registrationAgency?: string;
  countryOfRegistration?: string;
  registrationId?: string;
}

export interface CustomerGroupRef {
  id: string;
  name?: Record<string, string>;
  role?: string;
}

export interface ResourceId {
  id: string;
}

export interface Metadata {
  version?: number;
  createdAt?: string;
  modifiedAt?: string;
  mixins?: Record<string, unknown>;
}

export interface LegalEntity {
  id: string;
  name: string;
  type: LegalEntityType;
  parentId?: string;
  accountLimit?: AccountLimit;
  legalInfo?: LegalInfo;
  customerGroups?: CustomerGroupRef[];
  entitiesAddresses?: ResourceId[];
  approvalGroup?: ResourceId[];
  restrictions?: string[];
  metadata?: Metadata;
  mixins?: Record<string, unknown>;
}

export interface LegalEntityCreate {
  id?: string;
  name: string;
  type?: LegalEntityType;
  parentId?: string;
  accountLimit?: AccountLimit;
  legalInfo?: LegalInfo;
  customerGroups?: CustomerGroupRef[];
  entitiesAddresses?: ResourceId[];
  approvalGroup?: ResourceId[];
  restrictions?: string[];
  metadata?: { mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export interface LegalEntityUpdate {
  name?: string;
  parentId?: string;
  accountLimit?: AccountLimit;
  legalInfo?: LegalInfo;
  customerGroups?: CustomerGroupRef[];
  entitiesAddresses?: ResourceId[];
  approvalGroup?: ResourceId[];
  restrictions?: string[];
  metadata?: { version: number; mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export type ContactAssignmentType = "PRIMARY" | "BILLING" | "LOGISTICS" | "CONTACT";

export interface ContactAssignment {
  id: string;
  legalEntity?: LegalEntity | { id: string };
  customer?: { id: string; name?: string; surname?: string; email?: string; phone?: string };
  type?: ContactAssignmentType;
  primary?: boolean;
  metadata?: Metadata;
  mixins?: Record<string, unknown>;
}

export interface ContactAssignmentCreate {
  id?: string;
  legalEntity: { id: string };
  customer: { id: string };
  type?: ContactAssignmentType;
  primary?: boolean;
  metadata?: { mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export interface ContactAssignmentUpdate {
  type?: ContactAssignmentType;
  primary?: boolean;
  metadata?: { version: number; mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export type LocationType = "HEADQUARTER" | "WAREHOUSE" | "OFFICE";

export interface ContactDetails {
  emails?: string[];
  phones?: string[];
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  countryCode?: string;
  tags?: string[];
}

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  contactDetails?: ContactDetails;
  metadata?: Metadata;
  mixins?: Record<string, unknown>;
}

export interface LocationCreate {
  id?: string;
  legalEntityId: string;
  name: string;
  type: LocationType;
  contactDetails?: ContactDetails;
  metadata?: { mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export interface LocationUpdate {
  name?: string;
  type?: LocationType;
  contactDetails?: ContactDetails;
  metadata?: { version: number; mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}
```

- [ ] **Step 2: Create customer-management index**

`packages/sdk/src/generated/customer-management/index.ts`:

```ts
export * from "./types.gen";
```

- [ ] **Step 3: Create IAM types**

`packages/sdk/src/generated/iam/types.gen.ts`:

```ts
/**
 * Hand-written mirror of the minimal IAM Service group shape needed for
 * B2B foundation reads. The Emporix IAM API exposes groups keyed by
 * `b2b.legalEntityId`. Membership-mutation endpoints exist on the server
 * but their exact path/body shape is not in the current SDK input set —
 * `customer-groups.ts` ships read-only here; mutations follow in a small
 * follow-up plan once the API reference is confirmed.
 */

export interface IamGroupB2B {
  legalEntityId?: string;
}

export interface IamGroup {
  id: string;
  name?: Record<string, string>;
  role?: string;
  b2b?: IamGroupB2B;
}
```

- [ ] **Step 4: Create IAM index**

`packages/sdk/src/generated/iam/index.ts`:

```ts
export * from "./types.gen";
```

- [ ] **Step 5: Typecheck**

```
pnpm -F @viu/emporix-sdk typecheck
```
Expected: PASS — no consumer yet, just type files compiling.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/generated/customer-management packages/sdk/src/generated/iam
git commit -m "feat(sdk): vendor customer-management + iam type schemas

Hand-rolled mirror of OpenAPI 0.0.1 schemas, pending real codegen
wiring. Covers LegalEntity, ContactAssignment, Location create/
update/read shapes plus the minimal IamGroup read shape needed for
storefront B2B reads.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `ServiceName` — extend with `'customer-management'` and `'iam'`

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`

- [ ] **Step 1: Add to the union**

In `packages/sdk/src/core/logger.ts`, extend the `ServiceName` union (currently ends with `"auth"`):

```ts
export type ServiceName =
  | "customer"
  | "product"
  | "category"
  | "cart"
  | "checkout"
  | "payment"
  | "price"
  | "media"
  | "segment"
  | "site"
  | "session-context"
  | "customer-management"
  | "iam"
  | "http"
  | "auth";
```

- [ ] **Step 2: Typecheck**

```
pnpm -F @viu/emporix-sdk typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/core/logger.ts
git commit -m "feat(sdk): add customer-management and iam to ServiceName

Lets the new B2B services bind their own logger and be level-
controlled independently of the existing services.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `CompaniesService` — full CRUD over `/customer-management/{tenant}/legal-entities`

**Files:**
- Create: `packages/sdk/src/services/companies.ts`
- Create: `packages/sdk/src/companies.ts`
- Create: `packages/sdk/tests/services/companies.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/sdk/tests/services/companies.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CompaniesService } from "../../src/services/companies";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import {
  EmporixForbiddenError,
  EmporixInsufficientScopeError,
} from "../../src/core/errors";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-management" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CompaniesService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("CompaniesService", () => {
  it("listMine GETs legal-entities with the customer Bearer", async () => {
    let auth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]);
      }),
    );
    const rows = await harness().listMine(CUST);
    expect(auth).toBe("Bearer cust-tok");
    expect(rows[0].id).toBe("le-1");
  });

  it("get fetches a single legal entity by id", async () => {
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        HttpResponse.json({ id: "le-1", name: "Acme", type: "COMPANY" }),
      ),
    );
    const le = await harness().get("le-1", CUST);
    expect(le.name).toBe("Acme");
  });

  it("create POSTs the body and returns the id", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/legal-entities", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "le-new" }, { status: 201 });
      }),
    );
    const r = await harness().create({ name: "New Co" }, CUST);
    expect(r.id).toBe("le-new");
    expect(body).toEqual({ name: "New Co" });
  });

  it("update PATCHes the body and returns the entity", async () => {
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        HttpResponse.json({ id: "le-1", name: "Patched", type: "COMPANY" }),
      ),
    );
    const r = await harness().update("le-1", { name: "Patched" }, CUST);
    expect(r.name).toBe("Patched");
  });

  it("delete DELETEs and returns void", async () => {
    server.use(
      http.delete("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(harness().delete("le-1", CUST)).resolves.toBeUndefined();
  });

  it("create surfaces InsufficientScopeError on 403 with scope-hint body", async () => {
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json(
          { code: 403, status: "Forbidden", details: ["missing scope: customermanagement.legalentity_manage"] },
          { status: 403 },
        ),
      ),
    );
    await expect(harness().create({ name: "x" }, CUST)).rejects.toBeInstanceOf(
      EmporixInsufficientScopeError,
    );
  });

  it("create falls back to plain ForbiddenError on 403 without a scope hint", async () => {
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json({ code: 403, status: "Forbidden" }, { status: 403 }),
      ),
    );
    await expect(harness().create({ name: "x" }, CUST)).rejects.toBeInstanceOf(
      EmporixForbiddenError,
    );
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/companies.test.ts
```
Expected: FAIL — `CompaniesService is not exported`.

- [ ] **Step 3: Implement the service**

`packages/sdk/src/services/companies.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  LegalEntity,
  LegalEntityCreate,
  LegalEntityUpdate,
} from "../generated/customer-management";

/**
 * Storefront-customer access to Legal Entities.
 *
 * `listMine`/`get` require `customermanagement.legalentity_read_own` on the
 * customer token. `create`/`update`/`delete` require the corresponding
 * `_manage` scopes — typically only granted to Admin-group customers; a 403
 * surfaces as `EmporixInsufficientScopeError`.
 */
export class CompaniesService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/customer-management/${this.ctx.tenant}/legal-entities`;
  }

  /** Lists the legal entities the calling customer is assigned to. */
  async listMine(auth: AuthContext): Promise<LegalEntity[]> {
    return this.ctx.http.request<LegalEntity[]>({
      method: "GET",
      path: this.base(),
      auth,
    });
  }

  /** Fetches a single legal entity by id. */
  async get(legalEntityId: string, auth: AuthContext): Promise<LegalEntity> {
    return this.ctx.http.request<LegalEntity>({
      method: "GET",
      path: `${this.base()}/${legalEntityId}`,
      auth,
    });
  }

  /** Creates a legal entity. Requires `customermanagement.legalentity_manage`. */
  async create(input: LegalEntityCreate, auth: AuthContext): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Patches a legal entity. */
  async update(
    legalEntityId: string,
    patch: LegalEntityUpdate,
    auth: AuthContext,
  ): Promise<LegalEntity> {
    return this.ctx.http.request<LegalEntity>({
      method: "PATCH",
      path: `${this.base()}/${legalEntityId}`,
      auth,
      body: patch,
    });
  }

  /** Deletes a legal entity (async cascade on the server). */
  async delete(legalEntityId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${legalEntityId}`,
      auth,
    });
  }
}
```

- [ ] **Step 4: Create facade re-export**

`packages/sdk/src/companies.ts`:

```ts
export { CompaniesService } from "./services/companies";
export type {
  LegalEntity,
  LegalEntityCreate,
  LegalEntityUpdate,
  LegalEntityType,
  AccountLimit,
  LegalInfo,
  CustomerGroupRef,
} from "./generated/customer-management";
```

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/companies.test.ts
```
Expected: PASS — all seven cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/companies.ts packages/sdk/src/companies.ts packages/sdk/tests/services/companies.test.ts
git commit -m "feat(sdk): add CompaniesService for legal-entity CRUD

Storefront-customer surface over Customer-Management's legal-entities
endpoints. Read methods use legalentity_read_own; mutations surface
EmporixInsufficientScopeError when the token lacks legalentity_manage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `ContactsService` — full CRUD over `/customer-management/{tenant}/contact-assignments`

**Files:**
- Create: `packages/sdk/src/services/contacts.ts`
- Create: `packages/sdk/src/contacts.ts`
- Create: `packages/sdk/tests/services/contacts.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/sdk/tests/services/contacts.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ContactsService } from "../../src/services/contacts";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-management" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ContactsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("ContactsService", () => {
  it("listForCompany GETs with legalEntityId query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/contact-assignments", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "ca-1", type: "CONTACT" }]);
      }),
    );
    const rows = await harness().listForCompany("le-1", CUST);
    expect(q?.get("legalEntityId")).toBe("le-1");
    expect(rows[0].id).toBe("ca-1");
  });

  it("assign POSTs legalEntity + customer + type", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/contact-assignments", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "ca-new" }, { status: 201 });
      }),
    );
    const r = await harness().assign(
      { legalEntity: { id: "le-1" }, customer: { id: "cu-1" }, type: "BILLING", primary: true },
      CUST,
    );
    expect(r.id).toBe("ca-new");
    expect(body).toEqual({
      legalEntity: { id: "le-1" },
      customer: { id: "cu-1" },
      type: "BILLING",
      primary: true,
    });
  });

  it("update PATCHes the assignment", async () => {
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/contact-assignments/ca-1", () =>
        HttpResponse.json({ id: "ca-1", type: "LOGISTICS" }),
      ),
    );
    const r = await harness().update("ca-1", { type: "LOGISTICS" }, CUST);
    expect(r.type).toBe("LOGISTICS");
  });

  it("unassign DELETEs and returns void", async () => {
    server.use(
      http.delete("https://api.emporix.io/customer-management/acme/contact-assignments/ca-1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(harness().unassign("ca-1", CUST)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/contacts.test.ts
```
Expected: FAIL — `ContactsService is not exported`.

- [ ] **Step 3: Implement the service**

`packages/sdk/src/services/contacts.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  ContactAssignment,
  ContactAssignmentCreate,
  ContactAssignmentUpdate,
} from "../generated/customer-management";

/**
 * Manages contact assignments linking customers to legal entities.
 *
 * `listForCompany` requires `customermanagement.contactassignment_read`;
 * `assign`/`update`/`unassign` require `_manage`. The query param
 * `legalEntityId` scopes the list to one company.
 */
export class ContactsService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/customer-management/${this.ctx.tenant}/contact-assignments`;
  }

  /** Lists contact assignments for one legal entity. */
  async listForCompany(legalEntityId: string, auth: AuthContext): Promise<ContactAssignment[]> {
    return this.ctx.http.request<ContactAssignment[]>({
      method: "GET",
      path: this.base(),
      query: { legalEntityId },
      auth,
    });
  }

  /** Creates a contact assignment. */
  async assign(input: ContactAssignmentCreate, auth: AuthContext): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Patches a contact assignment. */
  async update(
    contactAssignmentId: string,
    patch: ContactAssignmentUpdate,
    auth: AuthContext,
  ): Promise<ContactAssignment> {
    return this.ctx.http.request<ContactAssignment>({
      method: "PATCH",
      path: `${this.base()}/${contactAssignmentId}`,
      auth,
      body: patch,
    });
  }

  /** Deletes a contact assignment. */
  async unassign(contactAssignmentId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${contactAssignmentId}`,
      auth,
    });
  }
}
```

- [ ] **Step 4: Create facade re-export**

`packages/sdk/src/contacts.ts`:

```ts
export { ContactsService } from "./services/contacts";
export type {
  ContactAssignment,
  ContactAssignmentCreate,
  ContactAssignmentUpdate,
  ContactAssignmentType,
} from "./generated/customer-management";
```

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/contacts.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/contacts.ts packages/sdk/src/contacts.ts packages/sdk/tests/services/contacts.test.ts
git commit -m "feat(sdk): add ContactsService for contact-assignment CRUD

Manages employee↔company links with the four documented assignment
types (PRIMARY/BILLING/LOGISTICS/CONTACT). listForCompany scopes by
legalEntityId query param.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `LocationsService` — full CRUD over `/customer-management/{tenant}/locations`

**Files:**
- Create: `packages/sdk/src/services/locations.ts`
- Create: `packages/sdk/src/locations.ts`
- Create: `packages/sdk/tests/services/locations.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/sdk/tests/services/locations.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { LocationsService } from "../../src/services/locations";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-management" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new LocationsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("LocationsService", () => {
  it("listForCompany GETs with legalEntityId query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/locations", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([
          { id: "loc-1", name: "HQ", type: "HEADQUARTER" },
          { id: "loc-2", name: "Lager", type: "WAREHOUSE" },
        ]);
      }),
    );
    const rows = await harness().listForCompany("le-1", CUST);
    expect(q?.get("legalEntityId")).toBe("le-1");
    expect(rows.map((r) => r.type)).toEqual(["HEADQUARTER", "WAREHOUSE"]);
  });

  it("get fetches one location by id", async () => {
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/locations/loc-1", () =>
        HttpResponse.json({ id: "loc-1", name: "HQ", type: "HEADQUARTER" }),
      ),
    );
    const r = await harness().get("loc-1", CUST);
    expect(r.name).toBe("HQ");
  });

  it("create accepts each location type and POSTs the body", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/locations", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: "loc-new" }, { status: 201 });
      }),
    );
    for (const type of ["HEADQUARTER", "WAREHOUSE", "OFFICE"] as const) {
      const r = await harness().create({ legalEntityId: "le-1", name: type, type }, CUST);
      expect(r.id).toBe("loc-new");
    }
    expect(bodies).toHaveLength(3);
  });

  it("update PATCHes the location", async () => {
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/locations/loc-1", () =>
        HttpResponse.json({ id: "loc-1", name: "Renamed", type: "HEADQUARTER" }),
      ),
    );
    const r = await harness().update("loc-1", { name: "Renamed" }, CUST);
    expect(r.name).toBe("Renamed");
  });

  it("delete DELETEs and returns void", async () => {
    server.use(
      http.delete("https://api.emporix.io/customer-management/acme/locations/loc-1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(harness().delete("loc-1", CUST)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/locations.test.ts
```
Expected: FAIL — `LocationsService is not exported`.

- [ ] **Step 3: Implement the service**

`packages/sdk/src/services/locations.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Location,
  LocationCreate,
  LocationUpdate,
} from "../generated/customer-management";

/**
 * Manages locations owned by a legal entity. Three types are supported:
 * HEADQUARTER, WAREHOUSE, OFFICE.
 *
 * Reads require `customermanagement.location_read`; mutations require
 * `_manage`.
 */
export class LocationsService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/customer-management/${this.ctx.tenant}/locations`;
  }

  /** Lists locations owned by one legal entity. */
  async listForCompany(legalEntityId: string, auth: AuthContext): Promise<Location[]> {
    return this.ctx.http.request<Location[]>({
      method: "GET",
      path: this.base(),
      query: { legalEntityId },
      auth,
    });
  }

  /** Fetches one location by id. */
  async get(locationId: string, auth: AuthContext): Promise<Location> {
    return this.ctx.http.request<Location>({
      method: "GET",
      path: `${this.base()}/${locationId}`,
      auth,
    });
  }

  /** Creates a location for a legal entity. */
  async create(input: LocationCreate, auth: AuthContext): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Patches a location. */
  async update(
    locationId: string,
    patch: LocationUpdate,
    auth: AuthContext,
  ): Promise<Location> {
    return this.ctx.http.request<Location>({
      method: "PATCH",
      path: `${this.base()}/${locationId}`,
      auth,
      body: patch,
    });
  }

  /** Deletes a location. */
  async delete(locationId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${locationId}`,
      auth,
    });
  }
}
```

- [ ] **Step 4: Create facade re-export**

`packages/sdk/src/locations.ts`:

```ts
export { LocationsService } from "./services/locations";
export type {
  Location,
  LocationCreate,
  LocationUpdate,
  LocationType,
  ContactDetails,
} from "./generated/customer-management";
```

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/locations.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/locations.ts packages/sdk/src/locations.ts packages/sdk/tests/services/locations.test.ts
git commit -m "feat(sdk): add LocationsService for company-location CRUD

CRUD over /customer-management/{tenant}/locations with the three
documented location types. listForCompany scopes by legalEntityId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `CustomerGroupsService` — read-only listing over `/iam/{tenant}/groups`

**Files:**
- Create: `packages/sdk/src/services/customer-groups.ts`
- Create: `packages/sdk/src/customer-groups.ts`
- Create: `packages/sdk/tests/services/customer-groups.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/sdk/tests/services/customer-groups.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CustomerGroupsService } from "../../src/services/customer-groups";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "iam" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CustomerGroupsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("CustomerGroupsService", () => {
  it("listForCompany sends b2b.legalEntityId as query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/iam/acme/groups", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([
          { id: "grp-admin", name: { en: "Admin" }, role: "ADMIN", b2b: { legalEntityId: "le-1" } },
          { id: "grp-buyer", name: { en: "Buyer" }, role: "BUYER", b2b: { legalEntityId: "le-1" } },
        ]);
      }),
    );
    const rows = await harness().listForCompany("le-1", CUST);
    expect(q?.get("b2b.legalEntityId")).toBe("le-1");
    expect(rows.map((r) => r.role)).toEqual(["ADMIN", "BUYER"]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/customer-groups.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the service**

`packages/sdk/src/services/customer-groups.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { IamGroup } from "../generated/iam";

/**
 * Read-only access to IAM customer groups for a legal entity.
 *
 * Member-management endpoints (`addMember`/`removeMember`) are deferred —
 * the exact IAM path/body shape isn't in the SDK input set yet. They will
 * land in a small follow-up plan once the API reference is confirmed.
 */
export class CustomerGroupsService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/iam/${this.ctx.tenant}/groups`;
  }

  /** Lists customer groups belonging to one legal entity. */
  async listForCompany(legalEntityId: string, auth: AuthContext): Promise<IamGroup[]> {
    return this.ctx.http.request<IamGroup[]>({
      method: "GET",
      path: this.base(),
      query: { "b2b.legalEntityId": legalEntityId },
      auth,
    });
  }
}
```

- [ ] **Step 4: Create facade re-export**

`packages/sdk/src/customer-groups.ts`:

```ts
export { CustomerGroupsService } from "./services/customer-groups";
export type { IamGroup, IamGroupB2B } from "./generated/iam";
```

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/customer-groups.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/customer-groups.ts packages/sdk/src/customer-groups.ts packages/sdk/tests/services/customer-groups.test.ts
git commit -m "feat(sdk): add CustomerGroupsService (read-only)

Lists IAM groups filtered by b2b.legalEntityId. Member-management
mutations are deferred to a follow-up plan once the IAM API endpoint
shape is confirmed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire the four new services into `EmporixClient`

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/tests/services/facade-coverage.test.ts`
- Modify: `packages/sdk/tests/client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../src/client";

describe("EmporixClient B2B services", () => {
  it("exposes companies / contacts / locations / customerGroups", () => {
    const c = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(c.companies).toBeDefined();
    expect(c.contacts).toBeDefined();
    expect(c.locations).toBeDefined();
    expect(c.customerGroups).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk vitest run tests/client.test.ts
```
Expected: FAIL — `c.companies` is undefined.

- [ ] **Step 3: Wire into the client**

In `packages/sdk/src/client.ts`:

Add imports:

```ts
import { CompaniesService } from "./services/companies";
import { ContactsService } from "./services/contacts";
import { LocationsService } from "./services/locations";
import { CustomerGroupsService } from "./services/customer-groups";
```

Add fields (anywhere among the existing `readonly` lines):

```ts
  readonly companies: CompaniesService;
  readonly contacts: ContactsService;
  readonly locations: LocationsService;
  readonly customerGroups: CustomerGroupsService;
```

Inside the constructor, after the existing `this.sessionContext = …` line:

```ts
    this.companies = new CompaniesService(mk("customer-management"));
    this.contacts = new ContactsService(mk("customer-management"));
    this.locations = new LocationsService(mk("customer-management"));
    this.customerGroups = new CustomerGroupsService(mk("iam"));
```

- [ ] **Step 4: Export from package root**

In `packages/sdk/src/index.ts`, add (next to other facade re-exports):

```ts
export * from "./companies";
export * from "./contacts";
export * from "./locations";
export * from "./customer-groups";
```

- [ ] **Step 5: Extend facade coverage test**

In `packages/sdk/tests/services/facade-coverage.test.ts`, find the array of services-to-check and add `"companies"`, `"contacts"`, `"locations"`, `"customerGroups"` to it.

- [ ] **Step 6: Run all SDK tests**

```
pnpm -F @viu/emporix-sdk test
```
Expected: PASS — all suites including the new B2B services + the wiring test + facade-coverage.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/client.test.ts packages/sdk/tests/services/facade-coverage.test.ts
git commit -m "feat(sdk): wire B2B services into EmporixClient

Adds companies/contacts/locations under the customer-management
logger service and customerGroups under the iam logger service. All
four are publicly re-exported from the package root.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Confirm existing `customer.refresh` and `cart.getCurrent` handle `legalEntityId`

Both already accept it; this task adds explicit assertions so future regressions catch them.

**Files:**
- Modify: `packages/sdk/tests/services/customer.test.ts`
- Modify: `packages/sdk/tests/services/cart.test.ts`

- [ ] **Step 1: Add the customer-refresh test**

Append to `packages/sdk/tests/services/customer.test.ts`:

```ts
describe("CustomerService.refresh with legalEntityId", () => {
  it("forwards legalEntityId as a query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ access_token: "new-tok", refresh_token: "new-r" });
      }),
    );
    await harness().refresh({ refreshToken: "old-r", legalEntityId: "le-1" });
    expect(q?.get("refreshToken")).toBe("old-r");
    expect(q?.get("legalEntityId")).toBe("le-1");
  });

  it("omits legalEntityId when not provided", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ access_token: "new-tok", refresh_token: "new-r" });
      }),
    );
    await harness().refresh({ refreshToken: "old-r" });
    expect(q?.has("legalEntityId")).toBe(false);
  });
});
```

(Reuse the existing `harness()` and `server` from the file. If the file uses a different harness name, mirror it.)

- [ ] **Step 2: Add the cart-getCurrent test**

Append to `packages/sdk/tests/services/cart.test.ts`:

```ts
describe("CartService.getCurrent with legalEntityId", () => {
  it("forwards legalEntityId as a query param so the server returns the company cart", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "cart-le-1", siteCode: "main" });
      }),
    );
    await harness().getCurrent(
      { kind: "customer", token: "cust-tok" },
      { siteCode: "main", legalEntityId: "le-1" },
    );
    expect(q?.get("siteCode")).toBe("main");
    expect(q?.get("legalEntityId")).toBe("le-1");
  });
});
```

- [ ] **Step 3: Run, expect pass**

```
pnpm -F @viu/emporix-sdk vitest run tests/services/customer.test.ts tests/services/cart.test.ts
```
Expected: PASS — both new describes plus all existing tests still green.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/tests/services/customer.test.ts packages/sdk/tests/services/cart.test.ts
git commit -m "test(sdk): pin legalEntityId pass-through in customer.refresh and cart.getCurrent

Regression-pins behaviour that already works but isn't asserted —
b2b-foundation depends on these query-param shapes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Storage — add `emporix.activeLegalEntityId` key + helpers

**Files:**
- Modify: `packages/react/src/storage/index.ts`
- Modify: `packages/react/src/storage/local-storage.ts`
- Modify: `packages/react/src/storage/cookie.ts`
- Modify: `packages/react/src/storage/memory.ts`
- Create: `packages/react/tests/storage-active-legal-entity.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/react/tests/storage-active-legal-entity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "../src/storage/memory";

describe("EmporixStorage.activeLegalEntityId helpers", () => {
  it("set / get / clear roundtrip in memory backend", () => {
    const s = createMemoryStorage();
    expect(s.getActiveLegalEntityId()).toBeNull();
    s.setActiveLegalEntityId("le-1");
    expect(s.getActiveLegalEntityId()).toBe("le-1");
    s.clearActiveLegalEntityId();
    expect(s.getActiveLegalEntityId()).toBeNull();
  });

  it("notifies subscribers via subscribeAll", () => {
    const s = createMemoryStorage();
    const seen: Array<[string, string | null]> = [];
    s.subscribeAll?.((key, value) => seen.push([key, value]));
    s.setActiveLegalEntityId("le-2");
    expect(seen).toContainEqual(["emporix.activeLegalEntityId", "le-2"]);
    s.clearActiveLegalEntityId();
    expect(seen).toContainEqual(["emporix.activeLegalEntityId", null]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/storage-active-legal-entity.test.ts
```
Expected: FAIL — `getActiveLegalEntityId is not a function`.

- [ ] **Step 3: Extend the storage contract**

In `packages/react/src/storage/index.ts`:

1. Extend `EmporixStorageKey`:
```ts
export type EmporixStorageKey =
  | "emporix.customerToken"
  | "emporix.cartId"
  | "emporix.anonymousSession"
  | "emporix.activeLegalEntityId";
```

2. Add to the `EmporixStorage` interface (alongside existing `getCartId`/`setCartId`/etc.):
```ts
  getActiveLegalEntityId(): string | null;
  setActiveLegalEntityId(id: string): void;
  clearActiveLegalEntityId(): void;
```

- [ ] **Step 4: Implement in memory backend**

In `packages/react/src/storage/memory.ts`, add three methods that mirror the cart-id pattern:

```ts
    getActiveLegalEntityId() {
      return store.get("emporix.activeLegalEntityId") ?? null;
    },
    setActiveLegalEntityId(id: string) {
      store.set("emporix.activeLegalEntityId", id);
      allListeners.notify("emporix.activeLegalEntityId", id);
    },
    clearActiveLegalEntityId() {
      store.delete("emporix.activeLegalEntityId");
      allListeners.notify("emporix.activeLegalEntityId", null);
    },
```

(Adapt names — `store` / `allListeners` — to whatever the actual identifiers are in `memory.ts`. Read `memory.ts` first; the existing `setCartId`/`clearCartId` pair is the template.)

- [ ] **Step 5: Implement in local-storage and cookie backends**

Same three-method pattern in `local-storage.ts` and `cookie.ts`, using the existing cart-id helpers in each file as the template — write through to the underlying store, notify listeners.

- [ ] **Step 6: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/storage-active-legal-entity.test.ts
pnpm -F @viu/emporix-sdk-react test
```
Expected: PASS — new test plus all existing storage tests still green.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/storage packages/react/tests/storage-active-legal-entity.test.ts
git commit -m "feat(react): add activeLegalEntityId storage key + helpers

New EmporixStorage trio (get/set/clear) implemented in memory,
local-storage, and cookie backends. Writes flow through subscribeAll
for telemetry consistency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `CompanyContext` — provider + bootstrap (no switch logic yet)

**Files:**
- Create: `packages/react/src/company-context.tsx`
- Create: `packages/react/tests/use-active-company-bootstrap.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/react/tests/use-active-company-bootstrap.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useActiveCompany bootstrap", () => {
  it("mode='b2c' when the customer has zero legal entities", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([]),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.mode).toBe("b2c");
    expect(result.current.activeCompany).toBeNull();
    expect(result.current.myCompanies).toEqual([]);
  });

  it("auto-picks the only company when there is exactly one", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "scoped-tok", refresh_token: "r" }),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-1"));
    expect(result.current.mode).toBe("b2b");
    expect(storage.getActiveLegalEntityId()).toBe("le-1");
  });

  it("stays 'unresolved' when the customer has multiple companies and no persisted pick", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([
          { id: "le-1", name: "Acme", type: "COMPANY" },
          { id: "le-2", name: "Globex", type: "COMPANY" },
        ]),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.myCompanies).toHaveLength(2));
    expect(result.current.mode).toBe("unresolved");
    expect(result.current.activeCompany).toBeNull();
  });

  it("honours a persisted activeLegalEntityId when it matches a company", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setActiveLegalEntityId("le-2");
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([
          { id: "le-1", name: "Acme", type: "COMPANY" },
          { id: "le-2", name: "Globex", type: "COMPANY" },
        ]),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-2"));
    expect(result.current.mode).toBe("b2b");
  });

  it("drops a stale persisted activeLegalEntityId that doesn't match any company", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setActiveLegalEntityId("le-gone");
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "scoped-tok", refresh_token: "r" }),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-1"));
    expect(storage.getActiveLegalEntityId()).toBe("le-1");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-active-company-bootstrap.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement context + provider**

`packages/react/src/company-context.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth, type EmporixClient, type LegalEntity } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage";

export type CompanyMode = "b2c" | "b2b" | "unresolved";

export interface CompanyContextValue {
  activeCompany: LegalEntity | null;
  myCompanies: LegalEntity[];
  mode: CompanyMode;
  status: "idle" | "loading" | "switching" | "error";
  error: unknown;
  setActiveCompany: (legalEntityId: string | null) => Promise<void>;
  refetchMyCompanies: () => Promise<void>;
}

const NULL_CTX: CompanyContextValue = {
  activeCompany: null,
  myCompanies: [],
  mode: "b2c",
  status: "idle",
  error: null,
  setActiveCompany: async () => {
    throw new Error("CompanyContextProvider not mounted");
  },
  refetchMyCompanies: async () => {},
};

export const EmporixCompanyContext = createContext<CompanyContextValue>(NULL_CTX);

export function useActiveCompany(): CompanyContextValue {
  return useContext(EmporixCompanyContext);
}

export interface CompanyContextProviderProps {
  client: EmporixClient;
  storage: EmporixStorage;
  initialActiveLegalEntityId?: string | null;
  children: ReactNode;
}

export function CompanyContextProvider({
  client,
  storage,
  initialActiveLegalEntityId,
  children,
}: CompanyContextProviderProps): JSX.Element {
  const [myCompanies, setMyCompanies] = useState<LegalEntity[]>([]);
  const [activeCompany, setActive] = useState<LegalEntity | null>(null);
  const [status, setStatus] = useState<CompanyContextValue["status"]>("idle");
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    const token = storage.get?.("emporix.customerToken") ?? null;
    if (!token) {
      setMyCompanies([]);
      setActive(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    try {
      const companies = await client.companies.listMine(auth.customer(token));
      setMyCompanies(companies);
      const persisted =
        initialActiveLegalEntityId ?? storage.getActiveLegalEntityId();
      const matched = persisted ? companies.find((c) => c.id === persisted) ?? null : null;
      if (matched) {
        setActive(matched);
      } else if (companies.length === 1) {
        // Auto-pick by refreshing token to scope it.
        await switchTo(companies[0]);
      } else {
        setActive(null);
        if (persisted && !matched) storage.clearActiveLegalEntityId();
      }
      setStatus("idle");
    } catch (e) {
      setError(e);
      setStatus("error");
    }
  }, [client, storage, initialActiveLegalEntityId]);

  /**
   * Internal: perform the refresh + storage write for a target company.
   *
   * Refresh-token source is `storage.get("emporix.refreshToken")`. The
   * existing `use-customer-session.ts` keeps refresh tokens in-session
   * only (not persisted), so on a fresh page load this returns null and
   * `switchTo` falls back to a local-state-only update — the server
   * keeps whatever scope the existing customer token already has. Apps
   * that want cross-reload B2B switching must persist `emporix.refreshToken`
   * (preferably via a cookie storage backend with `httpOnly` semantics).
   */
  const switchTo = useCallback(
    async (target: LegalEntity | null) => {
      const refreshToken = storage.get?.("emporix.refreshToken") ?? null;
      const token = storage.get?.("emporix.customerToken") ?? null;
      if (!refreshToken || !token) {
        setActive(target);
        if (target) storage.setActiveLegalEntityId(target.id);
        else storage.clearActiveLegalEntityId();
        return;
      }
      const next = await client.customers.refresh({
        refreshToken,
        legalEntityId: target?.id,
      });
      storage.set?.("emporix.customerToken", next.customerToken);
      storage.clearCartId?.();
      if (target) storage.setActiveLegalEntityId(target.id);
      else storage.clearActiveLegalEntityId();
      setActive(target);
    },
    [client, storage],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Re-load when the customer token changes externally (login/logout in another hook).
  useEffect(() => {
    return storage.subscribe?.(() => void load());
  }, [storage, load]);

  const setActiveCompany = useCallback(
    async (legalEntityId: string | null) => {
      setStatus("switching");
      try {
        if (legalEntityId === null) {
          await switchTo(null);
        } else {
          const target = myCompanies.find((c) => c.id === legalEntityId) ?? null;
          if (!target) throw new Error(`setActiveCompany: unknown legalEntityId ${legalEntityId}`);
          await switchTo(target);
        }
        setStatus("idle");
      } catch (e) {
        setError(e);
        setStatus("error");
        throw e;
      }
    },
    [myCompanies, switchTo],
  );

  const value = useMemo<CompanyContextValue>(() => {
    const mode: CompanyMode = activeCompany
      ? "b2b"
      : myCompanies.length > 1
        ? "unresolved"
        : "b2c";
    return {
      activeCompany,
      myCompanies,
      mode,
      status,
      error,
      setActiveCompany,
      refetchMyCompanies: load,
    };
  }, [activeCompany, myCompanies, status, error, setActiveCompany, load]);

  return (
    <EmporixCompanyContext.Provider value={value}>{children}</EmporixCompanyContext.Provider>
  );
}
```

- [ ] **Step 4: Mount inside `EmporixProvider`**

In `packages/react/src/provider.tsx`, import `CompanyContextProvider` and wrap children with it inside `SiteContextProvider`. Add `initialActiveLegalEntityId?: string | null` to `EmporixProviderProps` and forward it.

Sketch (the file already nests `SiteContextProvider`; mirror that):

```tsx
<SiteContextProvider client={client} storage={storage} initialSiteCode={initialSiteCode}>
  <CompanyContextProvider client={client} storage={storage} initialActiveLegalEntityId={initialActiveLegalEntityId}>
    {children}
  </CompanyContextProvider>
</SiteContextProvider>
```

- [ ] **Step 5: Re-export from package root**

In `packages/react/src/index.ts`, add:

```ts
export {
  EmporixCompanyContext,
  CompanyContextProvider,
  useActiveCompany,
  type CompanyContextValue,
  type CompanyMode,
} from "./company-context";
```

- [ ] **Step 6: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-active-company-bootstrap.test.tsx
```
Expected: PASS — all five bootstrap cases green.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/company-context.tsx packages/react/src/provider.tsx packages/react/src/index.ts packages/react/tests/use-active-company-bootstrap.test.tsx
git commit -m "feat(react): add CompanyContextProvider with hybrid bootstrap

Auto-picks on one company, stays 'unresolved' on multiple, falls back
to 'b2c' on zero. Honours a persisted activeLegalEntityId; drops
stale values silently. Re-runs when the customer token changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `setActiveCompany` switch — invalidate company-scoped queries

The bootstrap path already calls `switchTo`, which calls `customer.refresh` and drops the cart id. This task adds the React-Query invalidation step and tests the full switch.

**Files:**
- Modify: `packages/react/src/company-context.tsx`
- Create: `packages/react/tests/use-active-company-switch.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/react/tests/use-active-company-switch.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useActiveCompany switch", () => {
  it("setActiveCompany('le-2') refreshes the token, drops the cart id, and updates state", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setCartId("old-cart");
    // Pretend refresh token was persisted; the implementation reads `emporix.refreshToken`.
    storage.set?.("emporix.refreshToken", "r-tok");

    let refreshLegalEntityId: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([
          { id: "le-1", name: "Acme", type: "COMPANY" },
          { id: "le-2", name: "Globex", type: "COMPANY" },
        ]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        refreshLegalEntityId = new URL(request.url).searchParams.get("legalEntityId");
        return HttpResponse.json({ access_token: "scoped-le-2", refresh_token: "r2" });
      }),
    );

    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });

    await waitFor(() => expect(result.current.myCompanies).toHaveLength(2));
    expect(result.current.mode).toBe("unresolved");

    await act(async () => {
      await result.current.setActiveCompany("le-2");
    });

    expect(refreshLegalEntityId).toBe("le-2");
    expect(storage.get?.("emporix.customerToken")).toBe("scoped-le-2");
    expect(storage.getCartId()).toBeNull();
    expect(storage.getActiveLegalEntityId()).toBe("le-2");
    expect(result.current.activeCompany?.id).toBe("le-2");
    expect(result.current.mode).toBe("b2b");
  });

  it("setActiveCompany(null) returns to B2C mode (refresh without legalEntityId)", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setActiveLegalEntityId("le-1");
    storage.set?.("emporix.refreshToken", "r-tok");

    let refreshHadLE: boolean = true;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        refreshHadLE = new URL(request.url).searchParams.has("legalEntityId");
        return HttpResponse.json({ access_token: "b2c-tok", refresh_token: "r2" });
      }),
    );

    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-1"));

    await act(async () => {
      await result.current.setActiveCompany(null);
    });

    expect(refreshHadLE).toBe(false);
    expect(result.current.activeCompany).toBeNull();
    expect(result.current.mode).toBe("b2c");
    expect(storage.getActiveLegalEntityId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure or pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-active-company-switch.test.tsx
```
The first test may already pass (Task 11's `switchTo` does most of the work) but the React-Query-invalidation behaviour is implicit. If both tests pass already, skip to step 4. Otherwise continue.

- [ ] **Step 3: Add React-Query invalidation**

In `packages/react/src/company-context.tsx`, inside `switchTo`, after the storage writes:

```ts
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey.some((k) => k === target?.id || k === "cart" || k === "companies" || k === "customer"),
      });
```

Add `const qc = useQueryClient();` at the top of `CompanyContextProvider`.

- [ ] **Step 4: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-active-company-switch.test.tsx
```
Expected: PASS — both switch cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/company-context.tsx packages/react/tests/use-active-company-switch.test.tsx
git commit -m "feat(react): wire setActiveCompany switch with refresh + invalidate

Eager refresh-token rescope to the target legal entity (or to no LE
for B2C), drop the stored cart id, invalidate cart/customer/company
React-Query keys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Telemetry — `company:switched` event

**Files:**
- Modify: `packages/react/src/telemetry.ts`
- Modify: `packages/react/src/company-context.tsx`

- [ ] **Step 1: Extend the telemetry type**

In `packages/react/src/telemetry.ts`, extend `EmporixTelemetryEvent` with a new variant:

```ts
  | { kind: "company:switched"; from: string | null; to: string | null; durationMs: number }
```

Add it to the existing union.

- [ ] **Step 2: Write the test**

`packages/react/tests/telemetry-company-switched.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import type { EmporixTelemetryEvent } from "../src/telemetry";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([
      { id: "le-1", name: "Acme", type: "COMPANY" },
      { id: "le-2", name: "Globex", type: "COMPANY" },
    ]),
  ),
  http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
    HttpResponse.json({ access_token: "t", refresh_token: "r" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("company:switched telemetry", () => {
  it("emits a company:switched event on setActiveCompany", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.set?.("emporix.refreshToken", "r");
    const events: EmporixTelemetryEvent[] = [];

    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider
        client={client}
        storage={storage}
        queryClient={new QueryClient()}
        onTelemetry={(e) => events.push(e)}
      >
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });
    await waitFor(() => expect(result.current.myCompanies).toHaveLength(2));

    await act(async () => {
      await result.current.setActiveCompany("le-2");
    });

    const switched = events.find((e) => e.kind === "company:switched");
    expect(switched).toBeDefined();
    expect(switched).toMatchObject({ kind: "company:switched", from: null, to: "le-2" });
  });
});
```

- [ ] **Step 3: Run, expect failure**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/telemetry-company-switched.test.tsx
```
Expected: FAIL — no event emitted.

- [ ] **Step 4: Emit the event**

In `packages/react/src/company-context.tsx`:

1. Add `import { useEmporixTelemetry } from "./telemetry";` (path: file lives next to `telemetry.ts`).
2. At the top of `CompanyContextProvider` (next to the existing `qc = useQueryClient()`), add:
```ts
  const { emit } = useEmporixTelemetry();
```
3. Replace the entire `switchTo` body with the timed + emit version:

```ts
  const switchTo = useCallback(
    async (target: LegalEntity | null) => {
      const start = Date.now();
      const from = activeCompany?.id ?? null;
      const refreshToken = storage.get?.("emporix.refreshToken") ?? null;
      const token = storage.get?.("emporix.customerToken") ?? null;
      if (!refreshToken || !token) {
        setActive(target);
        if (target) storage.setActiveLegalEntityId(target.id);
        else storage.clearActiveLegalEntityId();
      } else {
        const next = await client.customers.refresh({
          refreshToken,
          legalEntityId: target?.id,
        });
        storage.set?.("emporix.customerToken", next.customerToken);
        storage.clearCartId?.();
        if (target) storage.setActiveLegalEntityId(target.id);
        else storage.clearActiveLegalEntityId();
        setActive(target);
        qc.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey.some(
              (k) =>
                k === "cart" ||
                k === "companies" ||
                k === "customer" ||
                k === from ||
                (target && k === target.id),
            ),
        });
      }
      emit({
        kind: "company:switched",
        from,
        to: target?.id ?? null,
        durationMs: Date.now() - start,
      });
    },
    [client, storage, activeCompany, qc, emit],
  );
```

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/telemetry-company-switched.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/telemetry.ts packages/react/src/company-context.tsx packages/react/tests/telemetry-company-switched.test.tsx
git commit -m "feat(react): emit company:switched telemetry on active-company change

Joins the existing onTelemetry stream alongside auth:* / cache:* /
mutation:* events; carries from/to/durationMs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: SSR — `initialActiveLegalEntityId` prop

**Files:**
- Modify: `packages/react/src/ssr.ts`
- Create: `packages/react/tests/provider-b2b.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/react/tests/provider-b2b.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([
      { id: "le-1", name: "Acme", type: "COMPANY" },
      { id: "le-2", name: "Globex", type: "COMPANY" },
    ]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("EmporixProvider B2B SSR hydration", () => {
  it("initialActiveLegalEntityId wins over a stale stored value", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setActiveLegalEntityId("le-1"); // stale
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider
        client={client}
        storage={storage}
        queryClient={new QueryClient()}
        initialActiveLegalEntityId="le-2"
      >
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-2"));
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/provider-b2b.test.tsx
```
Expected: FAIL — prop is not declared on `EmporixProvider` yet.

- [ ] **Step 3: Add the prop**

Task 11 already wraps children in `CompanyContextProvider` and forwards `initialActiveLegalEntityId`. This step only adds the type to the public `EmporixProviderProps`. In `packages/react/src/provider.tsx`, extend:

```ts
export interface EmporixProviderProps {
  // … existing fields …
  initialActiveLegalEntityId?: string | null;
}
```

Confirm the JSX destructure pulls it out and passes it down (Task 11 Step 4 sketch).

- [ ] **Step 4: Mirror in `ssr.ts`**

In `packages/react/src/ssr.ts`, expose `initialActiveLegalEntityId` as part of the SSR helper's return / props (mirror how `initialCustomerToken` and `initialSiteCode` are handled).

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/provider-b2b.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/src/ssr.ts packages/react/tests/provider-b2b.test.tsx
git commit -m "feat(react): accept initialActiveLegalEntityId on provider + ssr helper

SSR hosts forward the request-scoped active company to the client so
hydration matches the first render instead of flipping after bootstrap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Read hooks — `useMyCompanies` and `useCompany`

**Files:**
- Create: `packages/react/src/hooks/use-my-companies.ts`
- Create: `packages/react/src/hooks/use-company.ts`
- Create: `packages/react/tests/use-my-companies.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/react/tests/use-my-companies.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyCompanies } from "../src/hooks/use-my-companies";
import { useCompany } from "../src/hooks/use-company";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
    HttpResponse.json({ id: "le-1", name: "Acme Detailed", type: "COMPANY" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useMyCompanies / useCompany", () => {
  it("useMyCompanies returns the assigned companies", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useMyCompanies(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].id).toBe("le-1");
  });

  it("useMyCompanies is disabled without a customer token", () => {
    const { result } = renderHook(() => useMyCompanies(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useCompany fetches one by id", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useCompany("le-1"), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe("Acme Detailed");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-my-companies.test.tsx
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `useMyCompanies`**

`packages/react/src/hooks/use-my-companies.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type LegalEntity } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Lists the legal entities the calling customer is assigned to. */
export function useMyCompanies(): UseQueryResult<LegalEntity[]> {
  const { client, storage } = useEmporix();
  const token = storage.get?.("emporix.customerToken") ?? null;
  return useQuery({
    queryKey: emporixKey("companies", ["mine"], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null,
    queryFn: () => client.companies.listMine(auth.customer(token as string)),
  });
}
```

- [ ] **Step 4: Implement `useCompany`**

`packages/react/src/hooks/use-company.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type LegalEntity } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Fetches one legal entity by id. Disabled until a customer token is stored. */
export function useCompany(legalEntityId: string | undefined): UseQueryResult<LegalEntity> {
  const { client, storage } = useEmporix();
  const token = storage.get?.("emporix.customerToken") ?? null;
  return useQuery({
    queryKey: emporixKey("companies", [legalEntityId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && legalEntityId !== undefined,
    queryFn: () => client.companies.get(legalEntityId as string, auth.customer(token as string)),
  });
}
```

- [ ] **Step 5: Export from hooks index**

In `packages/react/src/hooks/index.ts`, add:

```ts
export { useMyCompanies } from "./use-my-companies";
export { useCompany } from "./use-company";
```

- [ ] **Step 6: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-my-companies.test.tsx
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-my-companies.ts packages/react/src/hooks/use-company.ts packages/react/src/hooks/index.ts packages/react/tests/use-my-companies.test.tsx
git commit -m "feat(react): add useMyCompanies + useCompany hooks

Cached reads of the calling customer's assigned legal entities and a
single-entity detail fetch. Both are disabled until a customer token
exists in storage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Read hooks — `useCompanyContacts` / `useCompanyLocations` / `useCompanyGroups`

**Files:**
- Create: `packages/react/src/hooks/use-company-contacts.ts`
- Create: `packages/react/src/hooks/use-company-locations.ts`
- Create: `packages/react/src/hooks/use-company-groups.ts`
- Create: `packages/react/tests/use-company-contacts.test.tsx`
- Create: `packages/react/tests/use-company-locations.test.tsx`

- [ ] **Step 1: Write failing tests**

`packages/react/tests/use-company-contacts.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCompanyContacts } from "../src/hooks/use-company-contacts";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-management/acme/contact-assignments", () =>
    HttpResponse.json([{ id: "ca-1", type: "CONTACT" }]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useCompanyContacts", () => {
  it("fetches contacts for one company", async () => {
    const { result } = renderHook(() => useCompanyContacts("le-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].id).toBe("ca-1");
  });
});
```

`packages/react/tests/use-company-locations.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCompanyLocations } from "../src/hooks/use-company-locations";
import { useCompanyGroups } from "../src/hooks/use-company-groups";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-management/acme/locations", () =>
    HttpResponse.json([{ id: "loc-1", name: "HQ", type: "HEADQUARTER" }]),
  ),
  http.get("https://api.emporix.io/iam/acme/groups", () =>
    HttpResponse.json([{ id: "grp-admin", role: "ADMIN", b2b: { legalEntityId: "le-1" } }]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useCompanyLocations / useCompanyGroups", () => {
  it("useCompanyLocations fetches locations for one company", async () => {
    const { result } = renderHook(() => useCompanyLocations("le-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].type).toBe("HEADQUARTER");
  });

  it("useCompanyGroups fetches IAM groups for one company", async () => {
    const { result } = renderHook(() => useCompanyGroups("le-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].role).toBe("ADMIN");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-company-contacts.test.tsx tests/use-company-locations.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement the three hooks**

All three follow the same shape. `packages/react/src/hooks/use-company-contacts.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type ContactAssignment } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Lists contact assignments for one legal entity. */
export function useCompanyContacts(
  legalEntityId: string | undefined,
): UseQueryResult<ContactAssignment[]> {
  const { client, storage } = useEmporix();
  const token = storage.get?.("emporix.customerToken") ?? null;
  return useQuery({
    queryKey: emporixKey("companies", ["contacts", legalEntityId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && legalEntityId !== undefined,
    queryFn: () =>
      client.contacts.listForCompany(legalEntityId as string, auth.customer(token as string)),
  });
}
```

`packages/react/src/hooks/use-company-locations.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type Location } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Lists locations owned by one legal entity. */
export function useCompanyLocations(
  legalEntityId: string | undefined,
): UseQueryResult<Location[]> {
  const { client, storage } = useEmporix();
  const token = storage.get?.("emporix.customerToken") ?? null;
  return useQuery({
    queryKey: emporixKey("companies", ["locations", legalEntityId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && legalEntityId !== undefined,
    queryFn: () =>
      client.locations.listForCompany(legalEntityId as string, auth.customer(token as string)),
  });
}
```

`packages/react/src/hooks/use-company-groups.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type IamGroup } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Lists IAM customer-groups for one legal entity. */
export function useCompanyGroups(
  legalEntityId: string | undefined,
): UseQueryResult<IamGroup[]> {
  const { client, storage } = useEmporix();
  const token = storage.get?.("emporix.customerToken") ?? null;
  return useQuery({
    queryKey: emporixKey("companies", ["groups", legalEntityId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && legalEntityId !== undefined,
    queryFn: () =>
      client.customerGroups.listForCompany(legalEntityId as string, auth.customer(token as string)),
  });
}
```

- [ ] **Step 4: Export from hooks index**

In `packages/react/src/hooks/index.ts`:

```ts
export { useCompanyContacts } from "./use-company-contacts";
export { useCompanyLocations } from "./use-company-locations";
export { useCompanyGroups } from "./use-company-groups";
```

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-company-contacts.test.tsx tests/use-company-locations.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-company-contacts.ts packages/react/src/hooks/use-company-locations.ts packages/react/src/hooks/use-company-groups.ts packages/react/src/hooks/index.ts packages/react/tests/use-company-contacts.test.tsx packages/react/tests/use-company-locations.test.tsx
git commit -m "feat(react): add company contacts, locations, and groups read hooks

Each is disabled until a customer token is stored. Query keys live
under the 'companies' resource bucket so setActiveCompany's predicate
invalidates them together.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Mutation hooks — companies + contacts + locations CRUD

All nine mutations live in one file because they share patterns (resolve token from storage, call SDK, invalidate related queries).

**Files:**
- Create: `packages/react/src/hooks/use-company-mutations.ts`
- Create: `packages/react/tests/use-company-mutations.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/react/tests/use-company-mutations.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useCreateCompany,
  useUpdateCompany,
  useDeleteCompany,
  useAssignContact,
  useUpdateContactAssignment,
  useUnassignContact,
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
} from "../src/hooks/use-company-mutations";
import { useMyCompanies } from "../src/hooks/use-my-companies";
import type { ReactNode } from "react";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const storage = createMemoryStorage({ initial: "cust" });
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
  return { Wrapper, queryClient };
}

describe("company mutation hooks", () => {
  it("useCreateCompany POSTs and invalidates useMyCompanies", async () => {
    const { Wrapper } = wrap();
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => {
        calls += 1;
        return HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]);
      }),
      http.post("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json({ id: "le-new" }, { status: 201 }),
      ),
    );
    const { result } = renderHook(
      () => ({ list: useMyCompanies(), create: useCreateCompany() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(calls).toBe(1);
    await act(async () => {
      await result.current.create.mutateAsync({ name: "New Co" });
    });
    await waitFor(() => expect(calls).toBe(2));
  });

  it("useUpdateCompany PATCHes", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        HttpResponse.json({ id: "le-1", name: "Patched", type: "COMPANY" }),
      ),
    );
    const { result } = renderHook(() => useUpdateCompany(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "le-1", patch: { name: "Patched" } });
    });
    expect(result.current.data?.name).toBe("Patched");
  });

  it("useDeleteCompany DELETEs", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.delete("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(() => useDeleteCompany(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync("le-1");
    });
    expect(result.current.isSuccess).toBe(true);
  });

  it("useAssignContact POSTs and useUnassignContact DELETEs", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/contact-assignments", () =>
        HttpResponse.json({ id: "ca-new" }, { status: 201 }),
      ),
      http.delete("https://api.emporix.io/customer-management/acme/contact-assignments/ca-new", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(
      () => ({ a: useAssignContact(), u: useUnassignContact() }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.a.mutateAsync({
        legalEntity: { id: "le-1" },
        customer: { id: "cu-1" },
        type: "CONTACT",
      });
    });
    expect(result.current.a.data?.id).toBe("ca-new");
    await act(async () => {
      await result.current.u.mutateAsync("ca-new");
    });
    expect(result.current.u.isSuccess).toBe(true);
  });

  it("useUpdateContactAssignment PATCHes", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/contact-assignments/ca-1", () =>
        HttpResponse.json({ id: "ca-1", type: "LOGISTICS" }),
      ),
    );
    const { result } = renderHook(() => useUpdateContactAssignment(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "ca-1", patch: { type: "LOGISTICS" } });
    });
    expect(result.current.data?.type).toBe("LOGISTICS");
  });

  it("useCreateLocation / useUpdateLocation / useDeleteLocation roundtrip", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/locations", () =>
        HttpResponse.json({ id: "loc-new" }, { status: 201 }),
      ),
      http.patch("https://api.emporix.io/customer-management/acme/locations/loc-new", () =>
        HttpResponse.json({ id: "loc-new", name: "Renamed", type: "HEADQUARTER" }),
      ),
      http.delete("https://api.emporix.io/customer-management/acme/locations/loc-new", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(
      () => ({
        c: useCreateLocation(),
        u: useUpdateLocation(),
        d: useDeleteLocation(),
      }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.c.mutateAsync({
        legalEntityId: "le-1",
        name: "HQ",
        type: "HEADQUARTER",
      });
    });
    expect(result.current.c.data?.id).toBe("loc-new");
    await act(async () => {
      await result.current.u.mutateAsync({ id: "loc-new", patch: { name: "Renamed" } });
    });
    expect(result.current.u.data?.name).toBe("Renamed");
    await act(async () => {
      await result.current.d.mutateAsync("loc-new");
    });
    expect(result.current.d.isSuccess).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-company-mutations.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the nine mutations**

`packages/react/src/hooks/use-company-mutations.ts`:

```ts
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  auth,
  type LegalEntity,
  type LegalEntityCreate,
  type LegalEntityUpdate,
  type ContactAssignment,
  type ContactAssignmentCreate,
  type ContactAssignmentUpdate,
  type Location,
  type LocationCreate,
  type LocationUpdate,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

/** Internal: pulls the customer token; throws if missing. */
function useCustomerAuth(): ReturnType<typeof auth.customer> {
  const { storage } = useEmporix();
  const token = storage.get?.("emporix.customerToken") ?? null;
  if (!token) throw new Error("Mutation requires a logged-in customer token");
  return auth.customer(token);
}

// ---- Companies ----

export function useCreateCompany(): UseMutationResult<{ id: string }, unknown, LegalEntityCreate> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => client.companies.create(input, ctx),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emporix", "companies", "mine"] }),
  });
}

export function useUpdateCompany(): UseMutationResult<
  LegalEntity,
  unknown,
  { id: string; patch: LegalEntityUpdate }
> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => client.companies.update(id, patch, ctx),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emporix", "companies"] }),
  });
}

export function useDeleteCompany(): UseMutationResult<void, unknown, string> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.companies.delete(id, ctx),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emporix", "companies"] }),
  });
}

// ---- Contacts ----

export function useAssignContact(): UseMutationResult<
  { id: string },
  unknown,
  ContactAssignmentCreate
> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => client.contacts.assign(input, ctx),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({
        queryKey: ["emporix", "companies", "contacts", vars.legalEntity.id],
      }),
  });
}

export function useUpdateContactAssignment(): UseMutationResult<
  ContactAssignment,
  unknown,
  { id: string; patch: ContactAssignmentUpdate }
> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => client.contacts.update(id, patch, ctx),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("contacts") }),
  });
}

export function useUnassignContact(): UseMutationResult<void, unknown, string> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.contacts.unassign(id, ctx),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("contacts") }),
  });
}

// ---- Locations ----

export function useCreateLocation(): UseMutationResult<{ id: string }, unknown, LocationCreate> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => client.locations.create(input, ctx),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({
        queryKey: ["emporix", "companies", "locations", vars.legalEntityId],
      }),
  });
}

export function useUpdateLocation(): UseMutationResult<
  Location,
  unknown,
  { id: string; patch: LocationUpdate }
> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => client.locations.update(id, patch, ctx),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("locations") }),
  });
}

export function useDeleteLocation(): UseMutationResult<void, unknown, string> {
  const { client } = useEmporix();
  const ctx = useCustomerAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.locations.delete(id, ctx),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("locations") }),
  });
}
```

- [ ] **Step 4: Export from hooks index**

In `packages/react/src/hooks/index.ts`:

```ts
export {
  useCreateCompany,
  useUpdateCompany,
  useDeleteCompany,
  useAssignContact,
  useUpdateContactAssignment,
  useUnassignContact,
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
} from "./use-company-mutations";
```

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react vitest run tests/use-company-mutations.test.tsx
```
Expected: PASS — six cases green covering all nine hooks.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-company-mutations.ts packages/react/src/hooks/index.ts packages/react/tests/use-company-mutations.test.tsx
git commit -m "feat(react): add nine company/contact/location mutation hooks

Companies (create/update/delete), contacts (assign/update/unassign),
locations (create/update/delete). Each invalidates the relevant read
query keys on success; missing _manage scope surfaces as React-Query
error (InsufficientScopeError from SDK).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: `useCompanySwitcher` convenience hook

**Files:**
- Create: `packages/react/src/hooks/use-company-switcher.ts`

- [ ] **Step 1: Implement**

`packages/react/src/hooks/use-company-switcher.ts`:

```ts
import { useCallback } from "react";
import type { LegalEntity } from "@viu/emporix-sdk";
import { useActiveCompany } from "../company-context";

export interface CompanySwitcherApi {
  companies: LegalEntity[];
  active: LegalEntity | null;
  status: "idle" | "loading" | "switching" | "error";
  switch: (legalEntityId: string) => Promise<void>;
  clear: () => Promise<void>;
}

/** Bundles useActiveCompany into a UI-friendly switch/clear pair. */
export function useCompanySwitcher(): CompanySwitcherApi {
  const ctx = useActiveCompany();
  const switchFn = useCallback(
    (legalEntityId: string) => ctx.setActiveCompany(legalEntityId),
    [ctx],
  );
  const clearFn = useCallback(() => ctx.setActiveCompany(null), [ctx]);
  return {
    companies: ctx.myCompanies,
    active: ctx.activeCompany,
    status: ctx.status,
    switch: switchFn,
    clear: clearFn,
  };
}
```

- [ ] **Step 2: Export from hooks index**

```ts
export { useCompanySwitcher } from "./use-company-switcher";
export type { CompanySwitcherApi } from "./use-company-switcher";
```

- [ ] **Step 3: Typecheck**

```
pnpm -F @viu/emporix-sdk-react typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/hooks/use-company-switcher.ts packages/react/src/hooks/index.ts
git commit -m "feat(react): add useCompanySwitcher convenience hook

UI-friendly wrapper around useActiveCompany — exposes companies,
active, status, switch(id), clear().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Thread `legalEntityId` into existing cart/checkout/addresses hooks

**Files:**
- Modify: `packages/react/src/hooks/use-cart.ts`
- Modify: `packages/react/src/hooks/internal/bootstrap-cart.ts`
- Modify: `packages/react/src/hooks/use-checkout.ts`
- Modify: `packages/react/src/hooks/use-customer-addresses.ts`
- Create: `packages/react/tests/use-cart-company-aware.test.tsx`

- [ ] **Step 1: Update `use-cart.ts`**

Inside `useCart`, import `useActiveCompany` and read `activeCompany?.id`. Include it in `emporixKey` and pass to any `getCurrent` call (in `use-cart.ts` and `internal/bootstrap-cart.ts`).

Diff sketch for `use-cart.ts:32`:

```ts
import { useActiveCompany } from "../company-context";
// …
  const { activeCompany } = useActiveCompany();
  const legalEntityId = activeCompany?.id;
// …
  queryKey: emporixKey(
    "cart",
    [resolvedId ?? null, legalEntityId ?? null],
    { tenant: client.tenant, authKind: ctx.kind, siteCode },
  ),
```

Repeat the include-in-key adjustment in `useCartMutations` (same file) and in `bootstrap-cart.ts`'s `getCurrent({ siteCode, legalEntityId })` call.

- [ ] **Step 2: Update `use-checkout.ts`**

Read `activeCompany?.id` and:
1. Include it as an extra tuple slot in the `emporixKey(…)` calls (mirrors the `use-cart.ts` change in step 1) so checkout state is per-company.
2. Inspect `packages/sdk/src/services/checkout.ts` and, for every method that builds an order payload (e.g. `createOrder`, `placeOrder` — actual names depend on the file), set `legalEntityId` on the request body when `activeCompany?.id` is set. If the existing SDK method doesn't accept `legalEntityId` in its typed input, extend its input type to include `legalEntityId?: string` (the wire schema accepts it) and pass it through. Add a single `checkout.legalEntityId.test.ts` case that asserts the body includes the field when the active company is set.

- [ ] **Step 3: Update `use-customer-addresses.ts`**

Include `legalEntityId` in `emporixKey` so the query refetches on company switch.

- [ ] **Step 4: Write a regression test**

`packages/react/tests/use-cart-company-aware.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCart } from "../src/hooks/use-cart";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
  ),
  http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
    HttpResponse.json({ access_token: "scoped", refresh_token: "r" }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts/cart-le-1", () =>
    HttpResponse.json({ id: "cart-le-1", siteCode: "main" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useCart is company-aware via query key", () => {
  it("query key tuple includes legalEntityId once active", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setCartId("cart-le-1");
    storage.set?.("emporix.refreshToken", "r");
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(
      () => ({ cart: useCart(), company: useActiveCompany() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.company.activeCompany?.id).toBe("le-1"));
    await waitFor(() => expect(result.current.cart.isSuccess).toBe(true));
    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    const cartKey = keys.find((k) => Array.isArray(k) && k[1] === "cart");
    expect(JSON.stringify(cartKey)).toContain("le-1");
  });
});
```

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk-react test
```
Expected: PASS — new test plus all existing cart/checkout/addresses tests still green (they previously passed `null` for legalEntityId; the addition is non-breaking because the key shape's extra slot is appended).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/src/hooks/internal/bootstrap-cart.ts packages/react/src/hooks/use-checkout.ts packages/react/src/hooks/use-customer-addresses.ts packages/react/tests/use-cart-company-aware.test.tsx
git commit -m "feat(react): thread legalEntityId into cart/checkout/addresses hooks

Active company id flows from CompanyContext into the query keys and
into cart.getCurrent / checkout order payloads. Cart and addresses
auto-invalidate on setActiveCompany.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: `examples/vite-spa` — CompanySwitcher + CompanyBadge

**Files:**
- Create: `examples/vite-spa/src/components/CompanySwitcher.tsx`
- Create: `examples/vite-spa/src/components/CompanyBadge.tsx`
- Modify: `examples/vite-spa/src/App.tsx`

- [ ] **Step 1: Create `CompanySwitcher`**

`examples/vite-spa/src/components/CompanySwitcher.tsx`:

```tsx
import { useCompanySwitcher } from "@viu/emporix-sdk-react";

export function CompanySwitcher() {
  const { companies, active, status, switch: switchTo, clear } = useCompanySwitcher();
  if (companies.length === 0) return null;
  return (
    <select
      aria-label="Active company"
      disabled={status === "switching"}
      value={active?.id ?? ""}
      onChange={(e) => {
        const value = e.target.value;
        if (value === "") void clear();
        else void switchTo(value);
      }}
    >
      <option value="">Privat (B2C)</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Create `CompanyBadge`**

`examples/vite-spa/src/components/CompanyBadge.tsx`:

```tsx
import { useActiveCompany } from "@viu/emporix-sdk-react";

export function CompanyBadge() {
  const { mode, activeCompany } = useActiveCompany();
  const label =
    mode === "b2b" ? activeCompany?.name ?? "" :
    mode === "b2c" ? "B2C" :
    "Bitte Firma wählen";
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: "#eef" }}>
      {label}
    </span>
  );
}
```

- [ ] **Step 3: Mount in `App.tsx`**

Add to the header area of `examples/vite-spa/src/App.tsx`:

```tsx
import { CompanySwitcher } from "./components/CompanySwitcher";
import { CompanyBadge } from "./components/CompanyBadge";
// …
<header>
  {/* existing brand */}
  <CompanyBadge />
  <CompanySwitcher />
</header>
```

(Adapt to the actual header markup; the imports + two element placements are what matters.)

- [ ] **Step 4: Build SDKs and typecheck examples**

Per the CLAUDE.md rule examples typecheck against built dist:

```
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-vite-spa typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/vite-spa/src/components/CompanySwitcher.tsx examples/vite-spa/src/components/CompanyBadge.tsx examples/vite-spa/src/App.tsx
git commit -m "feat(examples): add B2B company switcher + badge to vite-spa

CompanySwitcher renders only when myCompanies is non-empty. The
'Privat (B2C)' option clears the active company. CompanyBadge shows
the current mode in the header.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Docs — `b2b.md` + append to `auth.md` and `checkout.md`

**Files:**
- Create: `docs/b2b.md`
- Modify: `docs/auth.md`
- Modify: `docs/checkout.md`

- [ ] **Step 1: Write `docs/b2b.md`**

`docs/b2b.md`:

```markdown
# B2B Foundation

> Available since `@viu/emporix-sdk@<NEXT>` and `@viu/emporix-sdk-react@<NEXT>`.
> See `docs/superpowers/specs/2026-05-24-b2b-foundation-design.md` for the design rationale.

## Concepts

- **Legal Entity** — a company or subsidiary (`type: "COMPANY" | "SUBSIDIARY"`). Has an account limit, legal info, addresses, and assigned customer groups.
- **Contact Assignment** — links a customer to a legal entity with a type: `PRIMARY`, `BILLING`, `LOGISTICS`, or `CONTACT`.
- **Location** — a `HEADQUARTER`, `WAREHOUSE`, or `OFFICE` owned by a legal entity.
- **Customer Group** — IAM group keyed by `b2b.legalEntityId`. Predefined: Admin, Buyer, Requester, Contact.

## Active-company model

`useActiveCompany()` returns:

| Field | Meaning |
|---|---|
| `activeCompany: LegalEntity \| null` | `null` = B2C mode (no LE scope on token) |
| `myCompanies: LegalEntity[]` | All companies this customer is assigned to |
| `mode: "b2c" \| "b2b" \| "unresolved"` | `unresolved` = >1 companies, none picked yet |
| `status` | `"idle" \| "loading" \| "switching" \| "error"` |
| `setActiveCompany(id \| null)` | Eager refresh + cart-id drop + query invalidation |

Bootstrap behaviour:

- 0 companies → `mode: "b2c"`
- 1 company → auto-picked, `mode: "b2b"`
- >1 companies + no persisted pick → `mode: "unresolved"`, app must render a picker
- Persisted pick that matches → restored without refresh
- Persisted pick that doesn't match → silently dropped, falls back to 0/1/many logic

## Hooks

```ts
// Reads
useMyCompanies()             // UseQueryResult<LegalEntity[]>
useCompany(legalEntityId)    // UseQueryResult<LegalEntity>
useCompanyContacts(id)       // UseQueryResult<ContactAssignment[]>
useCompanyLocations(id)      // UseQueryResult<Location[]>
useCompanyGroups(id)         // UseQueryResult<IamGroup[]>

// Mutations (require *_manage scope on the customer token)
useCreateCompany / useUpdateCompany / useDeleteCompany
useAssignContact / useUpdateContactAssignment / useUnassignContact
useCreateLocation / useUpdateLocation / useDeleteLocation

// Convenience
useCompanySwitcher()         // { companies, active, status, switch(id), clear() }
```

## Storage keys

- `emporix.customerToken` — scoped to the active legal entity (or unscoped in B2C)
- `emporix.activeLegalEntityId` — local mirror of which company is active
- `emporix.cartId` — dropped on every `setActiveCompany` call

## Token scope

Switching company calls `customer.refresh({ refreshToken, legalEntityId })` which returns a new bearer token scoped to that entity. All subsequent SDK calls are evaluated against that scope on the server. Switching to `null` re-issues a non-scoped token.

## Insufficient scope

Mutation hooks throw `EmporixInsufficientScopeError` (extends `EmporixForbiddenError`) when the server returns 403 with a `missing scope:` hint. UI can switch off management controls based on `error.requiredScope`.

## SSR

`EmporixProvider` accepts `initialActiveLegalEntityId?: string | null` so server-rendered HTML matches the client bootstrap.
```

- [ ] **Step 2: Append to `docs/auth.md`**

Add a new section at the end:

```markdown
## Refresh with `legalEntityId` (B2B scope)

`customer.refresh({ refreshToken, legalEntityId })` re-issues a customer token scoped to the given legal entity. Omitting `legalEntityId` re-issues a non-scoped (B2C) token. Used internally by `setActiveCompany` in React; can be called directly from non-React hosts.

See [docs/b2b.md](./b2b.md) for the active-company model.
```

- [ ] **Step 3: Append to `docs/checkout.md`**

Add a note (anywhere in the doc that talks about order creation):

```markdown
> **B2B note**: when a customer is acting on behalf of a legal entity, the active company id is sent on order creation so the order is attached to the correct company. In React, this is automatic via `useActiveCompany`; non-React callers pass `legalEntityId` explicitly on checkout calls.
```

- [ ] **Step 4: Commit**

```bash
git add docs/b2b.md docs/auth.md docs/checkout.md
git commit -m "docs(docs): add b2b.md and link from auth and checkout

Concepts, active-company hook surface, storage keys, token scope
semantics, insufficient-scope behaviour, SSR hydration prop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: Changesets

**Files:**
- Create: `.changeset/b2b-foundation-sdk.md`
- Create: `.changeset/b2b-foundation-react.md`

- [ ] **Step 1: Create the SDK changeset**

`.changeset/b2b-foundation-sdk.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

B2B foundation:

- New `client.companies` / `client.contacts` / `client.locations` services over Customer Management (legal entities, contact assignments, locations).
- New `client.customerGroups` (read-only) over IAM (groups filtered by `b2b.legalEntityId`).
- New `EmporixInsufficientScopeError` subclass of `EmporixForbiddenError`, surfaced from 403 responses that carry a `missing scope: …` detail. Carries `requiredScope`.
- New `ServiceName` entries `"customer-management"` and `"iam"` for logger scoping.

No breaking changes. Existing `cart.getCurrent({ legalEntityId })` and `customer.refresh({ legalEntityId })` are now exercised in tests.
```

- [ ] **Step 2: Create the React changeset**

`.changeset/b2b-foundation-react.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

B2B foundation:

- New `CompanyContextProvider` (auto-mounted inside `EmporixProvider`) and `useActiveCompany()` hook.
- New B2B read hooks: `useMyCompanies`, `useCompany`, `useCompanyContacts`, `useCompanyLocations`, `useCompanyGroups`.
- New admin mutation hooks: `useCreateCompany`/`useUpdateCompany`/`useDeleteCompany`, `useAssignContact`/`useUpdateContactAssignment`/`useUnassignContact`, `useCreateLocation`/`useUpdateLocation`/`useDeleteLocation`.
- Convenience hook `useCompanySwitcher()`.
- New storage key `"emporix.activeLegalEntityId"` with `get`/`set`/`clear` helpers on every backend.
- New SSR prop `EmporixProvider.initialActiveLegalEntityId` for hydration.
- New telemetry event `{ kind: "company:switched", from, to, durationMs }`.
- `useCart`, `useCheckout`, `useCustomerAddresses` now include the active `legalEntityId` in their query keys and auto-invalidate on company switch.

Switching company calls `customer.refresh({ legalEntityId })` (eager token rescope), drops the stored cart id, and invalidates company-scoped queries.
```

- [ ] **Step 3: Verify changeset config**

```
pnpm changeset status
```
Expected: shows both packages will receive a minor bump.

- [ ] **Step 4: Commit**

```bash
git add .changeset
git commit -m "chore(release): add b2b foundation changesets

Two minor bumps — sdk gets four new services + InsufficientScopeError;
react gets CompanyContextProvider, eleven hooks, storage key,
telemetry event, SSR prop, and company-aware cart/checkout/addresses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run full test suite + typecheck + lint

```
pnpm install
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```
Expected: all green.

- [ ] Build packages (used by example typechecks downstream)

```
pnpm -r build
```
Expected: PASS.

- [ ] Examples typecheck against built dist

```
pnpm -F @viu/emporix-examples-vite-spa typecheck
pnpm -F @viu/emporix-examples-next-app-router typecheck
pnpm -F @viu/emporix-examples-node-server typecheck
```
Expected: all PASS.

- [ ] Push the branch and open the PR

```
git push -u origin feat/b2b-foundation
gh pr create --base main --title "feat: B2B foundation" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-05-24-b2b-foundation-design.md.

See docs/superpowers/plans/2026-05-24-b2b-foundation.md for the per-task breakdown. All 22 tasks landed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
