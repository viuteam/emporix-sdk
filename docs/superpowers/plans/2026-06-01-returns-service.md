# Returns Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **Returns Service** as a core SDK service, `client.returns` (6 CRUD ops), plus three React hooks for customer self-service.

**Architecture:** Types generated via `@hey-api/openapi-ts` and aliased in `returns-types.ts`. One `ReturnsService` defaults to the service token (overridable). Three React query/mutation hooks call the service with the browser customer context. create → `{ id }`; update/patch/delete → `void`.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, `@tanstack/react-query`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-returns-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `returns` spec URL |
| `packages/sdk/specs/returns.yml` | fetched OpenAPI |
| `packages/sdk/src/generated/returns/` | generated types |
| `packages/sdk/src/services/returns-types.ts` | public type aliases |
| `packages/sdk/src/services/returns.ts` | `ReturnsService` |
| `packages/sdk/src/returns.ts` | facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"returns"` to `ServiceName` |
| `packages/sdk/src/client.ts` | construct + expose `returns` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/returns-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/returns.test.ts` | MSW tests |
| `packages/sdk/tests/services/returns-wiring.test.ts` | wiring test |
| `packages/react/src/hooks/use-returns.ts` | 3 hooks |
| `packages/react/src/hooks/index.ts` | re-export the hooks |
| `packages/react/src/index.ts` | surface the hooks |
| `packages/react/tests/use-returns.test.tsx` | hook tests |
| `docs/returns.md` | usage doc |
| `docs/react.md` | mention the hooks |
| `CLAUDE.md` | service-list update |
| `.changeset/returns-service.md` | release entry (both packages) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/returns-service` off current `main`, commit spec + plan first:
```bash
git checkout main && git pull
git checkout -b feat/returns-service
git add docs/superpowers/specs/2026-06-01-returns-service-design.md docs/superpowers/plans/2026-06-01-returns-service.md
git commit -m "docs(sdk): add returns service design spec and plan"
```

---

## Task 1: Generate Returns types (codegen)

- [ ] **Step 1: Add the spec entry** — in `fetch-specs.ts`, after `shipping`:

```ts
  returns: `${BASE}/orders/returns/api-reference/api.yml`,
```

- [ ] **Step 2: Fetch + generate**

```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```

- [ ] **Step 3: Verify the generated names** — record for Task 2:

```bash
grep -nE "^export type (FullCustomerReturn|FullEmployeeReturn|ReturnCreateBody|ReturnUpdateBody|ReturnId) =" packages/sdk/src/generated/returns/types.gen.ts
```
Confirm the GET-single read shape (union vs single named type) and the list/create/update response codes:
```bash
grep -nE "body\??: [A-Za-z]|200:|201:|204:|url: '" packages/sdk/src/generated/returns/types.gen.ts | head -40
```

- [ ] **Step 4: Keep the change focused** — restore unrelated drift; stage only `returns` paths.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/returns.yml packages/sdk/src/generated/returns
git commit -m "feat(sdk): generate returns types"
```

---

## Task 2: Public types module

- [ ] **Step 1: Failing type test** — `packages/sdk/tests/services/returns-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Return, ReturnList, ReturnInput, ReturnUpdate, ReturnCreated } from "../../src/services/returns-types";

describe("returns types", () => {
  it("types are usable; ReturnCreated exposes id", () => {
    expectTypeOf<Return>().not.toBeNever();
    expectTypeOf<ReturnList>().toBeArray();
    expectTypeOf<ReturnInput>().not.toBeNever();
    expectTypeOf<ReturnUpdate>().not.toBeNever();
    const c = { id: "r1" } as ReturnCreated;
    expectTypeOf(c.id).toEqualTypeOf<string | undefined>();
  });
});
```

- [ ] **Step 2: Verify it fails** — `... | grep returns-types`.

- [ ] **Step 3: Write `returns-types.ts`** (swap names for the real generated ones):

```ts
/**
 * Public types for the Returns Service — stable names aliased over the generated
 * `returns` types. `Return` is the read shape (customer/employee variant union).
 */
import type {
  FullCustomerReturn,
  FullEmployeeReturn,
  ReturnCreateBody,
  ReturnUpdateBody,
  ReturnId,
} from "../generated/returns";

/** A return (read shape) — customer or employee variant. */
export type Return = FullCustomerReturn | FullEmployeeReturn;
/** Paged list of returns (`GET /returns`). */
export type ReturnList = Return[];
/** Create body (`POST /returns`). */
export type ReturnInput = ReturnCreateBody;
/** Update / patch body (`PUT` / `PATCH /returns/{id}`). */
export type ReturnUpdate = ReturnUpdateBody;
/** `POST /returns` response — the created return's `{ id }`. */
export type ReturnCreated = ReturnId;
```

> If the GET-single response is a single named type rather than a union, set
> `Return` to it. If the list is a paged envelope rather than an array, set
> `ReturnList` to that. Alias only — structural only for inlined schemas.

- [ ] **Step 4: Run test + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/returns-types.ts packages/sdk/tests/services/returns-types.test.ts
git commit -m "feat(sdk): add returns public types"
```

---

## Task 3: ReturnsService

- [ ] **Step 1: Failing service test** — `packages/sdk/tests/services/returns.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ReturnsService } from "../../src/services/returns";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "returns" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ReturnsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/return/acme/returns";

describe("ReturnsService", () => {
  it("listReturns GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "r1" }]);
      }),
    );
    await svc().listReturns();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getReturn fetches one by id", async () => {
    server.use(http.get(`${BASE}/r1`, () => HttpResponse.json({ id: "r1" })));
    expect((await svc().getReturn("r1")) as { id?: string }).toEqual({ id: "r1" });
  });

  it("getReturn throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getReturn("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createReturn POSTs the body and returns { id }", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "r1" }, { status: 201 });
      }),
    );
    const res = await svc().createReturn({ orderId: "o1" } as never);
    expect(body).toEqual({ orderId: "o1" });
    expect(res.id).toBe("r1");
  });

  it("updateReturn / patchReturn / deleteReturn resolve to void", async () => {
    server.use(
      http.put(`${BASE}/r1`, () => new HttpResponse(null, { status: 204 })),
      http.patch(`${BASE}/r1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/r1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().updateReturn("r1", { status: "APPROVED" } as never)).resolves.toBeUndefined();
    await expect(svc().patchReturn("r1", { status: "APPROVED" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteReturn("r1")).resolves.toBeUndefined();
  });

  it("listReturns forwards query params", async () => {
    let search = "";
    server.use(
      http.get(BASE, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    await svc().listReturns({ pageSize: 10, q: "status:OPEN" });
    expect(search).toContain("pageSize=10");
  });

  it("encodeURIComponent-escapes the return id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/return/acme/returns/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getReturn("a/b");
    expect(pathname).toBe("/return/acme/returns/a%2Fb");
  });
});
```

- [ ] **Step 2: Verify it fails** — module not found.

- [ ] **Step 3: Write `returns.ts` + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Return, ReturnList, ReturnInput, ReturnUpdate, ReturnCreated } from "./returns-types";

export type { Return, ReturnList, ReturnInput, ReturnUpdate, ReturnCreated } from "./returns-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Returns Service (`/return/{tenant}/returns`): CRUD over returns
 * (RMA). Defaults to the service token; for customer self-service (own returns)
 * pass `auth.customer(token)` (the React hooks do this).
 */
export class ReturnsService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/return/${this.ctx.tenant}/returns`;
  }

  /** List returns (paged; supports `pageSize`/`pageNumber`/`sort`/`q`). */
  async listReturns(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ReturnList> {
    return this.ctx.http.request<ReturnList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one return by id. */
  async getReturn(returnId: string, auth: AuthContext = SERVICE): Promise<Return> {
    return this.ctx.http.request<Return>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(returnId)}`,
      auth,
    });
  }

  /** Create a return. Returns the created `{ id }`. */
  async createReturn(input: ReturnInput, auth: AuthContext = SERVICE): Promise<ReturnCreated> {
    return this.ctx.http.request<ReturnCreated>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Replace a return by id. */
  async updateReturn(returnId: string, input: ReturnUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(returnId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a return by id. */
  async patchReturn(returnId: string, patch: ReturnUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/${encodeURIComponent(returnId)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a return by id. */
  async deleteReturn(returnId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(returnId)}`,
      auth,
    });
  }
}
```

Facade `packages/sdk/src/returns.ts`:

```ts
export * from "./services/returns";
```

- [ ] **Step 4: Run test + typecheck** — drop `as never` if the aliased inputs accept the literals.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/returns.ts packages/sdk/src/returns.ts packages/sdk/tests/services/returns.test.ts
git commit -m "feat(sdk): add returns service"
```

---

## Task 4: Wire onto EmporixClient

- [ ] **Step 1: Failing wiring test** — `packages/sdk/tests/services/returns-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { ReturnsService } from "../../src/services/returns";

describe("EmporixClient returns wiring", () => {
  it("exposes the returns service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.returns).toBeInstanceOf(ReturnsService);
  });
});
```

- [ ] **Step 2: Verify it fails.**

- [ ] **Step 3a: `ServiceName`** — add `| "returns"` after `| "shipping"`.
- [ ] **Step 3b: `client.ts`** — import `ReturnsService` after `ShippingService`; field `readonly returns: ReturnsService;` after `shipping`; construct `this.returns = new ReturnsService(mk("returns"));`.
- [ ] **Step 3c: barrel** — `export * from "./returns";` after `export * from "./shipping";`.

- [ ] **Step 4: Run wiring test, full suite, typecheck, build**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/returns-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk build
```

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/returns-wiring.test.ts
git commit -m "feat(sdk): expose returns service on the client"
```

---

## Task 5: React hooks — `useMyReturns`, `useReturn`, `useCreateReturn`

- [ ] **Step 1: Failing test** — `packages/react/tests/use-returns.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyReturns, useReturn, useCreateReturn } from "../src/hooks/use-returns";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io/return/acme/returns";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const storage = createMemoryStorage({ initial: "cust-tok" }); // logged-in customer
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useMyReturns", () => {
  it("lists the customer's returns with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "r1" }]);
      }),
    );
    const { result } = renderHook(() => useMyReturns(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenAuth).toBe("Bearer cust-tok");
  });
});

describe("useReturn", () => {
  it("fetches one return", async () => {
    server.use(http.get(`${BASE}/r1`, () => HttpResponse.json({ id: "r1" })));
    const { result } = renderHook(() => useReturn("r1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((result.current.data as { id?: string }).id).toBe("r1");
  });
});

describe("useCreateReturn", () => {
  it("creates a return and returns { id }", async () => {
    server.use(http.post(BASE, () => HttpResponse.json({ id: "r1" }, { status: 201 })));
    const { result } = renderHook(() => useCreateReturn(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ orderId: "o1" } as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("r1");
  });
});
```

- [ ] **Step 2: Verify it fails.**

- [ ] **Step 3: Write the hooks** — `packages/react/src/hooks/use-returns.ts`:

```ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Return, ReturnList, ReturnInput, ReturnCreated } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";
import { emporixKey } from "./internal/query-keys";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "returns"] as const;

/** The signed-in customer's returns (customer-only). */
export function useMyReturns(opts: { query?: Record<string, string | number> } = {}): UseQueryResult<ReturnList> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("returns", [opts.query ?? null], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.returns.listReturns(opts.query ?? {}, ctx),
    staleTime: STALE,
  });
}

/** A single return by id (customer-only). */
export function useReturn(returnId: string | undefined): UseQueryResult<Return> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("returns", [returnId ?? null], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.returns.getReturn(returnId as string, ctx),
    enabled: Boolean(returnId),
    staleTime: STALE,
  });
}

/** Create a return for the signed-in customer. Invalidates the returns list. */
export function useCreateReturn(): UseMutationResult<ReturnCreated, unknown, ReturnInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReturnInput) => client.returns.createReturn(input, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
```

- [ ] **Step 4: Re-export the hooks**

In `packages/react/src/hooks/index.ts`:
```ts
export { useMyReturns, useReturn, useCreateReturn } from "./use-returns";
```
In `packages/react/src/index.ts`, add `useMyReturns`, `useReturn`, `useCreateReturn` to the `export { … } from "./hooks/index";` block.

- [ ] **Step 5: Run test + typecheck** — hook tests + full react suite + typecheck.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-returns.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-returns.test.tsx
git commit -m "feat(react): add returns self-service hooks"
```

---

## Task 6: Documentation

- [ ] **Step 1: `docs/returns.md`**

````markdown
# Returns Service

Bindings for the Emporix **Returns Service** (`/return/{tenant}/returns`): CRUD
over returns (RMA).

> **Mixed audience.** Defaults to the service token. A customer can manage their
> own returns (`returns_*_own`) — pass `auth.customer(token)`, or use the React
> hooks (below). There is no dedicated storefront token scheme; the customer
> token is an OAuth2 bearer.

## Core — `client.returns`

```ts
const list = await client.returns.listReturns({ pageSize: 20, q: "status:OPEN" });
const r = await client.returns.getReturn("return-id");
const { id } = await client.returns.createReturn({ /* … */ });
await client.returns.updateReturn("return-id", { /* … */ });
await client.returns.patchReturn("return-id", { /* … */ });
await client.returns.deleteReturn("return-id");
```

## React hooks (customer self-service)

```tsx
import { useMyReturns, useReturn, useCreateReturn } from "@viu/emporix-sdk-react";

const { data: myReturns } = useMyReturns();
const { data: one } = useReturn("return-id");
const create = useCreateReturn();
const { id } = await create.mutateAsync({ /* … */ });
```

The hooks require a logged-in customer (they throw without a stored token) and
use the customer token.
````

- [ ] **Step 2: Mention in `docs/react.md`** — add a short "Returns" subsection (before `## Errors`) listing the three hooks (customer-only).

- [ ] **Step 3: CLAUDE.md** — append `Returns` to the service list:

```
…, Country, Currency, Shipping, Returns) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 4: Commit**

```bash
git add docs/returns.md docs/react.md CLAUDE.md
git commit -m "docs(sdk): document the returns service and hooks"
```

---

## Task 7: Changeset

- [ ] **Step 1: `.changeset/returns-service.md`**

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix Returns Service bindings via `client.returns`: CRUD over returns
(`listReturns`, `getReturn`, `createReturn`, `updateReturn`, `patchReturn`,
`deleteReturn`). Methods default to the service token and are auth-overridable.
Adds React hooks `useMyReturns`, `useReturn`, and `useCreateReturn` for customer
self-service (browser customer token).
```

- [ ] **Step 2: Verify** — `pnpm changeset status` (both packages minor).

- [ ] **Step 3: Commit**

```bash
git add .changeset/returns-service.md
git commit -m "chore(release): add returns service changeset"
```

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test && pnpm -F @viu/emporix-sdk-react typecheck && pnpm -F @viu/emporix-sdk-react lint
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 full CRUD → 6 methods in Task 3 + tests. D2 one service → Task 4. D3 service-token default, overridable → `const SERVICE`; hooks pass customer ctx. D4 three React hooks (customer-only) → Task 5 + exports + react test. D5 codegen + aliasing (`Return` union, create→`{ id }`, update/patch/delete→void) → Tasks 1+2. Docs/changeset → Tasks 6/7 (both packages). No gaps.
- **Placeholder scan:** No TBD/TODO. Full code throughout. Upstream-dependent uncertainties (read union vs single, list envelope, response codes) are concrete `grep`/note verifications with fallbacks.
- **Type consistency:** Public names `Return`/`ReturnList`/`ReturnInput`/`ReturnUpdate`/`ReturnCreated` identical across Task 2 (defs), Task 3 (imports + re-exports), and the tests. `Return`/`ReturnList`/`ReturnInput`/`ReturnCreated` imported by the hooks from `@viu/emporix-sdk` (requires the Task 4 build before Task 5). Base path `/return/${tenant}/returns` matches the spec and tests. Logger `"returns"` matches `mk("returns")` and the `ServiceName` addition. Commit scopes `sdk`/`react`/`release`, lowercase verbs (commitlint-safe).
```
